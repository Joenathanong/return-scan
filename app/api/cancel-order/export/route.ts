import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { handle, requireCancelOrder, badRequest } from "@/lib/api";
import { isValidDate, todayWIB } from "@/lib/date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PER_HALAMAN = 2000;

/**
 * GET /api/cancel-order/export?dari=&sampai=&kursor=
 *
 * Satu baris per BARANG; kode sesi diulang di setiap baris, bukan sel yang
 * digabung — alasannya sama dengan di ekspor bongkaran: merge cell merusak
 * filter, sort, dan pivot, yang justru alasan orang meminta ekspor.
 *
 * Sesi berstatus `voided` tidak ikut.
 *
 * Berkas .xlsx-nya dirakit di peramban, bukan di sini. Fungsi serverless
 * yang merakit spreadsheet puluhan ribu baris akan menyentuh batas memori
 * dan waktu Vercel.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireCancelOrder();

    const url = new URL(req.url);
    const dari = url.searchParams.get("dari") || todayWIB();
    const sampai = url.searchParams.get("sampai") || todayWIB();

    if (!isValidDate(dari) || !isValidDate(sampai)) {
      throw badRequest("Rentang tanggal tidak valid.");
    }
    if (dari > sampai) throw badRequest("Tanggal awal melewati tanggal akhir.");

    const kursor = url.searchParams.get("kursor") || "";

    const rows = await prisma.cancelOrderItem.findMany({
      where: {
        cancelOrder: { date: { gte: dari, lte: sampai }, status: "final" },
        ...(kursor ? { id: { gt: kursor } } : {}),
      },
      select: {
        id: true,
        barcode: true,
        sku: true,
        namaProduk: true,
        produkTidakDikenal: true,
        qty: true,
        batch: true,
        edDate: true,
        cancelOrder: {
          select: {
            kode: true,
            catatan: true,
            date: true,
            recordedAt: true,
            recordedBy: { select: { name: true } },
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
        kodeSesi: r.cancelOrder.kode,
        tanggal: r.cancelOrder.date,
        barcode: r.barcode ?? "",
        sku: r.sku ?? "",
        namaSku: r.namaProduk,
        qty: r.qty,
        batch: r.batch ?? "",
        edDate: r.edDate ?? "",
        catatan: r.cancelOrder.catatan ?? "",
        inputBy: r.cancelOrder.recordedBy.name,
        inputDate: r.cancelOrder.recordedAt.toISOString(),
        produkTidakDikenal: r.produkTidakDikenal,
      })),
    };
  });
}
