import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, getSession, writeAudit } from "@/lib/api";

export const runtime = "nodejs";

/**
 * POST /api/auth/logout
 *
 * Selain menghapus cookie, ini juga mengosongkan `users.sesi_aktif` supaya
 * ikatan ke perangkat benar-benar lepas.
 *
 * PENTING — pengosongan itu HANYA dilakukan kalau `sid` di cookie masih sama
 * dengan yang tercatat di database. Tanpa syarat itu, perangkat lama yang
 * sudah tergusur (dan baru menyadarinya lalu menekan "Keluar") akan menghapus
 * sesi milik perangkat BARU yang sedang dipakai bekerja — operator tiba-tiba
 * terlempar ke halaman login tanpa sebab yang terlihat.
 */
export async function POST() {
  const s = await getSession();

  if (s) {
    if (s.sid) {
      // updateMany, bukan update: kalau sid tidak cocok, hasilnya 0 baris
      // dan tidak ada error — persis perilaku yang diinginkan.
      await prisma.user.updateMany({
        where: { id: s.uid, sesiAktif: s.sid },
        data: { sesiAktif: null, perangkatLabel: null, sesiSejak: null },
      });
    }
    await writeAudit(s.uid, s.name, "LOGOUT", "Logout");
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
