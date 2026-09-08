"use client";

import { useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import { cn } from "@/lib/utils";
import { mintaJson, pesanError } from "@/lib/http";
import {
   Loader2, AlertCircle, CheckCircle2, X, Download,
} from "lucide-react";

interface Baris {
  noResi: string;
  barcode: string;
  sku: string;
  namaSku: string;
  qty: number;
  kondisi: string;
  namaDiterima: string;
  batch: string;
  edDate: string;
  scanBy: string;
  scanDate: string;
  tanggal: string;
  produkTidakDikenal: boolean;
  /** Dicocokkan dari Scan Retur lewat nomor resi. Kosong = belum ada di sana. */
  expedisi: string;
}

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
        // Kolom terakhir, sesuai permintaan. Kosong ditulis "—" seperti
        // kolom lain yang tidak terisi, supaya sel kosong di Excel selalu
        // berarti "belum diisi" dan bukan "tidak ada padanannya".
        "Expedisi": r.expedisi || "—",
      }));

      const ws = XLSX.utils.json_to_sheet(data);
      ws["!cols"] = [
        { wch: 5 }, { wch: 20 }, { wch: 18 }, { wch: 14 }, { wch: 34 },
        { wch: 9 }, { wch: 15 }, { wch: 26 }, { wch: 12 }, { wch: 12 },
        { wch: 18 }, { wch: 20 }, { wch: 18 },
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
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="page-title">Export Bongkaran</h1>
        <p className="page-sub">
          Satu baris per barang. Resi yang berisi dua barang muncul dua kali.
          Kolom <strong>Expedisi</strong> dicocokkan dari Scan Retur lewat nomor resi.
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
            <div className="overflow-x-auto scroll-slim">
              <table className="w-full text-sm whitespace-nowrap">
                <thead className="thead-ocs">
                  <tr>
                    {["No.", "No Resi", "Barcode Scan", "Kode SKU", "Nama SKU", "Qty",
                      "Kondisi", "Nama Barang Diterima", "Batch", "Exp. Date",
                      "Scan By", "Scan Date", "Expedisi"].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {rows.slice(0, 100).map((r, i) => (
                    <tr key={i} className={cn(r.produkTidakDikenal && "bg-amber-50/60")}>
                      <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.noResi}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.barcode || "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.sku || "—"}</td>
                      <td className="px-3 py-2">{r.namaSku || "—"}</td>
                      <td className="px-3 py-2">{r.qty}</td>
                      <td className="px-3 py-2">{r.kondisi}</td>
                      <td className="px-3 py-2">{r.namaDiterima || ""}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.batch || "—"}</td>
                      <td className="px-3 py-2">{tanggalExcel(r.edDate)}</td>
                      <td className="px-3 py-2">{r.scanBy}</td>
                      <td className="px-3 py-2 text-xs">{waktuExcel(r.scanDate)}</td>
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
