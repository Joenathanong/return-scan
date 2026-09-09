# Rancangan — Modul Scan Bongkaran Retur

Status: **rancangan, belum dieksekusi.** Dokumen ini menutup semua keputusan
teknis sebelum satu baris kode ditulis.

---

## 0. Yang sudah diputuskan

| Pertanyaan | Jawaban Anda | Konsekuensi rancangan |
|---|---|---|
| Sumber Master Produk | Impor dari file Excel | Ada menu `Admin → Master Produk` dengan tombol impor `.xlsx`; tidak perlu integrasi ke sistem lain |
| Umur simpan | Selalu 3 tahun, tanggal 1 | ED = tanggal 1 bulan MFG + 3 tahun. Tidak ada tabel umur simpan per produk |
| Sumber saran Batch | Dari hasil scan sebelumnya | Batch terkumpul sendiri per SKU; saran kosong di hari pertama, makin kaya seiring pemakaian |
| Login 1 perangkat | Semua user tanpa kecuali | Termasuk admin. **Anda sendiri ikut ter-logout kalau membuka aplikasi di perangkat kedua** — lihat §3 |
| Urutan Kondisi | Kondisi lebih dulu, tidak terikat barcode | Kondisi jadi kolom **pertama** tiap kartu barang, aktif sejak kartu muncul — lihat §8 |
| Barcode saat "Isi Salah" | Tidak ada barcode sama sekali | Kolom barcode disembunyikan; Kode SKU & Nama SKU kosong di Excel |
| Kondisi yang boleh tanpa barcode | Isi Salah saja | Rusak Total tetap **wajib** scan barcode |

---

## 0b. Template impor Master Produk

Halaman `Admin → Master Produk` punya tombol **Unduh template** yang
menghasilkan `template-master-produk.xlsx` berisi dua sheet:

| Sheet | Isi |
|---|---|
| **Master Produk** | Header `Kode SKU`, `Nama SKU`, `Barcode`, `Barcode BPOM` + lima baris contoh yang menunjukkan satu SKU dengan dua barcode (dua baris), beberapa kode dalam satu sel (dipisah koma), SKU tanpa barcode dagang, dan SKU yang hanya punya barcode BPOM |
| **Petunjuk** | Kolom mana yang wajib, batas panjangnya, dan empat hal yang paling sering ditanyakan — termasuk bahwa impor ulang aman, dan bahwa SKU yang tidak ada di file TIDAK dinonaktifkan |

Templatenya **dirakit di peramban memakai pustaka `xlsx` yang sama dengan
pembaca impornya**, bukan disimpan sebagai berkas statis di `/public`.
Berkas statis akan menjadi usang diam-diam begitu daftar header yang
diterima berubah, dan tidak ada yang mengingatkan.

---

## 1. Penempatan & menu

Modul masuk ke dalam `scan-retur-v2` yang sudah jalan (bukan aplikasi terpisah),
karena user-nya diatur di menu user yang sudah ada.

Sidebar dapat grup baru:

```
Operasional
  Scan Retur
  Scan Bongkaran        ← /bongkaran
  Print
Laporan
  History
  Data & Export
  Bongkaran Dashboard   ← /bongkaran/dashboard
  Bongkaran Export      ← /bongkaran/export
Admin
  Master Produk         ← /admin/produk   (baru)
  Kelola User  …
```

**Hak akses.** Menambah role baru (`bongkaran`) akan membuat matriks role
meledak begitu ada modul ketiga. Sebagai gantinya: satu kolom boolean
`bisaBongkaran` di tabel user, tampil sebagai checkbox di *Kelola User*.
Admin selalu boleh. Operator biasa tidak melihat menu Bongkaran sama sekali
sampai checkbox-nya dicentang.

---

## 2. Tabel baru

```prisma
model Produk {
  sku       String  @id @db.VarChar(64)     // kode SKU = kunci
  nama      String  @db.VarChar(191)
  active    Boolean @default(true)
  updatedAt DateTime @updatedAt             // dipakai sinkron cache
  barcodes  ProdukBarcode[]
  @@index([updatedAt])
}

model ProdukBarcode {
  barcode   String @id @db.VarChar(64)      // yang benar-benar di-scan
  jenis     String @default("PRODUK")       // PRODUK | BPOM
  sku       String @db.VarChar(64)
  updatedAt DateTime @updatedAt
  @@index([sku])
  @@index([updatedAt])
}

model BatchSku {                            // sumber auto-suggest
  id        String @id @default(cuid())
  sku       String @db.VarChar(64)
  batch     String @db.VarChar(32)
  edDate    String @db.VarChar(10)          // "YYYY-MM-DD"
  dipakai   Int    @default(1)              // berapa kali pernah di-scan
  updatedAt DateTime @updatedAt
  @@unique([sku, batch], map: "uq_batch_sku")
  @@index([updatedAt])
}

model Bongkaran {                           // 1 baris per RESI
  id          String @id @default(cuid())
  noResi      String @db.VarChar(64)
  scannedAt   DateTime                      // ← distempel SERVER saat resi di-scan
  waktuDariKlien Boolean @default(false)    // true kalau stempel server gagal (offline)
  scannedById String @db.VarChar(30)
  date        String @db.VarChar(10)        // tanggal bisnis WIB
  status      String @default("draft")      // draft | final | voided
  finalizedAt DateTime?
  items       BongkaranItem[]
  @@index([date])
  @@index([noResi])
  @@index([status])
}

model BongkaranItem {
  id           String @id @default(cuid())
  bongkaranId  String @db.VarChar(30)
  urutan       Int
  kondisi      String  @db.VarChar(20)      // BAGUS | RUSAK_KEMASAN | RUSAK_TOTAL | ISI_SALAH
  // Tiga kolom di bawah NULL hanya bila kondisi = ISI_SALAH.
  barcode      String? @db.VarChar(64)
  sku          String? @db.VarChar(64)      // SNAPSHOT, bukan relasi
  namaProduk   String? @db.VarChar(191)     // SNAPSHOT
  produkTidakDikenal Boolean @default(false) // barcode ada, tapi tak ada di master
  namaDiterima String? @db.VarChar(191)     // WAJIB kalau ISI_SALAH, selain itu NULL
  qty          Int
  batch        String? @db.VarChar(32)      // opsional hanya untuk ISI_SALAH
  mfgDate      String? @db.VarChar(10)      // hasil baca batch; null kalau manual
  edDate       String? @db.VarChar(10)      // opsional hanya untuk ISI_SALAH
  edOtomatis   Boolean @default(false)
  scannedAt    DateTime                     // waktu item ini di-scan
  @@index([bongkaranId])
  @@index([sku])
}
```

Dua hal yang sengaja begitu:

- **`sku` dan `namaProduk` disalin (snapshot) ke setiap item, bukan relasi.**
  Kalau nanti nama produk di master diralat, hasil scan bulan lalu harus tetap
  menampilkan nama yang dibaca petugas saat itu. Inilah yang bikin data lama
  di sistem lama sering "berubah sendiri".
- **Barcode dipisah dari SKU** (`ProdukBarcode`). Satu SKU sering punya lebih
  dari satu barcode (karton vs pcs, kemasan lama vs baru). Kalau digabung jadi
  satu kolom, penambahan barcode kedua nanti berarti bongkar tabel.
- **Barcode BPOM tinggal di tabel yang sama**, dibedakan kolom `jenis`
  (`PRODUK` | `BPOM`) — bukan sebagai kolom `barcode_bpom` tersendiri.
  Alasannya menentukan: pencarian saat scan tidak boleh peduli jenisnya.
  Operator mengarahkan scanner ke apa pun yang paling mudah terbaca di
  kemasan — pada produk kosmetik dan obat, nomor izin edar justru sering
  lebih rapi daripada barcode dagang yang tertutup stiker promo — dan sistem
  menemukannya lewat SATU lookup. Kalau dipisah jadi kolom sendiri, setiap
  scan yang gagal di kolom pertama harus mencoba kolom kedua: dua kali kerja
  di jalur yang paling sering dilewati, hanya demi bentuk tabel yang
  kebetulan terasa lebih rapi dibaca manusia.
  Satu kode fisik hanya boleh ada di satu jenis; kode yang muncul di kedua
  kolom DITOLAK saat impor, bukan ditebak mana yang benar.
- **`barcode`, `sku`, `namaProduk` boleh NULL — tapi hanya untuk `ISI_SALAH`.**
  Aturan ini ditegakkan di lapisan API, bukan sekadar diharapkan: item
  `BAGUS`/`RUSAK_KEMASAN`/`RUSAK_TOTAL` tanpa barcode ditolak dengan 400.

---

## 3. Login satu perangkat

Tambahan di tabel user: `sesiAktif` (VarChar 64, nullable), `perangkatLabel`,
`sesiSejak`.

Alurnya:

1. Login berhasil → server membuat `sid` acak, menyimpannya di
   `user.sesiAktif`, dan **ikut menaruh `sid` di dalam cookie sesi**.
2. `requireUser()` — yang sudah membaca baris user di **setiap** request untuk
   mengecek `active` — sekarang sekaligus membandingkan `sid` cookie dengan
   `user.sesiAktif`. **Nol query tambahan.**
3. Kalau tidak cocok → 401 dengan kode `SESI_DIGANTI`, pesan
   *"Akun Anda dipakai login di perangkat lain."* Klien menghapus state dan
   melempar ke `/login` dengan pesan itu.

Sifatnya **login terbaru menang**. Ini penting: tidak ada skenario admin
terkunci dari sistemnya sendiri — cukup login lagi.

Yang perlu Anda sadari:

- Tab berbeda di browser yang sama = cookie sama = aman.
- Browser berbeda / mode penyamaran / HP lain = login baru = perangkat lama
  langsung tertendang begitu ia menekan tombol apa pun.
- Di `Kelola User` ada tombol **"Keluarkan dari perangkat"** (set
  `sesiAktif = NULL`) untuk kasus PDT hilang, rusak, atau ditinggal login.

---

## 4. Stempel waktu "saat scan", bukan "saat save"

Saat resi di-scan, klien memanggil `POST /api/bongkaran/mulai` → server
membuat baris `Bongkaran` berstatus `draft` dan **server** yang menulis
`scannedAt`. Jam PDT yang salah tidak bisa merusak data.

Setiap item mencatat selisih milidetik terhadap saat itu (dari klien), dan
server menyimpannya sebagai `scannedAt_resi + selisih`. Yang datang dari klien
hanyalah *durasi*, bukan jam dinding — jadi tetap kebal jam PDT yang meleset.

Kalau panggilan `mulai` gagal (sinyal putus), klien memakai jam lokal,
menandai `waktuDariKlien = true`, dan dashboard menampilkannya dengan ikon
peringatan agar bisa ditelusuri.

Panggilan `mulai` ini sekalian mengembalikan dua informasi (lihat §8):
apakah resi ini pernah dibongkar, dan apakah resi ini ada di Scan Retur.

**Total tulis ke TiDB: 2 kali per resi** (mulai + save), berapa pun jumlah
barangnya.

---

## 5. Cache per PDT (hemat kuota TiDB)

IndexedDB di setiap PDT menyimpan tiga store: `produk`, `barcode`, `batch`,
plus `meta` berisi penanda waktu sinkron terakhir.

Saat login: `GET /api/bongkaran/sync` dengan kursor per jenis data → server
hanya mengirim baris yang berubah sesudahnya. Hari pertama: seluruh master
(sekali, beberapa putaran). Hari-hari berikutnya: biasanya 0–5 baris, respons
beberapa ratus byte.

**Kursornya gabungan (waktu + kunci baris), bukan waktu saja.** Impor massal
menulis ribuan baris dengan `updated_at` sama persis sampai milidetik; kursor
yang hanya membandingkan waktu akan melompati sisa baris bertimestamp sama
begitu satu halaman terpotong di tengahnya. Barang yang hilang dari cache
karena itu tidak akan pernah kembali di sinkron berikutnya — dan gejalanya
bukan error, melainkan barcode tertentu yang "tidak dikenal" selamanya di
sebagian PDT saja.

Selama scan berlangsung, **lookup barcode dan saran batch tidak menyentuh TiDB
sama sekali** — semuanya dari IndexedDB. Ini yang membuat modul ini murah dan
juga cepat di jaringan gudang yang jelek.

Penghapusan produk ditandai `active = false` (bukan DELETE) supaya ikut
terbawa sinkron delta.

---

## 6. Aturan Batch → ED

Batch dianggap tanggal produksi bila **panjangnya tepat 6** dan berpola
`^[A-L][0-9]{2}` :

- karakter 1 : `A`=Januari … `L`=Desember
- karakter 2–3 : tahun, `26` → 2026
- karakter 4–6 : bebas (nomor urut pabrik)

MFG = tanggal **1** bulan tersebut. ED = MFG + **3 tahun**, tetap tanggal 1.

> `B26ABC` → MFG 1 Februari 2026 → **ED 1 Februari 2029**

Rincian yang perlu diputuskan dan saya isi dengan default masuk akal:

- **Tahun 2 digit** dibaca sebagai `20YY`. Kalau hasilnya lebih dari 12 bulan
  di masa depan atau lebih dari 10 tahun ke belakang, ED tetap diisi tapi
  diberi peringatan kuning — bukan ditolak, supaya tidak menghentikan operator.
- **ED hasil otomatis tetap bisa diedit.** Auto-isi itu bantuan, bukan kunci.
  Kalau diedit, `edOtomatis` menjadi `false` agar terlihat di audit.
- Batch di luar pola → kolom ED **wajib** diisi manual.

---

## 7. Auto-suggest Batch

Muncul mulai **karakter ke-4**, hanya batch milik SKU yang barusan di-scan,
diurutkan dari yang paling baru dipakai. Daftar bisa di-scroll (tinggi maks
±200 px), dinavigasi ↑ ↓, dipilih Enter, ditutup Esc. Setiap baris menampilkan
batch **dan** ED-nya; memilih satu baris mengisi kedua kolom sekaligus.

Sumbernya `BatchSku`, yang di-*upsert* setiap kali save. Jadi memang kosong di
awal — itu memang yang Anda pilih.

**Kondisi "Isi Salah" tidak punya SKU**, jadi tidak ada daftar saran yang bisa
ditampilkan, dan batch yang diketik di sana **tidak** ikut memperkaya
`BatchSku` — batch tanpa SKU tidak bisa dipakai menyarankan apa pun nanti.
Aturan pembacaan 6 karakter (§6) tetap berlaku karena ia murni membaca teks.

---

## 8. Alur layar (dirancang untuk PDT, scanner = keyboard)

Kartu barang **bukan wizard**. Kondisi dan barcode hidup bersamaan sejak kartu
muncul, jadi operator bebas memilih urutan: yang normal langsung scan, yang
menemukan barang asing menekan tombol kondisi lebih dulu.

```
┌ Scan Bongkaran ─────────────────────────┐
│ No. Resi   [ ______________ ]  ← fokus  │
└─────────────────────────────────────────┘
        ↓ scan
┌ JX1234567890        14:32:07 ───────────┐   ← jam dari server
│ ⓘ cocok dengan Scan Retur (JNE, karung 3)│
├ Barang 1 ───────────────────────────────┤
│ Kondisi  [Bagus][Rusak Kemasan]         │   ← aktif sejak awal,
│          [Rusak Total][Isi Salah]       │      tidak menunggu barcode
│ Barcode [ 8991234567890 ]   Qty [  1  ] │   ← fokus di barcode
│ ✓ MINYAK GORENG X 1L        SKU-00123   │
│ Batch   [ B26A…    ]   Exp [01/02/2029] │
│         ▾ B26A01  ED 01-02-2029         │      otomatis dari batch
└─────────────────────────────────────────┘
```

Batch di **kiri**, Exp. Date di **kanan** — arah baca mengikuti arah
pengisian: batch yang berpola tanggal mengisi ED, jadi kolom yang mengisi
dibaca lebih dulu daripada kolom yang terisi. Quantity duduk di kanan kolom
identitas barang, di posisi yang sama untuk semua kondisi.

**Berdampingan hanya mulai lebar 640 px; di bawah itu bertumpuk.** Layar PDT
genggam sering hanya ~360 px, dan di lebar itu kolom barcode yang dibagi dua
tinggal ~150 px — nomor 13 digit tidak terbaca utuh. Saat bertumpuk, SEMUA
kolom berlebar penuh, termasuk Quantity dan Exp. Date: kolom yang dibatasi
lebarnya akan berdiri kerdil di tengah tumpukan kolom penuh, dan tepi
kanannya tidak sejajar dengan apa pun. Daftar saran batch sendiri diberi
lebar minimum dan boleh melebar melewati kolomnya, supaya baris
"B26A01 · ED 01-02-2029" tidak terpotong justru pada bagian yang membuatnya
berguna.

```
        [ + Barang ]
┌────────────────────────────────────────┐
│            [  SIMPAN (2 barang)  ]     │
└────────────────────────────────────────┘
```

**Kondisi tetap per BARANG, bukan sekali per resi.** Satu resi bisa berisi dua
barang dengan kondisi berbeda; kalau kondisi dipasang di tingkat resi, kasus itu
tidak bisa dicatat sama sekali.

**Tidak ada nilai awal "Bagus".** Operator yang terburu-buru akan menyimpan
barang rusak sebagai bagus tanpa sadar. Tombol Simpan menolak selama masih ada
kartu yang kondisinya kosong.

### Yang berubah begitu "Isi Salah" ditekan

Kolom barcode **hilang dari kartu** — bukan sekadar jadi opsional. Barang asing
memang tidak punya barcode yang berarti apa pun bagi sistem ini, dan kolom yang
terlihat tapi boleh kosong hanya mengundang operator mengisinya asal-asalan.

```
├ Barang 2 ───────────────────────────────┤
│ Kondisi  [Bagus][Rusak Kemasan]         │
│          [Rusak Total][●Isi Salah]      │
│ Nama Barang Diterima                    │   ← fokus otomatis pindah ke sini
│          [ Sabun Cair 500ml ______ ]    │
│ Qty      [ 1 ]                          │
│ Batch    [ ______ ]  (opsional)         │   ← tanpa daftar saran
│ Exp      [ __/__/____ ]  (opsional)     │
└─────────────────────────────────────────┘
```

Batch dan ED jadi **opsional** khusus di sini. Barcode-nya saja tidak ada;
memaksa batch berarti memaksa operator mengarang, dan batch tanpa SKU tidak
bisa dipakai untuk apa pun. Kalau batch memang terbaca di kemasan, silakan
diisi — aturan 6 karakter tetap mengisi ED otomatis.

Menekan kondisi lain sesudahnya mengembalikan kolom barcode, dan isian
*Nama Barang Diterima* dibuang.

### Rusak Total tetap wajib barcode

Sesuai pilihan Anda. Kalau barcode di kemasan sudah sobek, operator mencari
barcode lain di kardus atau di badan produk. Konsekuensinya: kalau di lapangan
ini sering menyangkut, gejalanya akan terlihat sebagai antrean yang berhenti —
beri tahu saya dan kita longgarkan, jangan sampai operator mengakalinya dengan
memilih "Isi Salah" supaya bisa lewat.

Scanner mengirim Enter, dan kursor otomatis lompat ke kolom berikutnya:
barcode → quantity → batch → (saran batch) → barang berikutnya. Enter di
Batch hanya mampir ke Exp. Date kalau kolom itu masih kosong padahal wajib —
yaitu ketika batch-nya tidak berpola tanggal. Kalau ED sudah terisi otomatis,
rantainya langsung menyambung ke barang berikutnya.

**Kondisi tetap butuh satu tindakan sadar dari operator.** Karena tidak ada
nilai awal, kasus paling normal sekalipun (Bagus) memerlukan satu ketukan.
Itu harga yang dibayar supaya barang rusak tidak pernah tersimpan sebagai
bagus hanya karena operator terburu-buru — dan menurut saya harganya pantas.
Untuk yang tidak mau melepas keyboard, **Alt+1 sampai Alt+4** memilih kondisi
dari kolom mana pun di kartu itu.

Kartu barang yang sudah lengkap menciut jadi satu baris ringkas supaya layar
PDT yang sempit tidak penuh.

### Kalau jaringan putus saat resi di-scan

Panggilan `mulai` yang gagal TIDAK menghentikan operator. Sesi dibuat lokal
dengan jam perangkat, layar memberi tahu apa adanya ("waktunya diambil dari
jam perangkat ini"), dan saat Simpan berhasil barisnya ditandai
`waktu_dari_klien` di server. Dashboard menghitung baris seperti ini
terpisah. Data yang tidak bisa dipercaya harus terlihat berbeda dari yang
bisa — bukan disamarkan supaya laporannya kelihatan rapi.

## 9. Dashboard

- Hari ini: jumlah resi, jumlah barang, sebaran kondisi (4 angka besar).
- Grafik batang 14 hari terakhir.
- Tabel per operator: resi, barang, resi terakhir jam berapa.
- **Draft belum selesai** — resi yang di-`mulai` tapi tidak pernah di-save
  (PDT mati/keluar tanpa simpan). Bisa dihapus admin.
- **Barcode tidak dikenal** — daftar barcode yang di-scan tapi tidak ada di
  master, dengan tombol langsung tambah ke Master Produk.
- Item dengan `waktuDariKlien = true`.

---

## 10. Export

Filter rentang tanggal → `.xlsx`. Satu baris per **barang** (resi diulang di
setiap baris, **bukan** merge cell — merge cell merusak filter dan pivot di
Excel).

| No. | No Resi | Barcode Scan | Kode SKU | Nama SKU | Quantity | Kondisi | Nama Barang Diterima | Batch | Exp. Date | Scan By | Scan Date | Expedisi |
|---|---|---|---|---|---|---|---|---|---|---|---|---|

Kolom **Expedisi** di paling akhir dicocokkan dari **Scan Retur** lewat nomor
resi — modul bongkaran sengaja tidak menyimpannya sendiri. Yang tahu paket ini
datang dari siapa adalah Scan Retur; menyalin nilainya ke tabel bongkaran
berarti punya dua sumber kebenaran yang akan berbeda begitu ekspedisi sebuah
resi diralat di sana.

Pencocokannya aman dari penggandaan baris: tabel `scans` punya UNIQUE pada
`no_resi_unik` untuk baris berstatus `success`, jadi satu resi hanya punya satu
padanan. Kolomnya **kosong kalau resi itu belum ada di Scan Retur** — keadaan
yang memang sah, karena bongkar boleh mendahului scan retur. Halaman ekspor
menghitung berapa resi yang begitu, supaya angka nol atau bukan-nol itu
terlihat sebelum berkasnya diunduh.

Kolom **Nama Barang Diterima** adalah tambahan dari daftar Anda — tanpa itu,
data "Isi Salah" kehilangan justru informasi yang bikin ia dicatat.
Alternatifnya digabung ke kolom Kondisi (`Isi Salah — Sabun Cair 500ml`), yang
mempertahankan 11 kolom persis seperti permintaan Anda tapi tidak bisa difilter.
**Default saya: kolom terpisah.**

Baris "Isi Salah" akan terlihat begini — tiga kolom identitas produk kosong,
karena memang tidak ada barcode yang di-scan:

| No. | No Resi | Barcode Scan | Kode SKU | Nama SKU | Qty | Kondisi | Nama Barang Diterima | Batch | Exp. Date | … |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | JX123 | 8991234567890 | SKU-00123 | MINYAK GORENG X 1L | 1 | Bagus | | B26A01 | 01/02/2029 | … |
| 2 | JX123 | — | — | — | 1 | Isi Salah | Sabun Cair 500ml | — | — | … |

Kalau Anda lebih suka sel benar-benar kosong daripada tanda `—`, itu satu baris
perubahan dan bisa diminta kapan saja.

`Scan Date` diformat `DD/MM/YYYY HH:mm:ss` WIB.

---

## 11. Lima keputusan yang masih terbuka — default saya

| # | Perkara | Default yang saya pakai kalau tidak diubah |
|---|---|---|
| 1 | Resi dobel | **Peringatkan, jangan blokir.** Saat resi di-scan: *"Resi ini sudah dibongkar 12/08 oleh Andi. Lanjutkan?"* → Lanjut / Batal. Tidak dikunci UNIQUE, karena satu resi bisa saja dua koli |
| 2 | Resi harus ada di Scan Retur? | **Tidak wajib.** Hanya ditampilkan sebagai info (*cocok* / *belum ada di Scan Retur*). Membongkar bisa terjadi sebelum resi tercatat, memblokir akan menghentikan gudang |
| 3 | Barcode tak dikenal | **Boleh lanjut.** Barcode-nya tetap tersimpan, operator mengetik nama barang manual, item ditandai `produkTidakDikenal`, dan barcode itu muncul di dashboard agar admin menambahkannya ke master. Ini beda dari "Isi Salah": di sini barcode ADA, cuma belum terdaftar |
| 4 | Simpan bertahap vs di akhir | **Header saat scan resi (draft) + item saat Simpan.** Dapat stempel waktu yang sah, tetap 2 tulis per resi, dan PDT mati meninggalkan draft yang terlihat — bukan data hilang diam-diam |
| 5 | Kolom `Nama Barang Diterima` | **Ditambahkan** sebagai kolom sendiri (lihat §10) |

---

## 12. Perkiraan pekerjaan

- Skema + migrasi: 5 tabel baru, 4 kolom baru di `users`
- API: `mulai`, `simpan`, `sync`, `dashboard`, `export`, `produk` (impor + CRUD), `user/keluarkan-perangkat`
- Halaman: `/bongkaran`, `/bongkaran/dashboard`, `/bongkaran/export`, `/admin/produk`
- Perubahan file lama: `lib/api.ts` (cek `sid`), `lib/crypto.ts` (payload `sid`), `login/logout`, `Sidebar`, `admin/users`
- Sekitar 18 file, mayoritas baru — risiko ke modul Scan Retur yang sudah jalan sangat kecil karena hampir tidak ada yang disentuh

Urutan eksekusi: **(1)** skema + login 1 perangkat + Master Produk & impor
Excel → **(2)** halaman scan + cache → **(3)** dashboard + export.

**Status: ketiganya selesai dan sudah terpasang.**

---

## 13. Sesi terputus dan umur draft

Ditambahkan setelah panel **Belum selesai** di dashboard penuh terus.

### Kenapa draft menumpuk

Satu baris `bongkaran` berstatus `draft` lahir pada detik resi di-scan —
itu konsekuensi langsung dari keputusan §4 (stempel waktu saat scan, bukan
saat save), dan keputusan itu tidak berubah. Artinya **setiap sesi yang
tidak selesai meninggalkan satu baris**, dan sesi bisa tidak selesai karena
banyak hal yang wajar di gudang: PDT mati, layar di-refresh, operator
pindah menu, jaringan putus saat Simpan, atau resi di-scan lalu ternyata
kolinya dibongkar orang lain.

Sebelum ini tidak ada satu pun yang membersihkannya, dan dashboard
menampilkan **seluruh** draft sepanjang masa (tanpa batas tanggal, `take:
50`). Dua atau tiga sesi terputus per hari sudah cukup membuat daftar itu
selalu penuh — dan daftar yang selalu penuh sama tidak bergunanya dengan
daftar yang tidak ada.

Draft itu sendiri hampir selalu **kosong**: barang dan status `final`
ditulis dalam satu transaksi, jadi tidak ada keadaan "setengah tersimpan".
Yang hilang saat sesi terputus bukan data di server, melainkan **keranjang
di layar** — dan itulah yang mahal, karena kardusnya harus dibongkar ulang.

### Tiga lapis penanganan

| Lapis | Di mana | Biaya TiDB |
|---|---|---|
| 1. Pemulihan keranjang | localStorage di PDT | **nol** |
| 2. Pakai ulang draft | `/api/bongkaran/mulai` | **nol tambahan** |
| 3. Sapu draft basi | menumpang `/api/bongkaran/dashboard` | ≤3 kueri per jam |

**1 — Pemulihan.** Sesi aktif (id draft, jam scan dari server, nomor kamera,
seluruh kartu barang) ditulis ke `localStorage` dengan penundaan 400 ms,
dan ditulis serentak saat `pagehide`/`visibilitychange`/pindah menu. Saat
halaman scan dibuka lagi, sesi itu dipulihkan beserta id draft-nya —
sehingga Simpan **menyelesaikan baris yang sama**, bukan membuat baris
kedua. Operator diberi tahu lewat spanduk, tidak dipulihkan diam-diam.
Umur simpanan 8 jam (`UMUR_SESI_JAM`).

**2 — Pakai ulang.** Kalau resi yang sama di-scan lagi oleh operator yang
sama sementara draft lamanya masih ada dan kosong, draft itu **di-update**
(jam scan disetel ke sekarang), bukan ditambah baris baru. Kueri tidak
bertambah: `findFirst` untuk cek duplikat diganti `findMany` yang menjawab
dua pertanyaan sekaligus. Draft yang **ada isinya** tidak pernah dipakai
ulang — itu harus dilihat manusia lewat "Lihat isi".

**3 — Sapu.** Draft kosong yang lebih tua dari 12 jam (`UMUR_DRAFT_SAPU_JAM`)
dihapus. Jalannya menumpang permintaan dashboard, dibatasi sekali per jam
per instance, memeriksa maksimal 500 baris, dan **memastikan dulu draft-nya
benar-benar kosong** sebelum menghapus (`draftKosong()`), bukan percaya
pada "seharusnya kosong". Admin bisa memicunya manual lewat tombol
**Bersihkan**.

### Dua ambang yang tidak boleh terbalik

    UMUR_SESI_JAM (8)  <  UMUR_DRAFT_SAPU_JAM (12)

Kalau terbalik, layar akan menawarkan memulihkan sesi yang draft-nya sudah
disapu, dan Simpan-nya gagal "draft tidak ditemukan" — tepat pada keranjang
yang tadi ditawarkan untuk diselamatkan. Hubungan ini **diuji**, bukan
sekadar ditulis di komentar.

Jaring pengaman terakhir: kalau draft memang sudah hilang saat Simpan
(404), layar mengirim ulang lewat jalur tanpa draft memakai `klienKunci`
yang sama — barangnya tetap tersimpan, dan barisnya ditandai
`waktu_dari_klien` supaya kelihatan bahwa jamnya tidak datang dari server.

---

## 14. Paket tanpa nomor resi (label sobek / tidak terbaca)

Tombol **Resi rusak / tidak terbaca** di bawah kolom resi. Ditekan → nomor
pengganti dibuat server → sisanya sama persis: scan barcode, kondisi, batch,
Simpan.

### Nomor penggantinya

    TANPA-RESI-20260909-K2-142335
                tanggal  kamera jam WIB

Dipilih begini, bukan penomoran urut 001/002:

- **Nol kueri.** Penomoran urut butuh `max()` setiap kali tombol ditekan.
  Jalur ini justru dirancang lebih murah daripada scan biasa: dua kueri
  pencocokan (cek duplikat + cari padanan di Scan Retur) memang **dilewati**,
  karena tidak ada nomor yang bisa dicocokkan.
- **Tidak bisa kembar tanpa indeks unik.** Kolom `no_resi` sengaja tidak
  unik (satu resi sah datang dalam dua koli), jadi penomoran urut tidak
  punya penjaga: dua operator yang menekan bersamaan dapat angka sama dan
  tidak ada yang memberi tahu. Di sini kamera + detik yang membedakan.
- **Nomornya sendiri menunjuk rekamannya:** tanggal, kamera, jam — tiga hal
  yang justru dibutuhkan untuk membuka CCTV yang benar. Untuk baris tanpa
  resi, ini satu-satunya jalan menelusuri asalnya.

### Awalan = penanda

Tidak ada kolom boolean terpisah. `AWALAN_TANPA_RESI` hanya boleh dibuat
server: `/mulai`, `/simpan`, dan `/[id]/resi` **menolak** nomor berawalan itu
kalau datang dari ketikan operator. Karena itu kehadiran awalan di `no_resi`
adalah pernyataan yang bisa dipercaya, dan indeks `no_resi` yang sudah ada
melayani semua pencariannya (`startsWith`) tanpa tambahan apa pun.

### Yang hilang, dan diakui hilang

Baris tanpa resi **tidak punya padanan di Scan Retur**, jadi kolom Expedisi
selamanya kosong dan tidak ada kaitan ke pengirimnya. Karena itu:

- Dialog konfirmasinya menyebutkan hal ini apa adanya sebelum ditekan.
- Tombolnya dibuat **tenang** (tombol sekunder, teks kecil, di bawah garis).
  Kalau menonjol, ia akan jadi jalan pintas setiap kali barcode resi susah
  di-scan.
- Dashboard menghitung pemakaiannya **per operator**. Kalau angkanya
  menumpuk di satu orang, itu terlihat sebagai angka hari ini — bukan
  ditemukan setahun lagi saat satu paket dicari dan tidak ketemu apa pun.
- Angka "Resi tanpa ekspedisi" di ekspor **mengecualikan** baris ini: kolom
  kosongnya bukan sesuatu yang perlu ditelusuri.

### Catatan

Kolom baru `bongkaran.catatan` (VarChar 191, nullable). Opsional — memaksa
diisi berarti memaksa mengetik di layar sentuh sambil memegang cutter, dan
yang diketik dalam keadaan itu adalah "-". Ikut ke Excel sebagai kolom
**paling akhir, sesudah Expedisi**: kolom baru menempel di ujung supaya
urutan yang sudah dipakai orang tidak bergeser.

### Kalau resi aslinya ketemu

`PATCH /api/bongkaran/[id]/resi`, admin saja, dan **satu arah saja**: dari
nomor pengganti ke nomor sungguhan. Nomor resi baris biasa tidak bisa
diganti dari mana pun — itu kunci ke Scan Retur, dan laporan yang nomornya
bisa berubah belakangan tidak bisa dipakai memeriksa apa pun.

Yang ikut terjadi: seluruh baris barang dalam resi itu berpindah nomor
(nomor milik induknya), kolom Expedisi terisi sendiri kalau padanannya ada,
jam scan **tidak** berubah, dan jejaknya masuk audit log. Kalau nomor baru
tidak ketemu di Scan Retur, layar mengatakannya saat itu juga — bukan
membiarkannya ditemukan sebagai kolom kosong sebulan kemudian.

> **Butuh `npm run db:push`.** Kolom `catatan` baru; tanpa push, penyimpanan
> hasil scan akan gagal. `/api/health` sudah ikut memeriksa kolom ini.
