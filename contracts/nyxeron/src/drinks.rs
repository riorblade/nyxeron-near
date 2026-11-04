//! Drink payments (SPEC §5.2, §6). A guest pays USDC with `ft_transfer_call` and a quote the api signed. The contract
//! checks the quote, sends the margin to the party's CEO, keeps the wholesale for the party and records the units it
//! owes the guest. Anything wrong refunds the whole payment: `ft_on_transfer` returns the full amount instead of
//! panicking, so the reason is logged.

use crate::*;
use near_sdk::{
    Gas, NearToken, Promise, PromiseError, PromiseOrValue, PublicKey,
    json_types::Base64VecU8,
    serde_json::{self, json},
};

/// Longest quote JSON accepted, in bytes. A quote with 64-byte ids and accounts is about 400.
pub const MAX_QUOTE_LEN: usize = 1024;
/// Most (guest, token) entries a party may owe. Every purchase reads and rewrites the party's list, so this bounds
/// its gas; a guest already on the list can keep buying.
pub const MAX_OWED_PER_PARTY: usize = 256;
/// Gas for the USDC `ft_transfer` and for our callback after it.
const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_FOR_CALLBACK: Gas = Gas::from_tgas(5);

/// `msg` of the guest's `ft_transfer_call`.
#[near(serializers = [json])]
struct PayMsg {
    /// The quote JSON bytes, exactly as the api signed them.
    quote: Base64VecU8,
    /// ed25519 signature over `quote`, 64 bytes.
    sig: Base64VecU8,
}

/// What the api signs. Amounts are micro-USDC; 1 unit = `shares_per_unit` of the token.
#[near(serializers = [json])]
pub struct Quote {
    pub v: u32,
    pub id: String,
    pub party: String,
    pub buyer: AccountId,
    pub ceo: AccountId,
    pub token: String,
    pub qty: u64,
    pub unit_price: U128,
    pub unit_wholesale: U128,
    pub expires_ms: u64,
}

/// Wholesale held for a party, whether it was released to the treasury (no more purchases after that), and the
/// CEO fixed by the party's first purchase (later quotes naming anyone else are refunded).
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PartyPot {
    pub held: U128,
    pub released: bool,
    pub ceo: Option<AccountId>,
}

/// Units still owed to one guest for one party.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Owed {
    pub account_id: AccountId,
    pub token_id: String,
    pub qty: U128,
}

#[near(serializers = [json])]
pub struct Config {
    pub owner_id: AccountId,
    pub usdc: Option<AccountId>,
    pub treasury: Option<AccountId>,
    pub quote_key: Option<PublicKey>,
    pub paused: bool,
}

struct Purchase {
    quote: Quote,
    total: u128,
    wholesale: u128,
}

#[near]
impl Contract {
    /// NEP-141 receiver: the guest's payment for a drink. Returns what to refund: 0 when accepted, all of it otherwise.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        match self.check_purchase(&sender_id, amount.0, &msg) {
            Ok(purchase) => {
                self.record_purchase(purchase);
                PromiseOrValue::Value(U128(0))
            }
            Err(reason) => {
                emit(
                    "refund",
                    json!({ "sender_id": sender_id, "amount": amount, "reason": reason }),
                );
                PromiseOrValue::Value(amount)
            }
        }
    }

    /// The ed25519 key the api signs quotes with. Quotes signed by an older key stop working.
    pub fn set_quote_key(&mut self, public_key: PublicKey) {
        self.require_owner();
        require!(
            public_key.curve_type() == near_sdk::CurveType::ED25519,
            "quote key must be ed25519"
        );
        self.quote_key = Some(public_key);
    }

    /// The USDC contract payments come from. Set once: pots and margins are kept in it.
    pub fn set_usdc(&mut self, account_id: AccountId) {
        self.require_owner();
        require!(self.usdc.is_none(), "usdc already set");
        self.usdc = Some(account_id);
    }

    /// Where `release_wholesale` sends a party's wholesale, to buy the stock.
    pub fn set_treasury(&mut self, account_id: AccountId) {
        self.require_owner();
        require!(
            account_id != env::current_account_id(),
            "treasury cannot be this contract"
        );
        self.treasury = Some(account_id);
    }

    /// Sends the party's wholesale to the treasury and closes the party to new purchases. If the transfer fails the
    /// pot is restored and this can run again; once the pot is out it refuses.
    pub fn release_wholesale(&mut self, party: String) -> PromiseOrValue<U128> {
        self.require_owner();
        self.require_not_paused();
        require_len(&party, "party", MAX_KEY_LEN);
        let usdc = self
            .usdc
            .clone()
            .unwrap_or_else(|| env::panic_str("usdc not set"));
        let treasury = self
            .treasury
            .clone()
            .unwrap_or_else(|| env::panic_str("treasury not set"));
        let mut pot = self.pots.get(&party).cloned().unwrap_or_default();
        require!(!(pot.released && pot.held.0 == 0), "already released");
        let amount = pot.held.0;
        pot.held = U128(0);
        pot.released = true;
        self.pots.insert(party.clone(), pot);
        if amount == 0 {
            return PromiseOrValue::Value(U128(0));
        }
        PromiseOrValue::Promise(
            ft_transfer(usdc, &treasury, amount, &format!("release:{party}")).then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_CALLBACK)
                    .on_wholesale_released(party, U128(amount)),
            ),
        )
    }

    #[private]
    pub fn on_wholesale_released(
        &mut self,
        party: String,
        amount: U128,
        #[callback_result] sent: Result<(), PromiseError>,
    ) -> U128 {
        if sent.is_ok() {
            emit("release", json!({ "party": party, "amount": amount }));
            return amount;
        }
        // Back in the pot so the owner can retry; the party stays closed.
        let mut pot = self.pots.get(&party).cloned().unwrap_or_default();
        pot.held = U128(pot.held.0 + amount.0);
        self.pots.insert(party.clone(), pot);
        emit(
            "release_failed",
            json!({ "party": party, "amount": amount }),
        );
        U128(0)
    }

    /// A CEO collects margin whose direct transfer failed (e.g. not registered on USDC at the time).
    pub fn claim_margin(&mut self) -> Promise {
        let ceo = env::predecessor_account_id();
        let amount = self.claimable.remove(&ceo).unwrap_or(0);
        require!(amount > 0, "nothing to claim");
        let usdc = self
            .usdc
            .clone()
            .unwrap_or_else(|| env::panic_str("usdc not set"));
        self.send_margin(usdc, ceo, amount, "claim")
    }

    #[private]
    pub fn on_margin_sent(
        &mut self,
        ceo: AccountId,
        amount: U128,
        #[callback_result] sent: Result<(), PromiseError>,
    ) {
        if sent.is_err() {
            let held = self.claimable.get(&ceo).copied().unwrap_or(0);
            self.claimable.insert(ceo.clone(), held + amount.0);
            emit("margin_held", json!({ "ceo": ceo, "amount": amount }));
        }
    }

    pub fn config(&self) -> Config {
        Config {
            owner_id: self.owner_id.clone(),
            usdc: self.usdc.clone(),
            treasury: self.treasury.clone(),
            quote_key: self.quote_key.clone(),
            paused: self.paused,
        }
    }

    /// Units still to settle for a party, per guest and token.
    pub fn owed(&self, party: String) -> Vec<Owed> {
        self.owed.get(&party).cloned().unwrap_or_default()
    }

    pub fn party_pot(&self, party: String) -> PartyPot {
        self.pots.get(&party).cloned().unwrap_or_default()
    }

    pub fn claimable_margin(&self, account_id: AccountId) -> U128 {
        U128(self.claimable.get(&account_id).copied().unwrap_or(0))
    }

    pub fn is_used_quote(&self, id: String) -> bool {
        self.used_quotes.contains(&id)
    }
}

impl Contract {
    /// Every check, before any state changes. The error is the refund reason that goes into the log.
    fn check_purchase(
        &self,
        sender_id: &AccountId,
        amount: u128,
        msg: &str,
    ) -> Result<Purchase, &'static str> {
        if self.usdc.as_ref() != Some(&env::predecessor_account_id()) {
            return Err("wrong_token");
        }
        if self.paused {
            return Err("paused");
        }
        let key = self.quote_key.as_ref().ok_or("no_quote_key")?;
        let pay: PayMsg = serde_json::from_str(msg).map_err(|_| "bad_msg")?;
        let quote_bytes = pay.quote.0;
        if quote_bytes.len() > MAX_QUOTE_LEN {
            return Err("bad_msg");
        }
        let sig: &[u8; 64] = pay
            .sig
            .0
            .as_slice()
            .try_into()
            .map_err(|_| "bad_signature")?;
        let key: &[u8; 32] = key.as_bytes()[1..].try_into().map_err(|_| "no_quote_key")?;
        if !env::ed25519_verify(sig, &quote_bytes, key) {
            return Err("bad_signature");
        }
        let quote: Quote = serde_json::from_slice(&quote_bytes).map_err(|_| "bad_quote")?;
        if quote.v != 1 {
            return Err("bad_version");
        }
        if !fits(&quote.id) || !fits(&quote.party) || quote.ceo == env::current_account_id() {
            return Err("bad_quote");
        }
        if self.used_quotes.contains(&quote.id) {
            return Err("quote_used");
        }
        if &quote.buyer != sender_id {
            return Err("buyer_mismatch");
        }
        if !self.token_info.contains_key(&quote.token) {
            return Err("unknown_token");
        }
        if quote.qty == 0 {
            return Err("bad_qty");
        }
        if env::block_timestamp_ms() > quote.expires_ms {
            return Err("expired");
        }
        let (price, wholesale) = (quote.unit_price.0, quote.unit_wholesale.0);
        let ceiling = wholesale.checked_mul(MAX_MARKUP).ok_or("bad_price")?;
        if wholesale == 0 || price < wholesale || price > ceiling {
            return Err("bad_price");
        }
        let qty = u128::from(quote.qty);
        let total = price.checked_mul(qty).ok_or("bad_amount")?;
        if amount != total {
            return Err("bad_amount");
        }
        if let Some(pot) = self.pots.get(&quote.party) {
            if pot.released {
                return Err("party_closed");
            }
            if pot.ceo.as_ref().is_some_and(|ceo| *ceo != quote.ceo) {
                return Err("ceo_mismatch");
            }
        }
        if let Some(owed) = self.owed.get(&quote.party)
            && owed.len() >= MAX_OWED_PER_PARTY
            && !owed
                .iter()
                .any(|o| o.account_id == quote.buyer && o.token_id == quote.token)
        {
            return Err("party_full");
        }
        Ok(Purchase {
            total,
            wholesale: wholesale * qty,
            quote,
        })
    }

    fn record_purchase(&mut self, p: Purchase) {
        let q = p.quote;
        let margin = p.total - p.wholesale;
        self.used_quotes.insert(q.id.clone());

        let mut pot = self.pots.get(&q.party).cloned().unwrap_or_default();
        pot.held = U128(pot.held.0 + p.wholesale);
        pot.ceo.get_or_insert_with(|| q.ceo.clone());
        self.pots.insert(q.party.clone(), pot);

        let mut owed = self.owed.get(&q.party).cloned().unwrap_or_default();
        let qty = u128::from(q.qty);
        match owed
            .iter_mut()
            .find(|o| o.account_id == q.buyer && o.token_id == q.token)
        {
            Some(o) => o.qty = U128(o.qty.0 + qty),
            None => owed.push(Owed {
                account_id: q.buyer.clone(),
                token_id: q.token.clone(),
                qty: U128(qty),
            }),
        }
        self.owed.insert(q.party.clone(), owed);

        emit(
            "purchase",
            json!({
                "id": q.id, "party": q.party, "buyer": q.buyer, "ceo": q.ceo, "token": q.token,
                "qty": U128(qty), "total": U128(p.total), "margin": U128(margin),
            }),
        );
        if margin > 0 {
            let usdc = env::predecessor_account_id();
            // Detached: the guest's payment is final either way, a failed transfer becomes claimable.
            self.send_margin(usdc, q.ceo, margin, &q.id).detach();
        }
    }

    fn send_margin(&self, usdc: AccountId, ceo: AccountId, amount: u128, memo: &str) -> Promise {
        ft_transfer(usdc, &ceo, amount, &format!("margin:{memo}")).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_CALLBACK)
                .on_margin_sent(ceo, U128(amount)),
        )
    }

    /// Takes `qty` off what `account_id` is owed for `party`; panics if that is more than owed.
    pub(crate) fn take_owed(
        &mut self,
        party: &str,
        account_id: &AccountId,
        token_id: &str,
        qty: u128,
    ) {
        let mut owed = self.owed.get(party).cloned().unwrap_or_default();
        let at = owed
            .iter()
            .position(|o| &o.account_id == account_id && o.token_id == token_id)
            .unwrap_or_else(|| env::panic_str("more than owed"));
        let left = owed[at]
            .qty
            .0
            .checked_sub(qty)
            .unwrap_or_else(|| env::panic_str("more than owed"));
        if left == 0 {
            owed.swap_remove(at);
        } else {
            owed[at].qty = U128(left);
        }
        if owed.is_empty() {
            self.owed.remove(party);
        } else {
            self.owed.insert(party.to_string(), owed);
        }
    }
}

/// Highest price over wholesale a quote may carry (`MAX_MARKUP` in packages/game).
const MAX_MARKUP: u128 = 3;

fn fits(value: &str) -> bool {
    !value.is_empty() && value.len() <= MAX_KEY_LEN
}

fn ft_transfer(usdc: AccountId, receiver_id: &AccountId, amount: u128, memo: &str) -> Promise {
    Promise::new(usdc).function_call(
        "ft_transfer".to_string(),
        json!({ "receiver_id": receiver_id, "amount": U128(amount), "memo": memo })
            .to_string()
            .into_bytes(),
        NearToken::from_yoctonear(1),
        GAS_FOR_FT_TRANSFER,
    )
}

/// NEP-297 event: `EVENT_JSON:{"standard":"nyxeron","version":"1.0.0","event":…,"data":[…]}`.
fn emit(event: &str, data: serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "nyxeron", "version": "1.0.0", "event": event, "data": [data] })
    ));
}
