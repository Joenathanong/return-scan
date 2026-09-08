"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { todayWIB, shiftDays } from "@/lib/date";
import { cn } from "@/lib/utils";
import type { Expedisi, Karung, ScanRecord } from "@/types";
import {
  Table2, Download, Search, Loader2, AlertCircle, AlertTriangle,
  RefreshCw, Trash2, X, CheckCircle2, Pencil, Check,
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

  // ── Keadaan edit baris ────────────────────────────────────────────────────
  const [editId, setEditId] = useState<string | null>(null);
  const [editResi, setEditResi] = useState("");
  const [editKarung, setEditKarung] = useState("");
  /** Karung yang tersedia untuk baris yang sedang diedit (satu tanggal). */
  const [karungPilihan, setKarungPilihan] = useState<Karung[]>([]);
  const [muatKarung, setMuatKarung] = useState(false);
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
      setInfo(`Resi ${voidUntuk.noResi} dihapus. Kodenya bebas di-scan lagi.`);
      setVoidUntuk(null);
      setAlasan("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMemproses(false);
    }
  };

  /**
   * Buka mode edit untuk satu baris.
   *
   * Daftar karung diambil untuk TANGGAL baris itu — bukan hanya ekspedisinya —
   * supaya resi yang masuk ke ekspedisi keliru masih bisa dipindahkan ke
   * karung ekspedisi lain di hari yang sama. Tanggal scan otomatis mengikuti
   * karung tujuan, jadi tidak mungkin ada isi karung yang tanggalnya berbeda
   * dari karungnya.
   */
  const mulaiEdit = async (r: ScanRecord) => {
    setEditId(r.id);
    setEditResi(r.noResi);
    setEditKarung(r.karungId);
    setError("");
    setMuatKarung(true);
    try {
      const res = await fetch(`/api/karung?date=${encodeURIComponent(r.date)}`, {
        cache: "no-store",
      });
      const d = await res.json();
      if (res.ok) setKarungPilihan(d.rows as Karung[]);
    } catch {
      // Daftar karung gagal dimuat — kode resi tetap bisa diperbaiki.
    } finally {
      setMuatKarung(false);
    }
  };

  const batalEdit = () => {
    setEditId(null);
    setEditResi("");
    setEditKarung("");
    setKarungPilihan([]);
  };

  const simpanEdit = async (r: ScanRecord) => {
    const resiBaru = editResi.trim().toUpperCase();
    if (!resiBaru) { setError("Kode resi tidak boleh kosong."); return; }
    if (resiBaru === r.noResi && editKarung === r.karungId) { batalEdit(); return; }

    setMemproses(true);
    setError("");
    try {
      const res = await fetch(`/api/scan/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noResi: resiBaru, karungId: editKarung }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Gagal menyimpan perubahan.");

      if (d.scan) {
        const baru = d.scan as ScanRecord;
        setRows((p) => p.map((x) => (x.id === r.id ? baru : x)));
        const pindah = baru.karungId !== r.karungId;
        setInfo(
          `Resi ${baru.noResi} diperbarui` +
          (pindah ? ` dan dipindahkan ke karung #${baru.nomorKarung} (${baru.expedisiName}).` : ".")
        );
      }
      batalEdit();
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
          <h1 className="page-title">Data &amp; Export</h1>
          <p className="page-sub">
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
          <label className="text-xs text-gray-500 mb-1 block">Dari</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-field" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Sampai</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-field" />
        </div>
        <div className="min-w-[160px]">
          <label className="text-xs text-gray-500 mb-1 block">Ekspedisi</label>
          <select value={expedisiId} onChange={(e) => setExpedisiId(e.target.value)} className="input-field">
            <option value="">Semua</option>
            {expedisiList.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="text-xs text-gray-500 mb-1 block">Cari</label>
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
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
          <AlertCircle className="w-4 h-4 text-bad flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 flex-1">{error}</p>
          <button onClick={() => setError("")} className="text-red-400"><X className="w-4 h-4" /></button>
        </div>
      )}
      {info && (
        <div className="bg-brand-50 border border-brand-200 rounded-xl px-4 py-3 flex gap-2">
          <CheckCircle2 className="w-4 h-4 text-ok-strong flex-shrink-0 mt-0.5" />
          <p className="text-sm text-brand-700 flex-1">{info}</p>
          <button onClick={() => setInfo("")} className="text-brand-500"><X className="w-4 h-4" /></button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-7 h-7 animate-spin text-brand-600" />
        </div>
      ) : tersaring.length === 0 ? (
        <div className="card p-8 text-center text-gray-400">
          <Table2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Tidak ada data untuk filter ini.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto scroll-slim">
            <table className="w-full text-sm">
              <thead className="thead-ocs">
                <tr>
                  <th className="px-3 py-2.5 w-14 text-right">No.</th>
                  <th className="px-3 py-2.5">Kode Resi</th>
                  <th className="px-3 py-2.5 w-20">Karung</th>
                  <th className="px-3 py-2.5">Ekspedisi</th>
                  <th className="px-3 py-2.5">Di Scan Oleh</th>
                  <th className="px-3 py-2.5 w-24">Tanggal</th>
                  <th className="px-3 py-2.5 w-20">Jam</th>
                  {isAdmin && <th className="px-3 py-2.5 w-20 text-center">Aksi</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {tersaring.slice(0, 1000).map((r, i) => {
                  const aneh = anomali.has(r.id);
                  const sedangDiedit = editId === r.id;

                  if (sedangDiedit) {
                    return (
                      <tr key={r.id} className="bg-brand-50">
                        <td className="px-3 py-2 text-right text-gray-400 tabular-nums">{i + 1}</td>
                        <td className="px-3 py-2">
                          <input
                            value={editResi}
                            onChange={(e) => setEditResi(e.target.value.toUpperCase())}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") simpanEdit(r);
                              if (e.key === "Escape") batalEdit();
                            }}
                            className="input-field py-1 font-mono text-sm"
                            autoFocus
                            disabled={memproses}
                          />
                        </td>
                        {/* Karung dan ekspedisi jadi satu pilihan: memindahkan
                            resi ke karung lain otomatis memindahkan ekspedisi
                            dan tanggalnya juga. */}
                        <td className="px-3 py-2" colSpan={2}>
                          <select
                            value={editKarung}
                            onChange={(e) => setEditKarung(e.target.value)}
                            className="input-field py-1 text-sm"
                            disabled={memproses || muatKarung}
                          >
                            {muatKarung && <option>Memuat karung...</option>}
                            {!muatKarung && karungPilihan.length === 0 && (
                              <option value={r.karungId}>
                                #{r.nomorKarung} — {r.expedisiName}
                              </option>
                            )}
                            {karungPilihan.map((k) => (
                              <option key={k.id} value={k.id}>
                                #{k.nomorKarung} — {k.expedisiName}
                                {k.status === "locked" ? " (terkunci)" : ""}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-gray-400 truncate max-w-[140px]">{r.scannedByName}</td>
                        <td className="px-3 py-2 text-gray-400 tabular-nums">{r.date}</td>
                        <td className="px-3 py-2 text-gray-400 tabular-nums">
                          {new Date(r.scannedAt).toLocaleTimeString("id-ID", {
                            timeZone: "Asia/Jakarta",
                            hour: "2-digit", minute: "2-digit", second: "2-digit",
                          })}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => simpanEdit(r)}
                              disabled={memproses}
                              className="p-1 rounded text-brand-700 hover:bg-brand-100 disabled:opacity-40"
                              title="Simpan (Enter)"
                            >
                              {memproses
                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                : <Check className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={batalEdit}
                              disabled={memproses}
                              className="p-1 rounded text-gray-400 hover:bg-gray-200"
                              title="Batal (Esc)"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={r.id} className={cn("hover:bg-gray-50", aneh && "bg-amber-50/60")}>
                      <td className="px-3 py-2 text-right text-gray-400 tabular-nums">{i + 1}</td>
                      <td className="px-3 py-2 font-mono font-medium text-heading">
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
                      <td className="px-3 py-2 text-gray-600">#{r.nomorKarung}</td>
                      <td className="px-3 py-2 text-gray-600 truncate max-w-[160px]">{r.expedisiName}</td>
                      <td className="px-3 py-2 text-gray-600 truncate max-w-[140px]">{r.scannedByName}</td>
                      <td className="px-3 py-2 text-gray-500 tabular-nums">{r.date}</td>
                      <td className="px-3 py-2 text-gray-500 tabular-nums">
                        {new Date(r.scannedAt).toLocaleTimeString("id-ID", {
                          timeZone: "Asia/Jakarta",
                          hour: "2-digit", minute: "2-digit", second: "2-digit",
                        })}
                      </td>
                      {isAdmin && (
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => mulaiEdit(r)}
                              disabled={editId !== null}
                              className="p-1 rounded text-gray-300 hover:text-brand-700 hover:bg-brand-50
                                         disabled:opacity-30 disabled:hover:text-gray-300 transition-colors"
                              title="Ubah kode resi atau pindah karung"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => { setVoidUntuk(r); setAlasan(""); }}
                              disabled={editId !== null}
                              className="p-1 rounded text-gray-300 hover:text-red-600 hover:bg-red-50
                                         disabled:opacity-30 disabled:hover:text-gray-300 transition-colors"
                              title="Hapus resi ini"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {tersaring.length > 1000 && (
            <div className="px-4 py-3 bg-gray-50 border-t border-gray-300 text-xs text-gray-500">
              Menampilkan 1.000 dari {tersaring.length.toLocaleString("id-ID")} baris.
              Export Excel tetap berisi seluruhnya.
            </div>
          )}
        </div>
      )}

      {/* Dialog pembatalan */}
      {voidUntuk && (
        <div className="fixed inset-0 bg-brand-950/50 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-card shadow-modal p-6 w-full max-w-sm space-y-4 max-h-[90vh] overflow-y-auto scroll-slim">
            <div>
              <h3 className="font-semibold text-heading flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-red-600" /> Hapus Resi?</h3>
              <p className="font-mono text-sm text-gray-600 mt-1">{voidUntuk.noResi}</p>
              <p className="text-xs text-gray-500 mt-1">
                {voidUntuk.expedisiName} · Karung #{voidUntuk.nomorKarung} · {voidUntuk.date}
              </p>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              <p className="text-xs text-red-700">
                Resi ini akan <strong>hilang dari tabel, laporan, ekspor Excel,
                tanda terima, dan hitungan dashboard</strong>, dan kodenya bebas
                di-scan ulang.
              </p>
            </div>
            <div className="bg-gray-50 border border-gray-300 rounded-xl px-3 py-2">
              <p className="text-xs text-gray-600">
                Di dalam database barisnya tetap disimpan dan ditandai dibatalkan,
                supaya jejak siapa men-scan apa tidak putus — penting kalau resi
                ini sudah tercetak di tanda terima yang ditandatangani.
              </p>
            </div>

            <div>
              <label className="text-sm font-medium text-ink mb-1.5 block">
                Alasan penghapusan <span className="text-red-600">*</span>
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
                {memproses
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Trash2 className="w-4 h-4" />}
                Ya, Hapus
              </button>
              <button onClick={() => setVoidUntuk(null)} className="btn-ghost">Batal</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
