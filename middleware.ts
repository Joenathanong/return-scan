import { NextResponse, type NextRequest } from "next/server";

/**
 * Middleware hanya melakukan pengalihan KASAR berdasarkan ada/tidaknya
 * cookie sesi. Ia SENGAJA tidak memverifikasi tanda tangan cookie.
 *
 * Alasannya teknis: middleware berjalan di Edge runtime yang tidak punya
 * `node:crypto`. Alasannya juga arsitektural: middleware bukan tempat yang
 * tepat untuk otorisasi. Setiap API route memanggil `requireUser()` /
 * `requireAdmin()` sendiri, yang memverifikasi HMAC cookie dan memastikan
 * akun masih aktif di database.
 *
 * Jadi cookie palsu paling banter membuat seseorang melihat kerangka
 * halaman kosong — semua data tetap ditolak 401 oleh API-nya.
 */

const COOKIE = "scan_retur_session";

/** Halaman yang boleh diakses tanpa login. */
const PUBLIC_PATHS = ["/login"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const punyaCookie = Boolean(req.cookies.get(COOKIE)?.value);
  const publik = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // Belum login & bukan halaman publik → ke /login, ingat tujuan awalnya
  if (!punyaCookie && !publik) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Sudah login tapi membuka /login → langsung ke dashboard
  if (punyaCookie && publik) {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Semua rute KECUALI:
     *   /api/*        — punya penjagaan sendiri lewat requireUser()
     *   /_next/*      — aset build
     *   file statis   — favicon, gambar, suara scan, dsb.
     */
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|ico|webp|mp3|wav)$).*)",
  ],
};
