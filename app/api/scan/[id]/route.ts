import { NextRequest } from "next/server";
import { prisma, isUniqueViolation, withRetry } from "@/lib/db";
import {
  handle, requireAdmin, badRequest, conflict, notFound, cleanResi, writeAudit,
} from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RESI = 64;

/**
 * PATCH /api/scan/[id] — perbaiki satu hasil scan.
 *
 * Hanya dua hal yang boleh diubah, karena hanya dua ini yang benar-benar
 * bisa salah saat scan:
 *
 *   noResi    kode terpotong atau salah baca barcode
 *   karungId  resi masuk ke karung yang keliru
 *
 * Yang SENGAJA tidak bisa diubah: siapa yang men-scan dan kapan. Keduanya
 * jejak pertanggungjawaban — nama itu tercetak di tanda terima yang sudah
 * ditandatangani ekspedisi, dan mengubahnya berarti mengubah dokumen yang
 * sudah disepakati kedua pihak.
 *
 * `expedisiId` dan `date` ikut menyesuaikan karung tujuan, bukan dikirim
 * terpisah — supaya tidak mungkin ada scan yang tanggalnya berbeda dari
 * karung yang menampungnya.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const me = await requireAdmin();
    const { id } = await params;
    const body = (await req.json()) as { noResi?: string; karungId?: string };

    const scan = await prisma.scan.findUnique({
      where: { id },
      include: {
        karung: { select: { id: true, nomorKarung: true, status: true, date: true } },
        expedisi: { select: { name: true } },
      },
    });
    if (!scan) throw notFound("Data scan tidak ditemukan.");
    if (scan.status === "voided") {
      throw badRequest("Resi ini sudah dibatalkan, jadi tidak bisa diubah lagi.");
    }

    const data: Record<string, unknown> = {};
    const jejak: string[] = [];

    // ── Kode resi ────────────────────────────────────────────────────────
    if (body.noResi !== undefined) {
      const baru = cleanResi(body.noResi);
      if (!baru) throw badRequest("Kode resi tidak boleh kosong.");
      if (baru.length > MAX_RESI) {
        throw badRequest(`Kode resi terlalu panjang (maks. ${MAX_RESI} karakter).`);
      }
      if (baru !== scan.noResi) {
        data.noResi = baru;
        // Kolom penjaga keunikan ikut diperbarui, kalau tidak resi lama
        // masih akan menghalangi orang lain men-scan kode itu.
        data.noResiUnik = baru;
        jejak.push(`resi ${scan.noResi} → ${baru}`);
      }
    }

    // ── Pindah karung ────────────────────────────────────────────────────
    if (body.karungId !== undefined && body.karungId !== scan.karungId) {
      const tujuan = await prisma.karung.findUnique({
        where: { id: String(body.karungId) },
        include: { expedisi: { select: { name: true } } },
      });
      if (!tujuan) throw badRequest("Karung tujuan tidak ditemukan.");

      data.karungId = tujuan.id;
      data.expedisiId = tujuan.expedisiId;
      data.date = tujuan.date; // tanggal SELALU ikut karung
      jejak.push(
        `karung #${scan.karung.nomorKarung} (${scan.expedisi.name}) → ` +
          `#${tujuan.nomorKarung} (${tujuan.expedisi.name}, ${tujuan.date})`
      );

      // Bukan larangan, tapi wajib tercatat: memindahkan resi ke/dari karung
      // yang sudah terkunci berarti mengubah isi tanda terima yang mungkin
      // sudah dicetak dan ditandatangani.
      if (scan.karung.status === "locked" || tujuan.status === "locked") {
        jejak.push("(melibatkan karung terkunci — tanda terima perlu dicetak ulang)");
      }
    }

    if (Object.keys(data).length === 0) {
      return { ok: true, tidakAdaPerubahan: true };
    }

    try {
      await withRetry(() => prisma.scan.update({ where: { id }, data }));
    } catch (err) {
      if (isUniqueViolation(err)) {
        const bentrok = await prisma.scan.findUnique({
          where: { noResiUnik: String(data.noResi) },
          include: {
            karung: { select: { nomorKarung: true } },
            expedisi: { select: { name: true } },
          },
        });
        throw conflict(
          bentrok
            ? `Kode ${data.noResi} sudah dipakai di karung #${bentrok.karung.nomorKarung} — ` +
              `${bentrok.expedisi.name} (${bentrok.date}).`
            : `Kode ${data.noResi} sudah dipakai resi lain.`,
          "RESI_DUPLICATE"
        );
      }
      throw err;
    }

    await writeAudit(me.id, me.name, "EDIT_SCAN", `Ubah scan ${id}: ${jejak.join("; ")}`, {
      scanId: id,
      noResiLama: scan.noResi,
    });

    const sesudah = await prisma.scan.findUnique({
      where: { id },
      include: {
        karung: { select: { nomorKarung: true } },
        expedisi: { select: { name: true, code: true } },
        scannedBy: { select: { name: true } },
      },
    });

    return {
      ok: true,
      scan: sesudah && {
        id: sesudah.id,
        noResi: sesudah.noResi,
        karungId: sesudah.karungId,
        nomorKarung: sesudah.karung.nomorKarung,
        expedisiId: sesudah.expedisiId,
        expedisiName: sesudah.expedisi.name,
        expedisiCode: sesudah.expedisi.code,
        scannedById: sesudah.scannedById,
        scannedByName: sesudah.scannedBy.name,
        scannedAt: sesudah.scannedAt.toISOString(),
        date: sesudah.date,
        status: "success" as const,
        voidedAt: null,
        voidReason: null,
      },
    };
  });
}
