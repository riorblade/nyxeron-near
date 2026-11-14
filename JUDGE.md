# Verify NYXERON without a wallet

Every claim below can be checked with `curl` and `jq` against NEAR testnet, Robinhood Chain testnet and the hosted api,
with no wallet, no funds and no build. Each step gives the command and the result to expect. The steps that need a
browser (play the game, sign in, buy a drink) are in the [README](README.md#try-it); the demo video is on
[X](https://x.com/nyxeron_xyz/status/2121707372079141215).

Everything runs on testnet: the dollars are Circle's testnet USDC and the shares are synthetic stand-ins on Robinhood
Chain testnet (Robinhood's real stock tokens exist on mainnet only). No real money moves.

**What to read, in order:** this file (5 minutes) · [README](README.md) (the product, how NEAR is used, the money
flow) · [contracts/nyxeron/README.md](contracts/nyxeron/README.md) (the contract's interface) ·
[contracts/nyxeron/AUDIT.md](contracts/nyxeron/AUDIT.md) (its security review) ·
[services/api/README.md](services/api/README.md) (the api).

## Helpers

```sh
# A contract view on NEAR testnet. $3 is the base64 of the JSON arguments (e30= is {}).
view() {
  curl -s https://rpc.testnet.near.org -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$1\",\"method_name\":\"$2\",\"args_base64\":\"$3\"}}" \
    | jq -r '.result.result | implode'
}
b64() { printf '%s' "$1" | base64; }
# A transaction with its receipts (the archival node keeps older ones).
tx() {
  curl -s https://archival-rpc.testnet.near.org -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"EXPERIMENTAL_tx_status\",\"params\":{\"tx_hash\":\"$1\",\"sender_account_id\":\"$2\",\"wait_until\":\"NONE\"}}"
}
events() { tx "$1" "$2" | jq -c '[.result.receipts_outcome[].outcome.logs[] | select(startswith("EVENT_JSON")) | ltrimstr("EVENT_JSON:") | fromjson | .event]'; }
```

## 1. The game contract, and what it sells

```sh
view nyxeron.testnet config e30= | jq '{owner_id, treasury, paused}'
view nyxeron.testnet tokens e30= | jq -c '[.[] | {stock: .[0], shares_per_unit: .[1].shares_per_unit}]'
```

Expect owner and treasury `nyxeron-api.testnet`, `paused` `false`, then ten stocks (`tsla`, `nvda`, `aapl`, `googl`,
`meta`, `msft`, `spy`, `qqq`, `crcl`, `mstr`), each `shares_per_unit` `0.001`: one drink is a thousandth of a share.
Stock units are NEP-245 multi tokens on this contract.

## 2. A guest pays for a drink with no gas and no pop-up (tracks `games`, `open`)

```sh
tx 3jhukG2LiiRSACLktNF4M8MFwidjTeJSmdEaR1NZA28u nyx-relayer-mw1s6vvb.testnet \
  | jq '{signer: .result.transaction.signer_id, player: .result.transaction.receiver_id, action: (.result.transaction.actions[0] | keys[0]), call: .result.transaction.actions[0].Delegate.delegate_action.actions[0].FunctionCall.method_name}'
events 3jhukG2LiiRSACLktNF4M8MFwidjTeJSmdEaR1NZA28u nyx-relayer-mw1s6vvb.testnet
```

Expect signer `nyx-relayer-mw1s6vvb.testnet`, the player's own implicit account (`66db3ee2…cbea4d`, made at Google
sign-in through Privy), action `Delegate` (a NEP-366 meta transaction: the player signed, our relayer paid the gas),
call `ft_transfer_call` (USDC to our contract with a server-signed price quote), then the events
`["ft_transfer","purchase","ft_transfer"]`: the payment in, the purchase recorded, the host's margin sent at once.

## 3. One party, end to end, across two chains (tracks `defi`, `games`)

The party in the demo video, `dfec4462-25` (3 × TSLA), as the api's public proof reports it:

```sh
curl -s https://api.nyxeron.xyz/api/proof/parties/dfec4462-25 | jq -c '{title, status, steps: [.steps[] | {kind, hash, proof}]}'
```

Expect `status` `done` and three steps: `release` (the party's wholesale to the treasury), `mint` with
`proof` `0xe78270ba…` (the share purchase on Robinhood Chain), `settle`. Check each on chain:

```sh
# The share purchase on Robinhood Chain testnet: sent from the warehouse to the market, succeeded.
curl -s https://rpc.testnet.chain.robinhood.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["0xe78270ba1053fe919cd01a2724707acd72c5434c6b617fcfabf386d7b915e7aa"]}' \
  | jq -c '.result | {status, from, to}'
# The mint on NEAR names that purchase as its proof; the contract takes each proof once.
tx 75vB3YgjNoUt2jw64KBpfNzkPp8VvnoYQR2XUKgesjSn nyxeron-api.testnet | jq -c '.result.transaction.actions[0].FunctionCall | {method_name, args: (.args | @base64d | fromjson)}'
view nyxeron.testnet is_used_proof "$(b64 '{"proof":"0xe78270ba1053fe919cd01a2724707acd72c5434c6b617fcfabf386d7b915e7aa"}')"
# The settle moves the units to the guest.
tx 8us4JGfoMTZmyvtGG6nrQkyB7uuuHML7KDQ9Fe8BWERB nyxeron-api.testnet \
  | jq -c '[.result.receipts_outcome[].outcome.logs[] | select(startswith("EVENT_JSON")) | ltrimstr("EVENT_JSON:") | fromjson | {event, to: .data[0].new_owner_id, token: .data[0].token_ids, amount: .data[0].amounts}]'
```

Expect `status` `0x1`, `from` `0xa7175f62…d74323` (the warehouse), `to` `0xa7dcd7d0…dd0c26e1` (the market); then
`mint_warehouse` with `token_id` `tsla`, `amount` `3`, `proof` `0xe78270ba…`; `true`; and an `mt_transfer` of `3`
units of `tsla` to the guest. A second party (`dfec4462-20`, 2 × CRCL) is in the README's [On chain](README.md#on-chain)
table.

## 4. The warehouse has no private key: NEAR Chain Signatures (track `defi`)

The Robinhood Chain address that buys the shares is derived from the MPC network's key for the NEAR account
`nyx-warehouse.testnet` and the path `nyxeron-warehouse-hood`:

```sh
view v1.signer-prod.testnet derived_public_key "$(b64 '{"path":"nyxeron-warehouse-hood","predecessor":"nyx-warehouse.testnet"}')"
```

Expect `"secp256k1:3gxmNSHRHhXGvXygq586vb8hgqb6V6ADx2v6NQWJGwQSLMaVwUVPaFHtTHopzTVujokHxPTfovnXRbXboZmcoL9B"`. Its
Ethereum address (keccak-256 of the 64-byte key, last 20 bytes) is the warehouse. With Node, from `services/api` after
`pnpm install`:

```sh
node -e 'const a="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";let n=0n;for(const c of process.argv[1].split(":")[1])n=n*58n+BigInt(a.indexOf(c));import("viem").then(({keccak256})=>console.log("0x"+keccak256("0x"+n.toString(16).padStart(128,"0")).slice(-40)))' secp256k1:3gxmNSHRHhXGvXygq586vb8hgqb6V6ADx2v6NQWJGwQSLMaVwUVPaFHtTHopzTVujokHxPTfovnXRbXboZmcoL9B
```

Expect `0xa7175f62675ec1b780577944e545047df0d74323`, the `from` of the purchase in step 3. The code is
`services/api/src/chainsig.ts`.

## 5. Every unit is backed by a share the warehouse holds

```sh
curl -s https://api.nyxeron.xyz/api/proof | jq -c '{network, synthetic: .hood.synthetic, tokens: [.tokens[] | {ticker, units, sharesOwed, sharesHeld, backed}]}'
view nyxeron.testnet mt_supply "$(b64 '{"token_id":"tsla"}')"
```

Expect `synthetic` `true` and, for each stock guests own, `sharesHeld` at least the shares the purchased units stand for
and `backed` `true`; `mt_supply` matches that stock's `units`. TSLA's `units` include 11 from an early simulated run
before the warehouse bought anything (shown on https://app.nyxeron.xyz/proof as "units from the early simulated run");
`backed` holds the warehouse only to the rest. The same page in a browser: https://app.nyxeron.xyz/proof.

## 6. The guest owns the units

```sh
view nyxeron.testnet mt_balance_of "$(b64 '{"account_id":"66db3ee2b1198e5ccfdc24ac2f0ccdacf7953f4b9b099bc2393b6ae950cbea4d","token_id":"tsla"}')"
```

Expect `"3"`: the guest from step 2 holds 3 TSLA units (0.003 of a share) in their own NEAR account.

## 7. Money in and out from any chain: NEAR Intents (track `defi`)

NEAR Intents has no testnet (Q-007), so on testnet **Add money** shows a live 1Click quote and sends nothing. In the
app: City → sign in → **Add money** → keep USDC on Base → any refund address → **Get a quote**: expect "You send 10.0
USDC on Base. You get about $9.99… here". The code is `services/api/src/intents.ts`.

## 8. The game is a real simulation, not a skin

The night (guests, energy, orders, the bar's capacity, the door, wages) is pure, seeded TypeScript in
[`packages/game`](packages/game): the same seed and choices always give the same night. Every number is in
[`packages/game/src/rules.ts`](packages/game/src/rules.ts).

```sh
pnpm install && pnpm vitest run packages/game
```

Expect every test to pass, among them "one bartender in a full superclub sells fewer drinks than a full bar" and "pays
the crew out of the margin".

## 9. The code

- Public, MIT licensed, first commit on 2026-11-03, inside the hackathon window.
- `pnpm install && pnpm lint && pnpm test` typechecks, lints and runs every TypeScript test (360);
  `pnpm test:contract` runs the contract's 78 unit tests and 10 sandbox tests. Requirements are in the
  [README](README.md#run-it-locally).
- The hosted demo (https://app.nyxeron.xyz and its api) stays up through judging. "Get test dollars" grants $1 of
  testnet USDC a day, enough for 3 × NVDA.
