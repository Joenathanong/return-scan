/**
 * Alat sementara untuk mengelola ekspedisi dari command line,
 * sampai halaman Admin → Master Ekspedisi selesai dipindahkan.
 *
 *   node tools/expedisi.mjs                          # daftar semua
 *   node tools/expedisi.mjs tambah "JNE" JNE         # tambah (nama, kode)
 *   node tools/expedisi.mjs tambah "J&T Express"     # kode dibuat otomatis
 *   node tools/expedisi.mjs nonaktif JNE
 *   node tools/expedisi.mjs aktif JNE
 *
 * Kode WAJIB unik dan hanya boleh A-Z, 0-9, garis bawah — karena kode inilah
 * yang nanti dipakai sebagai nama tab saat ekspor ke Google Sheets.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const [, , perintah, arg1, arg2] = process.argv;

const KODE_RE = /^[A-Z0-9_]{2,32}$/;

function saranKode(nama) {
  return String(nama).toUpperCase().replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "").slice(0, 32);
}

async function daftar() {
  const rows = await prisma.expedisi.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { scans: true, karung: true } } },
  });

  if (rows.length === 0) {
    console.log("\n  Belum ada ekspedisi.");
    console.log('  Tambah dengan: node tools/expedisi.mjs tambah "JNE" JNE\n');
    return;
  }

  console.log(`\n  ${rows.length} ekspedisi:\n`);
  console.log(`  ${"KODE".padEnd(20)} ${"NAMA".padEnd(30)} ${"STATUS".padEnd(10)} KARUNG  RESI`);
  console.log(`  ${"-".repeat(20)} ${"-".repeat(30)} ${"-".repeat(10)} ------  ----`);
  for (const e of rows) {
    console.log(
      `  ${e.code.padEnd(20)} ${e.name.slice(0, 30).padEnd(30)} ` +
      `${(e.active ? "aktif" : "nonaktif").padEnd(10)} ` +
      `${String(e._count.karung).padStart(6)}  ${String(e._count.scans).padStart(4)}`
    );
  }
  console.log("");
}

async function tambah(nama, kodeInput) {
  if (!nama) {
    console.log('\n  ✗ Nama wajib diisi: node tools/expedisi.mjs tambah "JNE" JNE\n');
    process.exit(1);
  }
  const kode = (kodeInput || saranKode(nama)).toUpperCase();

  if (!KODE_RE.test(kode)) {
    console.log(`\n  ✗ Kode "${kode}" tidak valid.`);
    console.log("    Hanya huruf kapital, angka, dan garis bawah (2–32 karakter).\n");
    process.exit(1);
  }

  const bentrokKode = await prisma.expedisi.findUnique({ where: { code: kode } });
  if (bentrokKode) {
    console.log(`\n  ✗ Kode "${kode}" sudah dipakai oleh "${bentrokKode.name}".`);
    console.log("    Beri kode lain sebagai argumen kedua.\n");
    process.exit(1);
  }

  const bentrokNama = await prisma.expedisi.findFirst({ where: { name: nama } });
  if (bentrokNama) {
    console.log(`\n  ✗ Ekspedisi "${nama}" sudah terdaftar (kode ${bentrokNama.code}).\n`);
    process.exit(1);
  }

  const dibuat = await prisma.expedisi.create({
    data: { name: nama, code: kode, active: true },
  });
  console.log(`\n  ✓ "${dibuat.name}" dibuat dengan kode ${dibuat.code}\n`);
}

async function ubahAktif(kode, aktif) {
  if (!kode) {
    console.log("\n  ✗ Sebutkan kodenya.\n");
    process.exit(1);
  }
  const e = await prisma.expedisi.findUnique({ where: { code: kode.toUpperCase() } });
  if (!e) {
    console.log(`\n  ✗ Kode "${kode}" tidak ditemukan.\n`);
    process.exit(1);
  }
  await prisma.expedisi.update({ where: { id: e.id }, data: { active: aktif } });
  console.log(`\n  ✓ "${e.name}" sekarang ${aktif ? "aktif" : "nonaktif"}.\n`);
}

async function main() {
  switch (perintah) {
    case undefined:
    case "daftar":   await daftar(); break;
    case "tambah":   await tambah(arg1, arg2); await daftar(); break;
    case "aktif":    await ubahAktif(arg1, true); break;
    case "nonaktif": await ubahAktif(arg1, false); break;
    default:
      console.log(`\n  Perintah "${perintah}" tidak dikenal.`);
      console.log("  Tersedia: daftar, tambah, aktif, nonaktif\n");
      process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error("\n  ✗ Gagal:", e.message, "\n");
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
