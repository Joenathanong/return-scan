import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { handle, requireBongkaran, badRequest } from "@/lib/api";
import { isValidDate, todayWIB } from "@/lib/date";
import { LABEL_KONDISI, isKondisi } from "@/lib/bongkaran";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Batas baris per pengambilan. Bukan batas laporan — klien mengulang selama
 * `lagi: true`. Angkanya menjaga satu balasan tetap di bawah batas memori
 * fungsi serverless untuk rentang tanggal yang lebar.
 */
const PER_HALAMAN = 2000;

/**
 * GET /api/bongkaran/export?dari=YYYY-MM-DD&sampai=YYYY-MM-DD&kursor=
 *
 * SATU BARIS PER BARANG, nomor resi DIULANG di tiap baris — bukan sel yang
 * digabung. Merge cell terlihat lebih rapi di layar tapi merusak filter,
 * sort, dan pivot di Excel, yang justru alasan orang meminta ekspor.
 *
 * Baris `voided` tidak ikut. Draft juga tidak: ia belum punya barang.
 *
 * Berkas .xlsx-nya dirakit di peramban (halaman /bongkaran/export), bukan
 * di sini. Fungsi serverless yang merakit spreadsheet puluhan ribu baris
 * akan menyentuh batas memori dan waktu Vercel; peramban punya keduanya
 * berlimpah dan sudah memuat pustaka xlsx untuk halaman Data & Export.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireBongkaran();

    const url = new URL(req.url);
    const dari = url.searchParams.get("dari") || todayWIB();
    const sampai = url.searchParams.get("sampai") || todayWIB();

    if (!isValidDate(dari) || !isValidDate(sampai)) {
      throw badRequest("Rentang tanggal tidak valid.");
    }
    if (dari > sampai) {
      throw badRequest("Tanggal awal melewati tanggal akhir.");
    }

    // Kursor berbasis id item: stabil, tidak terpengaruh baris baru yang
    // masuk di tengah pengambilan, dan tidak bisa melompat seperti kursor
    // berbasis nomor halaman.
    const kursor = url.searchParams.get("kursor") || "";

    const rows = await prisma.bongkaranItem.findMany({
      where: {
        bongkaran: { date: { gte: dari, lte: sampai }, status: "final" },
        ...(kursor ? { id: { gt: kursor } } : {}),
      },
      select: {
        id: true,
        kondisi: true,
        barcode: true,
        sku: true,
        namaProduk: true,
        namaDiterima: true,
        produkTidakDikenal: true,
        qty: true,
        batch: true,
        edDate: true,
        scannedAt: true,
        bongkaran: {
          select: {
            noResi: true,
            date: true,
            scannedAt: true,
            scannedBy: { select: { name: true } },
          },
        },
      },
      orderBy: { id: "asc" },
      take: PER_HALAMAN,
    });

    return {
      dari,
      sampai,
      lagi: rows.length === PER_HALAMAN,
      kursor: rows.length > 0 ? rows[rows.length - 1].id : null,
      rows: rows.map((r) => ({
        noResi: r.bongkaran.noResi,
        barcode: r.barcode ?? "",
        sku: r.sku ?? "",
        // Untuk barcode yang belum terdaftar, nama yang diketik operator
        // yang dipakai — kolomnya tidak dibiarkan kosong hanya karena
        // masternya belum lengkap.
        namaSku: r.namaProduk ?? "",
        qty: r.qty,
        kondisi: isKondisi(r.kondisi) ? LABEL_KONDISI[r.kondisi] : r.kondisi,
        namaDiterima: r.namaDiterima ?? "",
        batch: r.batch ?? "",
        edDate: r.edDate ?? "",
        scanBy: r.bongkaran.scannedBy.name,
        // Waktu BARANG, bukan waktu resi: dua barang dalam satu resi
        // di-scan pada detik yang berbeda, dan bedanya itu yang menunjukkan
        // berapa lama satu paket benar-benar dibongkar.
        scanDate: r.scannedAt.toISOString(),
        tanggal: r.bongkaran.date,
        produkTidakDikenal: r.produkTidakDikenal,
      })),
    };
  });
}
