# Penerapan IEG OCS Design System — Scan Retur

Sumber: `design-ocs.md` (Stock View V2, 8 Sep 2026).
Status: **terpasang.**

---

## Di mana temanya tinggal

Dua berkas, itu saja:

| Berkas | Isi |
|---|---|
| `tailwind.config.ts` | Token warna, gradien, radius, bayangan, ukuran sidebar/topbar |
| `app/globals.css` | Lapisan komponen: `.card`, `.btn-*`, `.input-field`, `.chip`, `.page-title`, `.thead-ocs` |

Halaman-halaman tidak menyimpan keputusan visual apa pun sendiri. Tema
berikutnya cukup menyentuh dua berkas ini — bukan dua puluh halaman.

**Token `brand` diganti isinya, bukan ditambah.** Dulu ia hijau (warna aksi
lama). Sekarang indigo `#4F46E5`. Karena namanya sama, seluruh aplikasi
berpindah palet tanpa mengubah arti satu pun kelas di halaman.

---

## Aturan yang ditegakkan

1. **Satu warna aksi.** Semua tombol dan tautan utama indigo `#4F46E5`.
   Hijau tidak hilang, tapi turun pangkat: sekarang ia hanya berarti
   "berhasil / aman" (`ok`), bukan lagi warna tombol.
2. **Gradien hanya di enam tempat:** sidebar, topbar, bar aksen judul,
   tombol primary, kepala tabel, dan satu banner sambutan di Dashboard.
3. **Latar aplikasi `#F8F9FF`, bukan putih** — inilah yang membuat kartu
   putih terlihat mengambang.
4. **Status = chip pill**, tidak pernah teks berwarna.
5. **Angka `tabular-nums`.** Kolom yang lebar digitnya bergoyang tidak bisa
   dibaca sekilas.
6. **Tanpa webfont eksternal.** System font stack — identik dengan OCS, dan
   nol permintaan jaringan tambahan di gudang yang sinyalnya pas-pasan.

---

## Tiga keputusan yang MENYIMPANG dari design system

Ditulis di sini supaya tidak dikira kelalaian.

### 1. Tinggi input 40px, bukan 32px

OCS adalah aplikasi meja. Halaman ini dipakai sambil berdiri memegang
scanner, dan kolom setinggi 32px terlalu sulit dikenai jempol. Sisanya —
radius 4px, border `#E0E0E0`, cincin fokus indigo 15% — persis spesifikasi.

### 2. Tinggi tombol 36px di layar, 44px di perangkat sentuh

Aturan lama `button, a { min-height: 44px }` dipasang demi PDT, tapi ikut
menggelembungkan setiap tautan sebaris. Sekarang: 36px untuk penunjuk
presisi, 44px hanya pada `pointer: coarse` — yang justru PDT.

### 3. Tombol kondisi di layar scan memakai warna status, bukan warna aksi

Empat tombol Bagus / Rusak Kemasan / Rusak Total / Isi Salah menyala dengan
warna semantiknya masing-masing. Yang dipilih di sana **bukan tindakan**,
melainkan nilai status yang akan tersimpan — dan operator yang menoleh
sebentar harus bisa membaca "merah" sebagai rusak total tanpa mengeja
tulisannya. Warna yang sama dipakai di kartu dashboard, versi lembut.

---

## Lebar halaman

Dua kerangka, dipilih dari isi halamannya — bukan dari selera:

| Kelas | Lebar | Dipakai di |
|---|---|---|
| `.shell` | penuh sampai 1600px | dashboard, tabel, **dan halaman scan** |
| `.shell-form` | 768px | formulir pendek: pengaturan, master expedisi |

**Halaman scan pindah dari `.shell-form` ke `.shell`.** Sebelumnya
`/bongkaran` dan `/cancel-order` sengaja dibuat sempit dengan alasan "baris
teks sepanjang 1600px tidak terbaca". Alasan itu benar untuk formulir satu
kolom, tapi keliru untuk kedua halaman ini: isinya bukan paragraf,
melainkan daftar kartu — dan di layar 1920px separuh layar tinggal kosong
sementara operator menggulir terus-menerus.

Yang melebar adalah **grid**-nya, bukan kolom isiannya:

- **Halaman** — mulai `xl` (1280px) terbelah jadi kolom isian + rel kanan
  22rem. Rel kanan berisi yang hanya perlu dibaca: kamera, kepala sesi (no.
  resi, jam scan, peringatan duplikat), dan hitungan berjalan. Rel itu
  `sticky`, jadi nomor resi tetap terlihat saat kartu barang sudah panjang.
- **Kartu barang (`/bongkaran`)** — barcode+qty dan batch+ED di kiri,
  empat tombol kondisi menumpuk di kolom kanan 18rem.
- **Kartu barang (`/cancel-order`)** — barcode+qty dan batch+ED
  berdampingan; satu barang muat dalam satu baris pandang.
- **Bilah simpan** — inner-nya ikut selebar halaman; di `xl` pesan
  peringatan di kiri, tombol Simpan di kanan.

### Urutan DOM sengaja tidak berubah

Rel kanan ditulis **lebih dulu** di DOM, dan penempatan kolom dilakukan
eksplisit lewat `col-start`/`row-start`, bukan lewat urutan tulis. Sebabnya:
di bawah `xl` grid runtuh ke satu kolom yang mengikuti urutan DOM apa
adanya, dan urutan itu harus tetap persis seperti di PDT — kamera, kepala
sesi, kartu barang; lalu di dalam kartu: barcode → kondisi → batch. Kalau
penempatan hanya mengandalkan urutan tulis, salah satu dari dua tampilan itu
pasti keliru.

Artinya: **tidak ada satu pun perubahan di PDT.** Semua kelas baru berawalan
`xl:`, dan layar PDT (~360–800px) tidak pernah mencapainya.

---

## Cetak tidak tersentuh

Tata letak tanda terima dikalibrasi dari pengukuran piksel hasil cetak
sungguhan. Tema baru **tidak boleh merembes ke kertas**:

- `@media print` memaksa latar putih dan teks hitam, jadi gradien dan indigo
  hanya hidup di layar.
- Tanda terima memakai markup dan gaya cetaknya sendiri (bukan `.card`),
  dan `app/(dashboard)/print/page.tsx` **dikecualikan dari seluruh sapuan
  warna otomatis**.
- Border kartu sengaja TIDAK dipaksa hitam saat mencetak — memaksakannya
  berisiko menggambar kotak yang selama ini tidak ada di kertas.

---

## Yang diverifikasi

- `tsc --noEmit` — 0 error.
- Tailwind dikompilasi penuh (`tailwindcss -i app/globals.css`) — berhasil,
  dan setiap token baru benar-benar ada di CSS hasilnya: `bg-app`,
  `thead-ocs`, `page-title`, `badge-success`, `w-sidebar`, `bg-ocs-sidebar`,
  `shadow-btn`, `rounded-card`, `text-ok-strong`, `bg-ocs-nav`, `border-ok`,
  `bg-accent`, `btn-primary`.
- `@apply chip` di dalam `.badge-*` menghasilkan properti pil yang benar
  (diperiksa di CSS keluaran, bukan diasumsikan).
- Blok `@page` dan `.no-print` tetap utuh di CSS hasil kompilasi.

**Belum diverifikasi:** rupa sebenarnya di peramban. Tidak ada yang bisa
menggantikan membukanya dan melihat.
