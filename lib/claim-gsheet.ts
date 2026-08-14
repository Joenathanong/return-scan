/**
 * Shared helpers untuk Claim G-Sheet.
 *
 * Arsitektur:
 *   - 1 Master Spreadsheet  → tab "ALL", semua data dari semua expedisi
 *   - N Expedisi Spreadsheets → masing-masing 1 file G-Sheet terpisah,
 *     1 tab bernama kode expedisi (mis. "JX", "SPXID", "GTL")
 *   - ID-ID tersimpan di Firestore: settings/claim
 */

import { google } from "googleapis";

// ── Column layout ──────────────────────────────────────────────────────────
// A: No.  B: No.Pesanan/Resi  C: Barcode  D: No.Item  E: SKU
// F: Qty  G: Kondisi  H: Batch  I: Exp.Date  J: Created By
// K: Created Date  L: Expedisi

export const CLAIM_HEADER = [
  "No.", "No. Pesanan/Resi", "Barcode Scan", "No. Item", "SKU",
  "Qty", "Kondisi", "Batch", "Exp. Date", "Created By", "Created Date", "Expedisi",
];

export const FIELD_COL: Record<string, string> = {
  noResi:      "B",
  barcode:     "C",
  noItem:      "D",
  sku:         "E",
  qty:         "F",
  kondisi:     "G",
  batch:       "H",
  expDate:     "I",
  createdBy:   "J",
  createdDate: "K",
  expedisi:    "L",
};

export interface ClaimRow {
  noResi:      string;
  barcode:     string;
  noItem:      string;
  sku:         string;
  qty:         string;
  kondisi:     string;
  batch:       string;
  expDate:     string;
  createdBy:   string;
  createdDate: string;
  expedisi:    string;
}

export interface ClaimSheetRow extends ClaimRow {
  gsheetRow: number;
  no:        string;
}

// ── Auth (dengan Drive scope untuk create & share spreadsheet baru) ────────

export function getClaimAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
    key:   (process.env.GOOGLE_SHEETS_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.file", // create + share files
    ],
  });
}

// ── Expedisi detection ────────────────────────────────────────────────────
// Re-export dari lib/expedisi-map.ts (pure data — bisa dipakai client & server)
export { detectExpedisi, getPrefixesForExpedisi } from "./expedisi-map";
// PREFIX_MAP digunakan secara internal di expedisi-map; tidak perlu di-export ulang

// ── Dedup key ─────────────────────────────────────────────────────────────
// 1 resi bisa punya banyak SKU (multi-line) → key = noResi + noItem
// Jika noItem kosong, fallback ke noResi + SKU + barcode

export function dedupKey(noResi: string, noItem: string, sku = "", barcode = ""): string {
  const r = String(noResi).trim();
  const i = String(noItem).trim();
  if (i && i !== "0" && i.toLowerCase() !== "undefined") return `${r}||${i}`;
  return `${r}||${sku}||${barcode}`;
}

// ── Tab management ────────────────────────────────────────────────────────

export async function getTabList(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string
): Promise<{ title: string; sheetId: number }[]> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(title,sheetId)",
  });
  return (meta.data.sheets || []).map((s) => ({
    title:   s.properties?.title   ?? "",
    sheetId: s.properties?.sheetId ?? 0,
  }));
}

export async function ensureClaimTab(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  tabName: string,
  existingTabs?: { title: string; sheetId: number }[]
): Promise<number> {
  const tabs  = existingTabs ?? await getTabList(sheets, spreadsheetId);
  const found = tabs.find((t) => t.title === tabName);
  if (found) return found.sheetId;

  // Create tab
  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        { addSheet: { properties: { title: tabName, gridProperties: { frozenRowCount: 1 } } } },
      ],
    },
  });
  const newSheetId = res.data.replies?.[0]?.addSheet?.properties?.sheetId ?? 0;

  // Write header
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range:            `'${tabName}'!A1:L1`,
    valueInputOption: "RAW",
    requestBody:      { values: [CLAIM_HEADER] },
  });

  // Format header
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId: newSheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.11, green: 0.18, blue: 0.33 },
                textFormat:      { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
                horizontalAlignment: "CENTER",
              },
            },
            fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
          },
        },
      ],
    },
  });

  return newSheetId;
}

// ── Create new expedisi spreadsheet (auto-generate) ───────────────────────

export async function createExpedisiSpreadsheet(
  sheets: ReturnType<typeof google.sheets>,
  expedisiCode: string
): Promise<{ spreadsheetId: string; url: string }> {
  // Buat spreadsheet baru
  const res = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: `Claim Retur - ${expedisiCode}` },
    },
  });
  const spreadsheetId = res.data.spreadsheetId!;

  // Buat tab dengan nama expedisi + header
  await ensureClaimTab(sheets, spreadsheetId, expedisiCode);

  // Share: anyone with link dapat edit (supaya tim bisa akses)
  try {
    const auth  = getClaimAuth();
    const drive = google.drive({ version: "v3", auth });
    await drive.permissions.create({
      fileId:      spreadsheetId,
      requestBody: { role: "writer", type: "anyone" },
    });
  } catch (err) {
    // Jika sharing gagal, spreadsheet tetap terbuat tapi perlu di-share manual
    console.warn("Gagal share spreadsheet:", err);
  }

  return {
    spreadsheetId,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
  };
}

// ── Read existing dedup keys dari master ALL tab ──────────────────────────

export async function readExistingKeys(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string
): Promise<Set<string>> {
  const keys = new Set<string>();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'ALL'!B:D", // B=noResi, C=barcode, D=noItem
    });
    const rows = res.data.values || [];
    for (let i = 1; i < rows.length; i++) {
      const noResi  = String(rows[i]?.[0] ?? "").trim();
      const barcode = String(rows[i]?.[1] ?? "").trim();
      const noItem  = String(rows[i]?.[2] ?? "").trim();
      if (noResi) keys.add(dedupKey(noResi, noItem, "", barcode));
    }
  } catch { /* ALL tab belum ada */ }
  return keys;
}

// ── Get row count (data rows) di satu tab ─────────────────────────────────

export async function getTabDataCount(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  tabName: string
): Promise<number> {
  try {
    const res  = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabName}'!A:A`,
    });
    const rows = res.data.values || [];
    return rows.filter((r) => r[0] && !isNaN(Number(r[0]))).length;
  } catch { return 0; }
}

// Append rows to a tab
export async function appendClaimRows(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  tabName: string,
  rows: ClaimRow[],
  startNo: number
): Promise<void> {
  if (rows.length === 0) return;
  const values = rows.map((r, i) => [
    startNo + i,
    r.noResi,
    r.barcode,
    r.noItem,
    r.sku,
    r.qty,
    r.kondisi,
    r.batch,
    r.expDate,
    r.createdBy,
    r.createdDate,
    r.expedisi,
  ]);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range:            `'${tabName}'!A:L`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody:      { values },
  });
}
