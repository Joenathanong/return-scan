import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { handle, requireUser, requireAdmin, badRequest, writeAudit } from "@/lib/api";
import { bacaSettings, ambilSpreadsheetId } from "@/lib/settings";
import { KODE_RE, PESAN_KODE_TIDAK_VALID } from "@/lib/expedisi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface EntriConfig {
  spreadsheetId: string;
  url: string;
  expedisiId: string | null;
  expedisiName: string | null;
}

/**
 * Konfigurasi modul Claim.
 *
 * Dulu tersimpan di Firestore pada dokumen `settings/claim`. Sekarang di
 * tabel `claim_expedisi_sheets`, tetap DIKUNCI PER KODE (bukan per id
 * ekspedisi) supaya kode hasil deteksi prefix resi yang belum terdaftar di
 * master ekspedisi tetap bisa disimpan — lihat catatan di schema.prisma.
 *
 * Bentuk respons dipertahankan sama seperti versi Firestore
 * (`{ masterSpreadsheetId, expedisiSheets }` dengan kunci kode ekspedisi)
 * supaya halaman Claim tidak perlu diubah strukturnya.
 */
async function bacaConfig() {
  const [settings, sheets] = await Promise.all([
    bacaSettings(),
    prisma.claimExpedisiSheet.findMany({
      include: { expedisi: { select: { name: true } } },
      orderBy: { code: "asc" },
    }),
  ]);

  const expedisiSheets: Record<string, EntriConfig> = {};
  for (const s of sheets) {
    expedisiSheets[s.code] = {
      spreadsheetId: s.spreadsheetId,
      url: s.url,
      expedisiId: s.expedisiId,
      expedisiName: s.expedisi?.name ?? null,
    };
  }

  return {
    masterSpreadsheetId: settings.claimMasterSpreadsheetId,
    expedisiSheets,
  };
}

export async function GET() {
  return handle(async () => {
    await requireUser();
    return bacaConfig();
  });
}

/**
 * PATCH — simpan master sheet dan/atau sheet per kode ekspedisi.
 *
 * body: {
 *   masterSpreadsheetId?: string,
 *   sheet?:  { code: string, spreadsheetId: string, url?: string },
 *   sheets?: Array<{ code: string, spreadsheetId: string, url?: string }>,
 *   hapusCode?: string,
 * }
 *
 * `sheets` (jamak) dipakai halaman upload untuk menyimpan beberapa sheet
 * yang dibuat otomatis sekaligus, dalam satu panggilan.
 */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const me = await requireAdmin();
    const body = (await req.json()) as {
      masterSpreadsheetId?: string;
      sheet?: { code?: string; spreadsheetId?: string; url?: string };
      sheets?: { code?: string; spreadsheetId?: string; url?: string }[];
      hapusCode?: string;
    };

    if (body.masterSpreadsheetId !== undefined) {
      const id = ambilSpreadsheetId(body.masterSpreadsheetId);
      await bacaSettings();
      await prisma.settings.update({
        where: { id: 1 },
        data: { claimMasterSpreadsheetId: id, updatedBy: me.id },
      });
      await writeAudit(
        me.id, me.name, "CLAIM_MASTER_SHEET",
        `Set master sheet claim: ${id || "(dikosongkan)"}`
      );
    }

    const daftar = [
      ...(body.sheet ? [body.sheet] : []),
      ...(body.sheets ?? []),
    ];

    for (const item of daftar) {
      const code = String(item.code ?? "").trim().toUpperCase();
      if (!KODE_RE.test(code)) {
        throw badRequest(`Kode "${code || "(kosong)"}" tidak valid. ${PESAN_KODE_TIDAK_VALID}`);
      }

      const spreadsheetId = ambilSpreadsheetId(String(item.spreadsheetId ?? ""));
      if (!spreadsheetId) throw badRequest(`Spreadsheet ID untuk ${code} wajib diisi.`);

      const url =
        String(item.url ?? "").trim() ||
        `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

      // Hubungkan ke master ekspedisi kalau kodenya memang terdaftar.
      // Kalau tidak, konfigurasinya tetap tersimpan tanpa relasi.
      const exp = await prisma.expedisi.findUnique({
        where: { code },
        select: { id: true },
      });

      // expedisiId unik — kalau kode lain sudah memakainya, biarkan NULL
      // daripada menggagalkan penyimpanan.
      let expedisiId: string | null = exp?.id ?? null;
      if (expedisiId) {
        const dipakai = await prisma.claimExpedisiSheet.findFirst({
          where: { expedisiId, code: { not: code } },
          select: { code: true },
        });
        if (dipakai) expedisiId = null;
      }

      await prisma.claimExpedisiSheet.upsert({
        where: { code },
        create: { code, expedisiId, spreadsheetId, url },
        update: { expedisiId, spreadsheetId, url },
      });
    }

    if (daftar.length > 0) {
      await writeAudit(
        me.id, me.name, "CLAIM_SHEET",
        `Simpan sheet claim: ${daftar.map((d) => d.code).join(", ")}`
      );
    }

    if (body.hapusCode) {
      const code = String(body.hapusCode).trim().toUpperCase();
      await prisma.claimExpedisiSheet.deleteMany({ where: { code } });
      await writeAudit(me.id, me.name, "CLAIM_SHEET_HAPUS", `Hapus sheet claim ${code}`);
    }

    // Kembalikan konfigurasi terbaru supaya klien tidak perlu meminta ulang.
    return bacaConfig();
  });
}
