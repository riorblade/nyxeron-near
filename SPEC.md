# NYXERON · Spesifikasi

Status: **draft untuk disetujui tim** (2026-11-03). Rencana kerja dan pembagian tugas: [plan.md](plan.md). Aturan
hackathon: [HACKATHON.md](HACKATHON.md) (baca versi live sebelum submit).

## 1. Ringkasan

NYXERON adalah game nightclub multiplayer di NEAR. Setiap minuman di menu adalah saham tokenized (Tesla, Nvidia,
S&P 500) dengan harga live. CEO menyewa venue dan mengadakan pesta; tamu membeli unit saham asli (1 unit = 0.001
share) di harga pesta. CEO mendapat margin, platform mendapat harga grosir, tamu memegang sahamnya.

Peran NEAR, konkret:

| Bagian            | Teknologi NEAR                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Login             | Login Google/email → akun NEAR otomatis (Privy NEAR wallet), tanpa seed phrase, tanpa gas                              |
| Top-up            | **NEAR Intents (1Click)**: bayar dari chain/token apa saja, mendarat sebagai USDC di treasury NEAR                     |
| Kepemilikan       | Unit saham = token **NEP-245** di kontrak `nyxeron`, dipegang di akun NEAR pemain                                      |
| Gudang saham asli | xStocks (mis. TSLAx) di alamat Solana yang **diturunkan dari akun NEAR via Chain Signatures (MPC)**, tanpa private key |
| Agent restock     | Agent menandatangani swap USDC→xStock lewat Chain Signatures, dalam batas belanja                                      |
| Bukti backing     | `mt_supply` di NEAR vs saldo xStock alamat MPC, bisa dicek siapa saja di `/proof`                                      |

Kalimat pitch: _"Saham Tesla asli, dimiliki akun NEAR tanpa kunci privat, dijual sebagai minuman di nightclub,
dibayar dari chain apa saja."_

### Temuan riset (2026-11-03)

- **1Click tidak punya saham tokenized** (`GET /v0/tokens`: 210 token, hanya crypto dan stablecoin). Saham tidak
  bisa dibeli langsung via Intents.
- **xStocks likuid di Solana** (DexScreener): TSLAx/USDC ~$2,4 jt likuiditas di Raydium, NVDAx/USDC ~$2,9 jt,
  SPYx/USDC ~$2,1 jt. Swap kecil (≤ $50) aman. Mint TSLAx: `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB`
  (verifikasi ulang di situs resmi xStocks sebelum dikunci di config).
- **1Click mendukung Solana** sebagai tujuan, jadi treasury NEAR bisa mendanai gudang Solana lewat Intents.
- **Chain Signatures** mendukung tanda tangan EdDSA untuk Solana (cek di docs Chain Signatures + skill
  `near-smart-contracts` rule `chain-signatures`).
- **Privy mendukung NEAR** lewat `@privy-io/react-auth/extended-chains` (`createWallet({ chainType: 'near' })`),
  sesuai tutorial resmi docs.near.org.
- Track paling cocok: `games` (hint: social login, agent NPC, NEAR Intents, NEP-245).

## 2. Scope

### Masuk (MVP)

1. **Game loop** (§3): kelola club, buka pesta, tamu (pemain dan bot) membeli minuman = unit saham, harga bergerak
   dengan harga live dan energi crowd.
2. Login Google/email → akun NEAR otomatis.
3. Kontrak `nyxeron` (Rust, NEP-245): mint ke gudang hanya dengan bukti swap Solana, settle pesta memindahkan unit
   dari gudang ke akun NEAR tamu.
4. Top-up via 1Click → kredit (1 USD = 100 kredit, fee 1%).
5. Agent restock via Chain Signatures + swap Solana; server memverifikasi lalu mint di NEAR.
6. Halaman publik `/proof`.
7. README untuk juri AI dengan langkah "do X, see Y".

### Tidak masuk (YAGNI, tambah kalau ada waktu)

- Meta-transaction relayer: pemain tidak tanda tangan di loop normal (server yang settle).
- Penarikan unit ke xStock asli (burn NEP-245 → MPC kirim xStock ke alamat Solana pemain). Stretch terbaik.
- Kebijakan belanja agent di dalam kontrak (cap harian on-chain). Stretch, cocok track `security`.
- NPC tamu dengan wallet dan otak AI (NEAR AI Cloud). Stretch, cocok hint "agent NPC".
- Oracle on-chain: kontrak tidak butuh harga. Harga game dari API harga off-chain (S2).
- `mt_transfer_call`, approvals NEP-245.
- Kredit sebagai token on-chain: kredit di ledger server; yang on-chain adalah aset yang dimiliki pemain.

## 3. Game loop (MVP)

Didesain di kertas dulu dan disetujui tim sebelum ngoding (sesuai prompt track `games`).

| Ritme         | Pemain melakukan                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Tiap 30 detik | Saat pesta: tamu membeli minuman; CEO melihat penjualan, energi crowd, harga bergerak; bisa ganti promo/lagu                   |
| Tiap 5 menit  | Satu pesta selesai → laporan malam (penjualan, margin, unit terjual); CEO atur harga menu (≤ 3× grosir) untuk pesta berikutnya |
| Tiap sesi     | Naik level venue, sewa venue lebih besar, kumpulkan portofolio saham sebagai tamu                                              |

Mode:

- **Practice** (gratis, poin main, tanpa login): loop yang sama tanpa uang asli. Pintu masuk untuk juri.
- **City** (uang asli, kredit): sewa venue, pesta dengan tamu asli, unit saham asli on-chain.
- **Fast-forward**: simulasi seminggu pesta dalam satu menit supaya juri melihat ekonominya bergerak.

Angka awal (bisa disetel): 1 unit = 0.001 share; harga grosir = spot × 0.001 × 100 kredit, dibulatkan ke atas;
harga CEO maksimum 3× grosir; fee top-up 1%, min $3, cap $20/hari dan $100 total per pemain.

## 4. Arsitektur

```
 Pemain (browser)                       NEAR                                   Solana
 ───────────────                        ────                                   ──────
 Privy login ──► akun NEAR implicit
 Top-up ──► 1Click deposit address ──► Intents ──► USDC ──► treasury
                                                             │ (1Click) USDC + SOL
                                                             ▼
 agent ── sign request ──► MPC signer (Chain Signatures) ── signature ──► swap USDC→TSLAx ──► gudang @ alamat MPC
                                                                                                  │
 api ── verifikasi swap di Solana RPC ◄───────────────────────────────────────────────────────────┘
  │ mint_warehouse(tsla, n, sol_tx)        settle(op_id, transfers)
  ▼
 kontrak nyxeron (NEP-245) ── unit di akun NEAR tamu ── terlihat di nearblocks
```

| Bagian              | Isi                                                                         | Stack (usul)                                      |
| ------------------- | --------------------------------------------------------------------------- | ------------------------------------------------- |
| `contracts/nyxeron` | NEP-245 unit saham, gudang, settle                                          | Rust, near-sdk 5.x, near-workspaces               |
| `apps/web`          | Game client, login, top-up, portofolio, `/proof`                            | React + Vite + Tailwind                           |
| `services/api`      | Akun, kredit, pesta, penjualan, top-up 1Click, outbox ke NEAR, rekonsiliasi | TypeScript (Node), near-kit / near-api-js, SQLite |
| `apps/agent`        | Restock gudang: quote, swap via Chain Signatures, report                    | TypeScript                                        |
| `packages/game`     | Simulasi pesta (murni, deterministik, seeded RNG), dipakai web dan api      | TypeScript                                        |

TypeScript di backend karena library NEAR (near-kit, near-api-js, chain signatures) paling matang di TS, jadi satu
bahasa untuk semua kecuali kontrak (S1).

### Jaringan

| Jalur                            | Jaringan                             | Alasan                                                          |
| -------------------------------- | ------------------------------------ | --------------------------------------------------------------- |
| Game + kontrak untuk dicoba juri | NEAR **testnet** (`nyxeron.testnet`) | Gratis; juri main dengan kredit demo (`DEMO_MODE=1`)            |
| Uang asli: top-up, gudang xStock | NEAR **mainnet** + Solana mainnet    | 1Click tidak punya testnet (Q-007); xStocks tidak ada di devnet |

Kode sama, beda config (`NEAR_NETWORK`). Deploy mainnet dan transaksi uang asli hanya setelah konfirmasi tim.

## 5. Kontrak `contracts/nyxeron` (Rust, near-sdk 5.x)

Ditulis dengan skill `near-smart-contracts`, diaudit dengan `near-contract-audit` sebelum mainnet. Cek apakah
`near-sdk-contract-tools` punya NEP-245; kalau tidak, tulis inti NEP-245 sendiri. Build reproducible
(`cargo near build`), tes di sandbox (`near-workspaces`).

### State

```rust
owner_id: AccountId,                        // akun server (api), satu-satunya yang mint/settle
tokens: IterableMap<TokenId, TokenInfo>,    // "tsla" → { symbol: "TSLAx", sol_mint, shares_per_unit: "0.001" }
balances: LookupMap<(TokenId, AccountId), u128>,
supply: LookupMap<TokenId, u128>,
used_proofs: LookupSet<String>,             // signature tx Solana yang sudah di-mint (anti double-mint)
settled: LookupSet<String>,                 // id operasi settle yang sudah jalan (idempoten)
paused: bool,
```

Gudang = saldo milik akun kontrak itu sendiri.

### Method

| Method                                                                                           | Siapa    | Efek                                                                                        |
| ------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------- |
| `new(owner_id)`                                                                                  | deploy   | init                                                                                        |
| `register_token(token_id, info)`                                                                 | owner    | tambah saham ke whitelist (awal: `tsla`)                                                    |
| `mint_warehouse(token_id, amount, sol_tx)`                                                       | owner    | mint ke gudang; tolak kalau `sol_tx` sudah dipakai atau `paused`                            |
| `settle(op_id, transfers: Vec<(AccountId, TokenId, U128)>)`                                      | owner    | gudang → tamu dalam satu panggilan; tolak `op_id` duplikat; batas panjang `transfers` (gas) |
| `write_off(token_id, amount, reason)`                                                            | owner    | burn dari gudang (unit hilang yang ditulis-off)                                             |
| `set_paused(bool)`                                                                               | owner    | hentikan mint/settle                                                                        |
| `mt_transfer`, `mt_batch_transfer`                                                               | pemegang | standar NEP-245 (pemain belum memakai di MVP)                                               |
| `mt_balance_of`, `mt_batch_balance_of`, `mt_supply`, `mt_token`, `tokens()`, `is_used_proof(tx)` | view     | web, api, `/proof`, juri                                                                    |

Event NEP-297 standar `nep245` (`mt_mint`, `mt_transfer`, `mt_burn`) dengan `memo` = signature tx Solana /
`party:<id>` / alasan write-off.

Storage dibayar dari saldo kontrak (hanya owner yang membuat entri baru); api memantau saldo kontrak. Pindah ke
`storage_deposit` per pemain kalau pemain banyak.

### Tes wajib (sandbox)

Mint ganda dengan `sol_tx` sama ditolak · `settle` ganda dengan `op_id` sama ditolak · non-owner tidak bisa
mint/settle/write_off · settle melebihi stok gudang gagal tanpa perubahan parsial · `paused` menghentikan mint dan
settle · total supply = gudang + Σ saldo pemain setelah urutan operasi acak.

## 6. `services/api`

### 6.1 Identitas

Setiap request membawa access token Privy, diverifikasi server (JWKS). Akun NEAR pemain diambil dari Privy REST API
(linked account `chain_type = near`), tidak pernah dari body request.

### 6.2 Klien NEAR dan outbox

- View dan call lewat RPC publik (Q-009), RPC kedua sebagai pembanding untuk hal yang menyangkut uang.
- Tanda tangan pakai **function-call access key** yang hanya boleh memanggil kontrak `nyxeron` (env
  `NEAR_SIGNER_KEY`). Bocor = paling parah salah settle, tidak bisa mengambil NEAR akun.
- Tabel `chain_ops(id, kind, args_json, status, tx_hash, attempts)`. Settle di DB satu transaksi SQL dan menulis
  baris `chain_ops` di transaksi yang sama; worker mengirim ke NEAR dengan retry. Kontrak idempoten (`op_id`,
  `sol_tx`), jadi retry aman.

### 6.3 Top-up via 1Click

Pakai skill `near-intents`.

1. `POST /api/topups/quote {originAsset, amountUsd, refundTo}` → 1Click `POST /v0/quote` (`dry: false`), tujuan USDC
   di NEAR (`assetId` dari `/v0/tokens`), `recipient` = treasury, `refundTo` = alamat asal pemain. Simpan
   `topups(deposit_address UNIQUE, user, quote, deadline)`. Deposit address unik per quote = pencocokan pemain trivial.
2. Pemain mengirim dana ke deposit address. Opsional `POST /api/topups/submit {depositAddress, txHash}` →
   `/v0/deposit/submit`.
3. Worker polling `GET /v0/status`. `SUCCESS` → verifikasi transfer USDC ke treasury di NEAR RPC → satu transaksi
   SQL: tandai top-up, tambah kredit `(USD − 1%) × 100` dalam cap, tulis ledger. `REFUNDED` / `FAILED` /
   `INCOMPLETE_DEPOSIT` → catat, tanpa kredit (refund diurus 1Click).
4. `?dry=1` → quote `dry: true` tanpa deposit address, untuk juri dan pratinjau.

Tanpa JWT partner ada fee tambahan 1Click (Q-006: 0.2%, skill: 25 bps; cek docs).

### 6.4 Pesta dan penjualan

- CEO mengunci harga per token untuk pesta (≤ 3× grosir).
- Pembelian tamu = panggilan server, satu transaksi: cek pesta, kredit, stok gudang; tahan kredit; reserve unit;
  catat penjualan `pending` dengan harga CEO dan harga grosir saat itu.
- Akhir pesta (+ masa tenggang): satu settlement per pesta: kredit ditangkap, unit ke tamu, grosir ke platform,
  margin ke CEO, ledger; tulis `chain_ops` `settle(op_id = "party:<id>")`.

### 6.5 Restock

`POST /api/agent/restock {token, sol_tx}` (bearer `AGENT_KEY`): server membaca tx di Solana RPC (dua RPC),
memastikan xStock masuk ke alamat gudang MPC, jumlah dari perubahan saldo token, tx belum dipakai, finalized →
bukukan unit → `chain_ops` `mint_warehouse`.

### 6.6 Rekonsiliasi (per jam, mismatch = pause)

1. Kredit didukung: Σ kredit pemain (termasuk hold) ÷ 100 ≤ saldo USDC treasury di NEAR − dana platform.
2. Unit didukung: `mt_supply(tsla)` × 0.001 ≤ saldo TSLAx alamat MPC di Solana.
3. DB = chain: unit di DB = saldo on-chain (setelah outbox kosong).

## 7. `apps/agent`

1. **Alamat gudang**: diturunkan dari akun NEAR agent + path tetap (mis. `nyxeron-warehouse-sol`) lewat kontrak MPC
   (nama kontrak dari docs Chain Signatures, jangan ditebak). Dikunci di config.
2. **Demand**: baca stok gudang dan penjualan dari api.
3. **Quote**: aggregator swap Solana (kandidat Jupiter API) USDC→TSLAx; tolak kalau harga > 5% di atas atau > 20%
   di bawah spot.
4. **Swap**: tx dari aggregator → minta tanda tangan EdDSA ke MPC → broadcast ke Solana → tunggu finalized.
5. **Report** ke api, retry pada 5xx/jaringan.

Batas: $50 per swap, $500 per hari, satu swap berjalan pada satu waktu (record + run lock di file state).
Pendanaan gudang: treasury NEAR → 1Click → USDC + sedikit SOL (biaya) ke alamat MPC, lewat `pnpm agent --fund`.

Kunci agent: kalau method sign di kontrak MPC butuh deposit (function-call key tidak bisa melampirkan deposit),
akun agent pakai full-access key dengan saldo kecil. Stretch: kontrak kita yang memanggil MPC dengan kebijakan
on-chain.

## 8. `apps/web`

- Layar: landing, dashboard club, layar pesta, laporan malam, City (venue, pesta live), portofolio, top-up, `/proof`.
- Gaya: neon nightclub (panel kaca violet, neon magenta/violet, emas untuk aksi utama). Aset visual dibuat sendiri.
- Login Privy dengan wallet NEAR; profil menampilkan akun NEAR + tautan nearblocks.
- Top-up: pilih chain + token (dari `/v0/tokens`, disaring), deposit address + salin, status.
- Portofolio: unit dari `mt_balance_of`, badge "on NEAR", tautan tx `settle`.
- `/proof`: alamat gudang Solana dan akun NEAR pengendalinya, saldo xStock, `mt_supply`, rasio, restock terakhir.
- `DEMO_MODE` (testnet saja): "Get demo credits" + satu Demo Party yang selalu jalan.
- Teks UI dalam bahasa Inggris.

## 9. Keamanan (tidak boleh dipangkas)

- Server tidak percaya browser untuk nilai: akun NEAR dari Privy server-side, jumlah top-up dari 1Click + RPC NEAR,
  unit restock dari RPC Solana.
- Idempotensi ganda: DB (unique key) dan kontrak (`used_proofs`, `settled`).
- Kunci hanya di env: `NEAR_SIGNER_KEY`, kunci agent, `AGENT_KEY`, `ONECLICK_JWT` (opsional), Privy secret.
- Pause dibaca di dalam transaksi yang memindahkan uang dan di kontrak.
- Tes: replay deposit address, status 1Click palsu/terlambat, RPC berbeda pendapat, outbox crash di tengah, settle
  gagal parsial, pembelian bersamaan menghabiskan stok.

## 10. Langkah juri (draft untuk README)

1. Buka demo → **Play** → main Practice tanpa login → harga saham live di menu.
2. **Fast-forward** → seminggu pesta dalam satu menit, harga dan margin bergerak.
3. **Sign in with Google** → profil menampilkan akun NEAR baru → buka di nearblocks.
4. **Top up** → pilih "USDC on Base" → quote 1Click (dry run, tanpa dana).
5. **Get demo credits** (testnet) → join Demo Party → beli 3 unit TSLA → pesta selesai → portofolio 3 unit
   "on NEAR" → tautan tx `settle`.
6. Buka `/proof` → alamat Solana yang dikendalikan akun NEAR via Chain Signatures, saldo TSLAx, `mt_supply`
   mainnet, rasio ≥ 1.
7. Lokal: `pnpm install && pnpm test && pnpm test:contract` → hijau.

Bukti mainnet di README: tx top-up 1Click, tx swap MPC di Solana, tx `mint_warehouse` dan `settle` di NEAR.

## 11. Keputusan terbuka (tim)

| #   | Keputusan                                                           | Rekomendasi                                                                                      |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| D1  | Track                                                               | `games` + `agents` (opsional `defi`)                                                             |
| D2  | Nama akun mainnet (kontrak, treasury, agent) dan akun payout hadiah | Tim buat sendiri di wallet                                                                       |
| D3  | Dana mainnet untuk bukti                                            | ~$20: 2 top-up kecil + 2 swap $3–5                                                               |
| D4  | Fallback kalau Chain Signatures meleset (9 Nov)                     | Unit diterbitkan dari USDC treasury dan ditandai "not yet backed"; Chain Signatures jadi stretch |
| D5  | Login: Privy NEAR vs NEAR Auth                                      | Privy; NEAR Auth kalau Privy NEAR tidak tersedia                                                 |
| S1  | Bahasa backend                                                      | TypeScript (library NEAR paling matang)                                                          |
| S2  | Sumber harga saham live                                             | Pilih di spike: API harga publik gratis dan stabil, cache di server                              |
