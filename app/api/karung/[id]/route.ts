import { NextRequest } from "next/server";
import { prisma, isUniqueViolation, withRetry } from "@/lib/db";
import {
  handle, requireUser, requireAdmin, badRequest, conflict, notFound, writeAudit,
} from "@/lib/api";
import { KARUNG_INCLUDE, toKarung, type KarungRow } from "@/lib/karung";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── GET /api/karung/[id] ────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    await requireUser();
    const { id } = await params;
    const k = await prisma.karung.findUnique({ where: { id }, include: KARUNG_INCLUDE });
    if (!k) throw notFound("Karung tidak ditemukan.");
    return { karung: toKarung(k as unknown as KarungRow) };
  });
}

// ─── PATCH /api/karung/[id] ──────────────────────────────────────────────────

/**
 * Satu endpoint untuk semua perubahan karung, dipilih lewat `aksi`:
 *
 *   lock          — kunci (dipanggil saat tanda terima dicetak). Siapa pun.
 *   unlock        — admin membuka kembali, berlaku 24 jam.
 *   relock        — admin mengunci lagi sebelum 24 jam habis.
 *   ubah-nomor    — ganti nomor karung. Admin.
 *
 * Semua aksi dicatat ke audit log — di sistem lama, `unlock` tercatat tapi
 * perubahan nomor karung hanya sebagian.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await params;
    const body = (await req.json()) as { aksi?: string; nomorKarung?: string };
    const aksi = String(body.aksi ?? "");

    const k = await prisma.karung.findUnique({
      where: { id },
      include: { expedisi: { select: { name: true } } },
    });
    if (!k) throw notFound("Karung tidak ditemukan.");

    const label = `#${k.nomorKarung} (${k.expedisi.name}, ${k.date})`;

    switch (aksi) {
      case "lock": {
        const now = new Date();
        await prisma.karung.update({
          where: { id },
          data: { status: "locked", lockedAt: now, lockedById: me.id, printedAt: now },
        });
        await writeAudit(me.id, me.name, "LOCK_KARUNG", `Kunci karung ${label}`);
        break;
      }

      case "unlock": {
        await requireAdmin();
        await prisma.karung.update({
          where: { id },
          data: {
            status: "admin_unlocked",
            adminUnlockedAt: new Date(),
            adminUnlockedBy: me.id,
          },
        });
        await writeAudit(me.id, me.name, "UNLOCK_KARUNG", `Admin buka karung ${label}`);
        break;
      }

      case "relock": {
        await requireAdmin();
        await prisma.karung.update({
          where: { id },
          data: { status: "locked", adminUnlockedAt: null, adminUnlockedBy: null },
        });
        await writeAudit(me.id, me.name, "RELOCK_KARUNG", `Admin kunci ulang karung ${label}`);
        break;
      }

      case "ubah-nomor": {
        await requireAdmin();
        const nomorBaru = String(body.nomorKarung ?? "").trim();
        if (!nomorBaru) throw badRequest("Nomor karung wajib diisi.");
        if (nomorBaru.length > 64) throw badRequest("Nomor karung terlalu panjang.");
        if (nomorBaru === k.nomorKarung) return { ok: true, tidakAdaPerubahan: true };

        try {
          await withRetry(() =>
            prisma.karung.update({ where: { id }, data: { nomorKarung: nomorBaru } })
          );
        } catch (err) {
          if (isUniqueViolation(err)) {
            throw conflict(
              `Karung #${nomorBaru} untuk ${k.expedisi.name} pada ${k.date} sudah ada.`
            );
          }
          throw err;
        }
        await writeAudit(
          me.id, me.name, "UBAH_NOMOR_KARUNG",
          `Karung ${label} → #${nomorBaru}`
        );
        break;
      }

      default:
        throw badRequest("Aksi tidak dikenal. Gunakan: lock, unlock, relock, ubah-nomor.");
    }

    const after = await prisma.karung.findUnique({ where: { id }, include: KARUNG_INCLUDE });
    return { karung: toKarung(after as unknown as KarungRow) };
  });
}

// ─── DELETE /api/karung/[id] ─────────────────────────────────────────────────

/** Hanya karung KOSONG yang boleh dihapus, dan hanya oleh admin. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const me = await requireAdmin();
    const { id } = await params;

    const k = await prisma.karung.findUnique({
      where: { id },
      include: { expedisi: { select: { name: true } } },
    });
    if (!k) throw notFound("Karung tidak ditemukan.");

    // Dihitung ulang di sini, bukan mempercayai kolom apa pun.
    const isi = await prisma.scan.count({ where: { karungId: id, status: "success" } });
    if (isi > 0) {
      throw conflict(
        `Karung #${k.nomorKarung} berisi ${isi} resi — tidak bisa dihapus. ` +
          `Batalkan resinya dulu satu per satu kalau memang salah.`,
        "NOT_EMPTY"
      );
    }

    await prisma.karung.delete({ where: { id } });
    await writeAudit(
      me.id, me.name, "DELETE_KARUNG",
      `Hapus karung kosong #${k.nomorKarung} (${k.expedisi.name}, ${k.date})`
    );
    return { ok: true };
  });
}
