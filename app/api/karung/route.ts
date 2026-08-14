import { NextRequest } from "next/server";
import { prisma, isUniqueViolation } from "@/lib/db";
import {
  handle, requireUser, badRequest, conflict, requireString, writeAudit,
} from "@/lib/api";
import { todayWIB, isValidDate } from "@/lib/date";
import { KARUNG_INCLUDE, toKarung, type KarungRow } from "@/lib/karung";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── GET /api/karung ─────────────────────────────────────────────────────────

/**
 * GET /api/karung?expedisiId=..&date=..     → karung satu ekspedisi satu hari
 * GET /api/karung?dateFrom=..&dateTo=..     → riwayat rentang tanggal
 * GET /api/karung?date=..                   → semua karung satu hari
 *
 * Tanpa parameter apa pun → karung hari ini (WIB).
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const q = req.nextUrl.searchParams;

    const expedisiId = q.get("expedisiId");
    const date = q.get("date");
    const dateFrom = q.get("dateFrom");
    const dateTo = q.get("dateTo");

    const where: Record<string, unknown> = {};
    if (expedisiId) where.expedisiId = expedisiId;

    if (date) {
      if (!isValidDate(date)) throw badRequest("Format tanggal harus YYYY-MM-DD.");
      where.date = date;
    } else if (dateFrom || dateTo) {
      if (dateFrom && !isValidDate(dateFrom)) throw badRequest("dateFrom tidak valid.");
      if (dateTo && !isValidDate(dateTo)) throw badRequest("dateTo tidak valid.");
      where.date = {
        ...(dateFrom ? { gte: dateFrom } : {}),
        ...(dateTo ? { lte: dateTo } : {}),
      };
    } else {
      // Tanpa filter tanggal sama sekali → default HARI INI (WIB).
      // Sengaja tetap dibatasi walau `expedisiId` diberikan, supaya halaman
      // scan tidak pernah tidak sengaja menarik seluruh riwayat karung.
      where.date = todayWIB();
    }

    const rows = await prisma.karung.findMany({
      where,
      include: KARUNG_INCLUDE,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 2000,
    });

    return { rows: (rows as unknown as KarungRow[]).map(toKarung) };
  });
}

// ─── POST /api/karung ────────────────────────────────────────────────────────

/**
 * Membuat karung baru untuk HARI INI — tanggal dihitung server dalam WIB,
 * tidak pernah dikirim klien. Jam laptop operator yang salah tidak lagi
 * bisa menaruh karung di tanggal yang keliru.
 *
 * Nomor karung dijamin unik per ekspedisi per tanggal oleh constraint
 * `uq_karung_exp_date_nomor` di database, bukan oleh pengecekan klien.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const me = await requireUser();
    const body = (await req.json()) as { expedisiId?: string; nomorKarung?: string };

    const expedisiId = requireString(body.expedisiId, "Ekspedisi", 30);
    const nomorKarung = requireString(body.nomorKarung, "Nomor karung", 64);

    const exp = await prisma.expedisi.findUnique({ where: { id: expedisiId } });
    if (!exp) throw badRequest("Ekspedisi tidak ditemukan.");
    if (!exp.active) throw badRequest(`Ekspedisi ${exp.name} sedang nonaktif.`);

    const date = todayWIB();

    try {
      const created = await prisma.karung.create({
        data: { expedisiId, nomorKarung, date, status: "open", createdById: me.id },
        include: KARUNG_INCLUDE,
      });
      await writeAudit(
        me.id, me.name, "CREATE_KARUNG",
        `Buat karung #${nomorKarung} untuk ${exp.name} (${date})`
      );
      return { karung: toKarung(created as unknown as KarungRow) };
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw conflict(
          `Karung #${nomorKarung} untuk ${exp.name} hari ini sudah ada. ` +
            `Pilih karung itu dari daftar, atau pakai nomor lain.`,
          "KARUNG_DUPLICATE"
        );
      }
      throw err;
    }
  });
}
