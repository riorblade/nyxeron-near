# NYXERON · Rencana

Desain: [SPEC.md](SPEC.md) (v2, dari spike). Bukti: [spikes/FINDINGS.md](spikes/FINDINGS.md). Aturan:
[HACKATHON.md](HACKATHON.md). Cara kerja: [CONTRIBUTING.md](CONTRIBUTING.md).

## Tujuan

Game nightclub di NEAR: minuman = saham asli dari Robinhood Chain. Login Google, uang di akun NEAR pemain sendiri,
top-up dan cash-out dari/ke chain mana pun lewat NEAR Intents, tanpa gas, tanpa popup. Saham dibeli alamat yang
dikendalikan akun NEAR lewat Chain Signatures, dan unitnya (NEP-245) jadi milik tamu.

## Tim

| Orang     | GitHub        | Bagian                                                                                         |
| --------- | ------------- | ---------------------------------------------------------------------------------------------- |
| **Ghoza** | @ghozzza      | Kontrak `contracts/nyxeron`, Chain Signatures (`services/api/src/chainsig.ts`), deploy kontrak |
| **Kiel**  | @riorblade    | Backend `services/api`, alur game `packages/game`, deploy, visual                              |
| **Wisnu** | @AdityaWisnuu | `apps/web` (game + back office), UX, README juri, video, post X, submission                    |

## Tanggal penting (UTC)

| Kapan            | Apa                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| Rab 4 Nov        | Spike 01–18 selesai; desain v2 (Robinhood Chain)                                                                  |
| **Kam 5 Nov**    | Spike Privy (Wisnu) harus selesai: tanda tangan tanpa UI + delegate ke relayer. Kalau gagal → fallback D4         |
| **Jum 6 Nov**    | Interface kontrak v2 dikunci (Ghoza): `ft_on_transfer`, kutipan bertanda tangan, `release_wholesale`, `set_owner` |
| **Sen 9 Nov**    | Satu pesta penuh di testnet: bayar minuman on-chain → unit ke tamu                                                |
| Rab 11 Nov       | Bukti mainnet (dengan persetujuan tim): top-up, beli, swap saham gudang, `settle`, cash-out                       |
| Jum 13 Nov       | **Target submit internal**                                                                                        |
| Sab 14 Nov 23:59 | Batas akhir (= Min 15 Nov 06:59 WIB)                                                                              |

## Tugas per orang

Selesai = tes hijau (`pnpm lint`, `pnpm test`, `cargo test`), lewat issue → `dev-<nama>` → PR.

### Ghoza · Kontrak + Chain Signatures

| Kapan     | Tugas                                                                                                                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4–5 Nov   | Rampungkan PR #14 (review, merge). Tambah `set_owner`                                                                                                                                              |
| 5–7 Nov   | Kontrak v2 (SPEC §6): `ft_on_transfer` untuk bayar minuman dengan kutipan bertanda tangan ed25519, margin langsung ke CEO, utang unit per tamu, `release_wholesale`, refund utuh saat ditolak; tes |
| 6–8 Nov   | Issue #15 diarahkan ulang: `services/api/src/chainsig.ts` versi **EVM** (domain 0) untuk alamat gudang Robinhood Chain: derive, sign hash tx, rakit, dua bentuk respons. Acuan: spike 16           |
| 8 Nov     | Deploy v2 ke `nyxeron.testnet`                                                                                                                                                                     |
| 10–11 Nov | `near-contract-audit`, deploy mainnet (persetujuan tim)                                                                                                                                            |
| 12 Nov    | Bagian "Contract" di README                                                                                                                                                                        |

### Kiel · Backend + alur game + visual

| Kapan            | Tugas                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 4–5 Nov          | Perbaikan: endpoint Privy `api.privy.io`; `packages/game` pakai menu Robinhood yang dipin (spike 18); harga dari token Robinhood (§5.4) |
| 5 Nov            | Game loop di kertas (SPEC §4)                                                                                                           |
| 5–6 Nov          | `relay.ts` (allowlist ketat) + `onboard.ts` (aktifkan akun pemain, storage USDC); dipakai Wisnu untuk spike Privy                       |
| 5–8 Nov          | `packages/game`: simulasi pesta (seeded RNG), fast-forward; tes                                                                         |
| 6–8 Nov          | `parties.ts`: venue, pesta, kutipan bertanda tangan                                                                                     |
| 7–9 Nov          | `intents.ts`: quote top-up/cash-out, status                                                                                             |
| 8–10 Nov         | `settlement.ts`: job akhir pesta (1Click → USDG → swap via `chainsig.ts` → verifikasi → `mint_warehouse` + `settle`), outbox + retry    |
| 10–11 Nov        | `proof.ts`, rekonsiliasi; deploy api (testnet + mainnet config); mode demo testnet                                                      |
| Visual, 5–12 Nov | Token warna + komponen dasar (5 Nov), art venue, ikon minuman per saham, badge, thumbnail, gambar post X                                |

### Wisnu · Frontend + UX + sisanya

| Kapan       | Tugas                                                                                                                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **4–5 Nov** | **Spike 10 (Privy):** `createWallet({ chainType: 'near' })`, `signRawHash` tanpa UI (login pertama, login ulang, Safari mobile), tanda tangan delegate lalu kirim ke `/api/relay`. Butuh app id Privy |
| 5–8 Nov     | Scaffold `apps/web`, landing, Practice, dashboard club, layar pesta, laporan malam                                                                                                                    |
| 7–9 Nov     | Login Privy NEAR, saldo dolar, Add money / Cash out (1Click), bayar minuman lewat relayer                                                                                                             |
| 9–11 Nov    | City, portofolio (unit + USDC), "Collect shares", `/proof`, back office `/admin`                                                                                                                      |
| 11–12 Nov   | README juri (SPEC §11), deploy web, jalankan langkah juri dari browser bersih                                                                                                                         |
| 12–13 Nov   | Video ≤ 3 menit, draft post X, data submission (kirim hanya setelah tim setuju)                                                                                                                       |

## Ketergantungan

| Butuh                                    | Dari         | Untuk                           | Paling lambat |
| ---------------------------------------- | ------------ | ------------------------------- | ------------- |
| `/api/relay` + `/api/onboard` di testnet | Kiel         | Wisnu (spike 10)                | 5 Nov         |
| App id + secret Privy                    | Kiel         | Wisnu                           | 4 Nov         |
| Hasil spike 10                           | Wisnu        | semua (lanjut atau fallback D4) | 5 Nov         |
| Interface kontrak v2                     | Ghoza        | Kiel, Wisnu                     | 6 Nov         |
| `chainsig.ts` EVM                        | Ghoza        | Kiel (settlement)               | 8 Nov         |
| Token warna + komponen dasar             | Kiel         | Wisnu                           | 5 Nov         |
| Tx bukti mainnet                         | Ghoza + Kiel | Wisnu (README, video)           | 11 Nov        |

## Risiko

| Risiko                                  | Pemilik | Mitigasi                                                            |
| --------------------------------------- | ------- | ------------------------------------------------------------------- |
| Tanda tangan Privy NEAR ternyata ber-UI | Wisnu   | Spike 10 hari pertama; fallback D4 (saldo di kontrak + session key) |
| Kontrak v2 lebih besar dari perkiraan   | Ghoza   | Kiel bantu tes; batas ketat 6 Nov untuk interface                   |
| Token palsu / alamat salah              | Kiel    | Menu dipin dari spike 18, verifikasi beacon saat start              |
| Penerbit Robinhood memblokir/pause      | semua   | Disebut di README; pembelian kecil; gudang bisa di-pause            |
| Domain Robinhood diblokir ISP           | Kiel    | Hanya RPC publik (publicnode, drpc)                                 |
| 1Click tanpa testnet                    | Kiel    | Mode demo testnet; bukti kecil di mainnet                           |
| Waktu 10 hari                           | semua   | Stretch hanya setelah langkah juri jalan penuh                      |

## Keputusan terbuka

SPEC §12: D1 track, D2 akun mainnet + payout, D3 dana bukti, D4 fallback login, D5 riwayat repo sebelum publik.

## Butuh konfirmasi tim (tidak dilakukan agent sendiri)

Membuka repo ke publik, force-push, deploy mainnet, tanda tangan atau memakai dana, posting di X, mengirim submission.
