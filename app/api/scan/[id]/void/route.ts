import { NextRequest } from "next/server";
import { prisma, withRetry } from "@/lib/db";
import { handle, requireAdmin, badRequest, notFound, writeAudit } from "@/lib/api";

export const runtime = "nodejs";

/**
 * POST /api/scan/[id]/void — batalkan satu scan (khusus admin).
 *
 * Menggantikan "hapus baris di Google Sheet" dari sistem lama, yang dulu
 * hanya menghapus di sheet dan meninggalkan record Firestore selamanya
 * dengan tanda "sudah sync" — sehingga tidak pernah bisa dipulihkan.
 *
 * Di sini barisnya TIDAK dihapus:
 *   status     → "voided"  (hilang dari semua laporan & tanda terima)
 *   noResiUnik → NULL      (kode resi itu bebas dipakai lagi)
 *   voidedAt / voidedById / voidReason terisi sebagai jejak audit
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const me = await requireAdmin();
    const { id } = await params;

    const body = (await req.json().catch(() => ({}))) as { alasan?: string };
    const alasan = String(body.alasan ?? "").trim();
    if (!alasan) throw badRequest("Alasan pembatalan wajib diisi.");
    if (alasan.length > 255) throw badRequest("Alasan terlalu panjang (maks. 255).");

    const scan = await prisma.scan.findUnique({
      where: { id },
      include: {
        karung: { select: { nomorKarung: true } },
        expedisi: { select: { name: true } },
      },
    });
    if (!scan) throw notFound("Data scan tidak ditemukan.");
    if (scan.status === "voided") throw badRequest("Scan ini sudah dibatalkan.");

    await withRetry(() =>
      prisma.scan.update({
        where: { id },
        data: {
          status: "voided",
          noResiUnik: null,
          voidedAt: new Date(),
          voidedById: me.id,
          voidReason: alasan,
        },
      })
    );

    await writeAudit(
      me.id, me.name, "VOID_SCAN",
      `Batalkan resi ${scan.noResi} (karung #${scan.karung.nomorKarung}, ${scan.expedisi.name}) — ${alasan}`,
      { scanId: id, noResi: scan.noResi }
    );

    const totalResi = await prisma.scan.count({
      where: { karungId: scan.karungId, status: "success" },
    });

    return { ok: true, totalResi };
  });
}
