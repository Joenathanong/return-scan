/**
 * db:upgrade — pemeriksaan setelah `prisma db push`.
 *
 * RIWAYAT: versi pertama skrip ini memaksa seluruh tabel dikonversi ke
 * `utf8mb4_general_ci`, dengan asumsi TiDB Cloud Starter memakai
 * `utf8mb4_bin` yang peka huruf besar-kecil. ASUMSI ITU SALAH.
 *
 * TiDB Cloud Starter ternyata sudah memakai `utf8mb4_unicode_ci` — akhiran
 * `_ci` artinya case-insensitive, persis yang kita butuhkan. Konversi paksa
 * itu tidak hanya tidak perlu, tapi juga ditolak TiDB dengan error 8200
 * ("Unsupported converting collation ... when index is defined on it"),
 * karena TiDB tidak bisa mengubah collation kolom yang sudah punya index.
 *
 * Jadi skrip ini sekarang MEMERIKSA, bukan memaksa:
 *   1. Pastikan collation kolom-kolom penting memang case-insensitive
 *   2. Pastikan index UNIQUE yang menjaga integritas benar-benar terpasang
 *   3. Pastikan baris settings ada
 *
 * Aman dijalankan berkali-kali.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const NOTE_DEFAULT =
  "Seluruh karung yang diserahkan sudah di scan dan disaksikan oleh pihak yang menyerahkan barang. " +
  "tanda terima ini menjadi bukti yang sah, untuk tanda terima barang dari expedisi ke PT. IEG";

/** Kolom yang keunikannya menentukan benar-tidaknya data. */
const KOLOM_PENTING = [
  ["scans", "no_resi_unik", "keunikan kode resi"],
  ["scans", "no_resi", "pencarian resi"],
  ["expedisi", "code", "keunikan kode ekspedisi"],
  ["users", "email", "keunikan email login"],
  ["karung", "nomor_karung", "keunikan nomor karung per hari"],
  // Modul bongkaran
  ["produk", "sku", "pencocokan kode SKU"],
  ["produk_barcode", "barcode", "pencocokan barcode yang di-scan"],
  ["batch_sku", "batch", "saran batch per SKU"],
];

/** Index UNIQUE yang wajib ada. */
const UNIQUE_WAJIB = [
  ["scans", "uq_scan_resi", "satu resi tidak bisa masuk dua kali"],
  ["expedisi", "uq_expedisi_code", "kode ekspedisi tidak bisa kembar"],
  ["users", "uq_user_email", "email tidak bisa dipakai dua akun"],
  ["karung", "uq_karung_exp_date_nomor", "nomor karung unik per ekspedisi per tanggal"],
  // Modul bongkaran — satu batch hanya boleh tercatat sekali per SKU,
  // kalau tidak daftar sarannya akan penuh baris kembar.
  ["batch_sku", "uq_batch_sku", "satu batch hanya tercatat sekali per SKU"],
];

const caseInsensitive = (c) => typeof c === "string" && /_ci$/i.test(c);
const caseSensitive = (c) =>
  typeof c === "string" && (/_bin$/i.test(c) || /_cs$/i.test(c));

async function main() {
  console.log("\n  db:upgrade — scan-retur-v2\n");

  // ── 1. Collation ───────────────────────────────────────────────────────────
  const kolom = await prisma.$queryRawUnsafe(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c, COLLATION_NAME AS coll
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND COLLATION_NAME IS NOT NULL`
  );

  const peta = new Map(kolom.map((k) => [`${k.t}.${k.c}`, k.coll]));
  const bermasalah = [];

  console.log("  Collation kolom penting:");
  for (const [tabel, kol, guna] of KOLOM_PENTING) {
    const coll = peta.get(`${tabel}.${kol}`);
    if (!coll) {
      console.log(`    ? ${tabel}.${kol} — kolom tidak ditemukan (jalankan db:push dulu)`);
      continue;
    }
    if (caseInsensitive(coll)) {
      console.log(`    ✓ ${tabel}.${kol.padEnd(14)} ${coll}  (${guna})`);
    } else if (caseSensitive(coll)) {
      console.log(`    ✗ ${tabel}.${kol.padEnd(14)} ${coll}  — PEKA HURUF BESAR-KECIL`);
      bermasalah.push(`${tabel}.${kol} (${coll})`);
    } else {
      console.log(`    · ${tabel}.${kol.padEnd(14)} ${coll}  (tidak dikenali, dianggap aman)`);
    }
  }

  if (bermasalah.length) {
    console.log("\n  ⚠  Ada kolom dengan collation peka huruf besar-kecil:");
    for (const b of bermasalah) console.log(`       ${b}`);
    console.log(
      "\n     Artinya 'abc123' dan 'ABC123' dianggap DUA resi berbeda oleh\n" +
      "     index UNIQUE. Aplikasi sudah menormalkan resi ke huruf besar\n" +
      "     sebelum menyimpan (cleanResi di lib/api.ts), jadi ini lapis\n" +
      "     pengaman kedua — tapi sebaiknya tetap dibetulkan.\n" +
      "\n     TiDB TIDAK BISA mengubah collation kolom yang sudah ber-index.\n" +
      "     Cara membetulkannya: buat ulang database dengan collation yang\n" +
      "     benar, lalu db:push lagi (database masih kosong, jadi murah):\n" +
      "\n       DROP DATABASE scan_retur;\n" +
      "       CREATE DATABASE scan_retur DEFAULT CHARACTER SET utf8mb4\n" +
      "                                  COLLATE utf8mb4_unicode_ci;\n"
    );
  } else {
    console.log("\n  ✓ Semua kolom penting case-insensitive — tidak ada yang perlu diubah.");
  }

  // ── 2. Index UNIQUE ────────────────────────────────────────────────────────
  const idx = await prisma.$queryRawUnsafe(
    `SELECT TABLE_NAME AS t, INDEX_NAME AS i
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND NON_UNIQUE = 0
      GROUP BY TABLE_NAME, INDEX_NAME`
  );
  const adaIdx = new Set(idx.map((x) => `${x.t}.${x.i}`));

  console.log("\n  Index UNIQUE (penjaga integritas):");
  let hilang = 0;
  for (const [tabel, nama, guna] of UNIQUE_WAJIB) {
    if (adaIdx.has(`${tabel}.${nama}`)) {
      console.log(`    ✓ ${nama.padEnd(26)} ${guna}`);
    } else {
      console.log(`    ✗ ${nama.padEnd(26)} TIDAK ADA — ${guna}`);
      hilang++;
    }
  }
  if (hilang) {
    console.log(`\n  ⚠  ${hilang} index UNIQUE belum terpasang. Jalankan \`npm run db:push\`.`);
  }

  // ── 3. Baris settings ──────────────────────────────────────────────────────
  const ada = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!ada) {
    await prisma.settings.create({
      data: {
        id: 1,
        namaPerusahaan: "PT. IEG",
        noteTandaTerima: NOTE_DEFAULT,
        spreadsheetId: "",
        claimMasterSpreadsheetId: "",
      },
    });
    console.log("\n  settings  : baris default dibuat");
  } else {
    console.log("\n  settings  : sudah ada, dilewati");
  }

  const gagal = bermasalah.length > 0 || hilang > 0;
  console.log(
    gagal
      ? "\n  ◐ db:upgrade selesai dengan peringatan (lihat di atas).\n"
      : "\n  ✓ db:upgrade selesai — database sehat.\n"
  );
}

main()
  .catch((e) => {
    console.error("\n  ✗ db:upgrade gagal:", e.message, "\n");
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
