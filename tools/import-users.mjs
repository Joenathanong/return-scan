/**
 * import-users.mjs — pindahkan daftar user dari sistem lama ke sistem baru.
 *
 * ═══ YANG PERLU DIPAHAMI LEBIH DULU ═══
 *
 * Firebase Authentication TIDAK PERNAH mengekspor hash password. Tidak ada
 * cara apa pun memindahkan password lama — bukan keterbatasan skrip ini,
 * melainkan memang begitu rancangannya.
 *
 * Jadi yang dipindahkan adalah IDENTITAS user (email, nama, role, status
 * aktif), sementara setiap akun diberi PASSWORD SEMENTARA yang dibuat acak
 * di sini, dicetak ke layar, dan disimpan ke `password-sementara.txt` untuk
 * dibagikan. Semua akun ditandai `mustChangePassword`, jadi user wajib
 * mengganti password itu saat login pertama dan setelah itu tidak ada
 * seorang pun — termasuk admin — yang tahu password permanennya.
 *
 * ═══ CARA PAKAI ═══
 *
 * 1. Di folder sistem LAMA, ambil data masternya (±20 baca Firestore):
 *
 *      cd ../scan-retur
 *      node audit-data.mjs --master-only
 *      cp seed-master.json ../scan-retur-v2/
 *      cd ../scan-retur-v2
 *
 * 2. Lihat dulu apa yang akan terjadi, tanpa mengubah apa pun:
 *
 *      node tools/import-users.mjs --dry-run
 *
 * 3. Kalau sudah cocok, jalankan sungguhan:
 *
 *      node tools/import-users.mjs
 *
 * ═══ KALAU KUOTA FIRESTORE SEDANG HABIS ═══
 *
 * Tidak perlu menunggu. Buka web LAMA → Admin → Kelola User, salin daftarnya
 * ke sebuah file CSV, lalu impor dari situ — sama sekali tidak menyentuh
 * Firestore:
 *
 *      node tools/import-users.mjs --csv=users.csv --dry-run
 *
 * Isi users.csv (baris header boleh ada, boleh tidak):
 *
 *      email,nama,role,aktif
 *      budi@ptieg.co.id,Budi Santoso,operator,ya
 *      sari@ptieg.co.id,Sari Dewi,admin,ya
 *
 * Kolom `role` dan `aktif` opsional. Pemisah boleh koma atau titik koma.
 *
 * ═══ OPSI LAIN ═══
 *
 *   --file=nama.json      pakai file JSON selain seed-master.json
 *   --csv=nama.csv        pakai CSV, bukan JSON
 *   --reset-existing      user yang SUDAH ada ikut diberi password baru
 *                         (default: dilewati, passwordnya tidak disentuh)
 *   --role-default=admin  role untuk data yang rolenya kosong
 *                         (default: operator)
 *
 * Aman dijalankan berkali-kali: user yang sudah ada dilewati.
 */

import { PrismaClient } from "@prisma/client";
import { scryptSync, randomBytes, randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();

const ARGS = process.argv.slice(2);
const hasFlag = (n) => ARGS.some((a) => a === `--${n}`);
const getArg = (n, d) => {
  const hit = ARGS.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split("=").slice(1).join("=") : d;
};

const DRY_RUN = hasFlag("dry-run");
const RESET_EXISTING = hasFlag("reset-existing");
const CSV = getArg("csv", "");
const FILE = CSV || getArg("file", "seed-master.json");
const ROLE_DEFAULT = getArg("role-default", "operator") === "admin" ? "admin" : "operator";

const c = {
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  cy: (s) => `\x1b[36m${s}\x1b[0m`,
};
const log = (...a) => console.log(...a);
const hr = () => log(c.dim("─".repeat(72)));

/** HARUS sama persis dengan hashPassword() di lib/crypto.ts */
function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const dk = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${dk}`;
}

/**
 * Password sementara: 4 huruf + 4 angka.
 *
 * Huruf yang mudah tertukar sengaja dibuang (I, L, O, U) dan angka 0 & 1
 * juga — password ini akan dibacakan atau ditulis di kertas, jadi "0" vs "O"
 * dan "1" vs "l" adalah masalah nyata, bukan kerewelan.
 *
 * Memenuhi syarat validatePassword(): minimal 8 karakter, ada huruf dan angka.
 */
function buatPassword() {
  const HURUF = "ABCDEFGHJKMNPQRSTVWXYZ";
  const ANGKA = "23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += HURUF[randomInt(HURUF.length)];
  for (let i = 0; i < 4; i++) s += ANGKA[randomInt(ANGKA.length)];
  return s;
}

const rapi = (s, n) => String(s ?? "").slice(0, n).padEnd(n);

/**
 * Pembaca CSV sederhana — cukup untuk daftar user yang disalin dari layar.
 * Mendukung pemisah koma atau titik koma, tanda kutip di sekeliling nilai,
 * dan baris header yang boleh ada atau tidak.
 */
function bacaCsv(teks) {
  const baris = teks
    .split(/\r?\n/)
    .map((b) => b.trim())
    .filter((b) => b && !b.startsWith("#"));
  if (baris.length === 0) return [];

  const pisah = (b) => {
    const pemisah = b.includes(";") && !b.includes(",") ? ";" : ",";
    return b.split(pemisah).map((x) => x.trim().replace(/^["']|["']$/g, ""));
  };

  let kolom = ["email", "nama", "role", "aktif"];
  let mulai = 0;

  // Deteksi baris header: kalau kolom pertama bukan email, anggap header.
  const pertama = pisah(baris[0]).map((x) => x.toLowerCase());
  if (!pertama[0]?.includes("@")) {
    kolom = pertama.map((h) =>
      h.startsWith("e") ? "email"
      : h.startsWith("n") ? "nama"
      : h.startsWith("r") ? "role"
      : h.startsWith("a") ? "aktif"
      : h
    );
    mulai = 1;
  }

  const hasil = [];
  for (let i = mulai; i < baris.length; i++) {
    const nilai = pisah(baris[i]);
    const obj = {};
    kolom.forEach((k, j) => { obj[k] = nilai[j] ?? ""; });
    const aktifTeks = String(obj.aktif ?? "").toLowerCase();
    hasil.push({
      email: obj.email,
      nama: obj.nama,
      role: String(obj.role ?? "").toLowerCase(),
      aktif: aktifTeks === "" ? true
        : !["tidak", "no", "false", "0", "nonaktif", "n"].includes(aktifTeks),
    });
  }
  return hasil;
}

async function main() {
  log("");
  log(c.b("  IMPOR USER — sistem lama → scan-retur-v2"));
  if (DRY_RUN) log(c.cy("  MODE UJI COBA — tidak ada yang ditulis ke database"));
  hr();

  // ── Baca file sumber ──────────────────────────────────────────────────────
  const berkas = path.resolve(process.cwd(), FILE);
  if (!fs.existsSync(berkas)) {
    log(c.r(`\n  ✗ ${FILE} tidak ditemukan.\n`));
    log("  Ambil dulu dari sistem lama:\n");
    log(c.dim("      cd ../scan-retur"));
    log(c.dim("      node audit-data.mjs --master-only"));
    log(c.dim("      cp seed-master.json ../scan-retur-v2/"));
    log(c.dim("      cd ../scan-retur-v2\n"));
    process.exit(1);
  }

  const isiBerkas = fs.readFileSync(berkas, "utf8");
  let sumber = [];

  if (CSV || FILE.toLowerCase().endsWith(".csv")) {
    sumber = bacaCsv(isiBerkas);
  } else {
    let master;
    try {
      master = JSON.parse(isiBerkas);
    } catch (e) {
      log(c.r(`\n  ✗ ${FILE} bukan JSON yang sah: ${e.message}\n`));
      process.exit(1);
    }
    sumber = Array.isArray(master.users) ? master.users : [];

    // seed-master.json hasil audit bisa tertulis sebagian kalau kuota
    // Firestore habis di tengah jalan — beri tahu, jangan diam-diam
    // mengimpor daftar yang tidak lengkap.
    if (master.lengkap && master.lengkap.users === false) {
      log(c.y(`  ⚠  ${FILE} ditulis saat kuota Firestore habis —`));
      log(c.y("     bagian user BELUM terbaca dari sistem lama."));
      log(c.dim("     Ambil ulang setelah ±14:00 WIB, atau pakai --csv=users.csv.\n"));
    }
  }

  if (sumber.length === 0) {
    log(c.y(`\n  ${FILE} tidak berisi data user.\n`));
    if (!CSV) {
      log("  Dua jalan keluar:\n");
      log(c.dim("   1. Tunggu kuota Firestore reset (±14:00 WIB), lalu di folder"));
      log(c.dim("      scan-retur jalankan: node audit-data.mjs --master-only\n"));
      log(c.dim("   2. Salin daftar user dari web LAMA (Admin → Kelola User) ke"));
      log(c.dim("      users.csv, lalu: node tools/import-users.mjs --csv=users.csv\n"));
      log(c.dim("      Isi users.csv:"));
      log(c.dim("          email,nama,role,aktif"));
      log(c.dim("          budi@ptieg.co.id,Budi Santoso,operator,ya\n"));
    }
    process.exit(0);
  }

  log(`  Sumber        : ${FILE}${CSV ? c.dim("  (CSV)") : ""}`);
  log(`  User ditemukan: ${c.b(sumber.length)}`);
  hr();

  // ── Cocokkan dengan yang sudah ada ────────────────────────────────────────
  const emailAda = new Set(
    (await prisma.user.findMany({ select: { email: true } })).map((u) => u.email)
  );

  const akanDibuat = [];
  const akanDireset = [];
  const dilewati = [];
  const bermasalah = [];
  const emailTerlihat = new Set();

  for (const u of sumber) {
    const email = String(u.email ?? "").trim().toLowerCase();
    const nama = String(u.nama ?? u.name ?? "").trim() || email;

    if (!email) {
      bermasalah.push({ nama: nama || "(tanpa nama)", alasan: "email kosong" });
      continue;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      bermasalah.push({ nama: email, alasan: "format email tidak valid" });
      continue;
    }
    if (emailTerlihat.has(email)) {
      bermasalah.push({ nama: email, alasan: "email kembar di file sumber" });
      continue;
    }
    emailTerlihat.add(email);

    const entri = {
      email,
      nama,
      role: u.role === "admin" ? "admin" : u.role === "operator" ? "operator" : ROLE_DEFAULT,
      aktif: u.aktif !== false && u.active !== false,
      password: buatPassword(),
    };

    if (emailAda.has(email)) {
      if (RESET_EXISTING) akanDireset.push(entri);
      else dilewati.push(entri);
    } else {
      akanDibuat.push(entri);
    }
  }

  // ── Ringkasan rencana ─────────────────────────────────────────────────────
  log(c.b("  RENCANA"));
  log(`  Dibuat baru   : ${akanDibuat.length ? c.g(akanDibuat.length) : "0"}`);
  log(`  Password direset: ${akanDireset.length ? c.y(akanDireset.length) : "0"}${
    RESET_EXISTING ? "" : c.dim("  (pakai --reset-existing untuk mengaktifkan)")
  }`);
  log(`  Dilewati      : ${dilewati.length}${dilewati.length ? c.dim("  (email sudah ada)") : ""}`);
  if (bermasalah.length) log(`  Bermasalah    : ${c.r(bermasalah.length)}`);

  if (bermasalah.length) {
    log("");
    log(c.y("  Data yang tidak bisa diimpor:"));
    for (const b of bermasalah) log(`    · ${b.nama} — ${b.alasan}`);
  }

  if (dilewati.length) {
    log("");
    log(c.dim("  Sudah ada, tidak disentuh:"));
    for (const d of dilewati) log(c.dim(`    · ${d.email}`));
  }

  const kerja = [...akanDibuat, ...akanDireset];
  if (kerja.length === 0) {
    log("");
    log(c.g("  Tidak ada yang perlu dikerjakan.\n"));
    return;
  }

  // ── Kerjakan ──────────────────────────────────────────────────────────────
  if (!DRY_RUN) {
    for (const u of akanDibuat) {
      await prisma.user.create({
        data: {
          email: u.email,
          name: u.nama,
          passwordHash: hashPassword(u.password),
          role: u.role,
          active: u.aktif,
          mustChangePassword: true,
        },
      });
    }
    for (const u of akanDireset) {
      await prisma.user.update({
        where: { email: u.email },
        data: {
          name: u.nama,
          passwordHash: hashPassword(u.password),
          role: u.role,
          active: u.aktif,
          mustChangePassword: true,
        },
      });
    }
  }

  // ── Daftar password sementara ─────────────────────────────────────────────
  log("");
  hr();
  log(c.b("  PASSWORD SEMENTARA") + c.dim("  — bagikan ke masing-masing user"));
  hr();
  log(`  ${rapi("EMAIL", 34)} ${rapi("NAMA", 18)} ${rapi("ROLE", 9)} PASSWORD`);
  log(`  ${"-".repeat(34)} ${"-".repeat(18)} ${"-".repeat(9)} --------`);
  for (const u of kerja) {
    log(
      `  ${rapi(u.email, 34)} ${rapi(u.nama, 18)} ${rapi(
        u.role + (u.aktif ? "" : "*"), 9
      )} ${c.b(u.password)}`
    );
  }
  if (kerja.some((u) => !u.aktif)) {
    log(c.dim("\n  * = akun nonaktif, tidak bisa login sampai diaktifkan admin"));
  }

  // ── Simpan ke berkas ──────────────────────────────────────────────────────
  const baris = [
    "PASSWORD SEMENTARA — scan-retur-v2",
    `Dibuat: ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB`,
    "",
    "Setiap user WAJIB mengganti password ini saat login pertama.",
    "HAPUS berkas ini setelah semua password dibagikan.",
    "",
    ...kerja.map((u) => `${u.email}\t${u.nama}\t${u.role}\t${u.password}`),
    "",
  ].join("\n");

  if (!DRY_RUN) {
    fs.writeFileSync("password-sementara.txt", baris, "utf8");
  }

  log("");
  hr();
  if (DRY_RUN) {
    log(c.cy("  UJI COBA selesai — tidak ada yang ditulis ke database."));
    log(c.dim("  Password di atas hanya contoh; yang sungguhan dibuat ulang saat dijalankan."));
    log(c.dim("  Jalankan tanpa --dry-run untuk benar-benar mengimpor.\n"));
  } else {
    log(c.g(`  ✓ ${akanDibuat.length} user dibuat, ${akanDireset.length} direset.`));
    log(`    Daftar password disimpan di ${c.b("password-sementara.txt")}`);
    log("");
    log(c.y("  ⚠  Berkas itu berisi password polos. Bagikan lalu HAPUS."));
    log(c.dim("     Sudah masuk .gitignore, jadi tidak akan ikut ter-commit.\n"));
  }
}

main()
  .catch((e) => {
    console.error("\n  ✗ Gagal:", e.message, "\n");
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
