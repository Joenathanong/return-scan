import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { handle, requireBongkaran, cleanResi, badRequest } from "@/lib/api";
import { todayWIB } from "@/lib/date";
import {
  isKamera, nomorTanpaResi, tanpaResi, AWALAN_TANPA_RESI, CATATAN_MAKS,
} from "@/lib/bongkaran";
import { bersihkanNama } from "@/lib/produk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/bongkaran/mulai  { noResi }
 *
 * Dipanggil TEPAT saat resi di-scan, bukan saat Simpan. Inilah satu-satunya
 * tempat `scanned_at` ditulis, dan yang menulisnya adalah SERVER — jam PDT
 * yang meleset (baterai RTC habis, zona waktu salah, operator mengubahnya)
 * tidak bisa merusak data. Setiap barang nanti dicatat sebagai selisih
 * milidetik terhadap titik ini; yang datang dari klien hanya durasi, bukan
 * jam dinding.
 *
 * Barisnya berstatus `draft` sampai Simpan ditekan. Draft yang tidak pernah
 * selesai (PDT mati, operator keluar) tetap terlihat di dashboard — jauh
 * lebih baik daripada data yang hilang tanpa jejak.
 *
 * Sekalian mengembalikan dua hal yang hanya bisa dijawab server, supaya
 * tidak perlu panggilan tambahan:
 *   • apakah resi ini pernah dibongkar sebelumnya (peringatan, bukan
 *     larangan — satu nomor resi bisa sah datang dalam dua koli);
 *   • apakah resi ini ada di Scan Retur (informasi, bukan syarat —
 *     bongkar bisa terjadi sebelum resinya sempat tercatat).
 */
/**
 * Riwayat satu nomor resi — SATU kueri untuk dua pertanyaan:
 *
 *   • pernahkah resi ini SELESAI dibongkar (peringatan duplikat), dan
 *   • apakah operator ini masih punya DRAFT tertinggal untuk resi yang sama
 *     (dipakai ulang, bukan ditumpuk).
 *
 * Ditulis sebagai fungsi, bukan dituliskan langsung di dalam handler,
 * supaya tipe hasilnya punya nama — jalur tanpa resi melewati kueri ini
 * dan tetap harus menghasilkan bentuk yang sama persis.
 *
 * TIDAK diekspor: App Router hanya mengizinkan handler HTTP dan beberapa
 * konstanta khusus diekspor dari route.ts.
 */
async function cariRiwayat(noResi: string, uid: string) {
  return prisma.bongkaran.findMany({
    where: {
      noResi,
      OR: [{ status: "final" }, { status: "draft", scannedById: uid }],
    },
    select: {
      id: true, scannedAt: true, date: true, status: true, scannedById: true,
      scannedBy: { select: { name: true } },
      _count: { select: { items: true } },
    },
    orderBy: { scannedAt: "desc" },
    take: 10,
  });
}

async function cariScanRetur(noResi: string) {
  return prisma.scan.findFirst({
    where: { noResi, status: "success" },
    select: {
      date: true,
      expedisi: { select: { name: true, code: true } },
      karung: { select: { nomorKarung: true } },
    },
  });
}

type Riwayat = Awaited<ReturnType<typeof cariRiwayat>>;
type Retur = Awaited<ReturnType<typeof cariScanRetur>>;

export async function POST(req: NextRequest) {
  return handle(async () => {
    const me = await requireBongkaran();

    const body = (await req.json()) as {
      noResi?: string; kamera?: number; tanpaResi?: boolean; catatan?: string;
    };

    /** Paket yang label resinya sobek / tidak terbaca sama sekali. */
    const labelRusak = body.tanpaResi === true;

    const catatan = bersihkanNama(body.catatan).slice(0, CATATAN_MAKS) || null;

    let noResi = "";
    if (!labelRusak) {
      noResi = cleanResi(body.noResi);
      if (!noResi) throw badRequest("Nomor resi wajib diisi.");
      if (noResi.length > 64) throw badRequest("Nomor resi terlalu panjang.");

      // Awalan nomor pengganti HANYA boleh lahir dari server.
      //
      // Kalau operator boleh mengetiknya sendiri, awalan itu berhenti jadi
      // pernyataan "sistem tidak menemukan nomor resi" dan berubah jadi
      // "seseorang mengetik sesuatu yang mirip" — dan seluruh perhitungan
      // yang bersandar padanya (penghitung di dashboard, kolom Catatan di
      // ekspor, pengecualian pencocokan ekspedisi) ikut kehilangan arti.
      if (tanpaResi(noResi)) {
        throw badRequest(
          `Nomor resi tidak boleh diawali "${AWALAN_TANPA_RESI}" — awalan itu dipakai ` +
            "sistem untuk paket yang labelnya tidak terbaca. Pakai tombol " +
            '"Resi rusak / tidak terbaca" kalau memang begitu keadaannya.'
        );
      }
    }

    // Kamera WAJIB di sini, walaupun kolomnya nullable di database.
    //
    // Nullable itu untuk baris lama yang tercatat sebelum fitur ini ada;
    // baris baru tidak punya alasan untuk kosong, karena layar memaksa
    // memilih kamera sebelum kolom resi bisa disentuh. Kalau tetap sampai
    // ke sini tanpa kamera, ada yang salah — dan lebih baik ketahuan
    // sekarang daripada muncul sebagai kolom kosong berbulan-bulan
    // kemudian, saat seseorang justru sedang mencari rekamannya.
    const kamera = Number(body.kamera);
    if (!isKamera(kamera)) {
      throw badRequest("Nomor kamera belum dipilih. Pilih kamera dulu di layar Bongkaran.");
    }

    /*
      JALUR TANPA RESI TIDAK MENYENTUH DUA KUERI DI BAWAH SAMA SEKALI.

      Keduanya menjawab pertanyaan yang hanya masuk akal kalau ada nomor
      yang bisa dicocokkan: "pernah dibongkar sebelumnya?" dan "ada di Scan
      Retur?". Untuk nomor yang baru saja dibuat sistem, jawabannya sudah
      pasti tidak — menanyakannya ke TiDB hanya menghabiskan kuota untuk
      mendengar hal yang sudah diketahui. Jadi jalur ini justru LEBIH MURAH
      daripada scan resi biasa: nol kueri sebelum menulis, bukan dua.
    */
    const [riwayat, diScanRetur]: [Riwayat, Retur] = labelRusak
      ? [[], null]
      : await Promise.all([cariRiwayat(noResi, me.id), cariScanRetur(noResi)]);

    const sebelumnya = riwayat.find((r) => r.status === "final") ?? null;

    /*
      Draft yang boleh dipakai ulang: milik operator ini, masih berstatus
      draft, dan BENAR-BENAR KOSONG. Yang ada isinya sengaja dilewati —
      barang yang sudah tercatat di sana harus dilihat manusia lewat panel
      dashboard ("Lihat isi" lalu Simpan), bukan diam-diam ditimpa oleh
      sesi baru yang jam scan-nya berbeda.
    */
    const draftLama =
      riwayat.find(
        (r) => r.status === "draft" && r.scannedById === me.id && r._count.items === 0
      ) ?? null;

    const scannedAt = new Date();

    // Nomornya dibuat DI SINI, dari jam server dan kamera yang sama dengan
    // yang tersimpan di barisnya — bukan di klien. Nomor yang dibuat klien
    // akan memakai jam PDT, dan justru pada baris tanpa resi jam itulah
    // satu-satunya jalan menemukan rekamannya kembali.
    if (labelRusak) noResi = nomorTanpaResi(kamera, scannedAt);

    // Dipakai ulang = update, bukan create. Jumlah kueri tetap satu, dan
    // barisnya tetap satu — inilah bedanya dengan sebelumnya.
    //
    // `scannedAt` DIPERBARUI ke sekarang, bukan dipertahankan dari scan
    // yang gagal tadi. Jam scan adalah waktu barang ini benar-benar mulai
    // dibongkar; mempertahankan jam lama akan melaporkan pekerjaan pukul
    // sepuluh sebagai pekerjaan pukul delapan, dan membuat pencarian
    // rekaman CCTV meleset ke jam yang layarnya kosong.
    const bongkaran = draftLama
      ? await prisma.bongkaran.update({
          where: { id: draftLama.id },
          data: { scannedAt, kamera, date: todayWIB() },
          select: { id: true, noResi: true, scannedAt: true, date: true, kamera: true },
        })
      : await prisma.bongkaran.create({
          data: {
            noResi,
            scannedAt,
            kamera,
            catatan,
            scannedById: me.id,
            date: todayWIB(),
            status: "draft",
          },
          select: { id: true, noResi: true, scannedAt: true, date: true, kamera: true },
        });

    return {
      id: bongkaran.id,
      noResi: bongkaran.noResi,
      scannedAt: bongkaran.scannedAt.toISOString(),
      date: bongkaran.date,
      kamera: bongkaran.kamera,
      /** Layar memakainya untuk memberi tahu operator, bukan untuk logika. */
      dipakaiUlang: Boolean(draftLama),
      tanpaResi: labelRusak,
      catatan,
      duplikat: sebelumnya
        ? {
            tanggal: sebelumnya.date,
            oleh: sebelumnya.scannedBy.name,
            jumlahBarang: sebelumnya._count.items,
          }
        : null,
      retur: diScanRetur
        ? {
            tanggal: diScanRetur.date,
            expedisi: diScanRetur.expedisi.name,
            kodeExpedisi: diScanRetur.expedisi.code,
            karung: diScanRetur.karung.nomorKarung,
          }
        : null,
    };
  });
}
