import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getClaimAuth, getTabList } from "@/lib/claim-gsheet";

/**
 * GET /api/claim/tabs?spreadsheetId=...
 * Returns list of available tab names in the claim spreadsheet.
 */
export async function GET(req: NextRequest) {
  try {
    const spreadsheetId =
      new URL(req.url).searchParams.get("spreadsheetId") ||
      process.env.CLAIM_SPREADSHEET_ID;

    if (!spreadsheetId) {
      return NextResponse.json({ error: "spreadsheetId wajib" }, { status: 400 });
    }

    const auth   = getClaimAuth();
    const sheets = google.sheets({ version: "v4", auth });
    const tabs   = await getTabList(sheets, spreadsheetId);

    // Sort: ALL first, then alphabetically
    const sorted = tabs
      .map((t) => t.title)
      .filter(Boolean)
      .sort((a, b) => {
        if (a === "ALL") return -1;
        if (b === "ALL") return  1;
        return a.localeCompare(b);
      });

    return NextResponse.json({ tabs: sorted });
  } catch (err) {
    console.error("Claim tabs error:", err);
    return NextResponse.json(
      { error: "Gagal mengambil daftar tab", detail: String(err) },
      { status: 500 }
    );
  }
}
