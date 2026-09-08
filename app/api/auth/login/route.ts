import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword, signSession, buatSid } from "@/lib/crypto";
import { labelPerangkat } from "@/lib/perangkat";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  writeAudit,
} from "@/lib/api";
import type { SessionUser, UserRole } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/login
 *
 * Pesan error untuk email tidak ada dan password salah sengaja DISAMAKAN
 * ("Email atau password salah") supaya tidak bisa dipakai menebak email mana
 * yang terdaftar.
 *
 * Kesalahan KONFIGURASI diperlakukan sebaliknya: dijelaskan sejelas mungkin.
 * Menyembunyikannya tidak menambah keamanan sedikit pun — penyerang tidak
 * mendapat apa-apa dari tahu bahwa SESSION_SECRET belum diisi — sementara
 * admin yang sedang memasang sistem jadi buta total. Sebelumnya semua error
 * di sini dibalas "Gagal memproses login.", dan itu membuat kesalahan
 * environment variable mustahil dibedakan dari password yang keliru.
 */
export async function POST(req: NextRequest) {
  // ── Periksa konfigurasi lebih dulu, sebelum menyentuh database ──────────
  const rahasia = process.env.SESSION_SECRET ?? "";
  if (!rahasia) {
    console.error("[scan-retur] SESSION_SECRET belum diisi");
    return NextResponse.json(
      {
        error:
          "Server belum dikonfigurasi: SESSION_SECRET belum diisi. " +
          "Tambahkan di Vercel → Settings → Environment Variables, lalu deploy ulang.",
        code: "CONFIG_SESSION_SECRET",
      },
      { status: 500 }
    );
  }
  if (rahasia.length < 32) {
    console.error(`[scan-retur] SESSION_SECRET hanya ${rahasia.length} karakter`);
    return NextResponse.json(
      {
        error:
          `Server belum dikonfigurasi: SESSION_SECRET hanya ${rahasia.length} ` +
          "karakter, minimal 32. Perbarui di Vercel lalu deploy ulang.",
        code: "CONFIG_SESSION_SECRET",
      },
      { status: 500 }
    );
  }
  if (!process.env.DATABASE_URL) {
    console.error("[scan-retur] DATABASE_URL belum diisi");
    return NextResponse.json(
      {
        error:
          "Server belum dikonfigurasi: DATABASE_URL belum diisi. " +
          "Tambahkan di Vercel → Settings → Environment Variables, lalu deploy ulang.",
        code: "CONFIG_DATABASE_URL",
      },
      { status: 500 }
    );
  }

  let email = "";
  try {
    const body = (await req.json()) as { email?: string; password?: string };
    email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email dan password wajib diisi." },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({ where: { email } });

    // Perbandingan tetap dijalankan walau user tidak ada, memakai hash palsu,
    // supaya lama respons tidak membocorkan apakah email itu terdaftar.
    const stored =
      user?.passwordHash ??
      "scrypt$0000000000000000000000000000000000000000000000000000000000000000$00";
    const cocok = verifyPassword(password, stored);

    if (!user || !cocok) {
      await writeAudit(null, email || "(kosong)", "LOGIN_GAGAL", `Login gagal: ${email}`);
      return NextResponse.json(
        { error: "Email atau password salah." },
        { status: 401 }
      );
    }

    if (!user.active) {
      await writeAudit(user.id, user.name, "LOGIN_DITOLAK", "Akun nonaktif");
      return NextResponse.json(
        { error: "Akun Anda dinonaktifkan. Hubungi admin." },
        { status: 403 }
      );
    }

    const role: UserRole = user.role === "admin" ? "admin" : "operator";

    // ── Login satu perangkat ────────────────────────────────────────────
    // `sid` baru dibuat SETIAP login dan menimpa `sesi_aktif`. Perangkat
    // yang tadinya login memegang sid lama; permintaan berikutnya darinya
    // akan ditolak requireUser() dengan kode SESI_DIGANTI.
    //
    // Arahnya sengaja "login terbaru menang", bukan "login pertama
    // bertahan". Kalau yang lama bertahan, PDT yang mati tanpa logout akan
    // mengunci akun itu sampai 12 jam ke depan dan operator tidak bisa
    // bekerja — sedangkan dengan arah ini, ia cukup login lagi.
    const sid = buatSid();
    const perangkat = labelPerangkat(req.headers.get("user-agent"));

    const token = signSession(
      { uid: user.id, email: user.email, name: user.name, role, sid },
      SESSION_MAX_AGE
    );

    const sesiSebelumnya = user.sesiAktif;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLogin: new Date(),
        sesiAktif: sid,
        perangkatLabel: perangkat,
        sesiSejak: new Date(),
      },
    });
    await writeAudit(
      user.id,
      user.name,
      "LOGIN",
      sesiSebelumnya
        ? `Login berhasil (${perangkat}) — sesi di perangkat sebelumnya diakhiri`
        : `Login berhasil (${perangkat})`
    );

    const sessionUser: SessionUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role,
      mustChangePassword: user.mustChangePassword,
      bisaBongkaran: user.role === "admin" || user.bisaBongkaran,
      bisaCancelOrder: user.role === "admin" || user.bisaCancelOrder,
    };

    const res = NextResponse.json({ user: sessionUser });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,      // tidak bisa dibaca JavaScript — beda dari sistem
                           // lama yang menaruh uid di cookie biasa
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    return res;
  } catch (err) {
    const e = err as { code?: string; message?: string };
    const pesan = String(e?.message ?? err);

    // Selalu catat lengkap ke log server — inilah yang terbaca di Vercel.
    console.error("[scan-retur] login error:", err);

    // Database tidak terjangkau / kredensial salah → beri tahu apa adanya.
    if (/insecure transport|1105/i.test(pesan)) {
      return NextResponse.json(
        {
          error:
            "TiDB menolak koneksi karena tidak memakai TLS. Tambahkan " +
            "?sslaccept=strict pada DATABASE_URL di Vercel, lalu deploy ulang.",
          code: "DB_NO_TLS",
        },
        { status: 503 }
      );
    }
    if (
      e?.code === "P1001" || e?.code === "P1017" ||
      /Can't reach database server|ECONNREFUSED|ETIMEDOUT/i.test(pesan)
    ) {
      return NextResponse.json(
        {
          error:
            "Server tidak bisa menghubungi database. Periksa DATABASE_URL " +
            "dan IP Access List di TiDB Cloud. Buka /api/health untuk rincian.",
          code: "DB_UNREACHABLE",
        },
        { status: 503 }
      );
    }
    if (/Access denied|authentication failed/i.test(pesan)) {
      return NextResponse.json(
        {
          error:
            "Kredensial database ditolak. Password di DATABASE_URL salah, atau " +
            "karakter khususnya belum di-URL-encode (@ jadi %40).",
          code: "DB_AUTH",
        },
        { status: 503 }
      );
    }
    if (/does not exist|Unknown table|relation .* does not exist|P2021/i.test(pesan)) {
      return NextResponse.json(
        {
          error:
            "Tabel database belum dibuat. Jalankan `npm run db:push` dari " +
            "komputer Anda ke database yang sama.",
          code: "DB_NO_TABLE",
        },
        { status: 503 }
      );
    }
    if (/did not initialize|@prisma\/client|prisma generate/i.test(pesan)) {
      return NextResponse.json(
        {
          error:
            "Prisma Client tidak ter-generate saat build. Pastikan package.json " +
            'memuat "build": "prisma generate && next build", lalu deploy ulang.',
          code: "PRISMA_NOT_GENERATED",
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        error: "Gagal memproses login. Buka /api/health untuk memeriksa server.",
        code: "UNKNOWN",
      },
      { status: 500 }
    );
  }
}
