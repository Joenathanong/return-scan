import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { handle, requireBongkaran, badRequest, writeAudit } from "@/lib/api";
import { bersihkanKode } from "@/lib/produk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Batas kewajaran satu kali pencocokan ulang. */
const MAKS_BARCODE = 200;

/**
 * POST /api/bongkaran/cocokkan  { barcodes?: string[] }
 *
 * Mencocokkan ULANG baris yang tertandai "barcode belum terdaftar" dengan
 * isi Master Produk hari ini.
 *
 * Kenapa ini perlu ada: baris ditandai `produk_tidak_dikenal` pada saat
 * di-scan, dan tanda itu benar SAAT ITU. Begitu admin mendaftarkan
 * barcode-nya ke Master Produk, tanda tadi jadi usang — barcode-nya
 * sekarang terdaftar — tapi baris lamanya tetap menyandangnya selamanya
 * dan terus muncul di daftar dashboard. Orang lalu menyimpulkan
 * pendaftarannya gagal, padahal berhasil.
 *
 * Yang dilakukan: untuk setiap barcode yang KINI ada di master, isi
 * `sku` dan `namaProduk` dari master lalu cabut tandanya. Barcode yang
 * memang masih belum terdaftar dibiarkan apa adanya dan dilaporkan
 * kembali — tidak dihapus dari daftar, karena ia memang masih perlu
 * ditangani.
 *
 * WAKTU TIDAK DISENTUH. `scanned_at` tetap menunjuk saat barang di-scan.
 *
 * Nama yang diketik operator SENGAJA ditimpa nama resmi dari master.
 * Nama ketikan tangan adalah tambalan sementara; begitu ada nama resmi,
 * membiarkan tambalan itu berarti dua baris barang yang sama muncul
 * dengan dua nama berbeda di laporan yang sama.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const me = await requireBongkaran();

    const body = (await req.json().catch(() => ({}))) as { barcodes?: unknown };

    let daftar: string[] = [];
    if (Array.isArray(body.barcodes)) {
      daftar = [...new Set(body.barcodes.map((b) => bersihkanKode(b)).filter(Boolean))];
      if (daftar.length === 0) throw badRequest("Tidak ada barcode yang dikirim.");
      if (daftar.length > MAKS_BARCODE) {
        throw badRequest(`Maksimal ${MAKS_BARCODE} barcode sekali jalan.`);
      }
    } else {
      // Tanpa daftar: ambil semua barcode yang masih bertanda tidak dikenal.
      const semua = await prisma.bongkaranItem.groupBy({
        by: ["barcode"],
        where: {
          produkTidakDikenal: true,
          barcode: { not: null },
          bongkaran: { status: "final" },
        },
        _count: { _all: true },
        // Prisma mewajibkan orderBy bila ada take. Diurutkan dari yang
        // paling sering muncul, jadi kalau daftarnya melebihi batas, yang
        // tertangani lebih dulu adalah barcode yang paling banyak
        // menyandera baris.
        orderBy: { _count: { barcode: "desc" } },
        take: MAKS_BARCODE,
      });
      daftar = semua.map((b) => b.barcode ?? "").filter(Boolean);
    }

    if (daftar.length === 0) {
      return { ok: true, diperbaiki: 0, barisDiperbaiki: 0, masihAsing: [] };
    }

    // Barcode aktif saja: barcode yang sudah dilepas pemiliknya (active
    // false) tidak boleh dipakai memperbaiki apa pun.
    const cocok = await prisma.produkBarcode.findMany({
      where: { barcode: { in: daftar }, active: true },
      select: { barcode: true, sku: true, produk: { select: { nama: true, active: true } } },
    });

    let diperbaiki = 0;
    let barisDiperbaiki = 0;
    const ditemukan = new Set<string>();

    for (const c of cocok) {
      // Produk yang sudah dinonaktifkan tidak dipakai memperbaiki: kalau
      // masternya sendiri menyatakan produk ini tidak dipakai lagi,
      // memasangnya ke baris lama hanya memindahkan kebingungan.
      if (!c.produk.active) continue;

      const { count } = await prisma.bongkaranItem.updateMany({
        where: { barcode: c.barcode, produkTidakDikenal: true },
        data: { sku: c.sku, namaProduk: c.produk.nama, produkTidakDikenal: false },
      });
      if (count > 0) {
        diperbaiki++;
        barisDiperbaiki += count;
      }
      ditemukan.add(c.barcode);
    }

    const masihAsing = daftar.filter((b) => !ditemukan.has(b));

    if (barisDiperbaiki > 0) {
      await writeAudit(
        me.id, me.name, "BONGKARAN_COCOKKAN_BARCODE",
        `${diperbaiki} barcode dicocokkan ulang, ${barisDiperbaiki} baris diperbaiki`
      );
    }

    return { ok: true, diperbaiki, barisDiperbaiki, masihAsing };
  });
}
