//! Deploys the real wasm, next to a plain NEP-141 token standing in for USDC, to a local NEAR sandbox and drives it
//! the way the api and the players' clients will.

use ed25519_dalek::Signer as _;
use near_api::types::{AccessKeyPermission, transaction::actions::FunctionCallPermission};
use near_api::{AccountId, NearGas, NearToken, Signer, signer::generate_secret_key};
use near_sdk::json_types::Base64VecU8;
use near_sdk::serde_json::{Value, json};
use std::sync::Arc;

const MAX_SETTLE_TRANSFERS: usize = 32;
const MAX_KEY_LEN: usize = 64;
/// Gas the player's client attaches to `ft_transfer_call` in spike 10 (#29). The relayer allows up to 150.
const CLIENT_GAS_TGAS: u64 = 100;
const PRICE: u128 = 410_000;
const WHOLESALE: u128 = 390_000;

struct Env {
    sandbox: near_sandbox::Sandbox,
    network: near_api::NetworkConfig,
    signer: Arc<Signer>,
    contract: near_api::Contract,
    usdc: near_api::Contract,
    api: AccountId,
    quote_key: ed25519_dalek::SigningKey,
}

fn build(manifest: Option<&str>) -> testresult::TestResult<Vec<u8>> {
    let opts = cargo_near_build::BuildOpts {
        manifest_path: manifest.map(Into::into),
        ..Default::default()
    };
    Ok(std::fs::read(cargo_near_build::build_with_cli(opts)?)?)
}

fn id(name: &str) -> AccountId {
    format!("{name}.sandbox").parse().unwrap()
}

async fn deploy() -> testresult::TestResult<Env> {
    let wasm = build(None)?;
    let usdc_wasm = build(Some("tests/mock-usdc/Cargo.toml"))?;

    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let network = near_api::NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;

    let api = id("api");
    let contract_id = id("nyxeron");
    let usdc_id = id("usdc");
    for account in [&api, &contract_id, &usdc_id, &id("ceo"), &id("treasury")] {
        create(&sandbox, account).await?;
    }

    near_api::Contract::deploy(usdc_id.clone())
        .use_code(usdc_wasm)
        .with_init_call("new", json!({ "owner_id": usdc_id, "total_supply": "0" }))?
        .with_signer(signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    near_api::Contract::deploy(contract_id.clone())
        .use_code(wasm)
        .with_init_call("new", json!({ "owner_id": api }))?
        .with_signer(signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    let quote_key = ed25519_dalek::SigningKey::from_bytes(&[7; 32]);
    let env = Env {
        sandbox,
        network,
        signer,
        contract: near_api::Contract(contract_id.clone()),
        usdc: near_api::Contract(usdc_id.clone()),
        api,
        quote_key,
    };
    env.call(
        "register_token",
        json!({
            "token_id": "tsla",
            "info": { "symbol": "TSLA", "backing": "robinhood:0x0000000000000000000000000000000000000001", "shares_per_unit": "0.001" }
        }),
    )
    .await?
    .assert_success();
    let quote_pk = format!(
        "ed25519:{}",
        bs58(&env.quote_key.verifying_key().to_bytes())
    );
    for (method, args) in [
        ("set_usdc", json!({ "account_id": usdc_id })),
        ("set_treasury", json!({ "account_id": id("treasury") })),
        ("set_quote_key", json!({ "public_key": quote_pk })),
    ] {
        env.call(method, args).await?.assert_success();
    }
    // The contract holds USDC (pots, claimable margin), so it is registered on the token. The CEO is registered too,
    // except in the test about an unregistered CEO.
    env.mint(&contract_id, 0).await?;
    env.mint(&id("ceo"), 0).await?;
    Ok(env)
}

async fn create(
    sandbox: &near_sandbox::Sandbox,
    account: &AccountId,
) -> testresult::TestResult<()> {
    // near-sandbox and near-api depend on different near-account-id majors, so go through the string.
    sandbox
        .create_account(account.as_str().parse()?)
        .initial_balance(NearToken::from_near(20))
        .send()
        .await?;
    Ok(())
}

/// base58 without pulling in another crate: `bs58` is what `ed25519:` keys use.
fn bs58(bytes: &[u8]) -> String {
    const ALPHABET: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let mut digits: Vec<u8> = Vec::new();
    for &b in bytes {
        let mut carry = u32::from(b);
        for d in digits.iter_mut() {
            carry += u32::from(*d) << 8;
            *d = (carry % 58) as u8;
            carry /= 58;
        }
        while carry > 0 {
            digits.push((carry % 58) as u8);
            carry /= 58;
        }
    }
    let zeros = bytes.iter().take_while(|&&b| b == 0).count();
    std::iter::repeat_n('1', zeros)
        .chain(digits.iter().rev().map(|&d| ALPHABET[d as usize] as char))
        .collect()
}

type TxResult = near_api::types::transaction::result::TransactionResult;

impl Env {
    /// Owner (api) call on the nyxeron contract.
    async fn call(&self, method: &str, args: Value) -> testresult::TestResult<TxResult> {
        self.call_as(&self.api, &self.contract, method, args, 300, 0)
            .await
    }

    async fn call_as(
        &self,
        who: &AccountId,
        contract: &near_api::Contract,
        method: &str,
        args: Value,
        tgas: u64,
        yocto: u128,
    ) -> testresult::TestResult<TxResult> {
        Ok(contract
            .call_function(method, args)
            .transaction()
            .gas(NearGas::from_tgas(tgas))
            .deposit(NearToken::from_yoctonear(yocto))
            .with_signer(who.clone(), self.signer.clone())
            .send_to(&self.network)
            .await?)
    }

    async fn view(&self, method: &str, args: Value) -> testresult::TestResult<Value> {
        Ok(self
            .contract
            .call_function(method, args)
            .read_only()
            .fetch_from(&self.network)
            .await?
            .data)
    }

    async fn usdc_of(&self, account: &AccountId) -> testresult::TestResult<u128> {
        let v: Value = self
            .usdc
            .call_function("ft_balance_of", json!({ "account_id": account }))
            .read_only()
            .fetch_from(&self.network)
            .await?
            .data;
        Ok(v.as_str().unwrap().parse()?)
    }

    async fn mint(&self, account: &AccountId, amount: u128) -> testresult::TestResult<()> {
        let usdc_id = self.usdc.0.clone();
        self.call_as(
            &usdc_id,
            &self.usdc,
            "mint",
            json!({ "account_id": account, "amount": amount.to_string() }),
            30,
            0,
        )
        .await?
        .assert_success();
        Ok(())
    }

    async fn storage_usage(&self) -> testresult::TestResult<u64> {
        Ok(near_api::Account(self.contract.0.clone())
            .view()
            .fetch_from(&self.network)
            .await?
            .data
            .storage_usage)
    }

    async fn balance(&self, account: &AccountId) -> testresult::TestResult<u128> {
        let v = self
            .view(
                "mt_balance_of",
                json!({ "account_id": account, "token_id": "tsla" }),
            )
            .await?;
        Ok(v.as_str().unwrap().parse()?)
    }

    /// A guest account with enough USDC for `qty` drinks.
    async fn guest(&self, name: &str, qty: u128) -> testresult::TestResult<AccountId> {
        let guest = id(name);
        create(&self.sandbox, &guest).await?;
        self.mint(&guest, PRICE * qty).await?;
        Ok(guest)
    }

    /// The quote the api would sign for `qty` tsla at `party`.
    fn quote(&self, quote_id: &str, party: &str, buyer: &AccountId, qty: u64) -> Value {
        json!({
            "v": 1, "id": quote_id, "party": party, "buyer": buyer, "ceo": id("ceo"), "token": "tsla", "qty": qty,
            "unit_price": PRICE.to_string(), "unit_wholesale": WHOLESALE.to_string(),
            "expires_ms": 4_102_444_800_000u64, // 2100-01-01
        })
    }

    /// The guest pays with `ft_transfer_call`, as the client signs it (1 yocto, `CLIENT_GAS_TGAS`).
    async fn pay(
        &self,
        buyer: &AccountId,
        quote: &Value,
        amount: u128,
    ) -> testresult::TestResult<TxResult> {
        let bytes = near_sdk::serde_json::to_vec(quote)?;
        let sig = self.quote_key.sign(&bytes).to_bytes().to_vec();
        let msg =
            json!({ "quote": Base64VecU8::from(bytes), "sig": Base64VecU8::from(sig) }).to_string();
        self.call_as(
            buyer,
            &self.usdc,
            "ft_transfer_call",
            json!({ "receiver_id": self.contract.0, "amount": amount.to_string(), "msg": msg }),
            CLIENT_GAS_TGAS,
            1,
        )
        .await
    }
}

fn send(account: &AccountId, amount: u128) -> Value {
    json!({ "account_id": account, "token_id": "tsla", "amount": amount.to_string() })
}

fn gas_tgas(result: &near_api::types::transaction::result::ExecutionFinalResult) -> f64 {
    result
        .outcomes()
        .iter()
        .map(|o| o.gas_burnt.as_gas())
        .sum::<u64>() as f64
        / 1e12
}

/// Full v2 flow: pay → margin to the CEO, wholesale held, units owed → release → settle.
#[tokio::test]
async fn a_party_from_payment_to_settle() -> testresult::TestResult<()> {
    let env = deploy().await?;
    let guest = env.guest("guest1", 3).await?;
    let total = PRICE * 3;

    let storage_before = env.storage_usage().await?;
    let paid = env
        .pay(&guest, &env.quote("q1", "42", &guest, 3), total)
        .await?;
    let paid = paid.into_full().unwrap();
    for f in paid.failures() {
        println!("failure: {:?}", f.clone().into_result());
    }
    assert!(paid.is_success());
    assert!(
        paid.logs()
            .iter()
            .any(|l| l.contains(r#""event":"purchase""#))
    );
    println!(
        "drink payment (ft_transfer_call → ft_on_transfer → margin ft_transfer → callback → resolve): {:.2} TGas burnt with {CLIENT_GAS_TGAS} attached",
        gas_tgas(&paid)
    );
    println!(
        "first purchase of a party stores {} bytes (quote id, pot, owed entry)",
        env.storage_usage().await? - storage_before
    );

    assert_eq!(env.usdc_of(&guest).await?, 0);
    assert_eq!(env.usdc_of(&id("ceo")).await?, (PRICE - WHOLESALE) * 3);
    assert_eq!(env.usdc_of(&env.contract.0).await?, WHOLESALE * 3);
    assert_eq!(
        env.view("owed", json!({ "party": "42" })).await?,
        json!([{ "account_id": guest, "token_id": "tsla", "qty": "3" }])
    );

    env.mint(&id("treasury"), 0).await?; // registers
    env.call("release_wholesale", json!({ "party": "42" }))
        .await?
        .assert_success();
    assert_eq!(env.usdc_of(&id("treasury")).await?, WHOLESALE * 3);
    assert_eq!(env.usdc_of(&env.contract.0).await?, 0);
    assert_eq!(
        env.view("party_pot", json!({ "party": "42" })).await?,
        json!({ "held": "0", "released": true, "ceo": id("ceo") })
    );

    // The treasury bought the stock: mint it, then give the guest what they are owed, no more.
    env.call(
        "mint_warehouse",
        json!({ "token_id": "tsla", "amount": "3", "proof": format!("0x{}", "ab".repeat(32)) }),
    )
    .await?
    .assert_success();
    env.call(
        "settle",
        json!({ "party": "42", "op_id": "42:1", "transfers": [send(&guest, 4)] }),
    )
    .await?
    .assert_failure();
    env.call(
        "settle",
        json!({ "party": "42", "op_id": "42:1", "transfers": [send(&guest, 3)] }),
    )
    .await?
    .assert_success();
    assert_eq!(env.balance(&guest).await?, 3);
    assert_eq!(env.view("owed", json!({ "party": "42" })).await?, json!([]));
    Ok(())
}

/// A refused payment comes back in full: the token contract's `ft_resolve_transfer` returns what we hand back.
#[tokio::test]
async fn refused_payments_come_back_in_full() -> testresult::TestResult<()> {
    let env = deploy().await?;
    let guest = env.guest("guest1", 3).await?;
    let total = PRICE * 3;

    let mut expired = env.quote("q1", "42", &guest, 3);
    expired["expires_ms"] = json!(1);
    let other = env.guest("guest2", 0).await?;
    let cases = [
        ("expired", expired, total),
        ("bad_amount", env.quote("q2", "42", &guest, 3), total - 1),
        ("buyer_mismatch", env.quote("q3", "42", &other, 3), total),
    ];
    for (reason, quote, amount) in cases {
        let r = env.pay(&guest, &quote, amount).await?.into_full().unwrap();
        assert!(r.is_success(), "{reason}");
        assert!(
            r.logs()
                .iter()
                .any(|l| l.contains(&format!(r#""reason":"{reason}""#))),
            "{reason}: {:?}",
            r.logs()
        );
        assert_eq!(
            env.usdc_of(&guest).await?,
            total,
            "{reason}: refunded in full"
        );
    }
    assert_eq!(env.usdc_of(&env.contract.0).await?, 0);
    assert_eq!(env.view("owed", json!({ "party": "42" })).await?, json!([]));
    Ok(())
}

/// A CEO not registered on USDC can't receive the margin: it waits in the contract until they claim it.
#[tokio::test]
async fn margin_to_an_unregistered_ceo_waits_to_be_claimed() -> testresult::TestResult<()> {
    let env = deploy().await?;
    let guest = env.guest("guest1", 1).await?;
    let ceo2 = id("ceo2");
    create(&env.sandbox, &ceo2).await?;
    let mut quote = env.quote("q1", "42", &guest, 1);
    quote["ceo"] = json!(ceo2);

    let paid = env.pay(&guest, &quote, PRICE).await?.into_full().unwrap();
    assert!(
        paid.logs()
            .iter()
            .any(|l| l.contains(r#""event":"margin_held""#))
    );
    assert_eq!(
        env.usdc_of(&guest).await?,
        0,
        "the payment itself went through"
    );
    assert_eq!(
        env.view("claimable_margin", json!({ "account_id": ceo2 }))
            .await?,
        json!((PRICE - WHOLESALE).to_string())
    );

    env.mint(&ceo2, 0).await?; // registers
    env.call_as(&ceo2, &env.contract, "claim_margin", json!({}), 100, 0)
        .await?
        .assert_success();
    assert_eq!(env.usdc_of(&ceo2).await?, PRICE - WHOLESALE);
    assert_eq!(
        env.view("claimable_margin", json!({ "account_id": ceo2 }))
            .await?,
        json!("0")
    );
    Ok(())
}

/// If the treasury can't receive, the pot is kept and the release can run again.
#[tokio::test]
async fn a_failed_release_can_be_retried() -> testresult::TestResult<()> {
    let env = deploy().await?;
    let guest = env.guest("guest1", 2).await?;
    env.pay(&guest, &env.quote("q1", "42", &guest, 2), PRICE * 2)
        .await?
        .assert_success();

    // Treasury not registered on USDC yet: the transfer fails, the call itself doesn't.
    let failed = env
        .call("release_wholesale", json!({ "party": "42" }))
        .await?
        .into_full()
        .unwrap();
    assert!(
        failed
            .logs()
            .iter()
            .any(|l| l.contains(r#""event":"release_failed""#))
    );
    assert_eq!(
        env.view("party_pot", json!({ "party": "42" })).await?,
        json!({ "held": (WHOLESALE * 2).to_string(), "released": true, "ceo": id("ceo") })
    );
    assert_eq!(env.usdc_of(&env.contract.0).await?, WHOLESALE * 2);

    env.mint(&id("treasury"), 0).await?;
    env.call("release_wholesale", json!({ "party": "42" }))
        .await?
        .assert_success();
    assert_eq!(env.usdc_of(&id("treasury")).await?, WHOLESALE * 2);
    env.call("release_wholesale", json!({ "party": "42" }))
        .await?
        .assert_failure();
    Ok(())
}

/// Every purchase stores its quote id for good, paid from the contract's own NEAR. Prints the bytes per purchase for
/// the README and AUDIT, and checks that a contract too poor to store a purchase refunds the guest in full.
#[tokio::test]
async fn storage_per_purchase_and_a_contract_out_of_near() -> testresult::TestResult<()> {
    let env = deploy().await?;
    let guest = env.guest("guest1", 3).await?;
    let other = env.guest("guest2", 1).await?;

    let mut stored = Vec::new();
    for (quote, buyer) in [
        (env.quote("q1", "42", &guest, 1), &guest),
        (env.quote("q2", "42", &guest, 1), &guest),
        (env.quote("q3", "42", &other, 1), &other),
    ] {
        let before = env.storage_usage().await?;
        env.pay(buyer, &quote, PRICE).await?.assert_success();
        stored.push(env.storage_usage().await? - before);
    }
    println!(
        "storage per purchase: party's first {} bytes, same guest again {} bytes, another guest {} bytes",
        stored[0], stored[1], stored[2]
    );
    assert!(stored[1] > 0, "a repeat purchase still stores its quote id");

    // Leave the contract NEAR for ~100 bytes (less the transfer fee) above what its storage already locks.
    let account = near_api::Account(env.contract.0.clone())
        .view()
        .fetch_from(&env.network)
        .await?
        .data;
    let per_byte = NearToken::from_yoctonear(10u128.pow(19));
    let keep = per_byte.saturating_mul(u128::from(account.storage_usage) + 100);
    near_api::Tokens::account(env.contract.0.clone())
        .send_to(id("treasury"))
        .near(account.amount.saturating_sub(keep))
        .with_signer(env.signer.clone())
        .send_to(&env.network)
        .await?
        .assert_success();

    let poor = env.guest("guest3", 1).await?;
    let paid = env
        .pay(&poor, &env.quote("q4", "43", &poor, 1), PRICE)
        .await?
        .into_full()
        .unwrap();
    println!(
        "payment to a contract out of NEAR: {:?}",
        paid.failures()
            .into_iter()
            .map(|f| format!("{:?}", f.clone().into_result()))
            .collect::<Vec<_>>()
    );
    assert_eq!(
        env.usdc_of(&poor).await?,
        PRICE,
        "refunded in full by the token"
    );
    assert_eq!(env.usdc_of(&id("ceo")).await?, (PRICE - WHOLESALE) * 3);
    assert_eq!(env.view("owed", json!({ "party": "43" })).await?, json!([]));
    assert_eq!(
        env.view("is_used_quote", json!({ "id": "q4" })).await?,
        json!(false)
    );
    Ok(())
}

#[tokio::test]
async fn warehouse_mint_and_proofs() -> testresult::TestResult<()> {
    let env = deploy().await?;
    let mint = env
        .call(
            "mint_warehouse",
            json!({ "token_id": "tsla", "amount": "1000", "proof": "tx-1" }),
        )
        .await?
        .into_full()
        .unwrap();
    assert!(
        mint.logs()
            .iter()
            .any(|l| l.contains(r#""event":"mt_mint""#) && l.contains(r#""memo":"tx-1""#))
    );
    assert_eq!(env.balance(&env.contract.0).await?, 1000);
    env.call(
        "mint_warehouse",
        json!({ "token_id": "tsla", "amount": "5", "proof": "tx-1" }),
    )
    .await?
    .assert_failure();
    assert_eq!(
        env.view("mt_supply", json!({ "token_id": "tsla" })).await?,
        json!("1000")
    );
    Ok(())
}

/// Settle above the warehouse stock moves nothing, even when the guests are owed enough.
#[tokio::test]
async fn settle_is_all_or_nothing() -> testresult::TestResult<()> {
    let env = deploy().await?;
    let g1 = env.guest("guest1", 3).await?;
    let g2 = env.guest("guest2", 3).await?;
    env.pay(&g1, &env.quote("q1", "42", &g1, 3), PRICE * 3)
        .await?
        .assert_success();
    env.pay(&g2, &env.quote("q2", "42", &g2, 3), PRICE * 3)
        .await?
        .assert_success();
    env.call(
        "mint_warehouse",
        json!({ "token_id": "tsla", "amount": "5", "proof": "tx-1" }),
    )
    .await?
    .assert_success();

    env.call(
        "settle",
        json!({ "party": "42", "op_id": "42:1", "transfers": [send(&g1, 3), send(&g2, 3)] }),
    )
    .await?
    .assert_failure();
    assert_eq!(env.balance(&g1).await?, 0);
    assert_eq!(env.balance(&env.contract.0).await?, 5);
    assert_eq!(
        env.view("is_settled", json!({ "op_id": "42:1" })).await?,
        json!(false)
    );
    assert_eq!(
        env.view("owed", json!({ "party": "42" }))
            .await?
            .as_array()
            .unwrap()
            .len(),
        2,
        "owed untouched"
    );
    Ok(())
}

/// The api signs with a function-call key limited to this contract: owner methods take no deposit, so it works.
#[tokio::test]
async fn api_works_with_a_function_call_key() -> testresult::TestResult<()> {
    let env = deploy().await?;
    let guest = env.guest("guest1", 1).await?;
    env.pay(&guest, &env.quote("q1", "42", &guest, 1), PRICE)
        .await?
        .assert_success();

    let fc_signer = Signer::from_secret_key(generate_secret_key()?)?;
    near_api::Account(env.api.clone())
        .add_key(
            AccessKeyPermission::FunctionCall(FunctionCallPermission {
                allowance: Some(NearToken::from_near(1)),
                receiver_id: env.contract.0.to_string(),
                method_names: vec![
                    "mint_warehouse".into(),
                    "settle".into(),
                    "release_wholesale".into(),
                ],
            }),
            fc_signer.get_public_key().await?,
        )
        .with_signer(env.signer.clone())
        .send_to(&env.network)
        .await?
        .assert_success();
    env.mint(&id("treasury"), 0).await?;

    for (method, args) in [
        ("release_wholesale", json!({ "party": "42" })),
        (
            "mint_warehouse",
            json!({ "token_id": "tsla", "amount": "10", "proof": "tx-fc" }),
        ),
        (
            "settle",
            json!({ "party": "42", "op_id": "42:fc", "transfers": [send(&guest, 1)] }),
        ),
    ] {
        env.contract
            .call_function(method, args)
            .transaction()
            .gas(NearGas::from_tgas(300))
            .with_signer(env.api.clone(), fc_signer.clone())
            .send_to(&env.network)
            .await?
            .assert_success();
    }
    assert_eq!(env.balance(&guest).await?, 1);
    Ok(())
}

/// The batch limit must fit NEAR's 16 KiB log cap with the longest ids: 64-char accounts, a 64-char op id, the
/// largest amounts. Prints gas, log size and storage for the README.
#[tokio::test]
async fn settle_max_batch_fits() -> testresult::TestResult<()> {
    let env = deploy().await?;
    let party = "p".repeat(MAX_KEY_LEN);
    // 64-char named accounts, as long as an implicit one. Each buys one drink so it is owed a unit.
    let mut guests = Vec::new();
    let mut tasks = tokio::task::JoinSet::new();
    let env = Arc::new(env);
    for i in 0..=MAX_SETTLE_TRANSFERS {
        let env = env.clone();
        let party = party.clone();
        tasks.spawn(async move {
            let name = format!("{i:0>56}");
            let guest = env.guest(&name, 1).await.unwrap();
            env.pay(
                &guest,
                &env.quote(&format!("q{i}"), &party, &guest, 1),
                PRICE,
            )
            .await
            .unwrap()
            .assert_success();
            guest
        });
    }
    while let Some(g) = tasks.join_next().await {
        guests.push(g?);
    }
    guests.sort();
    assert_eq!(guests[0].as_str().len(), 64);
    env.call(
        "mint_warehouse",
        json!({ "token_id": "tsla", "amount": "100", "proof": "tx-big" }),
    )
    .await?
    .assert_success();

    let batch: Vec<Value> = guests[..MAX_SETTLE_TRANSFERS]
        .iter()
        .map(|g| send(g, 1))
        .collect();
    let storage_before = env.storage_usage().await?;
    let result = env
        .call(
            "settle",
            json!({ "party": party, "op_id": "o".repeat(MAX_KEY_LEN), "transfers": batch }),
        )
        .await?
        .into_full()
        .unwrap();
    let log_bytes: usize = result.logs().iter().map(|l| l.len()).sum();
    // Settling frees the owed entries and adds a balance per new holder, so this is net.
    let storage_after = env.storage_usage().await? as i64;
    println!(
        "settle of {MAX_SETTLE_TRANSFERS} longest transfers: {:.2} TGas, {log_bytes} log bytes of 16384, storage {:+} bytes net",
        gas_tgas(&result),
        storage_after - storage_before as i64
    );
    for f in result.failures() {
        println!("failure: {:?}", f.clone().into_result());
    }
    assert!(result.is_success());
    // Amounts here are 1; the longest amount (39 digits) adds 38 bytes per event. Leave room for it and a longer
    // contract account id.
    assert!(
        log_bytes + 38 * MAX_SETTLE_TRANSFERS < 16384 * 9 / 10,
        "keep 10% of the log cap as margin"
    );
    assert!(gas_tgas(&result) < 100.0);

    let too_many: Vec<Value> = guests.iter().map(|g| send(g, 1)).collect();
    env.call(
        "settle",
        json!({ "party": party, "op_id": "too-many", "transfers": too_many }),
    )
    .await?
    .assert_failure();
    Ok(())
}

/// How little gas a client may attach and still have the margin reach the CEO. Run with `--ignored --nocapture`.
#[tokio::test]
#[ignore]
async fn probe_client_gas() -> testresult::TestResult<()> {
    let env = deploy().await?;
    for tgas in [30u64, 35, 40, 50, 60] {
        let g = env.guest(&format!("probe{tgas}"), 1).await?;
        let ceo_before = env.usdc_of(&id("ceo")).await?;
        let bytes = near_sdk::serde_json::to_vec(&env.quote(&format!("q{tgas}"), "probe", &g, 1))?;
        let sig = env.quote_key.sign(&bytes).to_bytes().to_vec();
        let msg =
            json!({ "quote": Base64VecU8::from(bytes), "sig": Base64VecU8::from(sig) }).to_string();
        let r = env
            .call_as(
                &g,
                &env.usdc,
                "ft_transfer_call",
                json!({ "receiver_id": env.contract.0, "amount": PRICE.to_string(), "msg": msg }),
                tgas,
                1,
            )
            .await?
            .into_full()
            .unwrap();
        let failures: Vec<String> = r
            .failures()
            .into_iter()
            .map(|f| format!("{:?}", f.clone().into_result()))
            .collect();
        println!(
            "{tgas} TGas: paid={} margin_to_ceo={} margin_held={} failures={failures:?}",
            env.usdc_of(&g).await? == 0,
            env.usdc_of(&id("ceo")).await? - ceo_before == PRICE - WHOLESALE,
            r.logs().iter().any(|l| l.contains("margin_held")),
        );
    }
    Ok(())
}

/// Gas of a payment and a settle when a party is at `MAX_OWED_PER_PARTY` (256) entries, the worst case for the
/// per-party list. Slow (256 guests), so run with `--ignored --nocapture`.
#[tokio::test]
#[ignore]
async fn full_party_gas() -> testresult::TestResult<()> {
    const MAX_OWED_PER_PARTY: usize = 256;
    let env = Arc::new(deploy().await?);
    let party = "p".repeat(MAX_KEY_LEN);
    let mut tasks = tokio::task::JoinSet::new();
    for i in 0..MAX_OWED_PER_PARTY - 1 {
        let env = env.clone();
        let party = party.clone();
        tasks.spawn(async move {
            let guest = env.guest(&format!("{i:0>56}"), 1).await.unwrap();
            env.pay(
                &guest,
                &env.quote(&format!("q{i}"), &party, &guest, 1),
                PRICE,
            )
            .await
            .unwrap()
            .assert_success();
        });
    }
    while let Some(r) = tasks.join_next().await {
        r?;
    }
    let last = env.guest(&format!("{:0>56}", "last"), 2).await?;
    let paid = env
        .pay(&last, &env.quote("q-last", &party, &last, 1), PRICE)
        .await?
        .into_full()
        .unwrap();
    assert!(paid.is_success());
    assert!(
        paid.logs()
            .iter()
            .any(|l| l.contains(r#""event":"purchase""#))
    );
    let late = env.guest(&format!("{:0>56}", "late"), 1).await?;
    let refused = env
        .pay(&late, &env.quote("q-late", &party, &late, 1), PRICE)
        .await?
        .into_full()
        .unwrap();
    assert!(refused.logs().iter().any(|l| l.contains("party_full")));
    env.call(
        "mint_warehouse",
        json!({ "token_id": "tsla", "amount": "1", "proof": "tx-full" }),
    )
    .await?
    .assert_success();
    let settled = env
        .call(
            "settle",
            json!({ "party": party, "op_id": "full:1", "transfers": [send(&last, 1)] }),
        )
        .await?
        .into_full()
        .unwrap();
    assert!(settled.is_success());
    println!(
        "party at {MAX_OWED_PER_PARTY} entries: payment {:.2} TGas, settle of 1 {:.2} TGas",
        gas_tgas(&paid),
        gas_tgas(&settled)
    );
    Ok(())
}
