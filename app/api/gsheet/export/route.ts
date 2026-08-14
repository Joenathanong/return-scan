import { NextRequest } from "next/server";
import { google } from "googleapis";
import { prisma } from "@/lib/db";
import { handle, requireUser, badRequest, writeAudit } from "@/lib/api";
import { bacaSettings } from "@/lib/settings";
import { sheetTabName, sheetDateName, timeWIB, isValidDate, todayWIB } from "@/lib/date";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const HEADER = ["No.", "Kode Resi", "No. Karung", "Di Scan Oleh", "Tanggal", "Jam"];

function getAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
    key: (process.env.GOOGLE_SHEETS_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

/**
 * POST /api/gsheet/export   body: { date: "YYYY-MM-DD", expedisiId?: string }
 *
 * ═══ INI PENGGANTI SELURUH MEKANISME SYNC LAMA ═══
 *
 * Sistem lama menulis SATU BARIS PER SCAN dengan `values.append`. Pada
 * kecepatan scan normal itu menembus batas 60 tulis/menit per service
 * account, gagal diam-diam, dan meninggalkan data yang ada di database tapi
 * tidak ada di sheet. Retry-nya pun berjeda 1–2 detik, masih di dalam
 * jendela kuota yang sama, jadi ketiganya gagal bersamaan.
 *
 * Cara baru: satu tab ditulis ULANG SELURUHNYA dari database.
 *
 *   • Biaya: 2 panggilan API per tab per ekspor — bukan satu per resi.
 *     Satu hari dengan 3.000 resi di 17 ekspedisi = ~35 panggilan.
 *   • Idempoten: dijalankan sepuluh kali hasilnya sama persis. Tidak ada
 *     duplikat, tidak ada baris tertinggal.
 *   • Tidak ada jalur kritis: kalau Google sedang bermasalah, scan tetap
 *     berjalan normal. Ekspor tinggal diulang nanti.
 *
 * Isi tab SELALU mencerminkan database apa adanya. Resi yang dibatalkan
 * (`voided`) otomatis hilang dari sheet pada ekspor berikutnya.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const me = await requireUser();
    const body = (await req.json()) as { date?: string; expedisiId?: string };

    const date = String(body.date ?? todayWIB());
    if (!isValidDate(date)) throw badRequest("Format tanggal harus YYYY-MM-DD.");

    const settings = await bacaSettings();
    if (!settings.spreadsheetId) {
      throw badRequest(
        "Spreadsheet ID belum diisi. Buka Admin → Pengaturan untuk mengisinya. " +
          "Ekspor G-Sheet bersifat opsional — aplikasi tetap berjalan penuh tanpanya."
      );
    }
    if (!process.env.GOOGLE_SHEETS_CLIENT_EMAIL || !process.env.GOOGLE_SHEETS_PRIVATE_KEY) {
      throw badRequest(
        "Kredensial Google Sheets belum diatur di .env " +
          "(GOOGLE_SHEETS_CLIENT_EMAIL dan GOOGLE_SHEETS_PRIVATE_KEY)."
      );
    }

    const spreadsheetId = settings.spreadsheetId;

    // ── Ambil semua scan tanggal itu, dikelompokkan per ekspedisi ────────────
    const scans = await prisma.scan.findMany({
      where: {
        date,
        status: "success",
        ...(body.expedisiId ? { expedisiId: body.expedisiId } : {}),
      },
      include: {
        karung: { select: { nomorKarung: true } },
        expedisi: { select: { id: true, code: true, name: true } },
        scannedBy: { select: { name: true } },
      },
      orderBy: [{ expedisiId: "asc" }, { karungId: "asc" }, { scannedAt: "asc" }],
    });

    if (scans.length === 0) {
      return {
        ok: true,
        tanggal: date,
        tab: [],
        pesan: "Tidak ada resi pada tanggal ini — tidak ada yang perlu diekspor.",
      };
    }

    const perTab = new Map<
      string,
      { code: string; name: string; expedisiId: string; rows: string[][] }
    >();

    for (const s of scans) {
      const tab = sheetTabName(s.expedisi.code, date);
      if (!perTab.has(tab)) {
        perTab.set(tab, {
          code: s.expedisi.code,
          name: s.expedisi.name,
          expedisiId: s.expedisi.id,
          rows: [],
        });
      }
      const g = perTab.get(tab)!;
      g.rows.push([
        String(g.rows.length + 1),
        s.noResi,
        s.karung.nomorKarung,
        s.scannedBy.name,
        sheetDateName(s.date),
        timeWIB(s.scannedAt),
      ]);
    }

    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    // ── Buat tab yang belum ada — SATU batchUpdate untuk semuanya ────────────
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties(title,sheetId)",
    });
    const adaTab = new Map(
      (meta.data.sheets ?? []).map((s) => [s.properties?.title ?? "", s.properties?.sheetId])
    );

    const perluDibuat = [...perTab.keys()].filter((t) => !adaTab.has(t));
    if (perluDibuat.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: perluDibuat.map((title) => ({
            addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } },
          })),
        },
      });
      const metaBaru = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: "sheets.properties(title,sheetId)",
      });
      for (const s of metaBaru.data.sheets ?? []) {
        adaTab.set(s.properties?.title ?? "", s.properties?.sheetId);
      }
    }

    // ── Tulis ulang setiap tab ───────────────────────────────────────────────
    const hasil: {
      tab: string; baris: number; status: "ok" | "failed"; error?: string;
    }[] = [];

    for (const [tab, g] of perTab) {
      try {
        // 1. Kosongkan tab. Wajib — kalau ekspor sebelumnya menghasilkan
        //    lebih banyak baris, sisanya akan tertinggal dan terbaca sebagai
        //    data hantu.
        await sheets.spreadsheets.values.clear({
          spreadsheetId,
          range: `'${tab}'!A:F`,
        });

        // 2. Tulis header + seluruh data dalam satu panggilan.
        //    USER_ENTERED dihindari: resi berawalan nol atau berbentuk angka
        //    panjang bisa diubah Google jadi bilangan dan kehilangan digit.
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${tab}'!A1`,
          valueInputOption: "RAW",
          requestBody: { values: [HEADER, ...g.rows] },
        });

        hasil.push({ tab, baris: g.rows.length, status: "ok" });

        await prisma.sheetExport.create({
          data: {
            tabName: tab,
            date,
            expedisiId: g.expedisiId,
            rowCount: g.rows.length,
            status: "ok",
            exportedBy: me.id,
          },
        });
      } catch (err) {
        const pesan = String((err as Error)?.message ?? err).slice(0, 500);
        hasil.push({ tab, baris: g.rows.length, status: "failed", error: pesan });
        await prisma.sheetExport.create({
          data: {
            tabName: tab, date, expedisiId: g.expedisiId,
            rowCount: g.rows.length, status: "failed",
            error: pesan, exportedBy: me.id,
          },
        });
      }
    }

    const berhasil = hasil.filter((h) => h.status === "ok").length;
    const gagal = hasil.length - berhasil;

    await writeAudit(
      me.id, me.name, "EXPORT_GSHEET",
      `Ekspor ${date}: ${berhasil} tab berhasil, ${gagal} gagal, ${scans.length} resi`
    );

    return {
      ok: gagal === 0,
      tanggal: date,
      totalResi: scans.length,
      berhasil,
      gagal,
      tab: hasil,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    };
  });
}

/** GET /api/gsheet/export?date=... — riwayat ekspor untuk satu tanggal. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const date = req.nextUrl.searchParams.get("date") ?? todayWIB();
    if (!isValidDate(date)) throw badRequest("Format tanggal harus YYYY-MM-DD.");

    const rows = await prisma.sheetExport.findMany({
      where: { date },
      orderBy: { exportedAt: "desc" },
      take: 100,
    });

    return {
      rows: rows.map((r) => ({
        id: r.id,
        tabName: r.tabName,
        date: r.date,
        rowCount: r.rowCount,
        status: r.status,
        error: r.error,
        exportedAt: r.exportedAt.toISOString(),
      })),
    };
  });
}
