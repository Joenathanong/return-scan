import { NextResponse } from "next/server";
import { SESSION_COOKIE, getSession, writeAudit } from "@/lib/api";

export const runtime = "nodejs";

export async function POST() {
  const s = await getSession();
  if (s) await writeAudit(s.uid, s.name, "LOGOUT", "Logout");

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
