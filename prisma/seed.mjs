/**
 * db:seed — isi awal database.
 *
 * 1. Membuat admin pertama dari ADMIN_EMAIL / ADMIN_PASSWORD di .env
 * 2. Kalau ada file `seed-master.json` (hasil `node audit-data.mjs --master-only`
 *    di project lama), ikut mengisi daftar ekspedisi & user dari sana.
 *
 * TIDAK memindahkan data transaksi apa pun. Sistem baru mulai bersih —
 * data lama tetap bisa dilihat di aplikasi lama.
 *
 * Aman dijalankan berkali-kali: yang sudah ada dilewati, tidak ditimpa.
 */

import { PrismaClient } from "@prisma/client";
import { scryptSync, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();

/** HARUS sama persis dengan hashPassword() di lib/crypto.ts */
function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const dk = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${dk}`;
}

/** Kode ekspedisi yang aman & stabil untuk dipakai sebagai nama tab G-Sheet. */
function bikinKode(nama, dipakai) {
  let base = String(nama)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 28) || "EXP";
  if (!dipakai.has(base)) return base;
  // Bentrok → tambahkan sufiks angka, JANGAN diam-diam pakai kode yang sama
  // (itu persis bug sistem lama: dua ekspedisi berbagi satu tab).
  for (let i = 2; i < 100; i++) {
    const alt = `${base.slice(0, 28)}_${i}`;
    if (!dipakai.has(alt)) return alt;
  }
  return `${base.slice(0, 24)}_${Date.now().toString().slice(-4)}`;
}

async function main() {
  console.log("\n  db:seed — scan-retur-v2\n");

  // ── 1. Admin pertama ───────────────────────────────────────────────────────
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const pw = process.env.ADMIN_PASSWORD || "";

  if (!email || !pw) {
    console.log("  ! ADMIN_EMAIL / ADMIN_PASSWORD belum diisi di .env — admin dilewati.");
  } else if (pw.length < 8) {
    console.log("  ! ADMIN_PASSWORD kurang dari 8 karakter — admin dilewati.");
  } else {
    const ada = await prisma.user.findUnique({ where: { email } });
    if (ada) {
      console.log(`  admin     : ${email} sudah ada, dilewati`);
    } else {
      await prisma.user.create({
        data: {
          email,
          name: process.env.ADMIN_NAME || "Administrator",
          passwordHash: hashPassword(pw),
          role: "admin",
          active: true,
          // Dipaksa ganti saat login pertama — password dari .env
          // tidak boleh jadi password permanen.
          mustChangePassword: true,
        },
      });
      console.log(`  admin     : ${email} dibuat (wajib ganti password saat login)`);
    }
  }

  // ── 2. Data master dari sistem lama (opsional) ─────────────────────────────
  const seedPath = path.resolve(process.cwd(), "seed-master.json");
  if (!fs.existsSync(seedPath)) {
    console.log("  master    : seed-master.json tidak ada — dilewati");
    await ringkas();
    return;
  }

  const master = JSON.parse(fs.readFileSync(seedPath, "utf8"));

  // Ekspedisi
  const sudahAda = await prisma.expedisi.findMany({ select: { code: true } });
  const dipakai = new Set(sudahAda.map((e) => e.code));
  let expBaru = 0, expLewat = 0;

  for (const e of master.expedisi ?? []) {
    const nama = String(e.nama ?? e.name ?? "").trim();
    if (!nama) continue;

    const sama = await prisma.expedisi.findFirst({ where: { name: nama } });
    if (sama) { expLewat++; continue; }

    // Pakai kode lama kalau masih bebas; kalau bentrok, buat yang unik.
    let kode = String(e.kode ?? e.code ?? "").trim().toUpperCase();
    if (!kode || dipakai.has(kode)) kode = bikinKode(nama, dipakai);
    dipakai.add(kode);

    await prisma.expedisi.create({
      data: { code: kode, name: nama, active: e.aktif !== false },
    });
    expBaru++;
    if (kode !== (e.kode ?? e.code)) {
      console.log(`      · "${nama}": kode ${e.kode ?? e.code} → ${kode} (bentrok, diubah)`);
    }
  }
  console.log(`  expedisi  : ${expBaru} dibuat, ${expLewat} dilewati (sudah ada)`);

  // User SENGAJA TIDAK diimpor di sini.
  //
  // Versi sebelumnya membuat akun dengan password acak yang tidak
  // diberitahukan ke siapa pun — hasilnya akun yang ada tapi tidak bisa
  // dipakai, dan admin harus men-set ulang satu per satu. Itu bukan impor,
  // itu memindahkan pekerjaan.
  //
  // Sekarang pakai `node tools/import-users.mjs`, yang membuat password
  // sementara yang bisa dibaca, mencetaknya, dan menyimpannya untuk
  // dibagikan.
  const jmlUser = (master.users ?? []).length;
  if (jmlUser > 0) {
    console.log(`  users     : ${jmlUser} user ada di ${path.basename(seedPath)}, TIDAK diimpor di sini`);
    console.log(`      → jalankan: node tools/import-users.mjs --dry-run`);
  }

  // Settings dari sistem lama
  if (master.settings?.namaPerusahaan || master.settings?.noteTandaTerima) {
    await prisma.settings.update({
      where: { id: 1 },
      data: {
        ...(master.settings.namaPerusahaan
          ? { namaPerusahaan: master.settings.namaPerusahaan } : {}),
        ...(master.settings.noteTandaTerima
          ? { noteTandaTerima: master.settings.noteTandaTerima } : {}),
      },
    });
    console.log("  settings  : nama perusahaan & note tanda terima diambil dari sistem lama");
  }

  await ringkas();
}

async function ringkas() {
  const [u, e, s] = await Promise.all([
    prisma.user.count(),
    prisma.expedisi.count(),
    prisma.scan.count(),
  ]);
  console.log(`\n  Isi database sekarang: ${u} user · ${e} ekspedisi · ${s} scan`);
  console.log("\n  ✓ db:seed selesai.\n");
}

main()
  .catch((e) => {
    console.error("\n  ✗ db:seed gagal:", e.message, "\n");
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
