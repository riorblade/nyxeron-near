# NYXERON · Spesifikasi

Status: **v2, dari hasil spike** (2026-11-04). Setiap keputusan merujuk ke spike di [spikes/FINDINGS.md](spikes/FINDINGS.md).
Tugas dan tanggal: [plan.md](plan.md). Aturan hackathon: [HACKATHON.md](HACKATHON.md).

## 1. Ringkasan

NYXERON adalah game nightclub multiplayer di NEAR. Setiap minuman di menu adalah saham asli (Tesla, NVIDIA, S&P 500,
…) dengan harga pasar live. CEO menyewa venue dan mengadakan pesta; tamu membeli minuman, dan setiap minuman berisi
unit saham asli (1 unit = 0,001 saham) yang menjadi milik tamu. CEO mendapat margin, platform mendapat harga grosir.

**Pemain tidak pernah merasa memakai blockchain:** login Google, saldo dalam dolar, tanpa seed phrase, tanpa popup
wallet, tanpa gas. Uang tetap milik pemain sendiri (non-custodial).

| Bagian            | Teknologi NEAR                                                                                                     | Bukti                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| Login             | Privy NEAR wallet (akun implicit milik pemain, kunci 2-of-2 di enclave)                                            | riset login; spike 10 menunggu |
| Tanpa gas         | Meta transaction NEP-366: pemain tanda tangan, relayer kita bayar gas + deposit 1 yocto                            | 03, 04                         |
| Uang masuk/keluar | NEAR Intents (1Click): top-up dari chain apa saja ke akun pemain, cash-out ke chain apa saja                       | 05                             |
| Bayar minuman     | USDC dari akun pemain ke kontrak `nyxeron`, kontrak membagi margin CEO dan grosir                                  | — (baru)                       |
| Saham asli        | Token saham Robinhood di Robinhood Chain, dibeli alamat EVM yang dikendalikan akun NEAR lewat **Chain Signatures** | 15, 16, 18                     |
| Kepemilikan       | Unit saham NEP-245 di akun NEAR tamu, 1:1 dengan saham di gudang                                                   | PR #14                         |
| Bukti             | `/proof`: `mt_supply` di NEAR vs saldo token di alamat gudang Robinhood Chain                                      | 15                             |

Pitch: _"Minum di nightclub, pulang bawa saham Tesla asli. Bayar dari chain apa saja, tanpa tahu ada blockchain."_

## 2. Keputusan dari spike

| Keputusan                            | Kenapa                                                                                           | Spike      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ | ---------- |
| Backend TypeScript, Node 24          | simulasi game dipakai bersama browser dan server; library NEAR paling matang                     | —          |
| Login Privy NEAR                     | resmi Tier 2, tanda tangan tanpa UI, non-custodial; NEAR Auth popup tiap tanda tangan            | riset      |
| Relayer sendiri (near-api-js 7.4)    | pemain 0 NEAR bisa bertransaksi; biaya ≈ $0,001/aksi, onboarding ≈ $0,034/pemain                 | 03, 04     |
| Session key **tidak** untuk bayar    | function-call key tidak bisa melampirkan deposit (USDC butuh 1 yocto)                            | 03         |
| Saham dari **Robinhood Chain**       | 201 token asli, $1–50 terisi, Intents bisa kirim USDG/ETH ke sana, Chain Signatures EVM terbukti | 15, 16, 18 |
| Bukan Solana xStocks                 | jalan juga, tapi tanda tangan Ed25519 lebih sulit (`chainsig.js` belum dukung tx v0)             | 07, 08     |
| Bukan Ondo di NEAR                   | likuiditas tipis: hanya lot $10/$50/$100, $1–5 selalu gagal                                      | 05, 06     |
| Harga minuman = harga token di pasar | token diperdagangkan 24/7; harga saham penutupan bisa selisih ±3 %                               | 06, 07     |
| Tanpa aplikasi agent                 | pembelian saham = job di `services/api`, bukan agent otonom                                      | —          |
| RPC dengan failover                  | RPC gratis rate-limit; `rpc.*.near.org` mati; domain Robinhood diblokir ISP di Indonesia         | 03, 08, 15 |

## 3. Scope

### Masuk (MVP)

1. Game loop (§4): pesta, tamu, minuman = saham, harga bergerak; mode Practice tanpa login; fast-forward.
2. Login Privy NEAR → akun pemain diaktifkan relayer.
3. Top-up dan cash-out lewat 1Click langsung dari/ke akun pemain.
4. Bayar minuman on-chain ke kontrak dengan harga yang ditandatangani server; margin langsung ke CEO.
5. Akhir pesta: gudang membeli saham di Robinhood Chain, kontrak mencetak dan membagikan unit NEP-245 ke tamu.
6. `/proof` publik dan back office.
7. README untuk juri dengan langkah "do X, see Y", plus tabel tx bukti mainnet.

### Tidak masuk (stretch, kalau sempat)

- **Tarik saham asli ke wallet sendiri:** unit di-burn, gudang mengirim token ke alamat Robinhood Chain milik pemain
  (diturunkan dari akun NEAR pemain lewat Chain Signatures). Ini satu-satunya bagian yang menghilangkan custody
  gudang; paling bernilai setelah MVP.
- NPC/tamu AI dengan NEAR AI Cloud (model tersedia, spike 09).
- Kebijakan belanja gudang di dalam kontrak (track `security`).
- Ondo di NEAR sebagai jalur kedua.

## 4. Game loop

| Ritme         | Pemain melakukan                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| Tiap 30 detik | Saat pesta: tamu membeli minuman; CEO melihat penjualan, energi crowd, harga bergerak; bisa ganti promo/lagu |
| Tiap 5 menit  | Pesta selesai → laporan malam (penjualan, margin, unit terjual) → tamu "mengambil" sahamnya (momen hadiah)   |
| Tiap sesi     | Naik level venue, sewa venue lebih besar, kumpulkan portofolio saham                                         |

Mode: **Practice** (gratis, poin main, tanpa login, pintu masuk juri), **City** (uang asli), **Fast-forward**
(seminggu pesta dalam semenit).

Angka awal: 1 unit = 0,001 saham; harga grosir = harga token × 0,001 × 1,01 (buffer biaya swap ≈ 0,2 % + gas), dibulatkan ke atas ke sen USDC; harga CEO ≤ 3×
grosir; top-up minimal $1, cap $20/hari dan $100 total per pemain selama hackathon.

## 5. Alur uang

```
 Pemain (Privy NEAR)            NEAR                                   Robinhood Chain (4663)
 ───────────────────            ────                                   ──────────────────────
 Add money ─► 1Click ──────────► USDC di akun pemain
 Beli minuman (tanda tangan,     │ ft_transfer_call (relayer bayar gas + 1 yocto)
 tanpa UI) ─────────────────────►├─► kontrak nyxeron ─► margin → akun CEO
                                 │                    └► grosir → treasury
 Akhir pesta                     │   treasury ─► 1Click ─────────────► USDG di alamat gudang (MPC)
                                 │   api ─► sign (Chain Signatures) ─► swap USDG → saham (KyberSwap)
                                 │   api verifikasi saldo token ◄──────┘
                                 └─► mint_warehouse + settle ─► unit NEP-245 di akun tamu
 Cash out ─► 1Click ◄─ USDC dari akun pemain/CEO
```

### 5.1 Uang pemain (non-custodial)

- USDC (NEP-141, mainnet `17208628…6133a1`) disimpan di akun NEAR pemain sendiri.
- **Top-up:** 1Click dengan `recipient` = akun pemain; 1Click sendiri yang mendaftarkan storage USDC. Server hanya
  membuat quote dan memantau status. Kredit di server **tidak** dipakai untuk uang asli.
- **Cash-out:** pemain menandatangani `ft_transfer` USDC ke deposit address 1Click; relayer membayar gas.
- **Onboarding:** akun implicit dibuat relayer dengan transfer 0 NEAR (≈ 0,0071 NEAR), kalau perlu storage USDC
  ditanggung relayer (0,00125 NEAR).

### 5.2 Bayar minuman

1. Klien meminta `POST /api/parties/{id}/quote {token, qty}`. Server mengembalikan **kutipan bertanda tangan**:
   `{contract, party, buyer, token, qty, price, wholesale, ceo, expires}`, ditandatangani kunci ed25519 server yang public
   key-nya tersimpan di kontrak.
2. Klien menandatangani delegate `ft_transfer_call` USDC → `nyxeron` dengan `msg` = kutipan + tanda tangan.
   Relayer memeriksa ketat (§9) lalu mengirim.
3. `ft_on_transfer` di kontrak memeriksa tanda tangan, `expires`, pembeli = pengirim, jumlah = `price × qty`, dan
   `price ≤ 3 × wholesale`. Lalu margin dikirim ke CEO, grosir dicatat sebagai hak beli treasury, dan unit dicatat
   sebagai **utang ke tamu**. Kalau ada yang salah, USDC dikembalikan utuh (tidak ada potongan).
4. UI langsung menampilkan minuman (optimistic); chain final dalam ≈ 2–3 detik.

### 5.3 Saham di Robinhood Chain (gudang)

- **Alamat gudang:** EVM, diturunkan dari akun NEAR api + path `nyxeron-warehouse-hood` (MPC domain 0). Tidak ada
  private key di mana pun.
- **Akhir pesta (job di api):**
  1. Kontrak melepas grosir pesta ke treasury.
  2. Treasury → 1Click → USDG (dan sedikit ETH untuk gas) ke alamat gudang.
  3. Per token: route KyberSwap USDG → token, dipecah jadi swap ≤ $50. Calldata router di-decode dulu: srcToken = USDG,
     dstToken = token yang dipin, penerima = gudang, jumlah = amountIn, tanpa fee, dan minReturn (yang ditegakkan
     router) ≥ yang terutang. Lalu tanda tangan MPC (≈ 6 detik), broadcast, tunggu receipt.
  4. Verifikasi di receipt swap itu sendiri: event `Transfer` dari token **yang alamatnya dipin** ke gudang, minimal
     sejumlah yang terutang. Ini lebih ketat daripada "saldo naik", yang bisa juga disebabkan swap pesta lain. Kalau
     swap sukses tapi saham tidak datang (`short_fill`), semua pembelian berhenti sampai dicek orang.
  5. `mint_warehouse(token, units, proof)`, dengan proof = tx hash swap pertama (ditambah `+n` kalau ada n swap lagi),
     lalu `settle(op_id, transfers)` ke tamu (maks 32 per panggilan).
- **Menu:** hanya token dari daftar terverifikasi spike 18 (codehash beacon + beacon Robinhood), dipin per alamat.
  Awal: TSLA, NVDA, AAPL, GOOGL, META, MSFT, SPY, QQQ, CRCL, MSTR.
- **Saldo berskala:** token Robinhood memakai `uiMultiplier`; jumlah saham dibaca dengan `balanceOfUI`.
- **Batas:** maks $50 per swap (approve juga maks $50) dan $500 per hari; tolak kalau minReturn swap bernilai lebih
  dari 2 % di bawah harga pasar.

### 5.4 Harga

- Harga token dari quote DEX (KyberSwap, `amountOutUsd` per $1) per token, cache 60 detik; menolak kalau lebih tua
  dari 10 menit.
- Harga saham asli (penutupan) hanya ditampilkan sebagai info.
- Spike lanjutan: oracle harga on-chain milik token Robinhood (`priceFeed`) sebagai sumber kedua.

## 6. Kontrak `contracts/nyxeron` (Ghoza)

Sudah ada (PR #14, deploy `nyxeron.testnet`): NEP-245, `register_token`, `mint_warehouse(token_id, amount, proof)`,
`settle(op_id, transfers ≤ 32)`, `write_off`, `set_paused`, views, event `nep245`, idempoten (`used_proofs`, `settled`).

Tambahan untuk v2:

| Method                                   | Siapa        | Efek                                                 |
| ---------------------------------------- | ------------ | ---------------------------------------------------- |
| `ft_on_transfer(sender_id, amount, msg)` | kontrak USDC | bayar minuman (§5.2); kembalikan semua kalau ditolak |
| `set_quote_key(public_key)`              | owner        | kunci ed25519 server untuk kutipan                   |
| `release_wholesale(party_id)`            | owner        | grosir pesta ke treasury untuk beli saham            |
| `owed(party_id)`                         | view         | unit yang harus dibagikan per tamu                   |
| `set_owner(owner_id)` + `accept_owner()` | owner, calon | ganti akun api tanpa deploy ulang, dua langkah       |

Tes wajib tambahan: kutipan kadaluarsa, tanda tangan salah, pembeli ≠ pengirim, harga di atas 3× grosir, refund utuh
saat ditolak, margin sampai ke CEO, `release_wholesale` sekali per pesta.

## 7. `services/api` (Kiel)

Sudah ada: config, SQLite + migrasi, ledger, login Privy + akun NEAR, `/api/quotes`, back office dasar.

Tambahan:

| Bagian                | Isi                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Perbaikan             | endpoint Privy `api.privy.io/v1/users/{id}`; harga dari token Robinhood (bukan Jupiter); `packages/game` pakai alamat Robinhood               |
| `relay.ts`            | `POST /api/relay`: terima delegate dari klien, tolak kalau receiver/method/deposit/jumlah aksi tidak di allowlist, kirim dengan kunci relayer |
| `onboard.ts`          | aktifkan akun implicit pemain + storage USDC sekali                                                                                           |
| `parties.ts`          | venue, pesta, kutipan bertanda tangan, simulasi pesta (dari `packages/game`)                                                                  |
| `settlement.ts`       | job akhir pesta §5.3, dengan outbox `chain_ops` dan retry; idempoten di kontrak                                                               |
| `chainsig.ts` (Ghoza) | derive alamat EVM, minta tanda tangan MPC, rakit tx; dua bentuk respons MPC                                                                   |
| `intents.ts`          | quote top-up/cash-out, pantau status                                                                                                          |
| `proof.ts`            | `GET /api/proof`: `mt_supply` vs `balanceOfUI` gudang per token                                                                               |
| RPC                   | NEAR: FastNEAR + drpc + intea; Robinhood: publicnode + drpc                                                                                   |

## 8. `apps/web` (Wisnu)

Layar: landing, Practice, dashboard club, pesta, laporan malam + "ambil saham", City, portofolio (unit + saldo USDC),
Add money/Cash out, `/proof`, back office `/admin`. Login Privy NEAR; semua tanda tangan lewat `signRawHash` tanpa UI
lalu dikirim ke `/api/relay`. Saldo dalam dolar; kata NEAR/Robinhood hanya di `/proof` dan badge kecil.

## 9. Keamanan

- Server tidak bisa memindahkan USDC pemain; hanya pemain yang menandatangani pembayaran.
- Relayer menolak semua delegate kecuali: receiver = kontrak `nyxeron` atau USDC, method di allowlist, deposit ≤ 1
  yocto, satu aksi. Batas per pemain per menit.
- Kutipan harga bertanda tangan dan kadaluarsa singkat (≤ 60 detik).
- Token saham dipin per alamat dan diverifikasi beacon-nya saat start; nama/ticker tidak pernah dipakai untuk mencari.
- Gudang: batas swap, tolak quote buruk, satu swap per token per pesta, verifikasi saldo sebelum mint.
- Kunci hanya di env; akun kontrak tanpa full-access key di mainnet.
- Risiko diterima: penerbit token Robinhood bisa memblokir/pause/burn, dan sequencer menyaring transaksi (spike 15).
  Disebut terang di README.

## 10. Lingkungan testnet (juri)

| Bagian                          | Testnet                                                                                                                  | Mainnet              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| Akun, relayer, kontrak, NEP-245 | asli (NEAR testnet)                                                                                                      | asli                 |
| USDC                            | USDC testnet Circle, atau token NEP-141 kita sendiri dengan tombol "Get test dollars"                                    | USDC asli            |
| Top-up/cash-out                 | tombol faucet; quote 1Click asli ditampilkan sebagai dry run                                                             | 1Click asli          |
| Saham                           | Chain Signatures testnet MPC asli; pembelian saham disimulasikan, unit dicetak dengan proof `demo:<id>` dan diberi label | Robinhood Chain asli |

Bukti mainnet di README: satu top-up, satu pembelian minuman, satu swap saham gudang, satu `settle`, satu cash-out.

## 11. Langkah juri (draft README)

1. Buka demo → **Play** → Practice tanpa login → harga saham live di menu.
2. **Fast-forward** → seminggu pesta dalam semenit.
3. **Sign in with Google** → profil menampilkan saldo $0 dan akun NEAR (tautan nearblocks).
4. **Get test dollars** → $50 → join Demo Party → beli 3 minuman TSLA → tanpa popup, minuman langsung muncul.
5. Pesta selesai → **Collect shares** → portofolio: 0,003 TSLA, tautan tx `settle`.
6. **Add money** → pilih USDC di Base → quote 1Click nyata (dry run).
7. `/proof` → unit di NEAR vs saham di alamat gudang Robinhood Chain (dikendalikan akun NEAR, tanpa private key).

## 12. Keputusan terbuka

| #   | Keputusan                                                             | Rekomendasi                                                       |
| --- | --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| D1  | Track                                                                 | `games` + `defi` + `open` (+ `realworld` kalau cash-out CEO jadi) |
| D2  | Akun mainnet (kontrak, api, treasury, relayer) dan akun payout hadiah | tim buat sendiri                                                  |
| D3  | Dana mainnet untuk bukti                                              | ≈ $20                                                             |
| D4  | Fallback kalau tanda tangan Privy ternyata ber-UI                     | pembelian lewat saldo di kontrak + session key (spike 03)         |
| D5  | Riwayat repo berisi string token lama sebelum dibuka publik           | bersihkan (force-push) atau buat ulang repo                       |
