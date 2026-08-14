import { prisma } from "@/lib/db";
import type { CompanySettings } from "@/types";

export const DEFAULT_NOTE =
  "Seluruh karung yang diserahkan sudah di scan dan disaksikan oleh pihak yang menyerahkan barang. " +
  "tanda terima ini menjadi bukti yang sah, untuk tanda terima barang dari expedisi ke PT. IEG";

/**
 * Baca settings; buat baris default kalau belum ada.
 *
 * Dipisah ke lib (bukan diekspor dari route.ts) karena Next.js App Router
 * hanya mengizinkan handler HTTP dan beberapa konstanta konfigurasi yang
 * diekspor dari file route — ekspor lain membuat build gagal.
 */
export async function bacaSettings(): Promise<CompanySettings> {
  let row = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!row) {
    row = await prisma.settings.create({
      data: {
        id: 1,
        namaPerusahaan: "PT. IEG",
        noteTandaTerima: DEFAULT_NOTE,
        spreadsheetId: "",
        claimMasterSpreadsheetId: "",
      },
    });
  }
  return {
    namaPerusahaan: row.namaPerusahaan,
    noteTandaTerima: row.noteTandaTerima,
    spreadsheetId: row.spreadsheetId,
    claimMasterSpreadsheetId: row.claimMasterSpreadsheetId,
    updatedAt: row.updatedAt?.toISOString() ?? null,
  };
}

/**
 * Terima ID spreadsheet maupun URL penuh.
 * Salah-tempel URL lengkap adalah kekeliruan yang paling sering terjadi.
 */
export function ambilSpreadsheetId(raw: string): string {
  const s = String(raw).trim();
  const cocok = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return cocok ? cocok[1] : s;
}
