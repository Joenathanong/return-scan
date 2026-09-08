# Cancel Order + Kamera CCTV + kolom Line

Status: **terpasang.** Butuh `npm run db:push` (tabel dan kolom baru).

---

## 1. Menu Scan Cancel Order

Pendataan barang batal kirim — belum pernah berangkat, jadi **tidak ada
nomor resi**. Yang dicatat hanya tiga hal: produk, jumlah, batch.

Barangnya menumpuk di rak dulu, lalu didaftarkan sekaligus. Karena itu yang
mengelompokkan data di sini adalah **sesi pencatatan**, bukan paket:

```
CancelOrder      ← satu sesi input gabungan, kode "CO-20260908-003"
  └── CancelOrderItem  ← satu baris per barang
```

### Yang sengaja TIDAK dibawa dari Bongkaran

| Tidak ada | Alasan |
|---|---|
| Kondisi barang | Barangnya belum pernah jalan — tidak ada yang rusak di perjalanan untuk dinilai |
| Stempel waktu per barang | Barangnya sudah lama tergeletak sebelum didaftar. Mencatat "jam berapa barcode ini ditembak" akan membuat data terlihat lebih presisi daripada kenyataannya. Yang dicatat: kapan seseorang duduk dan mendaftarnya |
| Batch wajib | Di sini batch hanya pelengkap pendataan |
| Barcode wajib | Barang cancel order sering sudah lepas dari kemasan luarnya. Memaksa barcode berarti memaksa operator mengarang, atau melewatkan barangnya sama sekali. Yang wajib hanya **nama barang** dan **jumlah** |

### Nomor sesi

`CO-YYYYMMDD-NNN`, diambil dari **kode terbesar hari itu**, bukan dari
jumlah baris. Menghitung baris salah begitu ada satu nomor terlewat — dan
nomor pasti terlewat, karena sesi yang dibatalkan tetap memegang kodenya.
Sekali hitungan tertinggal di belakang nomor tertinggi, setiap penyimpanan
berikutnya menabrak kode yang sudah ada dan membuang satu INSERT bersarang
(induk + sampai 300 baris) untuk di-rollback. Selisihnya melebar tiap kali,
dan begitu mencapai lima, modul berhenti bisa menyimpan sampai tengah malam.

Kolomnya UNIQUE dan pemanggilnya mencoba ulang lima kali — nomor urut yang
rapi tidak layak dibayar dengan penguncian tabel.

### Izin

Kolom `bisaCancelOrder` di tabel user, satu checkbox di Kelola User. Admin
selalu boleh. Pola yang sama dengan `bisaBongkaran`: satu boolean per modul,
bukan role baru — begitu ada modul keempat, matriks role akan meledak.

Master Produk sekarang dijaga `requireMasterProduk()` (admin **atau**
bongkaran **atau** cancel order), bukan lagi izin Bongkaran. Kalau tidak,
operator yang hanya diberi akses Cancel Order akan melihat semua barcode-nya
"tidak dikenal" — dan penyebabnya tidak akan terlihat di mana pun.

---

## 2. Kamera CCTV di menu Bongkaran

Sebelum apa pun bisa di-scan, operator memilih **Kamera 1–4**. Nomornya
disimpan bersama setiap resi, sehingga `scanned_at` menjawab "jam berapa"
dan `kamera` menjawab "kamera mana" — dua-duanya diperlukan untuk membuka
rekaman yang benar ketika sebuah baris dipertanyakan.

**Pilihannya disimpan sebagai state komponen biasa** — bukan
sessionStorage, bukan cookie. Nilainya hidup selama halaman Bongkaran
terbuka dan hilang begitu operator pindah menu, yang persis aturannya.
sessionStorage justru akan bertahan melewati perpindahan menu, dan operator
yang pindah meja pukul dua siang akan terus mencatat kamera meja paginya
tanpa satu pun tanda di layar.

Konsekuensi yang perlu diketahui: **memuat ulang halaman juga berarti
memilih kamera lagi.** Itu sisi lain dari koin yang sama.

**Kolomnya nullable.** Seluruh baris yang tercatat sebelum fitur ini ada
memang tidak punya nomor kamera. Memberi nilai bawaan 1 akan membuat ribuan
baris lama mengaku diawasi kamera 1 — pernyataan yang tidak pernah ada yang
membuatnya, dan justru menyesatkan orang yang kelak mencari rekamannya.
Untuk baris BARU, kamera wajib: server menolak `mulai` maupun simpan luring
tanpa nomor kamera yang sah.

Dashboard Bongkaran menampilkan sebaran per kamera hari itu. Gunanya bukan
hiasan: kalau tiga meja berjalan tapi seluruh resi tercatat di Kamera 1,
ada operator yang salah pilih di awal — dan itu baru akan terasa
berbulan-bulan kemudian, saat rekamannya dicari dan tidak ada.

---

## 3. Kolom Line di ekspor Bongkaran

Posisi barang di dalam resinya: `1 of 2`, `2 of 2`. Resi berisi satu barang
tetap ditulis `1 of 1`, **bukan dikosongkan** — kolom yang kadang kosong dan
kadang terisi memaksa pembacanya menebak apakah kosong itu berarti
"satu-satunya" atau "datanya hilang".

Server mengirim dua angka (`urutan`, `totalBaris`), bukan teks jadi. Bentuk
tulisannya urusan layar, dan angka mentah tetap bisa difilter maupun
diurutkan kalau kelak dibutuhkan.

### Susunan kolom ekspor Bongkaran sekarang

| No. | No Resi | **Line** | Barcode Scan | Kode SKU | Nama SKU | Quantity | Kondisi | Nama Barang Diterima | Batch | Exp. Date | Scan By | Scan Date | **Kamera** | Expedisi |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Expedisi tetap paling akhir. Kamera diletakkan tepat sebelumnya karena ia
berpasangan dengan Scan Date di sebelah kirinya.

---

## 4. Yang diverifikasi

- Uji unit: 15 kasus `periksaItemCancel` / `kodeSesi` / `edDariBatch`,
  20 kasus `isKamera` / `labelKamera` / penomoran Line — semuanya lulus.
- Tinjauan kode independen atas seluruh modul Cancel Order; tujuh temuan
  diperbaiki, termasuk dua yang berdampak nyata di lapangan:
  penomoran sesi yang bisa mematikan modul sampai tengah malam, dan fokus
  yang tidak berpindah setelah lookup sehingga barcode kedua tersambung ke
  barcode pertama.
- Tailwind dikompilasi penuh — seluruh kelas baru benar-benar ada di CSS.
- `tsc --noEmit`: 45 error, **seluruhnya** kolom dan tabel yang belum ada di
  Prisma Client. Hilang setelah `npm run db:push`.

**Belum diverifikasi:** rupa dan alur sebenarnya di peramban.
