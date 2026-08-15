# Deploy scan-retur-v2 ke Vercel

## 1. Environment variables di Vercel

Project Settings → Environment Variables. Isi untuk **Production**, dan kalau
memakai preview branch, isi juga untuk **Preview**.

| Nama | Wajib | Catatan |
|---|---|---|
| `DATABASE_URL` | ya | Connection string TiDB, lihat catatan di bawah |
| `SESSION_SECRET` | ya | Minimal 32 karakter, acak, RAHASIA |
| `GOOGLE_SHEETS_CLIENT_EMAIL` | tidak | Hanya untuk fitur ekspor G-Sheet |
| `GOOGLE_SHEETS_PRIVATE_KEY` | tidak | Sama |

`ADMIN_EMAIL` / `ADMIN_PASSWORD` **tidak perlu** di Vercel — itu hanya dipakai
`npm run db:seed` saat setup awal di komputer Anda.

> **`SESSION_SECRET` harus berbeda dari yang di komputer lokal**, dan sekali
> diganti semua orang otomatis logout. Buat dengan:
> ```
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```

> **`GOOGLE_SHEETS_PRIVATE_KEY`** berisi baris baru. Di Vercel, tempel apa
> adanya termasuk `-----BEGIN PRIVATE KEY-----`. Kode sudah menangani
> bentuk `\n` maupun baris baru sungguhan.

## 2. DATABASE_URL untuk serverless

Serverless berbeda dari server biasa: tiap permintaan bisa menjalankan
instance baru, dan tiap instance membuka koneksi sendiri ke database. Tanpa
batas, TiDB bisa menolak koneksi baru saat beban naik.

```
mysql://xxxx.root:PASSWORD@gateway01.ap-southeast-1.prod.aws.tidbcloud.com:4000/scan_retur?sslaccept=strict&connection_limit=3&pool_timeout=20
```

- `sslaccept=strict` — wajib, TiDB Cloud menolak koneksi tanpa TLS
- `connection_limit=3` — tiap instance maksimal 3 koneksi
- `pool_timeout=20` — tunggu 20 detik sebelum menyerah, bukan langsung gagal

Kalau muncul error "too many connections", turunkan `connection_limit` jadi
`1`. Kalau muncul timeout saat ramai, naikkan sedikit.

## 2b. Region fungsi

`vercel.json` berisi:

```json
{ "regions": ["sin1"] }
```

Log login pertama menunjukkan permintaan diterima di Singapore lalu
**dirutekan ke Washington (iad1)**, dan satu permintaan login memakan
**774 ms** — hampir seluruhnya biaya pulang-pergi ke cluster TiDB di
Singapore. Untuk login sekali itu masih tertahankan; untuk halaman scan yang
melakukan beberapa query per resi, selisihnya langsung terasa oleh operator.

Dua catatan penting:

- **Pemilihan region hanya berlaku di akun berbayar.** Pada paket Hobby,
  Vercel mengabaikan `regions` dan tetap memakai region default akun. Ubah
  lewat Project Settings → Functions; kalau pilihannya tidak ada, memang
  tidak tersedia di paket itu.
- **`vercel.json` menolak properti yang tidak dikenal.** Jangan menambahkan
  kunci `"//"` sebagai komentar — konvensi itu lazim di JSON lain, tapi di
  sini menggagalkan deploy dengan
  `should NOT have additional property "//"`. Semua penjelasan ditulis di
  berkas ini, bukan di dalam JSON-nya.

## 3. `prisma generate` saat build

`package.json` sudah memuat:

```json
"build": "prisma generate && next build",
"postinstall": "prisma generate"
```

Keduanya sengaja ada. Vercel menyimpan cache `node_modules` antar build —
kalau `@prisma/client` diambil dari cache, `postinstall` tidak berjalan dan
Prisma Client-nya basi atau tidak ada sama sekali. Build pertama biasanya
lolos (cache kosong), build berikutnya yang gagal. `prisma generate` di
skrip `build` menutup celah itu.

## 4. Skema database

Vercel **tidak** menjalankan `prisma db push`. Perubahan skema tetap
diterapkan dari komputer Anda:

```bash
npm run db:push
npm run db:generate
```

Database yang ditunjuk `.env` lokal dan yang ditunjuk `DATABASE_URL` di Vercel
adalah database yang sama, jadi `db:push` dari lokal sudah mengubah yang
dipakai produksi. Kalau nanti mau memisahkan produksi dan percobaan, buat
database kedua di TiDB dan arahkan `.env` lokal ke sana.

## 5. Setelah deploy pertama

1. Buka URL-nya, login dengan admin yang dibuat `db:seed`, ganti password.
2. Admin → Pengaturan: isi nama perusahaan dan Spreadsheet ID kalau ekspor
   G-Sheet dipakai.
3. Admin → Master Expedisi: pastikan daftarnya lengkap.
4. Uji satu scan, satu duplikat, dan satu cetak tanda terima.

Taruh `public/logo.png` (atau `.jpg`) supaya logo muncul di tanda terima.
Tanpa itu, gambarnya kosong — bukan error, hanya tidak tercetak.

## Yang tidak berjalan otomatis

- **Ekspor G-Sheet dijalankan manual** dari Admin → Pengaturan. Ini disengaja:
  ekspor bukan jalur kritis, dan menjadwalkannya otomatis akan mengembalikan
  masalah lama di mana kegagalan Google terjadi tanpa ada yang melihat.
  Kalau nanti ingin otomatis, Vercel Cron bisa memanggil
  `POST /api/gsheet/export` — tapi endpoint itu perlu diberi otorisasi
  khusus dulu, karena cron tidak membawa cookie sesi.
- **Backup database** tidak ada. TiDB Cloud Starter tidak menyediakan backup
  terjadwal di paket gratis. Untuk data operasional, ekspor Excel berkala dari
  halaman Data & Export adalah jaring pengaman termurah.
