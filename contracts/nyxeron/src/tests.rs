use near_sdk::{NearToken, test_utils::VMContextBuilder, testing_env};

use super::*;

fn owner() -> AccountId {
    "api.testnet".parse().unwrap()
}

fn warehouse() -> AccountId {
    "nyxeron.testnet".parse().unwrap()
}

fn guest(n: u32) -> AccountId {
    format!("guest{n}.testnet").parse().unwrap()
}

fn as_caller(caller: &AccountId, deposit: NearToken) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(warehouse())
            .predecessor_account_id(caller.clone())
            .attached_deposit(deposit)
            .block_timestamp(NOW_MS * 1_000_000)
            .build()
    );
}

/// Block time in the mock; quotes from `quote()` expire at `NOW_MS + 1000`.
const NOW_MS: u64 = 1_793_780_000_000;

fn tsla() -> TokenInfo {
    TokenInfo {
        symbol: "TSLA".into(),
        backing: "robinhood:0x0000000000000000000000000000000000000001".into(),
        shares_per_unit: "0.001".into(),
    }
}

/// Contract with `tsla` registered, 100 units in the warehouse, USDC and the quote key configured, and party `p1`
/// owing guests 0..=33 100 units each (enough for any settle below; settling past the stock still fails on stock).
fn setup() -> Contract {
    let mut c = bare();
    for n in 0..=MAX_SETTLE_TRANSFERS as u32 {
        pay(&mut c, &quote("p1", &guest(n), 100));
    }
    as_caller(&owner(), NearToken::from_yoctonear(0));
    c
}

/// `setup` without any purchases.
fn bare() -> Contract {
    as_caller(&owner(), NearToken::from_yoctonear(0));
    let mut c = Contract::new(owner());
    c.register_token("tsla".into(), tsla());
    c.mint_warehouse("tsla".into(), U128(100), "sol-tx-1".into());
    c.set_usdc(usdc());
    c.set_treasury(treasury());
    c.set_quote_key(quote_key_public());
    c
}

fn usdc() -> AccountId {
    "usdc.testnet".parse().unwrap()
}

fn treasury() -> AccountId {
    "treasury.testnet".parse().unwrap()
}

fn ceo() -> AccountId {
    "ceo.testnet".parse().unwrap()
}

fn quote_key() -> ed25519_dalek::SigningKey {
    ed25519_dalek::SigningKey::from_bytes(&[7; 32])
}

fn quote_key_public() -> near_sdk::PublicKey {
    near_sdk::PublicKey::from_parts(
        near_sdk::CurveType::ED25519,
        quote_key().verifying_key().to_bytes().to_vec(),
    )
    .unwrap()
}

static NEXT_QUOTE: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

/// A valid quote: `qty` tsla at 0.41 USDC with 0.39 wholesale, for `buyer` at `party`.
fn quote(party: &str, buyer: &AccountId, qty: u64) -> Quote {
    Quote {
        v: 1,
        id: format!(
            "q{}",
            NEXT_QUOTE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ),
        party: party.into(),
        buyer: buyer.clone(),
        ceo: ceo(),
        token: "tsla".into(),
        qty,
        unit_price: U128(410_000),
        unit_wholesale: U128(390_000),
        expires_ms: NOW_MS + 1_000,
    }
}

/// The `msg` a guest's client sends: the quote bytes and the api's signature over them.
fn signed(q: &Quote, key: &ed25519_dalek::SigningKey) -> String {
    use ed25519_dalek::Signer;
    let bytes = near_sdk::serde_json::to_vec(q).unwrap();
    let sig = key.sign(&bytes).to_bytes().to_vec();
    near_sdk::serde_json::json!({
        "quote": near_sdk::json_types::Base64VecU8::from(bytes),
        "sig": near_sdk::json_types::Base64VecU8::from(sig),
    })
    .to_string()
}

fn total(q: &Quote) -> U128 {
    U128(q.unit_price.0.wrapping_mul(u128::from(q.qty)))
}

/// USDC calls `ft_on_transfer` for the buyer's payment of exactly the quoted total. Returns the refund.
fn pay(c: &mut Contract, q: &Quote) -> u128 {
    pay_with(
        c,
        &usdc(),
        q.buyer.clone(),
        total(q),
        signed(q, &quote_key()),
    )
}

fn pay_with(
    c: &mut Contract,
    token: &AccountId,
    sender: AccountId,
    amount: U128,
    msg: String,
) -> u128 {
    as_caller(token, NearToken::from_yoctonear(0));
    match c.ft_on_transfer(sender, amount, msg) {
        near_sdk::PromiseOrValue::Value(refund) => refund.0,
        near_sdk::PromiseOrValue::Promise(_) => panic!("ft_on_transfer returns a value"),
    }
}

fn send(account: AccountId, amount: u128) -> SettleTransfer {
    SettleTransfer {
        account_id: account,
        token_id: "tsla".into(),
        amount: U128(amount),
    }
}

fn balance(c: &Contract, account: &AccountId) -> u128 {
    c.balance_of("tsla", account)
}

#[test]
fn mint_goes_to_the_warehouse_and_records_the_proof() {
    let c = setup();
    assert_eq!(balance(&c, &warehouse()), 100);
    assert_eq!(c.supply("tsla"), Some(100));
    assert!(c.is_used_proof("sol-tx-1".into()));
    assert!(!c.is_used_proof("sol-tx-2".into()));
    assert_eq!(c.tokens(), vec![("tsla".to_string(), tsla())]);
}

#[test]
#[should_panic(expected = "proof already used")]
fn the_same_proof_mints_once() {
    let mut c = setup();
    c.mint_warehouse("tsla".into(), U128(5), "sol-tx-1".into());
}

#[test]
fn settle_moves_units_from_the_warehouse_to_guests() {
    let mut c = setup();
    c.settle(
        "p1".into(),
        "party:1".into(),
        vec![send(guest(1), 3), send(guest(2), 7)],
    );
    assert_eq!(balance(&c, &guest(1)), 3);
    assert_eq!(balance(&c, &guest(2)), 7);
    assert_eq!(balance(&c, &warehouse()), 90);
    assert_eq!(c.supply("tsla"), Some(100));
    assert!(c.is_settled("party:1".into()));
}

#[test]
#[should_panic(expected = "op_id already settled")]
fn the_same_op_settles_once() {
    let mut c = setup();
    c.settle("p1".into(), "party:1".into(), vec![send(guest(1), 3)]);
    c.settle("p1".into(), "party:1".into(), vec![send(guest(1), 3)]);
}

#[test]
#[should_panic]
fn settle_above_warehouse_stock_fails() {
    let mut c = setup();
    c.settle(
        "p1".into(),
        "party:1".into(),
        vec![send(guest(1), 60), send(guest(2), 41)],
    );
}

#[test]
#[should_panic(expected = "too many transfers")]
fn settle_has_a_batch_limit() {
    let mut c = setup();
    let transfers = (0..=MAX_SETTLE_TRANSFERS as u32)
        .map(|n| send(guest(n), 1))
        .collect();
    c.settle("p1".into(), "party:1".into(), transfers);
}

#[test]
#[should_panic(expected = "cannot settle to the warehouse")]
fn settle_to_the_warehouse_is_refused() {
    let mut c = setup();
    c.settle("p1".into(), "party:1".into(), vec![send(warehouse(), 1)]);
}

#[test]
#[should_panic(expected = "unknown token")]
fn settle_of_an_unknown_token_is_refused() {
    let mut c = setup();
    c.settle(
        "p1".into(),
        "party:1".into(),
        vec![SettleTransfer {
            account_id: guest(1),
            token_id: "nvda".into(),
            amount: U128(1),
        }],
    );
}

#[test]
fn write_off_burns_from_the_warehouse_even_when_paused() {
    let mut c = setup();
    c.set_paused(true);
    c.write_off("tsla".into(), U128(4), "lost in a failed swap".into());
    assert_eq!(balance(&c, &warehouse()), 96);
    assert_eq!(c.supply("tsla"), Some(96));
}

#[test]
#[should_panic(expected = "paused")]
fn paused_stops_mint() {
    let mut c = setup();
    c.set_paused(true);
    c.mint_warehouse("tsla".into(), U128(1), "sol-tx-2".into());
}

#[test]
#[should_panic(expected = "paused")]
fn paused_stops_settle() {
    let mut c = setup();
    c.set_paused(true);
    c.settle("p1".into(), "party:1".into(), vec![send(guest(1), 1)]);
}

#[test]
fn unpause_resumes() {
    let mut c = setup();
    c.set_paused(true);
    c.set_paused(false);
    c.settle("p1".into(), "party:1".into(), vec![send(guest(1), 1)]);
    assert_eq!(balance(&c, &guest(1)), 1);
}

/// A contract with `tsla` and stock, called next by a guest instead of the owner.
fn setup_as_guest() -> Contract {
    let c = setup();
    as_caller(&guest(1), NearToken::from_yoctonear(0));
    c
}

#[test]
#[should_panic(expected = "only the owner")]
fn guest_cannot_register_a_token() {
    setup_as_guest().register_token("nvda".into(), tsla());
}

#[test]
#[should_panic(expected = "only the owner")]
fn guest_cannot_mint() {
    setup_as_guest().mint_warehouse("tsla".into(), U128(1), "sol-tx-9".into());
}

#[test]
#[should_panic(expected = "only the owner")]
fn guest_cannot_settle() {
    setup_as_guest().settle("p1".into(), "party:9".into(), vec![send(guest(1), 1)]);
}

#[test]
#[should_panic(expected = "only the owner")]
fn guest_cannot_write_off() {
    setup_as_guest().write_off("tsla".into(), U128(1), "x".into());
}

#[test]
#[should_panic(expected = "only the owner")]
fn guest_cannot_pause() {
    setup_as_guest().set_paused(true);
}

#[test]
#[should_panic(expected = "proof must be 1 to 128 bytes")]
fn oversized_proof_is_refused() {
    let mut c = setup();
    c.mint_warehouse("tsla".into(), U128(1), "x".repeat(MAX_PROOF_LEN + 1));
}

#[test]
#[should_panic(expected = "op_id must be 1 to 64 bytes")]
fn oversized_op_id_is_refused() {
    let mut c = setup();
    c.settle(
        "p1".into(),
        "p".repeat(MAX_KEY_LEN + 1),
        vec![send(guest(1), 1)],
    );
}

#[test]
#[should_panic(expected = "token already registered")]
fn a_token_registers_once() {
    let mut c = setup();
    c.register_token("tsla".into(), tsla());
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn zero_mint_is_refused() {
    let mut c = setup();
    c.mint_warehouse("tsla".into(), U128(0), "sol-tx-2".into());
}

#[test]
fn holders_transfer_with_one_yocto() {
    let mut c = setup();
    c.settle("p1".into(), "party:1".into(), vec![send(guest(1), 5)]);
    as_caller(&guest(1), NearToken::from_yoctonear(1));
    c.mt_transfer(guest(2), "tsla".into(), U128(2), None, None);
    assert_eq!(balance(&c, &guest(1)), 3);
    assert_eq!(balance(&c, &guest(2)), 2);
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn holder_transfer_without_deposit_is_refused() {
    let mut c = setup();
    c.settle("p1".into(), "party:1".into(), vec![send(guest(1), 5)]);
    as_caller(&guest(1), NearToken::from_yoctonear(0));
    c.mt_transfer(guest(2), "tsla".into(), U128(2), None, None);
}

/// Supply always equals the warehouse plus every holder, whatever order operations come in.
#[test]
fn supply_equals_warehouse_plus_holders_after_random_operations() {
    let mut c = setup();
    let guests: Vec<AccountId> = (0..5).map(guest).collect();
    // Small deterministic PRNG (xorshift) so the test is repeatable without extra crates.
    let mut seed: u64 = 0x9e37_79b9_7f4a_7c15;
    let mut next = |n: u64| {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed % n
    };
    for step in 0..300 {
        as_caller(&owner(), NearToken::from_yoctonear(0));
        let amount = u128::from(next(20) + 1);
        let run = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match next(4) {
            0 => c.mint_warehouse("tsla".into(), U128(amount), format!("sol-tx-r{step}")),
            1 => c.settle(
                "p1".into(),
                format!("party:r{step}"),
                vec![send(guests[next(5) as usize].clone(), amount)],
            ),
            2 => c.write_off("tsla".into(), U128(amount), "random".into()),
            _ => {
                let from = guests[next(5) as usize].clone();
                as_caller(&from, NearToken::from_yoctonear(1));
                c.mt_transfer(
                    guests[next(5) as usize].clone(),
                    "tsla".into(),
                    U128(amount),
                    None,
                    None,
                );
            }
        }));
        // Refused operations (not enough units, self-transfer) are part of the mix. Every refusal checks before it
        // writes a balance, so the mock not rolling back state on panic doesn't hide anything here.
        let _ = run;
        let held: u128 = guests.iter().map(|g| balance(&c, g)).sum();
        assert_eq!(
            c.supply("tsla"),
            Some(balance(&c, &warehouse()) + held),
            "step {step}"
        );
    }
}

#[test]
#[should_panic(expected = "sender and receiver must differ")]
fn transfer_to_yourself_is_refused() {
    // Without the hook this turned 5 units into 7 while supply stayed 100.
    let mut c = setup();
    c.settle("p1".into(), "party:1".into(), vec![send(guest(1), 5)]);
    as_caller(&guest(1), NearToken::from_yoctonear(1));
    c.mt_transfer(guest(1), "tsla".into(), U128(2), None, None);
}

#[test]
#[should_panic(expected = "sender and receiver must differ")]
fn batch_transfer_to_yourself_is_refused() {
    let mut c = setup();
    c.settle("p1".into(), "party:1".into(), vec![send(guest(1), 5)]);
    as_caller(&guest(1), NearToken::from_yoctonear(1));
    c.mt_batch_transfer(guest(1), vec!["tsla".into()], vec![U128(2)], None, None);
}

#[test]
fn the_owner_can_hand_over_to_a_new_api_account() {
    let mut c = setup();
    let next: AccountId = "api-v2.testnet".parse().unwrap();
    c.set_owner(next.clone());
    assert_eq!(c.owner_id(), next);
    as_caller(&next, NearToken::from_yoctonear(0));
    c.mint_warehouse("tsla".into(), U128(1), "sol-tx-2".into());
}

#[test]
#[should_panic(expected = "only the owner")]
fn the_old_owner_is_out_after_a_handover() {
    let mut c = setup();
    c.set_owner("api-v2.testnet".parse().unwrap());
    c.mint_warehouse("tsla".into(), U128(1), "sol-tx-2".into());
}

#[test]
#[should_panic(expected = "only the owner")]
fn guest_cannot_take_ownership() {
    setup_as_guest().set_owner(guest(1));
}

// ---- v2: drink payments (#22) ----

fn last_event() -> near_sdk::serde_json::Value {
    let log = near_sdk::test_utils::get_logs()
        .into_iter()
        .rev()
        .find(|l| l.contains("\"standard\":\"nyxeron\""))
        .expect("a nyxeron event");
    near_sdk::serde_json::from_str(log.strip_prefix("EVENT_JSON:").unwrap()).unwrap()
}

/// Asserts a payment was refunded in full for `reason` and left no trace.
fn assert_refused(c: &mut Contract, q: &Quote, refund: u128, amount: U128, reason: &str) {
    assert_eq!(refund, amount.0, "refund for {reason}");
    let e = last_event();
    assert_eq!(e["event"], "refund");
    assert_eq!(e["data"][0]["reason"], reason);
    assert!(!c.is_used_quote(q.id.clone()), "{reason}: quote not burned");
}

fn refused(mut q: Quote, change: impl FnOnce(&mut Quote), reason: &str) {
    let mut c = bare();
    change(&mut q);
    let refund = pay(&mut c, &q);
    assert_refused(&mut c, &q, refund, total(&q), reason);
    assert_eq!(c.owed("p1".into()), vec![]);
    assert_eq!(c.party_pot("p1".into()), PartyPot::default());
}

#[test]
fn a_paid_drink_owes_units_holds_wholesale_and_sends_the_margin() {
    let mut c = bare();
    let q = quote("p1", &guest(1), 3);
    assert_eq!(pay(&mut c, &q), 0);

    assert!(c.is_used_quote(q.id.clone()));
    assert_eq!(
        c.owed("p1".into()),
        vec![Owed {
            account_id: guest(1),
            token_id: "tsla".into(),
            qty: U128(3)
        }]
    );
    assert_eq!(
        c.party_pot("p1".into()),
        PartyPot {
            held: U128(1_170_000),
            released: false
        }
    );

    let e = last_event();
    assert_eq!(e["event"], "purchase");
    assert_eq!(e["data"][0]["total"], "1230000");
    assert_eq!(e["data"][0]["margin"], "60000");

    // Margin goes straight to the CEO through USDC.
    let receipts = near_sdk::test_utils::get_created_receipts();
    let to_usdc = receipts
        .iter()
        .find(|r| r.receiver_id == usdc())
        .expect("ft_transfer");
    let near_sdk::mock::MockAction::FunctionCallWeight {
        method_name,
        args,
        attached_deposit,
        ..
    } = &to_usdc.actions[0]
    else {
        panic!("function call expected")
    };
    assert_eq!(method_name, b"ft_transfer");
    assert_eq!(attached_deposit.as_yoctonear(), 1);
    let args: near_sdk::serde_json::Value = near_sdk::serde_json::from_slice(args).unwrap();
    assert_eq!(args["receiver_id"], ceo().as_str());
    assert_eq!(args["amount"], "60000");
}

#[test]
fn a_second_drink_adds_to_what_the_guest_is_owed() {
    let mut c = bare();
    pay(&mut c, &quote("p1", &guest(1), 3));
    pay(&mut c, &quote("p1", &guest(1), 2));
    pay(&mut c, &quote("p1", &guest(2), 1));
    assert_eq!(
        c.owed("p1".into()),
        vec![
            Owed {
                account_id: guest(1),
                token_id: "tsla".into(),
                qty: U128(5)
            },
            Owed {
                account_id: guest(2),
                token_id: "tsla".into(),
                qty: U128(1)
            },
        ]
    );
    assert_eq!(c.party_pot("p1".into()).held, U128(390_000 * 6));
}

#[test]
fn no_margin_no_transfer() {
    let mut c = bare();
    let mut q = quote("p1", &guest(1), 1);
    q.unit_price = q.unit_wholesale;
    assert_eq!(pay(&mut c, &q), 0);
    assert!(near_sdk::test_utils::get_created_receipts().is_empty());
}

#[test]
fn expired_quote_is_refunded() {
    refused(
        quote("p1", &guest(1), 1),
        |q| q.expires_ms = NOW_MS - 1,
        "expired",
    );
}

#[test]
fn a_quote_is_good_up_to_its_expiry_millisecond() {
    let mut c = bare();
    let mut q = quote("p1", &guest(1), 1);
    q.expires_ms = NOW_MS;
    assert_eq!(pay(&mut c, &q), 0);
}

#[test]
fn bad_version_is_refunded() {
    refused(quote("p1", &guest(1), 1), |q| q.v = 2, "bad_version");
}

#[test]
fn price_above_three_times_wholesale_is_refunded() {
    refused(
        quote("p1", &guest(1), 1),
        |q| q.unit_price = U128(390_000 * 3 + 1),
        "bad_price",
    );
}

#[test]
fn price_below_wholesale_is_refunded() {
    refused(
        quote("p1", &guest(1), 1),
        |q| q.unit_price = U128(389_999),
        "bad_price",
    );
}

#[test]
fn zero_wholesale_is_refunded() {
    refused(
        quote("p1", &guest(1), 1),
        |q| {
            q.unit_wholesale = U128(0);
            q.unit_price = U128(0);
        },
        "bad_price",
    );
}

#[test]
fn zero_qty_is_refunded() {
    refused(quote("p1", &guest(1), 1), |q| q.qty = 0, "bad_qty");
}

#[test]
fn unknown_token_is_refunded() {
    refused(
        quote("p1", &guest(1), 1),
        |q| q.token = "nvda".into(),
        "unknown_token",
    );
}

#[test]
fn oversized_quote_id_is_refunded() {
    refused(
        quote("p1", &guest(1), 1),
        |q| q.id = "q".repeat(MAX_KEY_LEN + 1),
        "bad_quote",
    );
}

#[test]
fn empty_party_is_refunded() {
    refused(
        quote("p1", &guest(1), 1),
        |q| q.party = String::new(),
        "bad_quote",
    );
}

#[test]
fn overflowing_markup_is_refunded_not_panicked() {
    refused(
        quote("p1", &guest(1), 1),
        |q| {
            q.unit_wholesale = U128(u128::MAX / 2);
            q.unit_price = U128(u128::MAX / 2);
        },
        "bad_price",
    );
}

#[test]
fn overflowing_total_is_refunded_not_panicked() {
    refused(
        quote("p1", &guest(1), 1),
        |q| {
            q.unit_wholesale = U128(u128::MAX / 3);
            q.unit_price = U128(u128::MAX / 3);
            q.qty = 4;
        },
        "bad_amount",
    );
}

#[test]
fn amount_other_than_price_times_qty_is_refunded() {
    let mut c = bare();
    let q = quote("p1", &guest(1), 3);
    for amount in [total(&q).0 - 1, total(&q).0 + 1] {
        let refund = pay_with(
            &mut c,
            &usdc(),
            guest(1),
            U128(amount),
            signed(&q, &quote_key()),
        );
        assert_refused(&mut c, &q, refund, U128(amount), "bad_amount");
    }
}

#[test]
fn a_quote_signed_by_another_key_is_refunded() {
    let mut c = bare();
    let q = quote("p1", &guest(1), 1);
    let other = ed25519_dalek::SigningKey::from_bytes(&[8; 32]);
    let refund = pay_with(&mut c, &usdc(), guest(1), total(&q), signed(&q, &other));
    assert_refused(&mut c, &q, refund, total(&q), "bad_signature");
}

#[test]
fn a_quote_edited_after_signing_is_refunded() {
    let mut c = bare();
    let q = quote("p1", &guest(1), 1);
    let mut cheaper = q.clone_for_test();
    cheaper.unit_price = U128(390_000);
    // Signature over the real quote, bytes of the cheaper one.
    let real: near_sdk::serde_json::Value =
        near_sdk::serde_json::from_str(&signed(&q, &quote_key())).unwrap();
    let msg = near_sdk::serde_json::json!({
        "quote": near_sdk::json_types::Base64VecU8::from(near_sdk::serde_json::to_vec(&cheaper).unwrap()),
        "sig": real["sig"],
    })
    .to_string();
    let refund = pay_with(&mut c, &usdc(), guest(1), total(&cheaper), msg);
    assert_refused(&mut c, &cheaper, refund, total(&cheaper), "bad_signature");
}

#[test]
fn a_replayed_quote_is_refunded() {
    let mut c = bare();
    let q = quote("p1", &guest(1), 1);
    assert_eq!(pay(&mut c, &q), 0);
    let refund = pay(&mut c, &q);
    assert_eq!(refund, total(&q).0);
    assert_eq!(last_event()["data"][0]["reason"], "quote_used");
    assert_eq!(c.owed("p1".into())[0].qty, U128(1));
}

#[test]
fn someone_elses_quote_is_refunded() {
    let mut c = bare();
    let q = quote("p1", &guest(1), 1);
    let refund = pay_with(
        &mut c,
        &usdc(),
        guest(2),
        total(&q),
        signed(&q, &quote_key()),
    );
    assert_refused(&mut c, &q, refund, total(&q), "buyer_mismatch");
}

#[test]
fn another_token_contract_is_refunded() {
    let mut c = bare();
    let q = quote("p1", &guest(1), 1);
    let fake: AccountId = "fake-usdc.testnet".parse().unwrap();
    let refund = pay_with(&mut c, &fake, guest(1), total(&q), signed(&q, &quote_key()));
    assert_refused(&mut c, &q, refund, total(&q), "wrong_token");
}

#[test]
fn garbage_msg_is_refunded() {
    let mut c = bare();
    let q = quote("p1", &guest(1), 1);
    for msg in ["", "{}", "not json", r#"{"quote":"AAAA","sig":"AAAA"}"#] {
        let refund = pay_with(&mut c, &usdc(), guest(1), U128(5), msg.into());
        assert_refused(
            &mut c,
            &q,
            refund,
            U128(5),
            if msg.contains("sig") {
                "bad_signature"
            } else {
                "bad_msg"
            },
        );
    }
}

#[test]
fn paused_refunds_payments() {
    let mut c = bare();
    c.set_paused(true);
    let q = quote("p1", &guest(1), 1);
    let refund = pay(&mut c, &q);
    assert_refused(&mut c, &q, refund, total(&q), "paused");
}

#[test]
fn without_a_quote_key_payments_are_refunded() {
    as_caller(&owner(), NearToken::from_yoctonear(0));
    let mut c = Contract::new(owner());
    c.register_token("tsla".into(), tsla());
    c.set_usdc(usdc());
    let q = quote("p1", &guest(1), 1);
    let refund = pay(&mut c, &q);
    assert_refused(&mut c, &q, refund, total(&q), "no_quote_key");
}

#[test]
fn a_new_quote_key_retires_the_old_one() {
    let mut c = bare();
    let next = ed25519_dalek::SigningKey::from_bytes(&[9; 32]);
    c.set_quote_key(
        near_sdk::PublicKey::from_parts(
            near_sdk::CurveType::ED25519,
            next.verifying_key().to_bytes().to_vec(),
        )
        .unwrap(),
    );
    let q = quote("p1", &guest(1), 1);
    let refund = pay(&mut c, &q);
    assert_refused(&mut c, &q, refund, total(&q), "bad_signature");
    let q = quote("p1", &guest(1), 1);
    assert_eq!(
        pay_with(&mut c, &usdc(), guest(1), total(&q), signed(&q, &next)),
        0
    );
}

#[test]
#[should_panic(expected = "quote key must be ed25519")]
fn a_secp256k1_quote_key_is_refused() {
    let mut c = bare();
    c.set_quote_key(
        near_sdk::PublicKey::from_parts(near_sdk::CurveType::SECP256K1, vec![1; 64]).unwrap(),
    );
}

#[test]
#[should_panic(expected = "usdc already set")]
fn usdc_is_set_once() {
    bare().set_usdc("other-usdc.testnet".parse().unwrap());
}

// ---- release_wholesale ----

#[test]
fn release_sends_the_pot_to_the_treasury_and_closes_the_party() {
    let mut c = bare();
    pay(&mut c, &quote("p1", &guest(1), 3));
    as_caller(&owner(), NearToken::from_yoctonear(0));
    let near_sdk::PromiseOrValue::Promise(_) = c.release_wholesale("p1".into()) else {
        panic!("release sends a transfer")
    };
    assert_eq!(
        c.party_pot("p1".into()),
        PartyPot {
            held: U128(0),
            released: true
        }
    );
    let receipts = near_sdk::test_utils::get_created_receipts();
    let near_sdk::mock::MockAction::FunctionCallWeight { args, .. } = &receipts
        .iter()
        .find(|r| r.receiver_id == usdc())
        .unwrap()
        .actions[0]
    else {
        panic!()
    };
    let args: near_sdk::serde_json::Value = near_sdk::serde_json::from_slice(args).unwrap();
    assert_eq!(args["receiver_id"], treasury().as_str());
    assert_eq!(args["amount"], "1170000");

    // Later drinks for that party are refunded.
    let q = quote("p1", &guest(2), 1);
    let refund = pay(&mut c, &q);
    assert_refused(&mut c, &q, refund, total(&q), "party_closed");
    // Other parties carry on.
    assert_eq!(pay(&mut c, &quote("p2", &guest(2), 1)), 0);
}

#[test]
#[should_panic(expected = "already released")]
fn release_runs_once() {
    let mut c = bare();
    pay(&mut c, &quote("p1", &guest(1), 3));
    as_caller(&owner(), NearToken::from_yoctonear(0));
    let _ = c.release_wholesale("p1".into());
    let _ = c.release_wholesale("p1".into());
}

#[test]
fn a_failed_release_restores_the_pot_for_a_retry() {
    let mut c = bare();
    pay(&mut c, &quote("p1", &guest(1), 3));
    as_caller(&owner(), NearToken::from_yoctonear(0));
    let _ = c.release_wholesale("p1".into());
    as_caller(&warehouse(), NearToken::from_yoctonear(0));
    assert_eq!(
        c.on_wholesale_released(
            "p1".into(),
            U128(1_170_000),
            Err(near_sdk::PromiseError::Failed)
        ),
        U128(0)
    );
    assert_eq!(
        c.party_pot("p1".into()),
        PartyPot {
            held: U128(1_170_000),
            released: true
        }
    );
    // Still closed to purchases, but the owner can send it again.
    as_caller(&owner(), NearToken::from_yoctonear(0));
    let near_sdk::PromiseOrValue::Promise(_) = c.release_wholesale("p1".into()) else {
        panic!()
    };
    assert_eq!(c.party_pot("p1".into()).held, U128(0));
}

#[test]
fn releasing_an_empty_party_just_closes_it() {
    let mut c = bare();
    let near_sdk::PromiseOrValue::Value(U128(0)) = c.release_wholesale("p9".into()) else {
        panic!()
    };
    assert!(c.party_pot("p9".into()).released);
}

#[test]
#[should_panic(expected = "only the owner")]
fn guest_cannot_release() {
    let _ = setup_as_guest().release_wholesale("p1".into());
}

#[test]
#[should_panic(expected = "only the owner")]
fn guest_cannot_set_the_quote_key() {
    setup_as_guest().set_quote_key(quote_key_public());
}

#[test]
#[should_panic(expected = "only the owner")]
fn guest_cannot_set_the_treasury() {
    setup_as_guest().set_treasury(guest(1));
}

// ---- margin that could not be sent ----

#[test]
fn a_failed_margin_becomes_claimable_and_the_ceo_claims_it() {
    let mut c = bare();
    pay(&mut c, &quote("p1", &guest(1), 3));
    as_caller(&warehouse(), NearToken::from_yoctonear(0));
    c.on_margin_sent(ceo(), U128(60_000), Err(near_sdk::PromiseError::Failed));
    c.on_margin_sent(ceo(), U128(40_000), Err(near_sdk::PromiseError::Failed));
    assert_eq!(c.claimable_margin(ceo()), U128(100_000));
    assert_eq!(last_event()["event"], "margin_held");

    as_caller(&ceo(), NearToken::from_yoctonear(0));
    let _ = c.claim_margin();
    assert_eq!(c.claimable_margin(ceo()), U128(0));
    // A failed claim puts it back.
    as_caller(&warehouse(), NearToken::from_yoctonear(0));
    c.on_margin_sent(ceo(), U128(100_000), Err(near_sdk::PromiseError::Failed));
    assert_eq!(c.claimable_margin(ceo()), U128(100_000));
}

#[test]
fn a_sent_margin_is_not_claimable() {
    let mut c = bare();
    as_caller(&warehouse(), NearToken::from_yoctonear(0));
    c.on_margin_sent(ceo(), U128(60_000), Ok(()));
    assert_eq!(c.claimable_margin(ceo()), U128(0));
}

#[test]
#[should_panic(expected = "nothing to claim")]
fn nothing_to_claim() {
    let mut c = bare();
    as_caller(&ceo(), NearToken::from_yoctonear(0));
    let _ = c.claim_margin();
}

// ---- settle is capped by what each guest is owed ----

#[test]
fn settle_takes_units_off_what_is_owed() {
    let mut c = bare();
    pay(&mut c, &quote("p1", &guest(1), 3));
    pay(&mut c, &quote("p1", &guest(2), 2));
    as_caller(&owner(), NearToken::from_yoctonear(0));
    c.settle(
        "p1".into(),
        "p1:a".into(),
        vec![send(guest(1), 2), send(guest(2), 2)],
    );
    assert_eq!(
        c.owed("p1".into()),
        vec![Owed {
            account_id: guest(1),
            token_id: "tsla".into(),
            qty: U128(1)
        }]
    );
    c.settle("p1".into(), "p1:b".into(), vec![send(guest(1), 1)]);
    assert_eq!(c.owed("p1".into()), vec![]);
    assert_eq!(balance(&c, &guest(1)), 3);
    assert_eq!(balance(&c, &guest(2)), 2);
}

#[test]
#[should_panic(expected = "more than owed")]
fn settle_cannot_give_more_than_owed() {
    let mut c = bare();
    pay(&mut c, &quote("p1", &guest(1), 3));
    as_caller(&owner(), NearToken::from_yoctonear(0));
    c.settle("p1".into(), "p1:a".into(), vec![send(guest(1), 4)]);
}

#[test]
#[should_panic(expected = "more than owed")]
fn settle_cannot_pay_a_guest_from_another_party() {
    let mut c = bare();
    pay(&mut c, &quote("p1", &guest(1), 3));
    as_caller(&owner(), NearToken::from_yoctonear(0));
    c.settle("p2".into(), "p2:a".into(), vec![send(guest(1), 1)]);
}

#[test]
#[should_panic(expected = "more than owed")]
fn settle_cannot_pay_the_same_guest_twice_in_one_batch() {
    let mut c = bare();
    pay(&mut c, &quote("p1", &guest(1), 3));
    as_caller(&owner(), NearToken::from_yoctonear(0));
    c.settle(
        "p1".into(),
        "p1:a".into(),
        vec![send(guest(1), 2), send(guest(1), 2)],
    );
}

impl Quote {
    fn clone_for_test(&self) -> Quote {
        near_sdk::serde_json::from_value(near_sdk::serde_json::to_value(self).unwrap()).unwrap()
    }
}

#[test]
fn the_contract_as_ceo_is_refunded() {
    // USDC refuses a transfer to yourself, so its margin could never leave the contract.
    refused(
        quote("p1", &guest(1), 1),
        |q| q.ceo = warehouse(),
        "bad_quote",
    );
}

#[test]
#[should_panic(expected = "treasury cannot be this contract")]
fn the_contract_as_treasury_is_refused() {
    bare().set_treasury(warehouse());
}
