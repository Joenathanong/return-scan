"use client";

import { useEffect, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import { todayWIB } from "@/lib/date";
import { cn } from "@/lib/utils";
import type { CompanySettings } from "@/types";
import {
  Settings as SettingsIcon, Save, Loader2, CheckCircle2, Building2,
  FileText, Sheet, ExternalLink, Info, Upload, AlertTriangle, X, AlertCircle,
} from "lucide-react";

interface HasilEkspor {
  ok: boolean;
  tanggal: string;
  totalResi?: number;
  berhasil?: number;
  gagal?: number;
  pesan?: string;
  spreadsheetUrl?: string;
  tab: { tab: string; baris: number; status: "ok" | "failed"; error?: string }[];
}

export default function AdminSettingsPage() {
  return (
    <AuthGuard adminOnly>
      <Isi />
    </AuthGuard>
  );
}

function Isi() {
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [menyimpan, setMenyimpan] = useState(false);
  const [tersimpan, setTersimpan] = useState(false);
  const [error, setError] = useState("");

  const [nama, setNama] = useState("");
  const [note, setNote] = useState("");
  const [sheetId, setSheetId] = useState("");

  const [tglEkspor, setTglEkspor] = useState(todayWIB());
  const [mengekspor, setMengekspor] = useState(false);
  const [hasil, setHasil] = useState<HasilEkspor | null>(null);
  const [errorEkspor, setErrorEkspor] = useState("");

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Gagal memuat pengaturan.");
        const s = d.settings as CompanySettings;
        setSettings(s);
        setNama(s.namaPerusahaan);
        setNote(s.noteTandaTerima);
        setSheetId(s.spreadsheetId);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const simpan = async () => {
    setMenyimpan(true);
    setError("");
    setTersimpan(false);
    try {
      const r = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          namaPerusahaan: nama,
          noteTandaTerima: note,
          spreadsheetId: sheetId,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Gagal menyimpan.");
      setSettings(d.settings as CompanySettings);
      setSheetId((d.settings as CompanySettings).spreadsheetId);
      setTersimpan(true);
      setTimeout(() => setTersimpan(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMenyimpan(false);
    }
  };

  const ekspor = async () => {
    setMengekspor(true);
    setHasil(null);
    setErrorEkspor("");
    try {
      const r = await fetch("/api/gsheet/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: tglEkspor }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Ekspor gagal.");
      setHasil(d as HasilEkspor);
    } catch (e) {
      setErrorEkspor(e instanceof Error ? e.message : String(e));
    } finally {
      setMengekspor(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-green-600" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <SettingsIcon className="w-6 h-6 text-green-600" /> Pengaturan Sistem
        </h1>
        <p className="text-slate-500 mt-1">Konfigurasi aplikasi dan integrasi</p>
      </div>

      {/* Perusahaan */}
      <div className="card p-6 space-y-4">
        <h2 className="font-semibold text-slate-800 flex items-center gap-2">
          <Building2 className="w-5 h-5 text-green-600" /> Informasi Perusahaan
        </h2>
        <div>
          <label className="text-sm font-medium text-slate-700 mb-1.5 block">
            Nama Perusahaan
          </label>
          <input value={nama} onChange={(e) => setNama(e.target.value)} className="input-field" />
          <p className="text-xs text-slate-400 mt-1">
            Muncul di tanda terima bagian &quot;Yang Menerima&quot;.
          </p>
        </div>
      </div>

      {/* Note tanda terima */}
      <div className="card p-6 space-y-4">
        <h2 className="font-semibold text-slate-800 flex items-center gap-2">
          <FileText className="w-5 h-5 text-green-600" /> Teks Note Tanda Terima
        </h2>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          className="input-field resize-none"
        />
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-xs font-medium text-amber-700 mb-1">Pratinjau:</p>
          <p className="text-xs text-amber-800">
            <strong>Note : </strong>{note || "—"}
          </p>
        </div>
      </div>

      {/* Google Sheets */}
      <div className="card p-6 space-y-4">
        <h2 className="font-semibold text-slate-800 flex items-center gap-2">
          <Sheet className="w-5 h-5 text-green-600" /> Ekspor Google Sheets
        </h2>

        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex gap-2">
          <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-blue-700 space-y-1.5">
            <p>
              <strong>G-Sheet sekarang hanya tujuan ekspor, bukan tempat penyimpanan.</strong>{" "}
              Database adalah satu-satunya sumber kebenaran. Bagian ini boleh
              dikosongkan — aplikasi tetap berjalan penuh tanpanya.
            </p>
            <p>
              Setiap ekspor menulis ULANG seluruh tab dari database, jadi
              hasilnya selalu sama dengan isi sistem dan tidak mungkin duplikat.
              Berbeda dari sistem lama yang menambah satu baris per scan dan
              sering kehabisan kuota Google.
            </p>
            <p>
              Share spreadsheet ke service account di{" "}
              <code className="bg-blue-100 px-1 rounded">GOOGLE_SHEETS_CLIENT_EMAIL</code>{" "}
              dengan akses <strong>Editor</strong>.
            </p>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700 mb-1.5 block">
            Spreadsheet ID atau URL
          </label>
          <input
            value={sheetId}
            onChange={(e) => setSheetId(e.target.value)}
            className="input-field font-mono text-xs"
            placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
          />
          <p className="text-xs text-slate-400 mt-1">
            Boleh tempel URL lengkapnya — ID-nya diambil otomatis.
          </p>
        </div>

        {settings?.spreadsheetId && (
          <a
            href={`https://docs.google.com/spreadsheets/d/${settings.spreadsheetId}/edit`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-green-600 hover:text-green-800"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Buka Spreadsheet
          </a>
        )}

        <div className="border-t border-slate-100 pt-4 space-y-3">
          <p className="text-sm font-medium text-slate-700">Jalankan ekspor</p>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="flex-1 min-w-[180px]">
              <label className="text-xs text-slate-500 mb-1 block">Tanggal</label>
              <input
                type="date"
                value={tglEkspor}
                onChange={(e) => { setTglEkspor(e.target.value); setHasil(null); setErrorEkspor(""); }}
                className="input-field"
                disabled={mengekspor}
              />
            </div>
            <button
              onClick={ekspor}
              disabled={mengekspor || !settings?.spreadsheetId}
              className="btn-primary"
              title={!settings?.spreadsheetId ? "Isi dan simpan Spreadsheet ID dulu" : ""}
            >
              {mengekspor ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {mengekspor ? "Mengekspor..." : "Ekspor ke G-Sheet"}
            </button>
          </div>

          {errorEkspor && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 flex-1">{errorEkspor}</p>
              <button onClick={() => setErrorEkspor("")} className="text-red-400">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {hasil && (
            <div
              className={cn(
                "rounded-xl border px-4 py-3 space-y-2",
                hasil.gagal ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200"
              )}
            >
              <p
                className={cn(
                  "text-sm font-semibold flex items-center gap-2",
                  hasil.gagal ? "text-amber-800" : "text-green-700"
                )}
              >
                {hasil.gagal
                  ? <AlertTriangle className="w-4 h-4" />
                  : <CheckCircle2 className="w-4 h-4" />}
                {hasil.pesan ??
                  `${hasil.berhasil} tab diperbarui · ${hasil.totalResi} resi`}
              </p>
              {hasil.tab.length > 0 && (
                <div className="space-y-1">
                  {hasil.tab.map((t) => (
                    <div key={t.tab} className="flex items-center gap-2 text-xs">
                      <span
                        className={cn(
                          "font-mono flex-1 truncate",
                          t.status === "ok" ? "text-green-700" : "text-red-700"
                        )}
                      >
                        {t.tab}
                      </span>
                      <span className="text-slate-500 tabular-nums">{t.baris} baris</span>
                      <span className={t.status === "ok" ? "badge-success" : "badge-danger"}>
                        {t.status === "ok" ? "ok" : "gagal"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {hasil.tab.some((t) => t.error) && (
                <p className="text-xs text-red-700">
                  {hasil.tab.find((t) => t.error)?.error}
                </p>
              )}
              {hasil.spreadsheetUrl && (
                <a
                  href={hasil.spreadsheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-green-700 hover:underline"
                >
                  <ExternalLink className="w-3 h-3" /> Buka spreadsheet
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {tersimpan && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> Pengaturan tersimpan.
        </div>
      )}

      <div className="flex justify-end">
        <button onClick={simpan} disabled={menyimpan} className="btn-primary">
          {menyimpan ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Simpan Pengaturan
        </button>
      </div>
    </div>
  );
}
