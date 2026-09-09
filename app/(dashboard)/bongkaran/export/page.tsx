"use client";

import { useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import { cn } from "@/lib/utils";
import { mintaJson, pesanError } from "@/lib/http";
import {
  Loader2, AlertCircle, CheckCircle2, X, Download, Pencil, Save,
} from "lucide-react";
import {
  KONDISI, LABEL_KONDISI, butuhBarcode, bacaBatch, isKondisi, type Kondisi,
} from "@/lib/bongkaran";
import { bersihkanKode } from "@/lib/produk";

interface Baris {
  /** Id baris — dipakai dialog koreksi untuk menyunting di tempat. */
  id: string;
  noResi: string;
  /** Posisi barang di dalam resinya. */
  urutan: number;
  totalBaris: number;
  barcode: string;
  sku: string;
  namaSku: string;
  qty: number;
  kondisi: string;
  /** Kode mentah kondisi — dialog butuh nilai yang bisa dikirim balik,
      bukan labelnya. */
  kondisiKode: string;
  edOtomatis: boolean;
  namaDiterima: string;
  batch: string;
  edDate: string;
  scanBy: string;
  scanDate: string;
  tanggal: string;
  produkTidakDikenal: boolean;
  /** Nomor kamera CCTV saat resi dibongkar. Null untuk data lama. */
  kamera: number | null;
  /** Dicocokkan dari Scan Retur lewat nomor resi. Kosong = belum ada di sana. */
  expedisi: string;
}

/**
 * "1 of 2" — posisi barang di dalam resinya.
 *
 * Resi berisi satu barang tetap ditulis "1 of 1", bukan dikosongkan:
 * kolom yang kadang kosong dan kadang terisi memaksa pembacanya menebak
 * apakah kosong itu berarti "satu-satunya" atau "datanya hilang".
 */
function line(urutan: number, total: number): string {
  return `${urutan} of ${total}`;
}

/**
 * Kolom tabel pratinjau: judul + perataan, satu sumber untuk keduanya.
 *
 * JUMLAHNYA HARUS SAMA PERSIS dengan jumlah <td> di setiap baris (16,
 * termasuk kolom ikon pensil yang judulnya sengaja kosong). Kalau nanti
 * ada kolom baru, tambahkan di SINI dan di baris tabelnya sekaligus —
 * pergeseran satu kolom membuat setiap judul menunjuk data tetangganya,
 * dan tabelnya tetap terlihat rapi sementara membacanya salah.
 */
const KOLOM: { judul: string; kelas?: string }[] = [
  { judul: "", kelas: "w-px" },              // ikon pensil
  { judul: "No.", kelas: "text-right" },
  { judul: "No Resi" },
  { judul: "Line", kelas: "text-center" },
  { judul: "Barcode Scan" },
  { judul: "Kode SKU" },
  { judul: "Nama SKU" },
  { judul: "Qty", kelas: "text-right" },
  { judul: "Kondisi" },
  { judul: "Nama Barang Diterima" },
  { judul: "Batch" },
  { judul: "Exp. Date" },
  { judul: "Scan By" },
  { judul: "Scan Date" },
  { judul: "Kamera" },
  { judul: "Expedisi" },
];

interface Balasan {
  dari: string;
  sampai: string;
  lagi: boolean;
  kursor: string | null;
  rows: Baris[];
}

const hariIniWIB = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());

/** "2026-09-07T03:12:45.000Z" → "07/09/2026 10:12:45" (WIB) */
function waktuExcel(iso: string): string {
  try {
    const f = new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    });
    // id-ID menghasilkan "07/09/2026 10.12.45" — titik diganti titik dua
    // supaya Excel mengenalinya sebagai jam, bukan teks acak.
    return f.format(new Date(iso)).replace(/\./g, ":");
  } catch {
    return iso;
  }
}

/** "2029-02-01" → "01/02/2029". Kosong tetap kosong, bukan "01/01/1970". */
function tanggalExcel(s: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

export default function BongkaranExportPage() {
  return (
    <AuthGuard>
      <Isi />
    </AuthGuard>
  );
}

function Isi() {
  const [dari, setDari] = useState(hariIniWIB);
  const [sampai, setSampai] = useState(hariIniWIB);
  const [rows, setRows] = useState<Baris[] | null>(null);
  const [memuat, setMemuat] = useState(false);
  const [maju, setMaju] = useState(0);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [sunting, setSunting] = useState<Baris | null>(null);

  const ambil = async () => {
    setMemuat(true);
    setError("");
    setRows(null);
    setMaju(0);
    try {
      const semua: Baris[] = [];
      let kursor: string | null = null;

      // Diambil bertahap. Rentang sebulan bisa puluhan ribu baris, dan satu
      // balasan raksasa akan menyentuh batas memori fungsi serverless.
      for (let putaran = 0; putaran < 500; putaran++) {
        const q = new URLSearchParams({ dari, sampai });
        if (kursor) q.set("kursor", kursor);
        const d: Balasan = await mintaJson<Balasan>(
          `/api/bongkaran/export?${q}`,
          { timeoutMs: 60_000 }
        );
        semua.push(...d.rows);
        setMaju(semua.length);
        if (!d.lagi || !d.kursor) break;
        kursor = d.kursor;
      }

      setRows(semua);
      if (semua.length === 0) setInfo("Tidak ada data pada rentang tanggal itu.");
    } catch (e) {
      setError(pesanError(e, "Gagal mengambil data."));
    } finally {
      setMemuat(false);
    }
  };

  const unduh = async () => {
    if (!rows || rows.length === 0) return;
    try {
      const XLSX = await import("xlsx");

      // Nomor resi DIULANG di tiap baris, bukan sel yang digabung. Merge
      // cell terlihat lebih rapi tapi merusak filter, sort, dan pivot —
      // justru alasan orang meminta ekspor.
      const data = rows.map((r, i) => ({
        "No.": i + 1,
        "No Resi": r.noResi,
        "Line": line(r.urutan, r.totalBaris),
        "Barcode Scan": r.barcode || "—",
        "Kode SKU": r.sku || "—",
        "Nama SKU": r.namaSku || "—",
        "Quantity": r.qty,
        "Kondisi": r.kondisi,
        "Nama Barang Diterima": r.namaDiterima,
        "Batch": r.batch || "—",
        "Exp. Date": tanggalExcel(r.edDate),
        "Scan By": r.scanBy,
        "Scan Date": waktuExcel(r.scanDate),
        // Kamera berpasangan dengan Scan Date: yang satu menjawab "kamera
        // mana", yang lain "jam berapa". Baris lama — dari sebelum fitur
        // kamera ada — ditulis "—", bukan diisi tebakan.
        "Kamera": r.kamera ? `Kamera ${r.kamera}` : "—",
        // Kolom terakhir, sesuai permintaan. Kosong ditulis "—" seperti
        // kolom lain yang tidak terisi, supaya sel kosong di Excel selalu
        // berarti "belum diisi" dan bukan "tidak ada padanannya".
        "Expedisi": r.expedisi || "—",
      }));

      const ws = XLSX.utils.json_to_sheet(data);
      ws["!cols"] = [
        { wch: 5 }, { wch: 20 }, { wch: 8 }, { wch: 18 }, { wch: 14 },
        { wch: 34 }, { wch: 9 }, { wch: 15 }, { wch: 26 }, { wch: 12 },
        { wch: 12 }, { wch: 18 }, { wch: 20 }, { wch: 11 }, { wch: 18 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Bongkaran");
      XLSX.writeFile(wb, `bongkaran-${dari}_sd_${sampai}.xlsx`);
      setInfo(`${rows.length.toLocaleString("id-ID")} baris diunduh.`);
    } catch (e) {
      setError(pesanError(e, "Gagal membuat file Excel."));
    }
  };

  const resiUnik = rows ? new Set(rows.map((r) => r.noResi)).size : 0;
  const tidakDikenal = rows ? rows.filter((r) => r.produkTidakDikenal).length : 0;
  // Dihitung per RESI, bukan per baris: satu resi berisi lima barang yang
  // tidak ketemu di Scan Retur adalah SATU resi yang perlu ditelusuri,
  // bukan lima.
  const resiTanpaExpedisi = rows
    ? new Set(rows.filter((r) => !r.expedisi).map((r) => r.noResi)).size
    : 0;

  return (
    <div className="shell">
      <div>
        <h1 className="page-title">Export Bongkaran</h1>
        <p className="page-sub">
          Baris yang ganjil bisa diperbaiki lewat ikon pensil — waktu scan-nya
          tidak ikut berubah. Kolom <strong>Line</strong> menunjukkan posisinya
          di dalam resi (&ldquo;1 of 2&rdquo;). Kolom <strong>Kamera</strong>
          berpasangan dengan Scan Date untuk mencari rekaman CCTV, dan{" "}
          <strong>Expedisi</strong> dicocokkan dari Scan Retur lewat nomor resi.
        </p>
      </div>

      {error && <Kotak jenis="error" pesan={error} onTutup={() => setError("")} />}
      {info && <Kotak jenis="info" pesan={info} onTutup={() => setInfo("")} />}

      <div className="card p-5 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium text-ink mb-1.5 block">Dari tanggal</label>
            <input type="date" value={dari} onChange={(e) => setDari(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="text-sm font-medium text-ink mb-1.5 block">Sampai tanggal</label>
            <input type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} className="input-field" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={ambil} disabled={memuat || !dari || !sampai} className="btn-primary">
            {memuat
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Mengambil {maju.toLocaleString("id-ID")}…</>
              : "Tampilkan"}
          </button>
          <button
            onClick={unduh}
            disabled={!rows || rows.length === 0}
            className="btn-ghost disabled:opacity-40"
          >
            <Download className="w-4 h-4" /> Unduh Excel
          </button>
        </div>
      </div>

      {rows && rows.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Angka label="Baris" nilai={rows.length} />
            <Angka label="Resi" nilai={resiUnik} />
            <Angka label="Barcode belum terdaftar" nilai={tidakDikenal} />
            <Angka label="Resi tanpa ekspedisi" nilai={resiTanpaExpedisi} />
          </div>

          {resiTanpaExpedisi > 0 && (
            <div className="bg-gray-50 border border-gray-300 rounded-xl px-4 py-3 flex gap-2.5 text-sm text-gray-600">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-gray-400" />
              <p>
                {resiTanpaExpedisi.toLocaleString("id-ID")} resi belum punya padanan
                di Scan Retur, jadi kolom Expedisi-nya kosong. Ini keadaan yang sah:
                bongkar boleh mendahului scan retur. Kalau resinya memang sudah lama
                di-scan, periksa apakah nomornya berbeda satu-dua karakter.
              </p>
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto scroll-slim max-h-[70vh]">
              <table className="w-full text-sm whitespace-nowrap">
                {/*
                  Judul kolom dibangun dari KOLOM, bukan dari daftar teks
                  lepas. Sebelumnya daftar itu berisi 15 judul sementara
                  setiap barisnya punya 16 sel — kolom ikon pensil tidak
                  punya judul — sehingga SELURUH judul bergeser satu kolom
                  ke kiri: "No." berdiri di atas ikon pensil, "No Resi" di
                  atas nomor urut, dan seterusnya sampai "Expedisi" berdiri
                  di atas kolom Kamera. Semua isinya benar; hanya judulnya
                  yang berbohong — jenis kesalahan yang paling lama tidak
                  ketahuan, karena tabelnya terlihat rapi.

                  Perataan ikut ditulis di sini supaya judul dan selnya
                  tidak bisa lagi berbeda arah.
                */}
                <thead className="thead-ocs sticky top-0 z-10">
                  <tr>
                    {KOLOM.map((k, i) => (
                      <th
                        key={i}
                        scope="col"
                        className={cn("px-3 py-2.5", k.kelas)}
                      >
                        {k.judul || <span className="sr-only">Aksi</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {rows.slice(0, 100).map((r, i) => (
                    <tr
                      key={r.id}
                      className={cn("row-hover", r.produkTidakDikenal && "bg-warn-bg/60")}
                    >
                      <td className="px-2 py-2 w-px">
                        <button
                          onClick={() => setSunting(r)}
                          className="p-1.5 rounded text-gray-400 hover:text-brand-600 hover:bg-brand-50"
                          title="Perbaiki baris ini"
                          aria-label={`Perbaiki baris ${i + 1}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </td>
                      <td className="px-3 py-2 text-gray-400 text-right tabular-nums">{i + 1}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.noResi}</td>
                      <td className="px-3 py-2 text-xs text-gray-500 tabular-nums text-center">
                        {line(r.urutan, r.totalBaris)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{r.barcode || "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.sku || "—"}</td>
                      <td className="px-3 py-2">{r.namaSku || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.qty}</td>
                      <td className="px-3 py-2">{r.kondisi}</td>
                      <td className="px-3 py-2">{r.namaDiterima || ""}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.batch || "—"}</td>
                      <td className="px-3 py-2">{tanggalExcel(r.edDate)}</td>
                      <td className="px-3 py-2">{r.scanBy}</td>
                      <td className="px-3 py-2 text-xs">{waktuExcel(r.scanDate)}</td>
                      <td className={cn("px-3 py-2 text-xs", !r.kamera && "text-gray-300")}>
                        {r.kamera ? `Kamera ${r.kamera}` : "—"}
                      </td>
                      <td className={cn("px-3 py-2", !r.expedisi && "text-gray-300")}>
                        {r.expedisi || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 100 && (
              <p className="px-3 py-2 text-xs text-gray-400 bg-gray-50 border-t border-gray-200">
                Menampilkan 100 baris pertama. Seluruh {rows.length.toLocaleString("id-ID")} baris
                ikut terunduh ke Excel.
              </p>
            )}
          </div>
        </>
      )}

      {sunting && (
        <DialogSunting
          baris={sunting}
          onTutup={() => setSunting(null)}
          onSimpan={(baru, pesan) => {
            // Baris diperbarui DI TEMPAT, tidak dengan memuat ulang seluruh
            // laporan: rentang sebulan bisa puluhan ribu baris, dan
            // menariknya lagi hanya untuk satu koreksi membuang waktu
            // operator yang sedang membereskan sepuluh baris berturut-turut.
            setRows((arr) => (arr ?? []).map((x) => (x.id === baru.id ? baru : x)));
            setSunting(null);
            setInfo(pesan);
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Dialog koreksi satu baris
   ══════════════════════════════════════════════════════════════════════════ */

function DialogSunting({
  baris, onTutup, onSimpan, onError,
}: {
  baris: Baris;
  onTutup: () => void;
  onSimpan: (baru: Baris, pesan: string) => void;
  onError: (pesan: string) => void;
}) {
  const awal: Kondisi = isKondisi(baris.kondisiKode) ? baris.kondisiKode : "BAGUS";

  const [kondisi, setKondisi] = useState<Kondisi>(awal);
  const [barcode, setBarcode] = useState(baris.barcode);
  const [sku, setSku] = useState(baris.sku);
  const [nama, setNama] = useState(baris.namaSku);
  const [namaDiterima, setNamaDiterima] = useState(baris.namaDiterima);
  const [qty, setQty] = useState(String(baris.qty));
  const [batch, setBatch] = useState(baris.batch);
  const [edDate, setEdDate] = useState(baris.edDate);
  const [edOtomatis, setEdOtomatis] = useState(baris.edOtomatis);
  const [menyimpan, setMenyimpan] = useState(false);

  const perluBarcode = butuhBarcode(kondisi);

  const ubahBatch = (v: string) => {
    const b = bersihkanKode(v);
    const terbaca = bacaBatch(b, hariIniWIB());
    setBatch(b);
    if (terbaca) {
      setEdDate(terbaca.edDate);
      setEdOtomatis(true);
    } else {
      setEdOtomatis(false);
    }
  };

  const simpan = async () => {
    setMenyimpan(true);
    try {
      await mintaJson(`/api/bongkaran/item/${baris.id}`, {
        method: "PATCH",
        body: {
          kondisi,
          barcode: perluBarcode ? barcode : "",
          sku: perluBarcode ? sku : "",
          namaProduk: perluBarcode ? nama : "",
          namaDiterima: perluBarcode ? "" : namaDiterima,
          qty: Number(qty),
          batch,
          edDate,
          edOtomatis,
        },
      });

      onSimpan(
        {
          ...baris,
          kondisiKode: kondisi,
          kondisi: LABEL_KONDISI[kondisi],
          barcode: perluBarcode ? bersihkanKode(barcode) : "",
          sku: perluBarcode ? bersihkanKode(sku) : "",
          namaSku: perluBarcode ? nama : "",
          namaDiterima: perluBarcode ? "" : namaDiterima,
          qty: Number(qty),
          batch: bersihkanKode(batch),
          edDate,
          edOtomatis,
          produkTidakDikenal: perluBarcode && Boolean(barcode) && !sku,
        },
        `Baris ${baris.noResi} diperbarui.`
      );
    } catch (e) {
      onError(pesanError(e, "Gagal menyimpan perubahan."));
    } finally {
      setMenyimpan(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-brand-950/50 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-card shadow-modal p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto scroll-slim">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-heading">Perbaiki baris</h3>
            <p className="text-sm text-gray-500 mt-0.5 font-mono truncate">
              {baris.noResi} · {line(baris.urutan, baris.totalBaris)}
            </p>
          </div>
          <button onClick={onTutup} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-brand-50 border border-brand-200 rounded-xl px-3.5 py-2.5 text-xs text-brand-700">
          Waktu scan <strong>tidak ikut berubah</strong> — ia tetap menunjuk saat
          barang benar-benar di-scan ({waktuExcel(baris.scanDate)}
          {baris.kamera ? `, Kamera ${baris.kamera}` : ""}), bukan saat perbaikan
          ini. Rekaman CCTV pada jam itu tetap bisa dicari.
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 mb-1.5 block">Kondisi</label>
          <div className="grid grid-cols-2 gap-2">
            {KONDISI.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKondisi(k)}
                className={cn(
                  "px-3 py-2 rounded-lg text-sm font-medium border transition-colors text-left",
                  kondisi === k
                    ? "bg-brand-600 border-brand-600 text-white"
                    : "bg-white border-gray-300 text-ink hover:border-brand-400"
                )}
              >
                {LABEL_KONDISI[k]}
              </button>
            ))}
          </div>
        </div>

        {perluBarcode ? (
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1.5 block">Barcode</label>
              <input value={barcode} onChange={(e) => setBarcode(e.target.value)}
                     className="input-field font-mono" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1.5 block">Kode SKU</label>
              <input value={sku} onChange={(e) => setSku(e.target.value)}
                     className="input-field font-mono" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-gray-600 mb-1.5 block">Nama produk</label>
              <input value={nama} onChange={(e) => setNama(e.target.value)} className="input-field" />
            </div>
          </div>
        ) : (
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1.5 block">
              Nama Barang yang Diterima
            </label>
            <input value={namaDiterima} onChange={(e) => setNamaDiterima(e.target.value)}
                   className="input-field" />
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1.5 block">Quantity</label>
            <input value={qty} inputMode="numeric"
                   onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ""))}
                   className="input-field text-center tabular-nums" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1.5 block">Batch</label>
            <input value={batch} onChange={(e) => ubahBatch(e.target.value)}
                   className="input-field font-mono" />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="text-xs font-medium text-gray-600 mb-1.5 block">
              Exp. Date
              {edOtomatis && <span className="ml-1.5 text-ok-strong font-normal">otomatis</span>}
            </label>
            <input type="date" value={edDate}
                   onChange={(e) => { setEdDate(e.target.value); setEdOtomatis(false); }}
                   className="input-field" />
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={simpan} disabled={menyimpan}
                  className="btn-primary flex-1 justify-center">
            {menyimpan ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Simpan perubahan
          </button>
          <button onClick={onTutup} className="btn-ghost">Batal</button>
        </div>
      </div>
    </div>
  );
}

function Angka({ label, nilai }: { label: string; nilai: number }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-heading tabular-nums mt-1">{nilai.toLocaleString("id-ID")}</p>
    </div>
  );
}

function Kotak({
  jenis, pesan, onTutup,
}: { jenis: "error" | "info"; pesan: string; onTutup: () => void }) {
  const err = jenis === "error";
  return (
    <div
      className={cn(
        "rounded-xl px-4 py-3 flex gap-2 items-start border",
        err ? "bg-bad-bg border-bad/25" : "bg-ok-bg border-ok/30"
      )}
    >
      {err
        ? <AlertCircle className="w-4 h-4 text-bad flex-shrink-0 mt-0.5" />
        : <CheckCircle2 className="w-4 h-4 text-ok-strong flex-shrink-0 mt-0.5" />}
      <p className={cn("text-sm flex-1", err ? "text-bad" : "text-ok-strong")}>{pesan}</p>
      <button onClick={onTutup} className={err ? "text-bad/60" : "text-ok"}>
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
