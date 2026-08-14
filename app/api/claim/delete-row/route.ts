import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getClaimAuth, getTabList } from "@/lib/claim-gsheet";

/**
 * DELETE /api/claim/delete-row
 *
 * Hapus satu baris dari spreadsheet tertentu, lalu renumber kolom A.
 * Master dan expedisi sheet adalah file terpisah — hapus dari satu
 * tidak otomatis menghapus dari yang lain.
 *
 * Body: { spreadsheetId, tab, gsheetRow }
 */
export async function DELETE(req: NextRequest) {
  try {
    const { spreadsheetId, tab, gsheetRow } = await req.json();

    if (!spreadsheetId || !tab || !gsheetRow) {
      return NextResponse.json(
        { error: "Field wajib: spreadsheetId, tab, gsheetRow" },
        { status: 400 }
      );
    }

    const auth   = getClaimAuth();
    const sheets = google.sheets({ version: "v4", auth });

    // Cari sheetId dari nama tab
    const tabs    = await getTabList(sheets, spreadsheetId);
    const tabMeta = tabs.find((t) => t.title === tab);
    if (!tabMeta) {
      return NextResponse.json(
        { error: `Tab "${tab}" tidak ditemukan` },
        { status: 404 }
      );
    }

    // Hapus baris
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId:    tabMeta.sheetId,
                dimension:  "ROWS",
                startIndex: gsheetRow - 1,
                endIndex:   gsheetRow,
              },
            },
          },
        ],
      },
    });

    // Renumber kolom A
    const colA     = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tab}'!A:A`,
    });
    const dataCount = Math.max(0, (colA.data.values?.length ?? 1) - 1);
    if (dataCount > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range:            `'${tab}'!A2:A${dataCount + 1}`,
        valueInputOption: "RAW",
        requestBody:      { values: Array.from({ length: dataCount }, (_, i) => [i + 1]) },
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Claim delete-row error:", err);
    return NextResponse.json(
      { error: "Gagal hapus baris", detail: String(err) },
      { status: 500 }
    );
  }
}
