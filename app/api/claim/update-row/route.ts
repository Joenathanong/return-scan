import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getClaimAuth, FIELD_COL } from "@/lib/claim-gsheet";

/**
 * PATCH /api/claim/update-row
 *
 * Body: { spreadsheetId, tab, gsheetRow, field, value }
 */
export async function PATCH(req: NextRequest) {
  try {
    const { spreadsheetId: bodyId, tab, gsheetRow, field, value } = await req.json();
    const spreadsheetId = bodyId || process.env.CLAIM_SPREADSHEET_ID;

    if (!spreadsheetId || !tab || !gsheetRow || !field || value === undefined) {
      return NextResponse.json(
        { error: "Field wajib: spreadsheetId, tab, gsheetRow, field, value" },
        { status: 400 }
      );
    }

    const col = FIELD_COL[field];
    if (!col) {
      return NextResponse.json(
        { error: `Field tidak dikenal: ${field}` },
        { status: 400 }
      );
    }

    const auth   = getClaimAuth();
    const sheets = google.sheets({ version: "v4", auth });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range:            `'${tab}'!${col}${gsheetRow}`,
      valueInputOption: "RAW",
      requestBody:      { values: [[String(value)]] },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Claim update-row error:", err);
    return NextResponse.json(
      { error: "Gagal update data", detail: String(err) },
      { status: 500 }
    );
  }
}
