# scan-retur-v2 — Setup

Sistem baru. **Tidak menyentuh `scan-retur` yang lama sama sekali** — aplikasi
lama tetap berjalan seperti biasa dan tetap jadi tempat melihat data lama.
Tidak ada data transaksi yang dipindahkan.

---

## 1. Buat cluster TiDB

1. Daftar di <https://tidbcloud.com> → **Create Cluster** → pilih **Starter** (gratis).
2. Region: pilih **ap-southeast-1 (Singapore)** — paling dekat dari Indonesia.
3. Buka **SQL Editor** (Chat2Query) lalu jalankan:

   ```sql
   CREATE DATABASE IF NOT EXISTS scan_retur;
   ```

4. **Connect** → Connect With: **Prisma** → salin `DATABASE_URL`, lalu **ganti
   nama database di ujungnya menjadi `scan_retur`**.

> **Jebakan yang pasti Anda temui.** Connection string dari konsol TiDB Cloud
> biasanya menunjuk ke `sys` atau `test`. `sys`, `mysql`, `information_schema`,
> `performance_schema`, dan `metrics_schema` adalah database sistem — Prisma
> menolaknya dengan `Error: P3004: The `sys` database is a system database`.
> Karena itu langkah 3 dikerjakan lebih dulu.

Kuota gratis: 5 GiB penyimpanan baris, 50 juta Request Unit per bulan.
Berdasarkan volume scan Anda sekarang, itu bertahun-tahun.

## 2. Isi `.env`

```bash
cd scan-retur-v2
cp .env.example .env
```

Lalu isi `DATABASE_URL`, `SESSION_SECRET`, dan `ADMIN_*`.

Untuk `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> **Kalau password TiDB Anda mengandung `@ : / ? # [ ]`**, encode dulu
> (`@` → `%40`). Kalau tidak, URL-nya salah parse dan muncul
> "Can't reach database server".

## 3. Pasang & siapkan database

```bash
npm install
npm run setup
```

`npm run setup` menjalankan empat langkah berurutan:

| Langkah | Kegunaan |
|---|---|
| `prisma db push` | Membentuk semua tabel dari `prisma/schema.prisma` |
| `prisma generate` | Membuat tipe TypeScript untuk Prisma Client |
| `db:upgrade` | Memeriksa collation & index UNIQUE, membuat baris settings |
| `db:seed` | Membuat admin pertama |

`db:upgrade` **memeriksa, tidak mengubah**. Yang dipastikan: kolom kunci
(`scans.no_resi_unik`, `expedisi.code`, `users.email`, `karung.nomor_karung`)
memakai collation *case-insensitive*, dan keempat index `UNIQUE` penjaga
integritas benar-benar terpasang. Kalau semuanya hijau, database sehat.

> **Catatan collation.** TiDB Cloud Starter memakai `utf8mb4_unicode_ci`
> secara default — akhiran `_ci` berarti case-insensitive, jadi `abc123` dan
> `ABC123` sudah dianggap resi yang sama. Tidak ada yang perlu dikonversi.
> (TiDB juga menolak konversi collation pada kolom yang sudah ber-index,
> dengan error 8200 — jadi memaksanya pun tidak akan berhasil.)

## 4. (Opsional) Bawa data master dari sistem lama

Kalau ingin 17 ekspedisi dan daftar user ikut terbawa — bukan data scan:

```bash
cd ../scan-retur
node audit-data.mjs --master-only     # ±20 baca Firestore saja
cp seed-master.json ../scan-retur-v2/
cd ../scan-retur-v2
npm run db:seed
```

Kalau tidak, 17 ekspedisi juga cukup cepat diketik manual lewat menu Admin.

**Soal user:** Firebase Auth tidak pernah mengekspor hash password. Akun yang
terbawa dibuat dalam keadaan *tidak bisa login* sampai admin men-set password
barunya lewat Admin → Users. Ini memang begitu, bukan bug.

## 5. Jalankan

```bash
npm run dev
```

Login pakai `ADMIN_EMAIL` / `ADMIN_PASSWORD` dari `.env`. Anda akan langsung
diminta mengganti password.

---

## Yang berbeda dari sistem lama

| | Lama | Baru |
|---|---|---|
| Sumber kebenaran | Firestore **dan** G-Sheet | Database saja |
| Cek duplikat resi | Query lalu tulis — bisa balapan | `UNIQUE` di database |
| Tulis ke G-Sheet | 1 append per scan, kena batas 60/menit | Ekspor tulis-ulang seluruh tab |
| Tanda terima dicetak dari | G-Sheet | Database |
| `totalResi` | Penghitung manual, bisa meleset | `COUNT(*)` |
| Tanggal bisnis | Jam browser operator | Dihitung server, zona Asia/Jakarta |
| Nama tab G-Sheet | Ikut berubah kalau ekspedisi di-rename | Kode manual yang stabil |
| Login | Firebase Auth | Cookie sesi bertanda tangan HMAC |

## Catatan teknis

**Tidak ada dependency native.** Password memakai `scrypt` dan sesi memakai
HMAC-SHA256, keduanya dari `node:crypto` bawaan. Tidak ada `bcrypt`, `argon2`,
atau `jose` yang perlu dikompilasi saat `npm install`.

**`relationMode = "prisma"`** — foreign key tidak ditegakkan database,
integritas dijaga di transaksi aplikasi. Ini pilihan konservatif supaya pasti
jalan di TiDB. Kalau nanti mau FK sungguhan, hapus baris itu dari
`schema.prisma` lalu `npm run db:push`. Yang **tidak** terpengaruh: semua
aturan `UNIQUE` tetap ditegakkan database — termasuk keunikan resi.

**Keunikan resi** memakai kolom bayangan `no_resi_unik`, karena MySQL/TiDB
tidak punya *partial unique index* seperti Postgres:

- scan sukses → `no_resi_unik = no_resi` (duplikat ditolak database)
- scan di-void → `no_resi_unik = NULL` (slotnya bebas dipakai lagi)

MySQL mengizinkan banyak baris `NULL` di kolom `UNIQUE`, jadi hasilnya sama
persis dengan partial unique index.

**Membatalkan scan tidak menghapus baris.** Statusnya jadi `voided` dan
jejaknya tetap tersimpan untuk audit — berbeda dari sistem lama yang menghapus
baris di G-Sheet dan membuat kedua sumber berbeda selamanya.

---

## Kalau `db:push` gagal soal primary key

```
Error: Unsupported drop primary key when the table is using clustered index
```

TiDB membuat primary key non-integer sebagai **clustered index** — baris fisik
tabel diurutkan menurut primary key itu sendiri. Akibatnya primary key tidak
bisa diubah atau dihapus setelah tabel terbentuk; tabelnya harus dibuat ulang.

Prisma tidak bisa melakukannya sendiri. Gunakan:

```bash
node tools/fix-claim-table.mjs      # cadangkan isinya lalu DROP tabel
npm run db:push
npm run db:generate
node tools/fix-claim-table.mjs --restore   # hanya kalau tadi ada isinya
npm run typecheck
```

Skrip itu mencadangkan isi tabel ke `claim-config-backup.json` sebelum
menghapus, dan berhenti sendiri kalau tabelnya sudah memakai skema baru.

Kalau nanti ada tabel lain yang kena hal serupa, polanya sama: cadangkan,
`DROP TABLE`, `db:push`, kembalikan. Untuk tabel yang sudah berisi data
produksi, cadangkan dulu ke file sebelum melakukan apa pun.

---

## Memindahkan user dari sistem lama

Firebase Authentication tidak pernah mengekspor hash password, jadi yang
dipindahkan hanya identitas user — password dibuat baru.

```bash
cd ../scan-retur
node audit-data.mjs --master-only     # ±20 baca Firestore
cp seed-master.json ../scan-retur-v2/
cd ../scan-retur-v2

node tools/import-users.mjs --dry-run  # lihat dulu, tidak mengubah apa pun
node tools/import-users.mjs            # jalankan sungguhan
```

Setiap akun diberi password sementara yang dicetak ke layar dan disimpan ke
`password-sementara.txt`. Semuanya ditandai wajib ganti password saat login
pertama. **Hapus berkas itu setelah semua password dibagikan.**
