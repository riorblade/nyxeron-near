//! Deploys the real wasm to a local NEAR sandbox and drives it the way the api will.

use near_api::types::{AccessKeyPermission, transaction::actions::FunctionCallPermission};
use near_api::{AccountId, NearGas, NearToken, Signer, signer::generate_secret_key};
use near_sdk::serde_json::{Value, json};
use std::sync::Arc;

const MAX_SETTLE_TRANSFERS: usize = 32;
const MAX_KEY_LEN: usize = 64;

struct Env {
    _sandbox: near_sandbox::Sandbox,
    network: near_api::NetworkConfig,
    signer: Arc<Signer>,
    contract: near_api::Contract,
    api: AccountId,
}

async fn deploy() -> testresult::TestResult<Env> {
    let wasm_path = cargo_near_build::build_with_cli(Default::default())?;
    let wasm = std::fs::read(wasm_path)?;

    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let network = near_api::NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;

    let api: AccountId = "api.sandbox".parse()?;
    let contract_id: AccountId = "nyxeron.sandbox".parse()?;
    for id in [&api, &contract_id] {
        // near-sandbox and near-api depend on different near-account-id majors, so go through the string.
        sandbox
            .create_account(id.as_str().parse()?)
            .initial_balance(NearToken::from_near(20))
            .send()
            .await?;
    }

    near_api::Contract::deploy(contract_id.clone())
        .use_code(wasm)
        .with_init_call("new", json!({ "owner_id": api }))?
        .with_signer(signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    let env = Env {
        _sandbox: sandbox,
        network,
        signer,
        contract: near_api::Contract(contract_id),
        api,
    };
    env.call("register_token", json!({
        "token_id": "tsla",
        "info": { "symbol": "TSLA", "backing": "solana:XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", "shares_per_unit": "0.001" }
    }))
    .await?
    .assert_success();
    Ok(env)
}

impl Env {
    async fn call(
        &self,
        method: &str,
        args: Value,
    ) -> testresult::TestResult<near_api::types::transaction::result::TransactionResult> {
        Ok(self
            .contract
            .call_function(method, args)
            .transaction()
            .gas(NearGas::from_tgas(300))
            .with_signer(self.api.clone(), self.signer.clone())
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

    async fn storage_usage(&self) -> testresult::TestResult<u64> {
        Ok(near_api::Account(self.contract.0.clone())
            .view()
            .fetch_from(&self.network)
            .await?
            .data
            .storage_usage)
    }

    async fn balance(&self, account: &str) -> testresult::TestResult<u128> {
        let v = self
            .view(
                "mt_balance_of",
                json!({ "account_id": account, "token_id": "tsla" }),
            )
            .await?;
        Ok(v.as_str().unwrap().parse()?)
    }
}

fn guest(n: usize) -> String {
    // Players are implicit or named accounts that may not exist yet; the contract only keys balances by id.
    format!("guest{n}.sandbox")
}

fn transfers(count: usize, amount: u128) -> Value {
    json!((0..count).map(|n| json!({ "account_id": guest(n), "token_id": "tsla", "amount": amount.to_string() })).collect::<Vec<_>>())
}

#[tokio::test]
async fn warehouse_mint_settle_and_proofs() -> testresult::TestResult<()> {
    let env = deploy().await?;

    let mint = env
        .call(
            "mint_warehouse",
            json!({ "token_id": "tsla", "amount": "1000", "proof": "sol-tx-1" }),
        )
        .await?;
    let mint = mint.into_full().unwrap();
    assert!(
        mint.logs()
            .iter()
            .any(|l| l.contains(r#""event":"mt_mint""#) && l.contains(r#""memo":"sol-tx-1""#))
    );
    assert_eq!(env.balance("nyxeron.sandbox").await?, 1000);

    env.call(
        "mint_warehouse",
        json!({ "token_id": "tsla", "amount": "5", "proof": "sol-tx-1" }),
    )
    .await?
    .assert_failure();
    assert_eq!(
        env.view("mt_supply", json!({ "token_id": "tsla" })).await?,
        json!("1000")
    );
    assert_eq!(
        env.view("is_used_proof", json!({ "proof": "sol-tx-1" }))
            .await?,
        json!(true)
    );

    // Above stock: the first transfers fit, the last does not. Nothing may move.
    let over = json!([
        { "account_id": guest(1), "token_id": "tsla", "amount": "600" },
        { "account_id": guest(2), "token_id": "tsla", "amount": "401" }
    ]);
    env.call("settle", json!({ "op_id": "party:0", "transfers": over }))
        .await?
        .assert_failure();
    assert_eq!(env.balance(&guest(1)).await?, 0);
    assert_eq!(env.balance("nyxeron.sandbox").await?, 1000);
    assert_eq!(
        env.view("is_settled", json!({ "op_id": "party:0" }))
            .await?,
        json!(false)
    );

    let settle = env
        .call(
            "settle",
            json!({ "op_id": "party:1", "transfers": transfers(3, 2) }),
        )
        .await?;
    let settle = settle.into_full().unwrap();
    assert!(
        settle
            .logs()
            .iter()
            .any(|l| l.contains(r#""event":"mt_transfer""#) && l.contains(r#""memo":"party:1""#))
    );
    assert_eq!(env.balance(&guest(0)).await?, 2);
    env.call(
        "settle",
        json!({ "op_id": "party:1", "transfers": transfers(3, 2) }),
    )
    .await?
    .assert_failure();
    assert_eq!(env.balance(&guest(0)).await?, 2);
    Ok(())
}

/// The api signs with a function-call key limited to this contract: owner methods take no deposit, so it works.
#[tokio::test]
async fn api_settles_with_a_function_call_key() -> testresult::TestResult<()> {
    let env = deploy().await?;
    let fc_key = generate_secret_key()?;
    let fc_signer = Signer::from_secret_key(fc_key)?;
    near_api::Account(env.api.clone())
        .add_key(
            AccessKeyPermission::FunctionCall(FunctionCallPermission {
                allowance: Some(NearToken::from_near(1)),
                receiver_id: env.contract.0.to_string(),
                method_names: vec!["mint_warehouse".into(), "settle".into()],
            }),
            fc_signer.get_public_key().await?,
        )
        .with_signer(env.signer.clone())
        .send_to(&env.network)
        .await?
        .assert_success();

    for (method, args) in [
        (
            "mint_warehouse",
            json!({ "token_id": "tsla", "amount": "10", "proof": "sol-tx-fc" }),
        ),
        (
            "settle",
            json!({ "op_id": "party:fc", "transfers": transfers(1, 4) }),
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
    assert_eq!(env.balance(&guest(0)).await?, 4);
    Ok(())
}

/// The batch limit must fit NEAR's 16 KiB log cap with the longest ids: 64-char implicit accounts, a 64-char op id,
/// the largest amount. Prints gas and log size for the README.
#[tokio::test]
async fn settle_max_batch_fits() -> testresult::TestResult<()> {
    let env = deploy().await?;
    env.call(
        "mint_warehouse",
        json!({ "token_id": "tsla", "amount": u128::MAX.to_string(), "proof": "sol-tx-big" }),
    )
    .await?
    .assert_success();

    // Worst case except amounts: u128::MAX in one transfer leaves nothing for the others.
    let worst = |n: usize, amount: u128| {
        json!((0..n)
            .map(|i| json!({ "account_id": format!("{i:064x}"), "token_id": "tsla", "amount": amount.to_string() }))
            .collect::<Vec<_>>())
    };
    let amount = u128::MAX / 64;
    let op_id = "p".repeat(MAX_KEY_LEN);
    let storage_before = env.storage_usage().await?;
    let result = env
        .call(
            "settle",
            json!({ "op_id": op_id, "transfers": worst(MAX_SETTLE_TRANSFERS, amount) }),
        )
        .await?;
    let result = result.into_full().unwrap();
    let gas: u64 = result.outcomes().iter().map(|o| o.gas_burnt.as_gas()).sum();
    let log_bytes: usize = result.logs().iter().map(|l| l.len()).sum();
    let per_holder = (env.storage_usage().await? - storage_before) / MAX_SETTLE_TRANSFERS as u64;
    println!(
        "settle of {MAX_SETTLE_TRANSFERS} longest transfers: {:.2} TGas, {log_bytes} log bytes of 16384, {per_holder} bytes of storage per new holder",
        gas as f64 / 1e12
    );
    for f in result.failures() {
        println!("failure: {:?}", f.clone().into_result());
    }
    assert!(result.is_success());
    assert!(
        log_bytes < 16384 * 9 / 10,
        "keep 10% of the log cap as margin for a longer contract account id"
    );
    assert!(gas < 100_000_000_000_000);

    let too_many = transfers(MAX_SETTLE_TRANSFERS + 1, 1);
    env.call(
        "settle",
        json!({ "op_id": "party:too-many", "transfers": too_many }),
    )
    .await?
    .assert_failure();
    Ok(())
}
