# NYXERON · Rencana

Spesifikasi: [SPEC.md](SPEC.md). Aturan dan tanggal: [HACKATHON.md](HACKATHON.md).

## Tujuan

Bangun NYXERON dari nol di NEAR untuk NEAR HACKATHON: game nightclub di mana minuman = saham tokenized. Login sosial →
akun NEAR, top-up dari chain apa saja via NEAR Intents, unit saham sebagai NEP-245, gudang xStocks di Solana yang
dikendalikan akun NEAR via Chain Signatures.

## Tim

| Orang     | GitHub        | Bagian                                                                                            |
| --------- | ------------- | ------------------------------------------------------------------------------------------------- |
| **Ghoza** | @ghozzza      | Smart contract: kontrak NEP-245, Chain Signatures (MPC), deploy kontrak                           |
| **Kiel**  | @riorblade    | Backend (`services/api`, `apps/agent`, deploy), alur game (`packages/game`) dan visual            |
| **Wisnu** | @AdityaWisnuu | Frontend + back office UI + UX (`apps/web`), README juri, video demo, post X, submission, sisanya |

Repo: `riorblade/nyxeron-near` (private sampai tim setuju dibuka; wajib publik sebelum 14 Nov 23:59 UTC).

## Tanggal penting (UTC)

| Kapan               | Apa                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| Sel 3 Nov           | Plan + spec + pembagian tugas                                                                  |
| **Rab 4 Nov**       | **Dikunci**: interface kontrak (Ghoza), game loop di kertas (Kiel), bentuk endpoint api (Kiel) |
| **Sen 9 Nov malam** | **Titik keputusan Chain Signatures**: jalan, atau fallback D4                                  |
| Jum 13 Nov          | **Target submit internal** (sehari cadangan)                                                   |
| Sab 14 Nov 23:59    | Batas akhir: repo publik, post X, submission (= Min 15 Nov 06:59 WIB)                          |
| 16–18 Nov           | Penjurian; demo hosted tetap hidup sampai minimal 18 Nov (idealnya 25 Nov)                     |

## Tugas per orang

Selesai = tes hijau (`pnpm test`, `pnpm lint`, `pnpm test:contract`).

### Ghoza · Smart contract

| Kapan     | Tugas                                                                                                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3–4 Nov   | Akun testnet dev (faucet). Kunci interface kontrak SPEC §5 (method, argumen, event), umumkan ke tim                                                                           |
| 3–5 Nov   | **Spike (risiko terbesar)**: derive alamat Solana dari akun NEAR via Chain Signatures (EdDSA), tanda tangani 1 tx kecil di Solana mainnet (konfirmasi tim sebelum pakai dana) |
| 4–6 Nov   | `contracts/nyxeron`: state + method SPEC §5, event `nep245`, `used_proofs`, `settled`, `paused`                                                                               |
| 4–6 Nov   | Tes sandbox (daftar SPEC §5), script `pnpm test:contract`                                                                                                                     |
| 6 Nov     | Deploy `nyxeron.testnet`, daftarkan `tsla`, function-call key untuk api (kirim ke Kiel lewat jalur aman)                                                                      |
| 7–10 Nov  | `apps/agent/chainsig.ts`: derive alamat gudang, tanda tangani tx swap dari aggregator (Jupiter) via MPC, broadcast. Ekspor `address()`, `signAndSend(tx)`                     |
| 10–11 Nov | Audit `near-contract-audit`, deploy mainnet (konfirmasi tim), 1–2 swap $3–5 bersama Kiel, catat tx                                                                            |
| 12 Nov    | Bagian "Contract" di README: alamat, method, cara cek `mt_supply` dan `is_used_proof`                                                                                         |
| Stretch   | Cap belanja agent on-chain (track `security`); burn NEP-245 → kirim xStock asli ke pemain                                                                                     |

### Kiel · Backend + alur game + visual

| Kapan            | Tugas                                                                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3–4 Nov          | **Game loop di kertas** (SPEC §3: tiap 30 detik / 5 menit / sesi), disetujui tim                                                                                                          |
| 5–8 Nov          | `packages/game`: simulasi pesta murni + seeded RNG (tamu, energi crowd, penjualan, harga), fast-forward; tes Vitest                                                                       |
| 3–4 Nov          | Scaffold monorepo (pnpm workspace, TS, Vitest, ESLint, Prettier, CI). Kunci bentuk endpoint api. Spike S2: sumber harga saham live                                                        |
| 5–7 Nov          | `services/api`: verifikasi token Privy, akun NEAR dari Privy REST, ledger kredit, venue/pesta/penjualan (hold → settle), SQLite                                                           |
| 6–8 Nov          | Klien NEAR (near-kit), tabel `chain_ops` + worker, settle → `settle` on-chain, portofolio dari `mt_balance_of`                                                                            |
| 7–9 Nov          | Top-up 1Click: quote (dry + wet), submit, worker status, verifikasi USDC di NEAR, kredit + cap. 1 top-up mainnet kecil (konfirmasi tim)                                                   |
| 8–11 Nov         | `apps/agent`: demand, quote Jupiter, cek harga vs spot, batas, record + run lock, `--fund` via 1Click; api: verifikasi swap di Solana RPC → `mint_warehouse`; rekonsiliasi SPEC §6.6      |
| 11–12 Nov        | Deploy api + agent (testnet + mainnet config), `DEMO_MODE` di api                                                                                                                         |
| Visual, 4–12 Nov | Gaya neon nightclub: token warna + komponen dasar (4–5 Nov, supaya Wisnu bisa jalan), art club/venue, ikon minuman per saham, ikon chain, badge "on NEAR", thumbnail video, gambar post X |
| Tes              | Replay deposit address, status 1Click palsu/terlambat, RPC beda pendapat, outbox crash, pembelian bersamaan                                                                               |

### Wisnu · Frontend + UX + sisanya

| Kapan     | Tugas                                                                                                                             |
| --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 3–4 Nov   | **Spike**: Privy `createWallet({ chainType: 'near' })` di app Privy kita (fallback NEAR Auth, D5)                                 |
| 5–8 Nov   | `apps/web` back office: login admin, daftar pemain, top-up, penjualan, stok, audit (endpoint dari Kiel, tipe dari `@nyxeron/api`) |
| 5–9 Nov   | `apps/web`: landing, dashboard club, layar pesta, laporan malam, mode Practice tanpa login                                        |
| 7–9 Nov   | Login Privy NEAR, profil akun NEAR + nearblocks; UI top-up (chain + token, deposit address, status)                               |
| 9–11 Nov  | City (venue, pesta live), portofolio on-chain, `/proof`, UI `DEMO_MODE`                                                           |
| Terus     | UX: alur juri tanpa hambatan dari browser bersih; teks UI bahasa Inggris                                                          |
| 11–12 Nov | README juri AI (SPEC §10): masalah, produk, peran NEAR, "do X, see Y", bukti mainnet, daftar library (Q-005), LICENSE             |
| 12 Nov    | Deploy web, jalankan langkah juri dari awal sampai akhir                                                                          |
| 12–13 Nov | Video demo ≤ 3 menit; draft post X (tim yang posting)                                                                             |
| 13 Nov    | Kumpulkan data submission dari tim, cetak payload, kirim **hanya setelah tim setuju**                                             |

## Ketergantungan

| Yang dibutuhkan                     | Dari         | Untuk                 | Paling lambat |
| ----------------------------------- | ------------ | --------------------- | ------------- |
| Interface kontrak                   | Ghoza        | Kiel, Wisnu           | 4 Nov         |
| Game loop disetujui                 | Kiel         | Wisnu (layar), semua  | 4 Nov         |
| Bentuk endpoint api (stub boleh)    | Kiel         | Wisnu                 | 4 Nov         |
| Token warna + komponen dasar        | Kiel         | Wisnu                 | 5 Nov         |
| Hasil spike Privy NEAR              | Wisnu        | Kiel                  | 4 Nov         |
| Kontrak testnet + function-call key | Ghoza        | Kiel                  | 6 Nov         |
| `packages/game` (API simulasi)      | Kiel         | Wisnu (layar pesta)   | 7 Nov         |
| `chainsig.ts`                       | Ghoza        | Kiel (agent)          | 9 Nov         |
| Tx bukti mainnet                    | Ghoza + Kiel | Wisnu (README, video) | 11 Nov        |

## Risiko

| Risiko                                                   | Pemilik      | Mitigasi                                                                                |
| -------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------- |
| Membangun game dari nol dalam 11 hari                    | Kiel + Wisnu | Game loop kecil dan jelas (SPEC §3); visual 2D, tanpa 3D; fast-forward dulu baru polish |
| Chain Signatures + swap Solana lebih lama dari perkiraan | Ghoza        | Spike hari pertama; fallback D4 pada 9 Nov                                              |
| Privy NEAR tidak tersedia di plan kita                   | Wisnu        | Spike; fallback NEAR Auth                                                               |
| 1Click tanpa testnet                                     | Kiel         | Quote `dry: true` untuk dev; mainnet hanya nominal kecil                                |
| Saldo kontrak habis untuk storage                        | Ghoza        | Pantau saldo, isi ulang                                                                 |
| Scope melebar                                            | Semua        | Stretch hanya setelah semua tugas 13 Nov selesai                                        |

## Keputusan terbuka

SPEC §11: D1 track, D2 akun mainnet + payout, D3 dana, D4 fallback, D5 login, S1 bahasa backend, S2 sumber harga.

## Butuh konfirmasi tim (tidak dilakukan agent sendiri)

Menjadikan repo publik, force-push, deploy mainnet, tanda tangan transaksi / pakai dana, posting di X, mengirim
submission.
