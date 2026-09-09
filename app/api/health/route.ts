import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/health — diagnosa mandiri, TANPA login.
 *
 * Dipakai saat aplikasi tidak merespons dan pesan errornya tidak informatif
 * (mis. "Failed to fetch" di halaman login, yang artinya fungsi server tidak
 * menjawab sama sekali sehingga tidak ada pesan apa pun yang bisa dibaca).
 *
 * Endpoint ini memisahkan tiga kemungkinan yang gejalanya mirip:
 *   1. Environment variable belum diisi di Vercel
 *   2. Prisma Client tidak ter-generate saat build
 *   3. Database tidak bisa dihubungi dari server
 *
 * KEAMANAN: tidak pernah mengembalikan nilai rahasia. Untuk setiap variabel
 * hanya dilaporkan ada/tidak dan panjangnya. Host dan nama database ikut
 * ditampilkan karena keduanya bukan rahasia dan sangat membantu memastikan
 * server menunjuk database yang benar — password selalu dibuang.
 */

/** Ambil host & nama database dari DATABASE_URL, buang kredensialnya. */
function bedahUrl(url: string | undefined) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return {
      protokol: u.protocol.replace(":", ""),
      host: u.hostname,
      port: u.port || "(default)",
      database: u.pathname.replace(/^\//, "") || "(kosong)",
      punyaSsl: u.searchParams.has("sslaccept"),
      connectionLimit: u.searchParams.get("connection_limit") ?? "(tidak diset)",
    };
  } catch {
    return { error: "DATABASE_URL tidak bisa diurai sebagai URL yang sah" };
  }
}

const cek = (v: string | undefined) => ({
  ada: Boolean(v && v.length > 0),
  panjang: v?.length ?? 0,
});

export async function GET() {
  const mulai = Date.now();

  const env = {
    DATABASE_URL: cek(process.env.DATABASE_URL),
    SESSION_SECRET: {
      ...cek(process.env.SESSION_SECRET),
      cukupPanjang: (process.env.SESSION_SECRET?.length ?? 0) >= 32,
    },
    GOOGLE_SHEETS_CLIENT_EMAIL: cek(process.env.GOOGLE_SHEETS_CLIENT_EMAIL),
    GOOGLE_SHEETS_PRIVATE_KEY: cek(process.env.GOOGLE_SHEETS_PRIVATE_KEY),
    NODE_ENV: process.env.NODE_ENV ?? null,
    VERCEL_REGION: process.env.VERCEL_REGION ?? null,
  };

  const koneksi = bedahUrl(process.env.DATABASE_URL);

  const masalah: string[] = [];
  if (!env.DATABASE_URL.ada) {
    masalah.push("DATABASE_URL belum diisi di Environment Variables Vercel.");
  } else if (koneksi && !("error" in koneksi) && !koneksi.punyaSsl) {
    // Diperiksa dari URL-nya langsung, bukan menunggu koneksi gagal —
    // supaya penyebabnya tetap terlihat walau uji koneksi di bawah
    // menghasilkan pesan yang berbeda.
    masalah.push(
      "DATABASE_URL tidak memuat ?sslaccept=strict. TiDB Cloud menolak semua " +
        "koneksi tanpa TLS, jadi ini akan selalu gagal. Tambahkan " +
        "?sslaccept=strict tepat setelah nama database, lalu deploy ulang."
    );
  }
  if (!env.SESSION_SECRET.ada) {
    masalah.push("SESSION_SECRET belum diisi — login tidak akan pernah berhasil.");
  } else if (!env.SESSION_SECRET.cukupPanjang) {
    masalah.push(
      `SESSION_SECRET hanya ${env.SESSION_SECRET.panjang} karakter, minimal 32.`
    );
  }

  // ── Uji koneksi database ────────────────────────────────────────────────
  let database: Record<string, unknown> = { terhubung: false };
  if (env.DATABASE_URL.ada) {
    const t0 = Date.now();
    try {
      await prisma.$queryRawUnsafe("SELECT 1");
      const msPing = Date.now() - t0;

      let jumlahUser: number | null = null;
      let jumlahExpedisi: number | null = null;
      try {
        jumlahUser = await prisma.user.count();
        jumlahExpedisi = await prisma.expedisi.count();
      } catch (e) {
        masalah.push(
          "Terhubung ke database, tapi tabelnya belum ada. " +
            "Jalankan `npm run db:push` dari komputer Anda. " +
            `(${String((e as Error)?.message ?? e).slice(0, 120)})`
        );
      }

      /**
       * ── Skema vs kode ──────────────────────────────────────────────────
       *
       * Ini yang paling sering menipu: aplikasinya sehat, database
       * terhubung, login jalan, semua halaman baca berfungsi — tapi setiap
       * penyimpanan gagal, karena kode sudah tahu kolom baru sementara
       * database belum punya kolomnya.
       *
       * Penyebabnya hampir selalu sama: `npm run build` menjalankan
       * `prisma generate` (yang MEMBUAT ULANG tipe dari file schema) tanpa
       * pernah menjalankan `prisma db push` (yang MENGUBAH database). Jadi
       * typecheck lolos, build lolos, deploy lolos — dan yang gagal hanya
       * INSERT-nya, dengan pesan yang tidak menyebut sebabnya.
       *
       * Diperiksa lewat information_schema, bukan dengan mencoba menulis:
       * pemeriksaan kesehatan tidak boleh meninggalkan data sampah.
       */
      const kolomWajib: { tabel: string; kolom: string; untuk: string }[] = [
        { tabel: "bongkaran", kolom: "kamera", untuk: "nomor kamera CCTV" },
        { tabel: "bongkaran", kolom: "klien_kunci", untuk: "simpan luring" },
        { tabel: "users", kolom: "bisa_cancel_order", untuk: "izin Cancel Order" },
        { tabel: "produk_barcode", kolom: "jenis", untuk: "barcode BPOM" },
      ];
      const tabelWajib = ["bongkaran", "bongkaran_item", "produk", "produk_barcode",
                          "batch_sku", "cancel_order", "cancel_order_item"];

      let skema: Record<string, unknown> = { diperiksa: false };
      try {
        const adaTabel = await prisma.$queryRawUnsafe<{ TABLE_NAME: string }[]>(
          `SELECT TABLE_NAME FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE()`
        );
        const namaTabel = new Set(adaTabel.map((t) => String(t.TABLE_NAME).toLowerCase()));

        const adaKolom = await prisma.$queryRawUnsafe<
          { TABLE_NAME: string; COLUMN_NAME: string }[]
        >(
          `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()`
        );
        const pasangan = new Set(
          adaKolom.map((c) =>
            `${String(c.TABLE_NAME).toLowerCase()}.${String(c.COLUMN_NAME).toLowerCase()}`
          )
        );

        const tabelHilang = tabelWajib.filter((t) => !namaTabel.has(t));
        const kolomHilang = kolomWajib.filter(
          (k) => namaTabel.has(k.tabel) && !pasangan.has(`${k.tabel}.${k.kolom}`)
        );

        skema = {
          diperiksa: true,
          tabelHilang,
          kolomHilang: kolomHilang.map((k) => `${k.tabel}.${k.kolom} (${k.untuk})`),
        };

        if (tabelHilang.length > 0 || kolomHilang.length > 0) {
          masalah.push(
            "Database TERTINGGAL dari kode. " +
              (tabelHilang.length ? `Tabel belum ada: ${tabelHilang.join(", ")}. ` : "") +
              (kolomHilang.length
                ? `Kolom belum ada: ${kolomHilang.map((k) => `${k.tabel}.${k.kolom}`).join(", ")}. `
                : "") +
              "Jalankan `npm run db:push` dari komputer Anda ke database yang SAMA " +
              "dengan yang dipakai server ini, lalu coba lagi. Selama belum, " +
              "membaca data tetap berhasil tapi setiap penyimpanan akan gagal."
          );
        }
      } catch (e) {
        skema = {
          diperiksa: false,
          error: String((e as Error)?.message ?? e).slice(0, 200),
        };
      }

      database = {
        terhubung: true,
        msPing,
        jumlahUser,
        jumlahExpedisi,
        skema,
        catatan:
          msPing > 400
            ? "Ping tinggi — kemungkinan region Vercel jauh dari cluster database."
            : undefined,
      };

      if (jumlahUser === 0) {
        masalah.push(
          "Database terhubung tapi belum ada satu pun user. " +
            "Jalankan `npm run db:seed` dari komputer Anda."
        );
      }
    } catch (e) {
      const pesan = String((e as Error)?.message ?? e);
      database = { terhubung: false, error: pesan.slice(0, 400) };

      if (/insecure transport|1105/i.test(pesan)) {
        masalah.push(
          "TiDB menolak koneksi karena tidak memakai TLS. Tambahkan " +
            "?sslaccept=strict pada DATABASE_URL (tepat setelah nama " +
            "database, sebelum parameter lain yang dipisah &), lalu deploy ulang."
        );
      } else if (/Can't reach database server|ECONNREFUSED|ETIMEDOUT|timeout/i.test(pesan)) {
        masalah.push(
          "Server tidak bisa menghubungi database. Periksa: nama host & port " +
            "di DATABASE_URL, parameter ?sslaccept=strict, dan IP Access List " +
            "di TiDB Cloud (harus mengizinkan akses dari mana saja untuk Vercel)."
        );
      } else if (/Access denied|authentication/i.test(pesan)) {
        masalah.push(
          "Kredensial database ditolak. Password di DATABASE_URL kemungkinan " +
            "salah, atau karakter khusus di dalamnya belum di-URL-encode " +
            "(@ jadi %40, # jadi %23, dan seterusnya)."
        );
      } else if (/did not initialize|generate|@prisma\/client/i.test(pesan)) {
        masalah.push(
          "Prisma Client tidak ter-generate saat build. Pastikan package.json " +
            'memuat "build": "prisma generate && next build".'
        );
      }
    }
  }

  // Jaring pengaman: jangan sampai `sehat: false` tapi `masalah: []` —
  // laporan seperti itu memberi tahu ada yang salah tanpa menyebut apa,
  // yang justru lebih membingungkan daripada tidak ada laporan sama sekali.
  if (database.terhubung !== true && masalah.length === 0) {
    masalah.push(
      "Database tidak bisa dihubungi, dan penyebabnya belum dikenali. " +
        "Lihat isi `database.error` di bawah untuk pesan aslinya."
    );
  }

  const sehat = masalah.length === 0 && database.terhubung === true;

  return NextResponse.json(
    {
      sehat,
      waktuServer: new Date().toISOString(),
      waktuWIB: new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }),
      env,
      koneksiDatabase: koneksi,
      database,
      masalah,
      totalMs: Date.now() - mulai,
    },
    { status: sehat ? 200 : 503 }
  );
}
