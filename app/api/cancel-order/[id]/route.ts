import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  handle, requireCancelOrder, badRequest, forbidden, notFound, writeAudit,
} from "@/lib/api";

export const runtime = "nodejs";

/** GET /api/cancel-order/[id] — satu sesi beserta barangnya. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    await requireCancelOrder();
    const { id } = await params;

    const row = await prisma.cancelOrder.findUnique({
      where: { id },
      select: {
        id: true, kode: true, catatan: true, date: true, status: true,
        recordedAt: true, voidReason: true,
        recordedBy: { select: { name: true } },
        items: {
          orderBy: { urutan: "asc" },
          select: {
            id: true, urutan: true, barcode: true, sku: true, namaProduk: true,
            produkTidakDikenal: true, qty: true, batch: true,
            mfgDate: true, edDate: true, edOtomatis: true,
          },
        },
      },
    });
    if (!row) throw notFound("Data cancel order tidak ditemukan.");

    return {
      id: row.id,
      kode: row.kode,
      catatan: row.catatan ?? "",
      tanggal: row.date,
      status: row.status,
      recordedAt: row.recordedAt.toISOString(),
      oleh: row.recordedBy.name,
      voidReason: row.voidReason,
      items: row.items,
    };
  });
}

/**
 * DELETE /api/cancel-order/[id]?alasan=… — batalkan sesi.
 *
 * Di-VOID, tidak dihapus. Sesi ini selalu berisi barang (tidak ada draft
 * kosong seperti di Bongkaran), jadi menghapusnya berarti menghapus bukti
 * pendataan. Statusnya jadi `voided`, datanya tetap utuh, dan ia hilang
 * dari riwayat maupun ekspor. Hanya admin.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const me = await requireCancelOrder();
    const { id } = await params;

    // `me.role` sudah dibaca di atas — tidak perlu perjalanan kedua ke
    // database hanya untuk menanyakan hal yang sudah diketahui.
    if (me.role !== "admin") {
      throw forbidden("Pembatalan data cancel order hanya bisa oleh admin.");
    }

    const alasan = (new URL(req.url).searchParams.get("alasan") || "").trim().slice(0, 255);
    if (!alasan) throw badRequest("Alasan pembatalan wajib diisi.");

    const row = await prisma.cancelOrder.findUnique({
      where: { id },
      select: { id: true, kode: true, status: true },
    });
    if (!row) throw notFound("Data cancel order tidak ditemukan.");
    if (row.status === "voided") return { ok: true, tindakan: "sudah dibatalkan" };

    await prisma.cancelOrder.update({
      where: { id },
      data: {
        status: "voided",
        voidedAt: new Date(),
        voidedById: me.id,
        voidReason: alasan,
      },
    });
    await writeAudit(
      me.id, me.name, "CANCEL_ORDER_BATAL",
      `${row.kode} dibatalkan: ${alasan}`
    );
    return { ok: true, tindakan: "dibatalkan" };
  });
}
