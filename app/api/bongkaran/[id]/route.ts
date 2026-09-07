import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  handle, requireBongkaran, badRequest, forbidden, notFound, writeAudit,
} from "@/lib/api";

export const runtime = "nodejs";

/**
 * GET /api/bongkaran/[id] — satu resi beserta barangnya.
 * Dipakai dashboard untuk membuka rinciannya.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    await requireBongkaran();
    const { id } = await params;

    const row = await prisma.bongkaran.findUnique({
      where: { id },
      select: {
        id: true, noResi: true, scannedAt: true, date: true, status: true,
        waktuDariKlien: true, finalizedAt: true, voidReason: true,
        scannedBy: { select: { name: true } },
        items: {
          orderBy: { urutan: "asc" },
          select: {
            id: true, urutan: true, kondisi: true, barcode: true, sku: true,
            namaProduk: true, produkTidakDikenal: true, namaDiterima: true,
            qty: true, batch: true, mfgDate: true, edDate: true,
            edOtomatis: true, scannedAt: true,
          },
        },
      },
    });
    if (!row) throw notFound("Data bongkaran tidak ditemukan.");

    return {
      id: row.id,
      noResi: row.noResi,
      scannedAt: row.scannedAt.toISOString(),
      date: row.date,
      status: row.status,
      waktuDariKlien: row.waktuDariKlien,
      finalizedAt: row.finalizedAt?.toISOString() ?? null,
      voidReason: row.voidReason,
      scannedByName: row.scannedBy.name,
      items: row.items.map((i) => ({
        ...i,
        scannedAt: i.scannedAt.toISOString(),
      })),
    };
  });
}

/**
 * DELETE /api/bongkaran/[id] — batalkan.
 *
 * Perilakunya berbeda menurut status, dan bedanya disengaja:
 *
 *   draft → BENAR-BENAR dihapus. Draft adalah resi yang di-scan lalu
 *           ditinggalkan; ia tidak memuat satu pun barang, jadi tidak ada
 *           jejak yang hilang. Membiarkannya menumpuk hanya membuat daftar
 *           "belum selesai" di dashboard jadi tidak berarti apa-apa.
 *
 *   final → di-VOID, tidak dihapus. Di sini sudah ada barang yang tercatat,
 *           dan menghapusnya berarti menghapus bukti. Statusnya jadi
 *           `voided`, datanya tetap utuh, dan ia hilang dari ekspor serta
 *           dari hitungan dashboard. Hanya admin.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const me = await requireBongkaran();
    const { id } = await params;

    const row = await prisma.bongkaran.findUnique({
      where: { id },
      select: { id: true, noResi: true, status: true, scannedById: true },
    });
    if (!row) throw notFound("Data bongkaran tidak ditemukan.");

    const url = new URL(req.url);
    const alasan = (url.searchParams.get("alasan") || "").trim().slice(0, 255);

    if (row.status === "draft") {
      // Operator boleh membuang draftnya sendiri; admin boleh membuang
      // draft siapa pun (itu gunanya daftar "belum selesai" di dashboard).
      if (row.scannedById !== me.id && me.role !== "admin") {
        throw badRequest("Draft ini milik operator lain.");
      }
      await prisma.bongkaran.delete({ where: { id } });
      await writeAudit(me.id, me.name, "BONGKARAN_HAPUS_DRAFT", `Draft ${row.noResi} dibuang`);
      return { ok: true, tindakan: "dihapus" };
    }

    if (row.status === "voided") return { ok: true, tindakan: "sudah dibatalkan" };

    // `me.role` sudah dibaca requireBongkaran() di atas — memanggil
    // requireAdmin() di sini berarti satu perjalanan ke database lagi untuk
    // menanyakan hal yang sudah kita ketahui.
    if (me.role !== "admin") {
      throw forbidden("Pembatalan data bongkaran yang sudah tersimpan hanya bisa oleh admin.");
    }
    if (!alasan) throw badRequest("Alasan pembatalan wajib diisi.");

    await prisma.bongkaran.update({
      where: { id },
      data: {
        status: "voided",
        voidedAt: new Date(),
        voidedById: me.id,
        voidReason: alasan,
      },
    });
    await writeAudit(
      me.id, me.name, "BONGKARAN_BATAL",
      `${row.noResi} dibatalkan: ${alasan}`
    );
    return { ok: true, tindakan: "dibatalkan" };
  });
}
