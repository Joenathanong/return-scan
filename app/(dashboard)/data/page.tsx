"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { todayWIB, shiftDays } from "@/lib/date";
import { cn } from "@/lib/utils";
import type { Expedisi, ScanRecord } from "@/types";
import {
  Table2, Download, Search, Loader2, AlertCircle, AlertTriangle,
  RefreshCw, Ban, X, CheckCircle2,
} from "lucide-react";

/** Jumlah minimum resi per ekspedisi sebelum pola panjang dianggap bermakna. */
const MIN_GROUP = 3;

/**
 * Deteksi anomali panjang resi.
 *
 * Tiap ekspedisi punya format resi dengan panjang yang khas. Kalau satu resi
 * panjangnya menyimpang dari mayoritas resi ekspedisi yang sama, biasanya itu
 * scan terpotong atau barcode salah baca — bukan resi yang benar-benar beda.
 * Ditandai, tidak dihapus: operator yang memutuskan.
 */
function deteksiAnomali(rows: ScanRecord[]): Set<string> {
  const perExp = new Map<string, ScanRecord[]>();
  for (const r of rows) {
    if (!perExp.has(r.expedisiId)) perExp.set(r.expedisiId, []);
    perExp.get(r.expedisiId)!.push(r);
  }

  const anomali = new Set<string>();
  for (const grup of perExp.values()) {
    if (grup.length < MIN_GROUP) continue;

    const hitung = new Map<number, number>();
    for (const r of grup) {
      const l = r.noResi.length;
      hitung.set(l, (hitung.get(l) ?? 0) + 1);
    }
    // Panjang paling sering = pola normal ekspedisi ini
    let panjangUmum = 0;
    let terbanyak = 0;
    for (const [panjang, n] of hitung) {
      if (n > terbanyak) { terbanyak = n; panjangUmum = panjang; }
    }
    // Kalau pola tidak dominan (< 60%), formatnya memang beragam — lewati.
    if (terbanyak / grup.length < 0.6) continue;

    for (const r of grup) {
      if (r.noResi.length !== panjangUmum) anomali.add(r.id);
    }
  }
  return anomali;
}

export default function DataPage() {
  const { appUser } = useAuth();
  const isAdmin = appUser?.role === "admin";

  const [dateFrom, setDateFrom] = useState(shiftDays(-6));
  const [dateTo, setDateTo] = useState(todayWIB());
  const [expedisiList, setExpedisiList] = useState<Expedisi[]>([]);
  const [expedisiId, setExpedisiId] = useState("");
  const [cari, setCari] = useState("");
  const [hanyaAnomali, setHanyaAnomali] = useState(false);

  const [rows, setRows] = useState<ScanRecord[]>([]);
  const [terpotong, setTerpotong] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const [voidUntuk, setVoidUntuk] = useState<ScanRecord | null>(null);
  const [alasan, setAlasan] = useState("");
  const [memproses, setMemproses] = useState(false);
  const [mengekspor, setMengekspor] = useState(false);

  useEffect(() => {
    fetch("/api/expedisi?all=1", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (r.ok) setExpedisiList(d.rows as Expedisi[]);
      })
      .catch(() => {});
  }, []);

  const muat = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const p = new URLSearchParams({ dateFrom, dateTo, limit: "20000" });
      if (expedisiId) p.set("expedisiId", expedisiId);
      const r = await fetch(`/api/scan?${p}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Gagal memuat data.");
      setRows(d.rows as ScanRecord[]);
      setTerpotong(Boolean(d.terpotong));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, expedisiId]);

  useEffect(() => { muat(); }, [muat]);

  const anomali = useMemo(() => deteksiAnomali(rows), [rows]);

  const tersaring = useMemo(() => {
    const q = cari.trim().toUpperCase();
    return rows.filter((r) => {
      if (hanyaAnomali && !anomali.has(r.id)) return false;
      if (!q) return true;
      return (
        r.noResi.toUpperCase().includes(q) ||
        r.nomorKarung.toUpperCase().includes(q) ||
        r.scannedByName.toUpperCase().includes(q) ||
        r.expedisiName.toUpperCase().includes(q)
      );
    });
  }, [rows, cari, hanyaAnomali, anomali]);

  const batalkan = async () => {
    if (!voidUntuk || !alasan.trim()) return;
    setMemproses(true);
    setError("");
    try {
      const r = await fetch(`/api/scan/${voidUntuk.id}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alasan: alasan.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Gagal membatalkan.");
      setRows((p) => p.filter((x) => x.id !== voidUntuk.id));
      setInfo(`Resi ${voidUntuk.noResi} dibatalkan. Kode resinya bebas dipakai lagi.`);
      setVoidUntuk(null);
      setAlasan("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMemproses(false);
    }
  };

  const eksporExcel = async () => {
    setMengekspor(true);
    try {
      const XLSX = await import("xlsx");
      const data = tersaring.map((r, i) => ({
        "No.": i + 1,
        "Kode Resi": r.noResi,
        "No. Karung": r.nomorKarung,
        Ekspedisi: r.expedisiName,
        "Di Scan Oleh": r.scannedByName,
        Tanggal: r.date,
        Jam: new Date(r.scannedAt).toLocaleTimeString("id-ID", {
          timeZone: "Asia/Jakarta",
          hour: "2-digit", minute: "2-digit", second: "2-digit",
        }),
        Catatan: anomali.has(r.id) ? "Panjang resi tidak biasa" : "",
      }));

      const ws = XLSX.utils.json_to_sheet(data);
      ws["!cols"] = [
        { wch: 6 }, { wch: 24 }, { wch: 12 }, { wch: 22 },
        { wch: 20 }, { wch: 12 }, { wch: 10 }, { wch: 24 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Data Resi");
      XLSX.writeFile(wb, `scan-retur_${dateFrom}_sd_${dateTo}.xlsx`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMengekspor(false);
    }
  };

  return (
    <div className="max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Table2 className="w-6 h-6 text-green-600" /> Data &amp; Export
          </h1>
          <p className="text-slate-500 mt-1">
            {tersaring.length.toLocaleString("id-ID")} resi ditampilkan
            {anomali.size > 0 && (
              <span className="text-amber-600"> · {anomali.size} perlu dicek</span>
            )}
          </p>
        </div>
        <button
          onClick={eksporExcel}
          disabled={mengekspor || tersaring.length === 0}
          className="btn-primary"
        >
          {mengekspor ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Export Excel
        </button>
      </div>

      {/* Filter */}
      <div className="card p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Dari</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-field" />
        </div>
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Sampai</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-field" />
        </div>
        <div className="min-w-[160px]">
          <label className="text-xs text-slate-500 mb-1 block">Ekspedisi</label>
          <select value={expedisiId} onChange={(e) => setExpedisiId(e.target.value)} className="input-field">
            <option value="">Semua</option>
            {expedisiList.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="text-xs text-slate-500 mb-1 block">Cari</label>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              className="input-field pl-9"
              placeholder="Resi, karung, nama..."
            />
          </div>
        </div>
        <button onClick={muat} className="btn-secondary">
          <RefreshCw className="w-4 h-4" /> Muat ulang
        </button>
      </div>

      {anomali.size > 0 && (
        <button
          onClick={() => setHanyaAnomali((v) => !v)}
          className={cn(
            "w-full rounded-xl border px-4 py-3 flex items-center gap-2 text-left transition-colors",
            hanyaAnomali
              ? "bg-amber-100 border-amber-300"
              : "bg-amber-50 border-amber-200 hover:bg-amber-100"
          )}
        >
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <p className="text-sm text-amber-800 flex-1">
            <strong>{anomali.size} resi</strong> panjangnya menyimpang dari pola
            ekspedisinya — kemungkinan scan terpotong.
          </p>
          <span className="text-xs text-amber-700 font-medium">
            {hanyaAnomali ? "Tampilkan semua" : "Tampilkan yang ini saja"}
          </span>
        </button>
      )}

      {terpotong && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            Hasil mencapai batas 20.000 baris dan kemungkinan terpotong.
            Persempit rentang tanggal untuk melihat seluruhnya.
          </p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 flex-1">{error}</p>
          <button onClick={() => setError("")} className="text-red-400"><X className="w-4 h-4" /></button>
        </div>
      )}
      {info && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-green-700 flex-1">{info}</p>
          <button onClick={() => setInfo("")} className="text-green-500"><X className="w-4 h-4" /></button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-7 h-7 animate-spin text-green-600" />
        </div>
      ) : tersaring.length === 0 ? (
        <div className="card p-8 text-center text-slate-400">
          <Table2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Tidak ada data untuk filter ini.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto scroll-slim">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-left text-xs text-slate-500 uppercase tracking-wide">
                  <th className="px-3 py-2.5 w-14 text-right">No.</th>
                  <th className="px-3 py-2.5">Kode Resi</th>
                  <th className="px-3 py-2.5 w-20">Karung</th>
                  <th className="px-3 py-2.5">Ekspedisi</th>
                  <th className="px-3 py-2.5">Di Scan Oleh</th>
                  <th className="px-3 py-2.5 w-24">Tanggal</th>
                  <th className="px-3 py-2.5 w-20">Jam</th>
                  {isAdmin && <th className="px-3 py-2.5 w-12" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tersaring.slice(0, 1000).map((r, i) => {
                  const aneh = anomali.has(r.id);
                  return (
                    <tr key={r.id} className={cn("hover:bg-slate-50", aneh && "bg-amber-50/60")}>
                      <td className="px-3 py-2 text-right text-slate-400 tabular-nums">{i + 1}</td>
                      <td className="px-3 py-2 font-mono font-medium text-slate-800">
                        <span className="flex items-center gap-1.5">
                          {r.noResi}
                          {aneh && (
                            <span
                              className="text-amber-600"
                              title={`Panjang ${r.noResi.length} karakter — berbeda dari pola ${r.expedisiName}`}
                            >
                              <AlertTriangle className="w-3.5 h-3.5" />
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-600">#{r.nomorKarung}</td>
                      <td className="px-3 py-2 text-slate-600 truncate max-w-[160px]">{r.expedisiName}</td>
                      <td className="px-3 py-2 text-slate-600 truncate max-w-[140px]">{r.scannedByName}</td>
                      <td className="px-3 py-2 text-slate-500 tabular-nums">{r.date}</td>
                      <td className="px-3 py-2 text-slate-500 tabular-nums">
                        {new Date(r.scannedAt).toLocaleTimeString("id-ID", {
                          timeZone: "Asia/Jakarta",
                          hour: "2-digit", minute: "2-digit", second: "2-digit",
                        })}
                      </td>
                      {isAdmin && (
                        <td className="px-3 py-2">
                          <button
                            onClick={() => { setVoidUntuk(r); setAlasan(""); }}
                            className="text-slate-300 hover:text-red-600 transition-colors"
                            title="Batalkan resi ini"
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {tersaring.length > 1000 && (
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-500">
              Menampilkan 1.000 dari {tersaring.length.toLocaleString("id-ID")} baris.
              Export Excel tetap berisi seluruhnya.
            </div>
          )}
        </div>
      )}

      {/* Dialog pembatalan */}
      {voidUntuk && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4">
            <div>
              <h3 className="font-semibold text-slate-900">Batalkan Resi</h3>
              <p className="font-mono text-sm text-slate-600 mt-1">{voidUntuk.noResi}</p>
              <p className="text-xs text-slate-500 mt-1">
                {voidUntuk.expedisiName} · Karung #{voidUntuk.nomorKarung} · {voidUntuk.date}
              </p>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
              <p className="text-xs text-blue-700">
                Barisnya tidak dihapus — hanya ditandai dibatalkan, dan jejaknya
                tetap tersimpan untuk audit. Kode resi ini akan bebas di-scan lagi.
              </p>
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">
                Alasan pembatalan
              </label>
              <input
                value={alasan}
                onChange={(e) => setAlasan(e.target.value)}
                className="input-field"
                placeholder="mis. salah scan, resi ganda fisik"
                autoFocus
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={batalkan}
                disabled={memproses || !alasan.trim()}
                className="btn-danger flex-1 justify-center"
              >
                {memproses && <Loader2 className="w-4 h-4 animate-spin" />} Batalkan
              </button>
              <button onClick={() => setVoidUntuk(null)} className="btn-ghost">Tutup</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
