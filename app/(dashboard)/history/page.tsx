"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { todayWIB, shiftDays, formatTanggalPanjang } from "@/lib/date";
import { cn } from "@/lib/utils";
import type { Karung, ScanRecord } from "@/types";
import {
  History as Loader2, AlertCircle, Package, Lock, Unlock,
  Printer, ChevronDown, ChevronRight, Trash2, X, RefreshCw,
} from "lucide-react";

export default function HistoryPage() {
  const { appUser } = useAuth();
  const isAdmin = appUser?.role === "admin";

  const [dateFrom, setDateFrom] = useState(shiftDays(-6));
  const [dateTo, setDateTo] = useState(todayWIB());
  const [rows, setRows] = useState<Karung[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [terbuka, setTerbuka] = useState<string | null>(null);
  const [isiKarung, setIsiKarung] = useState<Record<string, ScanRecord[]>>({});
  const [muatIsi, setMuatIsi] = useState(false);

  const muat = useCallback(async (from: string, to: string) => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(
        `/api/karung?dateFrom=${encodeURIComponent(from)}&dateTo=${encodeURIComponent(to)}`,
        { cache: "no-store" }
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Gagal memuat riwayat.");
      setRows(d.rows as Karung[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { muat(dateFrom, dateTo); }, [dateFrom, dateTo, muat]);

  const bukaKarung = async (k: Karung) => {
    if (terbuka === k.id) { setTerbuka(null); return; }
    setTerbuka(k.id);
    if (isiKarung[k.id]) return;

    setMuatIsi(true);
    try {
      const r = await fetch(`/api/scan?karungId=${encodeURIComponent(k.id)}`, {
        cache: "no-store",
      });
      const d = await r.json();
      if (r.ok) setIsiKarung((p) => ({ ...p, [k.id]: d.rows as ScanRecord[] }));
    } catch {
      /* daftar isi bersifat pelengkap */
    } finally {
      setMuatIsi(false);
    }
  };

  const aksiKarung = async (k: Karung, aksi: "unlock" | "relock") => {
    setError("");
    try {
      const r = await fetch(`/api/karung/${k.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aksi }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Gagal mengubah karung.");
      setRows((p) => p.map((x) => (x.id === k.id ? (d.karung as Karung) : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const hapusKarung = async (k: Karung) => {
    setError("");
    try {
      const r = await fetch(`/api/karung/${k.id}`, { method: "DELETE" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Gagal menghapus karung.");
      setRows((p) => p.filter((x) => x.id !== k.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Kelompokkan per tanggal supaya mudah dibaca
  const perTanggal: Record<string, Karung[]> = {};
  for (const k of rows) {
    (perTanggal[k.date] ??= []).push(k);
  }
  const tanggalUrut = Object.keys(perTanggal).sort((a, b) => b.localeCompare(a));

  const totalResi = rows.reduce((a, k) => a + k.totalResi, 0);

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="page-title">Riwayat Karung</h1>
        <p className="page-sub">
          {rows.length} karung · {totalResi.toLocaleString("id-ID")} resi
        </p>
      </div>

      <div className="card p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Dari</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="input-field"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Sampai</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="input-field"
          />
        </div>
        <button onClick={() => muat(dateFrom, dateTo)} className="btn-secondary">
          <RefreshCw className="w-4 h-4" /> Muat ulang
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex gap-2">
          <AlertCircle className="w-4 h-4 text-bad flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 flex-1">{error}</p>
          <button onClick={() => setError("")} className="text-red-400">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-7 h-7 animate-spin text-brand-600" />
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-8 text-center text-gray-400">
          <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Tidak ada karung pada rentang tanggal ini.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {tanggalUrut.map((tgl) => (
            <div key={tgl}>
              <p className="text-sm font-semibold text-gray-600 mb-2">
                {formatTanggalPanjang(tgl)}
                <span className="font-normal text-gray-400">
                  {" · "}{perTanggal[tgl].length} karung
                </span>
              </p>

              <div className="card overflow-hidden divide-y divide-gray-200">
                {perTanggal[tgl].map((k) => {
                  const isOpen = terbuka === k.id;
                  return (
                    <div key={k.id}>
                      <div className="p-4 flex flex-wrap items-center gap-3">
                        <button
                          onClick={() => bukaKarung(k)}
                          className="flex items-center gap-3 flex-1 min-w-[180px] text-left"
                        >
                          {isOpen
                            ? <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
                            : <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />}
                          <div>
                            <p className="font-medium text-heading text-sm">
                              {k.expedisiName} · Karung #{k.nomorKarung}
                            </p>
                            <p className="text-xs text-gray-500">
                              {k.totalResi} resi · dibuat {k.createdByName}
                            </p>
                          </div>
                        </button>

                        <div className="flex gap-1.5 items-center flex-wrap">
                          <span
                            className={
                              k.status === "locked" ? "badge-danger"
                              : k.status === "admin_unlocked" ? "badge-warning"
                              : "badge-success"
                            }
                          >
                            {k.status === "locked" ? "Terkunci"
                              : k.status === "admin_unlocked" ? "Dibuka admin"
                              : "Terbuka"}
                          </span>

                          <Link
                            href={`/print?karungId=${k.id}`}
                            className="btn-ghost text-xs"
                            title="Cetak tanda terima"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </Link>

                          {isAdmin && k.status === "locked" && (
                            <button
                              onClick={() => aksiKarung(k, "unlock")}
                              className="btn-ghost text-xs text-amber-700 hover:bg-amber-50"
                              title="Buka 24 jam"
                            >
                              <Unlock className="w-3.5 h-3.5" /> Buka
                            </button>
                          )}
                          {isAdmin && k.status === "admin_unlocked" && (
                            <button
                              onClick={() => aksiKarung(k, "relock")}
                              className="btn-ghost text-xs"
                              title="Kunci lagi"
                            >
                              <Lock className="w-3.5 h-3.5" /> Kunci
                            </button>
                          )}
                          {isAdmin && k.totalResi === 0 && (
                            <button
                              onClick={() => hapusKarung(k)}
                              className="btn-ghost text-xs text-red-600 hover:bg-red-50"
                              title="Hapus karung kosong"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {isOpen && (
                        <div className="bg-gray-50 px-4 py-3 border-t border-gray-200">
                          {muatIsi && !isiKarung[k.id] ? (
                            <div className="flex justify-center py-4">
                              <Loader2 className="w-5 h-5 animate-spin text-brand-600" />
                            </div>
                          ) : (isiKarung[k.id]?.length ?? 0) === 0 ? (
                            <p className="text-xs text-gray-400 text-center py-3">
                              Karung ini kosong.
                            </p>
                          ) : (
                            <div className="max-h-72 overflow-y-auto scroll-slim space-y-1 pr-1">
                              {isiKarung[k.id].map((s, i) => (
                                <div key={s.id} className="flex items-center gap-2 text-xs">
                                  <span className="text-gray-300 tabular-nums w-8 text-right">
                                    {i + 1}
                                  </span>
                                  <span className="font-mono text-ink flex-1 truncate">
                                    {s.noResi}
                                  </span>
                                  <span className="text-gray-400 truncate max-w-[120px]">
                                    {s.scannedByName}
                                  </span>
                                  <span className="text-gray-400 tabular-nums">
                                    {new Date(s.scannedAt).toLocaleTimeString("id-ID", {
                                      timeZone: "Asia/Jakarta",
                                      hour: "2-digit", minute: "2-digit", second: "2-digit",
                                    })}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
