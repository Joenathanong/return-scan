"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AuthGuard from "@/components/AuthGuard";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { mintaJson, pesanError } from "@/lib/http";
import {
  Loader2, AlertCircle, CheckCircle2, X, Download, ScanLine, XCircle,
  ChevronLeft, ChevronRight, Trash2,
} from "lucide-react";

interface Sesi {
  id: string;
  kode: string;
  catatan: string;
  tanggal: string;
  recordedAt: string;
  oleh: string;
  jumlahBaris: number;
  totalQty: number;
}

interface BarisExport {
  kodeSesi: string;
  tanggal: string;
  barcode: string;
  sku: string;
  namaSku: string;
  qty: number;
  batch: string;
  edDate: string;
  catatan: string;
  inputBy: string;
  inputDate: string;
  produkTidakDikenal: boolean;
}

const hariIniWIB = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());

function awalBulan(): string {
  const d = hariIniWIB();
  return `${d.slice(0, 8)}01`;
}

function waktuWIB(iso: string): string {
  try {
    return new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

/** "2029-02-01" → "01/02/2029". Kosong tetap kosong. */
function tanggalExcel(s: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

export default function RiwayatCancelOrderPage() {
  return (
    <AuthGuard>
      <Penjaga />
    </AuthGuard>
  );
}

/**
 * Penjaga yang sama dengan halaman scan.
 *
 * Datanya memang sudah aman — `requireCancelOrder()` menahannya di server.
 * Yang diperbaiki di sini adalah tampilannya: tanpa penjaga, operator tanpa
 * izin melihat kerangka halaman lengkap dengan pesan error merah yang tidak
 * bisa ia perbuat apa-apa.
 */
function Penjaga() {
  const { appUser } = useAuth();
  if (!appUser) return null;
  if (appUser.role !== "admin" && !appUser.bisaCancelOrder) {
    return (
      <div className="max-w-md card p-6 text-center space-y-2">
        <XCircle className="w-8 h-8 text-gray-300 mx-auto" />
        <p className="font-medium text-heading">Menu Cancel Order belum dibuka</p>
        <p className="text-sm text-gray-500">
          Minta admin mencentang &ldquo;Bisa Cancel Order&rdquo; untuk akun Anda di
          menu Kelola User.
        </p>
      </div>
    );
  }
  return <Isi />;
}

function Isi() {
  const { appUser } = useAuth();
  const isAdmin = appUser?.role === "admin";

  const [dari, setDari] = useState(awalBulan);
  const [sampai, setSampai] = useState(hariIniWIB);
  const [halaman, setHalaman] = useState(1);

  const [rows, setRows] = useState<Sesi[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const [mengunduh, setMengunduh] = useState(false);
  const [maju, setMaju] = useState(0);
  const [batalkan, setBatalkan] = useState<Sesi | null>(null);
  const [alasan, setAlasan] = useState("");
  const [memproses, setMemproses] = useState(false);

  const muat = useCallback(async () => {
    setLoading(true);
    try {
      const d = await mintaJson<{ rows: Sesi[]; total: number; limit: number }>(
        `/api/cancel-order?dari=${dari}&sampai=${sampai}&halaman=${halaman}`
      );
      setRows(d.rows);
      setTotal(d.total);
      setLimit(d.limit);
    } catch (e) {
      setError(pesanError(e, "Gagal memuat riwayat."));
    } finally {
      setLoading(false);
    }
  }, [dari, sampai, halaman]);

  useEffect(() => { muat(); }, [muat]);

  const unduh = async () => {
    setMengunduh(true);
    setError("");
    setMaju(0);
    try {
      const semua: BarisExport[] = [];
      let kursor: string | null = null;

      // Diambil bertahap; rentang sebulan bisa ribuan baris dan satu
      // balasan raksasa akan menyentuh batas memori fungsi serverless.
      for (let putaran = 0; putaran < 500; putaran++) {
        const q = new URLSearchParams({ dari, sampai });
        if (kursor) q.set("kursor", kursor);
        const d = await mintaJson<{
          rows: BarisExport[]; lagi: boolean; kursor: string | null;
        }>(`/api/cancel-order/export?${q}`, { timeoutMs: 60_000 });
        semua.push(...d.rows);
        setMaju(semua.length);
        if (!d.lagi || !d.kursor) break;
        kursor = d.kursor;
      }

      if (semua.length === 0) {
        setInfo("Tidak ada data pada rentang tanggal itu.");
        return;
      }

      const XLSX = await import("xlsx");
      const data = semua.map((r, i) => ({
        "No.": i + 1,
        "Kode Sesi": r.kodeSesi,
        "Tanggal": tanggalExcel(r.tanggal),
        "Barcode Scan": r.barcode || "—",
        "Kode SKU": r.sku || "—",
        "Nama SKU": r.namaSku,
        "Quantity": r.qty,
        "Batch": r.batch || "—",
        "Exp. Date": tanggalExcel(r.edDate),
        "Keterangan": r.catatan,
        "Input By": r.inputBy,
      }));

      const ws = XLSX.utils.json_to_sheet(data);
      ws["!cols"] = [
        { wch: 5 }, { wch: 18 }, { wch: 12 }, { wch: 18 }, { wch: 14 },
        { wch: 34 }, { wch: 9 }, { wch: 12 }, { wch: 12 }, { wch: 28 }, { wch: 18 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Cancel Order");
      XLSX.writeFile(wb, `cancel-order-${dari}_sd_${sampai}.xlsx`);
      setInfo(`${semua.length.toLocaleString("id-ID")} baris diunduh.`);
    } catch (e) {
      setError(pesanError(e, "Gagal membuat file Excel."));
    } finally {
      setMengunduh(false);
    }
  };

  const prosesBatal = async () => {
    if (!batalkan || !alasan.trim()) return;
    setMemproses(true);
    try {
      await mintaJson(
        `/api/cancel-order/${batalkan.id}?alasan=${encodeURIComponent(alasan.trim())}`,
        { method: "DELETE" }
      );
      setInfo(`${batalkan.kode} dibatalkan. Datanya tetap tersimpan untuk audit.`);
      setBatalkan(null);
      setAlasan("");
      muat();
    } catch (e) {
      setError(pesanError(e, "Gagal membatalkan."));
    } finally {
      setMemproses(false);
    }
  };

  const halamanTerakhir = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="shell">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Riwayat Cancel Order</h1>
          <p className="page-sub">
            {total.toLocaleString("id-ID")} sesi pencatatan pada rentang ini
          </p>
        </div>
        <Link href="/cancel-order" className="btn-ghost text-sm">
          <ScanLine className="w-4 h-4" /> Scan baru
        </Link>
      </div>

      {error && <Kotak jenis="error" pesan={error} onTutup={() => setError("")} />}
      {info && <Kotak jenis="info" pesan={info} onTutup={() => setInfo("")} />}

      <div className="card p-5 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium text-gray-600 mb-1.5 block">Dari tanggal</label>
            <input
              type="date" value={dari}
              onChange={(e) => { setDari(e.target.value); setHalaman(1); }}
              className="input-field"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-600 mb-1.5 block">Sampai tanggal</label>
            <input
              type="date" value={sampai}
              onChange={(e) => { setSampai(e.target.value); setHalaman(1); }}
              className="input-field"
            />
          </div>
        </div>
        <button onClick={unduh} disabled={mengunduh} className="btn-primary">
          {mengunduh
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Mengambil {maju.toLocaleString("id-ID")}…</>
            : <><Download className="w-4 h-4" /> Unduh Excel</>}
        </button>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-14">
            <Loader2 className="w-7 h-7 animate-spin text-brand-600" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-center text-gray-400 py-14 text-sm">
            Belum ada pencatatan pada rentang tanggal ini.
          </p>
        ) : (
          <div className="overflow-x-auto scroll-slim">
            <table className="w-full text-sm">
              <thead className="thead-ocs">
                <tr>
                  <th>Kode Sesi</th>
                  <th>Waktu Input</th>
                  <th>Oleh</th>
                  <th className="num">Baris</th>
                  <th className="num">Total Qty</th>
                  <th>Keterangan</th>
                  {isAdmin && <th className="text-center">Aksi</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {rows.map((r) => (
                  <tr key={r.id} className="row-hover">
                    <td className="px-4 py-3 font-mono text-xs text-brand-700 font-semibold whitespace-nowrap">
                      {r.kode}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                      {waktuWIB(r.recordedAt)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{r.oleh}</td>
                    <td className="px-4 py-3 num tabular-nums">{r.jumlahBaris}</td>
                    <td className="px-4 py-3 num tabular-nums font-medium">
                      {r.totalQty.toLocaleString("id-ID")}
                    </td>
                    <td className="px-4 py-3 text-gray-500 max-w-[16rem] truncate">
                      {r.catatan || "—"}
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => { setBatalkan(r); setAlasan(""); }}
                          className="btn-ghost text-xs text-bad hover:bg-bad-bg"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Batalkan
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > limit && (
          <div className="p-3 border-t border-gray-200 flex items-center justify-between text-sm bg-subtle">
            <button
              onClick={() => setHalaman((h) => Math.max(1, h - 1))}
              disabled={halaman <= 1}
              className="btn-ghost text-xs disabled:opacity-30"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Sebelumnya
            </button>
            <span className="text-gray-500">Halaman {halaman} dari {halamanTerakhir}</span>
            <button
              onClick={() => setHalaman((h) => h + 1)}
              disabled={halaman >= halamanTerakhir}
              className="btn-ghost text-xs disabled:opacity-30"
            >
              Berikutnya <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Dialog pembatalan */}
      {batalkan && (
        <div className="fixed inset-0 bg-brand-950/50 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-card shadow-modal p-6 w-full max-w-sm space-y-4 max-h-[90vh] overflow-y-auto scroll-slim">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-heading">Batalkan sesi ini?</h3>
                <p className="text-sm text-gray-500 mt-0.5 font-mono">{batalkan.kode}</p>
              </div>
              <button onClick={() => setBatalkan(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-gray-600">
              {batalkan.jumlahBaris} baris ({batalkan.totalQty.toLocaleString("id-ID")} pcs)
              akan hilang dari riwayat dan ekspor. Datanya <strong>tidak dihapus</strong> —
              ia tetap tersimpan untuk audit.
            </p>

            <input
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
              className="input-field"
              placeholder="Alasan pembatalan…"
              autoFocus
              maxLength={255}
            />

            <div className="flex gap-2">
              <button
                onClick={prosesBatal}
                disabled={memproses || !alasan.trim()}
                className="btn-danger flex-1 justify-center"
              >
                {memproses && <Loader2 className="w-4 h-4 animate-spin" />} Batalkan
              </button>
              <button onClick={() => setBatalkan(null)} className="btn-ghost">Tutup</button>
            </div>
          </div>
        </div>
      )}
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
