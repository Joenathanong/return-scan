import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getClaimAuth, type ClaimSheetRow } from "@/lib/claim-gsheet";

/**
 * GET /api/claim/read
 *
 * Membaca baris dari satu tab di spreadsheet claim.
 *
 * Query params:
 *   spreadsheetId — Google Sheets ID
 *   tab           — nama tab (mis. ALL, JX, SPXID)
 *   sortDir       — "asc" | "desc" (default: desc — terbaru dulu)
 *   search        — string pencarian (noResi / SKU / kondisi)
 */
export async function GET(req: NextRequest) {
  try {
    const params       = new URL(req.url).searchParams;
    const spreadsheetId =
      params.get("spreadsheetId") || process.env.CLAIM_SPREADSHEET_ID;
    const tab    = params.get("tab") || "ALL";
    const sortDir = params.get("sortDir") === "asc" ? "asc" : "desc";
    const search  = (params.get("search") || "").trim().toUpperCase();

    if (!spreadsheetId) {
      return NextResponse.json({ error: "spreadsheetId wajib" }, { status: 400 });
    }

    const auth   = getClaimAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const res  = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tab}'!A:L`,
    });
    const rawRows = res.data.values || [];

    // rawRows[0] = header (gsheetRow 1), data starts at rawRows[1]
    const rows: ClaimSheetRow[] = [];
    for (let i = 1; i < rawRows.length; i++) {
      const r = rawRows[i];
      if (!r || (!r[0] && !r[1])) continue; // skip completely empty rows

      const row: ClaimSheetRow = {
        gsheetRow:   i + 1, // 1-based
        no:          String(r[0]  ?? ""),
        noResi:      String(r[1]  ?? ""),
        barcode:     String(r[2]  ?? ""),
        noItem:      String(r[3]  ?? ""),
        sku:         String(r[4]  ?? ""),
        qty:         String(r[5]  ?? ""),
        kondisi:     String(r[6]  ?? ""),
        batch:       String(r[7]  ?? ""),
        expDate:     String(r[8]  ?? ""),
        createdBy:   String(r[9]  ?? ""),
        createdDate: String(r[10] ?? ""),
        expedisi:    String(r[11] ?? ""),
      };

      if (search) {
        const haystack = `${row.noResi} ${row.sku} ${row.kondisi} ${row.noItem} ${row.expedisi}`.toUpperCase();
        if (!haystack.includes(search)) continue;
      }

      rows.push(row);
    }

    // Sort by Created Date (col K index 10 = createdDate field)
    rows.sort((a, b) => {
      const da = new Date(a.createdDate).getTime() || 0;
      const db = new Date(b.createdDate).getTime() || 0;
      return sortDir === "asc" ? da - db : db - da;
    });

    return NextResponse.json({ rows, total: rows.length });
  } catch (err) {
    console.error("Claim read error:", err);
    return NextResponse.json(
      { error: "Gagal membaca data", detail: String(err) },
      { status: 500 }
    );
  }
}
