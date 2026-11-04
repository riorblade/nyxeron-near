//! NYXERON stock units: NEP-245 multi tokens, each unit a claim on stock tokens held in the warehouse.
//!
//! The warehouse is the contract's own balance. Only the owner (the api account) mints into it, with a proof that
//! stock was bought, and settles parties out of it to guests. Players hold units in their own NEAR accounts.

use near_sdk::{
    AccountId, BorshStorageKey, PanicOnDefault, env,
    json_types::U128,
    near, require,
    store::{IterableMap, LookupSet},
};
use near_sdk_contract_tools::hook::Hook;
use near_sdk_contract_tools::mt::{
    Nep245Burn, Nep245Controller, Nep245Mint, Nep245Transfer,
    nep245::metadata::{BaseMetadata, ContractMetadata, MetadataController, TokenMetadata},
    *,
};

/// Most transfers one `settle` call may carry. Each emits an `mt_transfer` event and NEAR caps a call's logs at
/// 16 KiB, so this is set from the longest possible event (sandbox test `settle_max_batch_fits`), not from gas.
pub const MAX_SETTLE_TRANSFERS: usize = 32;
/// Longest token id or op id. Both go into every settle event.
pub const MAX_KEY_LEN: usize = 64;
/// Longest proof or write-off reason. A Solana signature is 88 chars, a NEAR tx hash 44.
pub const MAX_PROOF_LEN: usize = 128;

/// near-sdk-contract-tools 4.0.0 reads both balances before writing either, so a transfer to yourself adds `amount`
/// out of thin air. Refuse it before the transfer runs.
pub struct NoSelfTransfer;

impl<C> Hook<C, Nep245Transfer<'_>> for NoSelfTransfer {
    fn hook<R>(contract: &mut C, transfer: &Nep245Transfer<'_>, f: impl FnOnce(&mut C) -> R) -> R {
        require!(
            transfer.sender_id != transfer.receiver_id,
            "sender and receiver must differ"
        );
        f(contract)
    }
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct TokenInfo {
    /// Ticker shown to players, e.g. "TSLA".
    pub symbol: String,
    /// What backs the units, e.g. "solana:<xStock mint>" or "near:<Ondo token contract>".
    pub backing: String,
    /// Shares one unit stands for, as a decimal string, e.g. "0.001".
    pub shares_per_unit: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct SettleTransfer {
    pub account_id: AccountId,
    pub token_id: String,
    pub amount: U128,
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Tokens,
    UsedProofs,
    Settled,
}

#[derive(PanicOnDefault, Nep245, Nep245Metadata)]
#[nep245(
    load_token_metadata = "TokenMetadata",
    transfer_hook = "NoSelfTransfer"
)]
#[near(contract_state)]
pub struct Contract {
    owner_id: AccountId,
    paused: bool,
    token_info: IterableMap<String, TokenInfo>,
    used_proofs: LookupSet<String>,
    settled: LookupSet<String>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        let mut contract = Self {
            owner_id,
            paused: false,
            token_info: IterableMap::new(StorageKey::Tokens),
            used_proofs: LookupSet::new(StorageKey::UsedProofs),
            settled: LookupSet::new(StorageKey::Settled),
        };
        contract.set_contract_metadata(&ContractMetadata::new("NYXERON stock units"));
        contract
    }

    /// Adds a stock to the whitelist. Units of it can be minted from then on.
    pub fn register_token(&mut self, token_id: String, info: TokenInfo) {
        self.require_owner();
        require_len(&token_id, "token_id", MAX_KEY_LEN);
        require!(
            !self.token_info.contains_key(&token_id),
            "token already registered"
        );

        self.create_token(token_id.clone())
            .unwrap_or_else(|e| env::panic_str(&e.to_string()));
        self.create_base_metadata(
            BaseMetadata::new(info.symbol.clone(), token_id.clone())
                .symbol(info.symbol.clone())
                .decimals(near_sdk::json_types::U64(0)),
        )
        .unwrap_or_else(|e| env::panic_str(&e.to_string()));
        self.set_token_metadata(
            &token_id,
            token_id.clone(),
            TokenMetadata::new()
                .title(format!("{} stock unit", info.symbol))
                .description(format!(
                    "1 unit = {} share, backed by {}",
                    info.shares_per_unit, info.backing
                )),
        )
        .unwrap_or_else(|e| env::panic_str(&e.to_string()));
        self.token_info.insert(token_id, info);
    }

    /// Mints `amount` units into the warehouse. `proof` (the purchase tx) can back one mint only.
    pub fn mint_warehouse(&mut self, token_id: String, amount: U128, proof: String) {
        self.require_owner();
        self.require_not_paused();
        self.require_registered(&token_id);
        require!(amount.0 > 0, "amount must be positive");
        require_len(&proof, "proof", MAX_PROOF_LEN);
        require!(self.used_proofs.insert(proof.clone()), "proof already used");

        let warehouse = env::current_account_id();
        Nep245Controller::mint(
            self,
            &Nep245Mint::single(token_id, amount.0, warehouse).memo(proof),
        )
        .unwrap_or_else(|e| env::panic_str(&e.to_string()));
    }

    /// Moves units from the warehouse to guests, all or nothing. `op_id` (e.g. "party:42") runs once.
    pub fn settle(&mut self, op_id: String, transfers: Vec<SettleTransfer>) {
        self.require_owner();
        self.require_not_paused();
        require_len(&op_id, "op_id", MAX_KEY_LEN);
        require!(!transfers.is_empty(), "no transfers");
        require!(
            transfers.len() <= MAX_SETTLE_TRANSFERS,
            "too many transfers"
        );
        require!(self.settled.insert(op_id.clone()), "op_id already settled");

        let warehouse = env::current_account_id();
        for t in &transfers {
            self.require_registered(&t.token_id);
            require!(t.amount.0 > 0, "amount must be positive");
            require!(t.account_id != warehouse, "cannot settle to the warehouse");
            Nep245Controller::transfer(
                self,
                &Nep245Transfer::single(
                    &warehouse,
                    &t.account_id,
                    t.token_id.as_str(),
                    t.amount.0,
                    Some(op_id.as_str()),
                ),
            )
            .unwrap_or_else(|e| env::panic_str(&e.to_string()));
        }
    }

    /// Burns units from the warehouse that no longer exist (lost or written off). Works while paused.
    pub fn write_off(&mut self, token_id: String, amount: U128, reason: String) {
        self.require_owner();
        self.require_registered(&token_id);
        require!(amount.0 > 0, "amount must be positive");
        require_len(&reason, "reason", MAX_PROOF_LEN);

        let warehouse = env::current_account_id();
        Nep245Controller::burn(
            self,
            &Nep245Burn::single(token_id, amount.0, warehouse).memo(reason),
        )
        .unwrap_or_else(|e| env::panic_str(&e.to_string()));
    }

    /// Stops `mint_warehouse` and `settle`. Holders can still move their units.
    pub fn set_paused(&mut self, paused: bool) {
        self.require_owner();
        self.paused = paused;
    }

    pub fn tokens(&self) -> Vec<(String, TokenInfo)> {
        self.token_info
            .iter()
            .map(|(id, info)| (id.clone(), info.clone()))
            .collect()
    }

    pub fn is_used_proof(&self, proof: String) -> bool {
        self.used_proofs.contains(&proof)
    }

    pub fn is_settled(&self, op_id: String) -> bool {
        self.settled.contains(&op_id)
    }

    pub fn is_paused(&self) -> bool {
        self.paused
    }

    pub fn owner_id(&self) -> AccountId {
        self.owner_id.clone()
    }
}

impl Contract {
    fn require_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "only the owner"
        );
    }

    fn require_not_paused(&self) {
        require!(!self.paused, "paused");
    }

    fn require_registered(&self, token_id: &String) {
        require!(self.token_info.contains_key(token_id), "unknown token");
    }
}

fn require_len(value: &str, name: &str, max: usize) {
    if value.is_empty() || value.len() > max {
        env::panic_str(&format!("{name} must be 1 to {max} bytes"));
    }
}

#[cfg(test)]
mod tests;
