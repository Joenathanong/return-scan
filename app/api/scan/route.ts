import { NextRequest } from "next/server";
import { prisma, withRetry, isUniqueViolation } from "@/lib/db";
import {
  handle, requireUser, badRequest, notFound, cleanResi, writeAudit,
} from "@/lib/api";
import { isKarungLocked } from "@/lib/karung";
import { isValidDate } from "@/lib/date";
import type { ScanResult, ScanRecord } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Di bawah ini resi dianggap mencurigakan (mungkin scan terpotong) — */
/** TIDAK ditolak, hanya diberi peringatan. Operator yang memutuskan.  */
const WARN_RESI_LENGTH = 8;
const MAX_RESI_LENGTH = 64;

function toScanRecord(s: {
  id: string; noResi: string; karungId: string; expedisiId: string;
  scannedById: string; scannedAt: Date; date: string; status: string;
  voidedAt: Date | null; voidReason: string | null;
  karung: { nomorKarung: string };
  expedisi: { name: string; code: string };
  scannedBy: { name: string };
}): ScanRecord {
  return {
    id: s.id,
    noResi: s.noResi,
    karungId: s.karungId,
    nomorKarung: s.karung.nomorKarung,
    expedisiId: s.expedisiId,
    expedisiName: s.expedisi.name,
    expedisiCode: s.expedisi.code,
    scannedById: s.scannedById,
    scannedByName: s.scannedBy.name,
    scannedAt: s.scannedAt.toISOString(),
    date: s.date,
    status: s.status === "voided" ? "voided" : "success",
    voidedAt: s.voidedAt?.toISOString() ?? null,
    voidReason: s.voidReason,
  };
}

const INCLUDE = {
  karung: { select: { nomorKarung: true } },
  expedisi: { select: { name: true, code: true } },
  scannedBy: { select: { name: true } },
} as const;

// ─── POST /api/scan ──────────────────────────────────────────────────────────

/**
 * Menyimpan satu hasil scan.
 *
 * PERBEDAAN INTI dari sistem lama: tidak ada lagi "cek dulu, lalu tulis".
 * Insert langsung dicoba, dan DUPLIKAT DITOLAK OLEH DATABASE lewat
 * UNIQUE pada kolom `no_resi_unik`. Dua operator yang men-scan resi sama
 * pada milidetik yang sama tidak mungkin dua-duanya lolos — sesuatu yang
 * tidak bisa dijamin Firestore.
 *
 * Tidak ada pula panggilan ke Google Sheets di sini. Scan tidak akan pernah
 * gagal atau hilang gara-gara kuota Google.
 */
export async function POST(req: NextRequest) {
  return handle(async (): Promise<ScanResult> => {
    const me = await requireUser();
    const body = (await req.json()) as { karungId?: string; noResi?: string };

    const karungId = String(body.karungId ?? "").trim();
    const resi = cleanResi(body.noResi);

    if (!karungId) throw badRequest("Karung belum dipilih.");
    if (!resi) throw badRequest("Kode resi kosong.");
    if (resi.length > MAX_RESI_LENGTH) {
      throw badRequest(`Kode resi terlalu panjang (maks. ${MAX_RESI_LENGTH} karakter).`);
    }

    const karung = await prisma.karung.findUnique({
      where: { id: karungId },
      include: { expedisi: { select: { id: true, name: true, code: true } } },
    });
    if (!karung) throw notFound("Karung tidak ditemukan.");

    if (isKarungLocked(karung)) {
      return {
        ok: false,
        outcome: "locked",
        message: "Karung sudah terkunci. Minta admin membukanya.",
      };
    }

    try {
      const scan = await withRetry(() =>
        prisma.scan.create({
          data: {
            noResi: resi,
            noResiUnik: resi, // ← kolom penjaga keunikan
            karungId: karung.id,
            expedisiId: karung.expedisiId,
            scannedById: me.id,
            // Tanggal diambil dari KARUNG, bukan dari "hari ini".
            // Karung yang dibuka melewati tengah malam tetap konsisten:
            // isi karung, tanggal karung, dan tanda terimanya satu tanggal.
            date: karung.date,
            status: "success",
          },
          include: INCLUDE,
        })
      );

      const totalResi = await prisma.scan.count({
        where: { karungId: karung.id, status: "success" },
      });

      return {
        ok: true,
        outcome: "success",
        scan: toScanRecord(scan),
        totalResi,
        message:
          resi.length < WARN_RESI_LENGTH
            ? `Resi hanya ${resi.length} karakter — mohon dicek ulang.`
            : undefined,
      };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;

      // Database menolak karena resi ini sudah tercatat. Cari di mana.
      const asli = await prisma.scan.findUnique({
        where: { noResiUnik: resi },
        include: INCLUDE,
      });

      const info = asli
        ? `Karung #${asli.karung.nomorKarung} — ${asli.expedisi.name} (${asli.date})`
        : "Sudah pernah di-scan sebelumnya.";

      await writeAudit(me.id, me.name, "SCAN_DUPLIKAT", `Resi ${resi} ditolak: ${info}`);

      return {
        ok: false,
        outcome: "duplicate",
        duplicateInfo: info,
        message: `Resi ${resi} sudah pernah di-scan.`,
      };
    }
  });
}

// ─── GET /api/scan ───────────────────────────────────────────────────────────

/**
 * GET /api/scan?karungId=...            → isi satu karung
 * GET /api/scan?date=YYYY-MM-DD         → semua scan satu tanggal
 * GET /api/scan?dateFrom=..&dateTo=..   → rentang tanggal
 *
 * Tambahan opsional: &expedisiId=..  &includeVoided=1  &limit=..
 *
 * Menggantikan tiga hal sekaligus dari sistem lama: query Firestore yang
 * menarik seluruh dokumen lalu memfilter di klien, pembacaan G-Sheet oleh
 * halaman Data, dan batas diam-diam 60 tab di multi-read.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const q = req.nextUrl.searchParams;

    const karungId = q.get("karungId");
    const date = q.get("date");
    const dateFrom = q.get("dateFrom");
    const dateTo = q.get("dateTo");
    const expedisiId = q.get("expedisiId");
    const includeVoided = q.get("includeVoided") === "1";
    const limit = Math.min(Number(q.get("limit")) || 5000, 20000);

    const where: Record<string, unknown> = {};
    if (!includeVoided) where.status = "success";
    if (expedisiId) where.expedisiId = expedisiId;

    if (karungId) {
      where.karungId = karungId;
    } else if (date) {
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
      throw badRequest("Sertakan karungId, date, atau dateFrom/dateTo.");
    }

    const rows = await prisma.scan.findMany({
      where,
      include: INCLUDE,
      orderBy: [{ date: "asc" }, { scannedAt: "asc" }],
      take: limit,
    });

    return {
      rows: rows.map(toScanRecord),
      total: rows.length,
      // Kalau hasilnya persis sama dengan limit, kemungkinan ada yang
      // terpotong. Sistem lama memotong diam-diam; di sini diberitahukan.
      terpotong: rows.length === limit,
    };
  });
}
