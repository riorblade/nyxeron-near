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
            .build()
    );
}

fn tsla() -> TokenInfo {
    TokenInfo {
        symbol: "TSLA".into(),
        backing: "solana:XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB".into(),
        shares_per_unit: "0.001".into(),
    }
}

/// Contract with `tsla` registered and 100 units in the warehouse.
fn setup() -> Contract {
    as_caller(&owner(), NearToken::from_yoctonear(0));
    let mut c = Contract::new(owner());
    c.register_token("tsla".into(), tsla());
    c.mint_warehouse("tsla".into(), U128(100), "sol-tx-1".into());
    c
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
    c.settle("party:1".into(), vec![send(guest(1), 3), send(guest(2), 7)]);
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
    c.settle("party:1".into(), vec![send(guest(1), 3)]);
    c.settle("party:1".into(), vec![send(guest(1), 3)]);
}

#[test]
#[should_panic]
fn settle_above_warehouse_stock_fails() {
    let mut c = setup();
    c.settle(
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
    c.settle("party:1".into(), transfers);
}

#[test]
#[should_panic(expected = "cannot settle to the warehouse")]
fn settle_to_the_warehouse_is_refused() {
    let mut c = setup();
    c.settle("party:1".into(), vec![send(warehouse(), 1)]);
}

#[test]
#[should_panic(expected = "unknown token")]
fn settle_of_an_unknown_token_is_refused() {
    let mut c = setup();
    c.settle(
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
    c.settle("party:1".into(), vec![send(guest(1), 1)]);
}

#[test]
fn unpause_resumes() {
    let mut c = setup();
    c.set_paused(true);
    c.set_paused(false);
    c.settle("party:1".into(), vec![send(guest(1), 1)]);
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
    setup_as_guest().settle("party:9".into(), vec![send(guest(1), 1)]);
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
    c.settle("p".repeat(MAX_KEY_LEN + 1), vec![send(guest(1), 1)]);
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
    c.settle("party:1".into(), vec![send(guest(1), 5)]);
    as_caller(&guest(1), NearToken::from_yoctonear(1));
    c.mt_transfer(guest(2), "tsla".into(), U128(2), None, None);
    assert_eq!(balance(&c, &guest(1)), 3);
    assert_eq!(balance(&c, &guest(2)), 2);
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn holder_transfer_without_deposit_is_refused() {
    let mut c = setup();
    c.settle("party:1".into(), vec![send(guest(1), 5)]);
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
    c.settle("party:1".into(), vec![send(guest(1), 5)]);
    as_caller(&guest(1), NearToken::from_yoctonear(1));
    c.mt_transfer(guest(1), "tsla".into(), U128(2), None, None);
}

#[test]
#[should_panic(expected = "sender and receiver must differ")]
fn batch_transfer_to_yourself_is_refused() {
    let mut c = setup();
    c.settle("party:1".into(), vec![send(guest(1), 5)]);
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
