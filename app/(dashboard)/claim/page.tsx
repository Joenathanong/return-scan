"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import AuthGuard from "@/components/AuthGuard";
import { cn } from "@/lib/utils";
import { getPrefixesForExpedisi } from "@/lib/expedisi-map";
import {
  Upload, FileSpreadsheet, Check, X, AlertCircle, Loader2,
  Edit2, Search, RefreshCw, Settings2, Database,
  Package, ExternalLink, ArrowUpDown, ChevronDown, ChevronUp,
  Plus, Trash2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedRow {
  noResi:      string;
  barcode:     string;
  noItem:      string;
  sku:         string;
  qty:         string;
  kondisi:     string;
  batch:       string;
  expDate:     string;
  createdBy:   string;
  createdDate: string;
}

interface SheetRow extends ParsedRow {
  gsheetRow: number;
  no:        string;
  expedisi:  string;
}

/**
 * Satu entri konfigurasi G-Sheet per expedisi, seperti dikembalikan
 * /api/claim/config. Kuncinya tetap KODE expedisi seperti dulu.
 *
 * `expedisiId` / `expedisiName` hanya tautan opsional ke master ekspedisi —
 * diisi server kalau kodenya kebetulan terdaftar, null kalau tidak. Halaman
 * ini tidak memakainya: penyimpanan dilakukan per kode.
 */
interface ClaimExpedisiSheet {
  spreadsheetId:  string;
  url:            string;
  expedisiId?:    string | null;
  expedisiName?:  string | null;
}

interface ClaimSheetConfig {
  masterSpreadsheetId: string;
  expedisiSheets:      Record<string, ClaimExpedisiSheet>;
}

type TabSection = "upload" | "edit";
type SortDir    = "asc" | "desc";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EXP_COLORS: Record<string, string> = {
  JX:        "bg-sky-100 text-sky-800",
  SPXID:     "bg-orange-100 text-orange-800",
  GTL:       "bg-emerald-100 text-emerald-800",
  TKP:       "bg-green-100 text-green-800",
  JNE:       "bg-red-100 text-red-800",
  SICEPAT:   "bg-purple-100 text-purple-800",
  GRAB:      "bg-yellow-100 text-yellow-800",
  IDEXPRESS: "bg-pink-100 text-pink-800",
  LION:      "bg-amber-100 text-amber-800",
  NINJA:     "bg-indigo-100 text-indigo-800",
  ALL:       "bg-slate-100 text-slate-700",
};
const expColor = (c: string) => EXP_COLORS[c] ?? "bg-indigo-100 text-indigo-800";

const GSHEET_URL = (id: string) => `https://docs.google.com/spreadsheets/d/${id}`;

const pesanError = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ClaimPage() {
  return (
    <AuthGuard adminOnly>
      <Isi />
    </AuthGuard>
  );
}

function Isi() {
  const [section, setSection]           = useState<TabSection>("upload");
  const [config, setConfig]             = useState<ClaimSheetConfig>({
    masterSpreadsheetId: "",
    expedisiSheets:      {},
  });
  const [configLoaded, setConfigLoaded] = useState(false);
  const [configError, setConfigError]   = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/claim/config", { cache: "no-store" });
        const d = (await r.json()) as Partial<ClaimSheetConfig> & { error?: string };
        if (!r.ok) throw new Error(d.error || "Gagal memuat konfigurasi claim.");

        setConfig({
          masterSpreadsheetId: d.masterSpreadsheetId ?? "",
          expedisiSheets:      d.expedisiSheets ?? {},
        });
        setConfigLoaded(true);
      } catch (e) {
        setConfigError(pesanError(e));
      }
    })();
  }, []);

  /** PATCH /api/claim/config selalu mengembalikan konfigurasi terbaru. */
  const patchConfig = useCallback(
    async (body: Record<string, unknown>): Promise<ClaimSheetConfig> => {
      const r = await fetch("/api/claim/config", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      const d = (await r.json()) as Partial<ClaimSheetConfig> & { error?: string };
      if (!r.ok) throw new Error(d.error || "Gagal menyimpan konfigurasi claim.");
      return {
        masterSpreadsheetId: d.masterSpreadsheetId ?? "",
        expedisiSheets:      d.expedisiSheets ?? {},
      };
    },
    []
  );

  const handleSaveMaster = async (id: string) => {
    const next = await patchConfig({ masterSpreadsheetId: id.trim() });
    setConfig(next);
  };

  /**
   * Sheet yang dibuat otomatis oleh /api/claim/upload — simpan semuanya
   * sekaligus dalam satu PATCH, lalu pakai respons PATCH sebagai state baru.
   */
  const handleNewSheets = async (
    newSheets: Record<string, { spreadsheetId: string; url: string }>
  ) => {
    const sheets = Object.entries(newSheets).map(([code, s]) => ({
      code,
      spreadsheetId: s.spreadsheetId,
      url:           s.url,
    }));
    if (sheets.length === 0) return;
    const next = await patchConfig({ sheets });
    setConfig(next);
  };

  const handleSaveExpedisiId = async (code: string, spreadsheetId: string) => {
    const id = spreadsheetId.trim();
    const next = await patchConfig({
      sheet: { code: code.trim().toUpperCase(), spreadsheetId: id, url: GSHEET_URL(id) },
    });
    setConfig(next);
  };

  return (
    <div className="max-w-full mx-auto space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Package className="w-6 h-6 text-green-600" /> Kelola Claim
        </h1>
      </div>

      {/* Error konfigurasi */}
      {configError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-3 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">{configError}</span>
          <button onClick={() => setConfigError("")}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Konfigurasi */}
      {configLoaded && (
        <ConfigSection
          config={config}
          onSaveMaster={handleSaveMaster}
          onSaveExpedisiId={handleSaveExpedisiId}
          onError={setConfigError}
        />
      )}

      {/* Tab switcher */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {(["upload", "edit"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setSection(t)}
            className={cn(
              "px-5 py-2 rounded-lg text-sm font-medium transition-all",
              section === t
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            )}
          >
            {t === "upload"
              ? <span className="flex items-center gap-1.5"><Upload className="w-4 h-4" />Upload Data</span>
              : <span className="flex items-center gap-1.5"><Database className="w-4 h-4" />Edit Data</span>}
          </button>
        ))}
      </div>

      {section === "upload"
        ? <UploadTab config={config} onNewSheets={handleNewSheets} />
        : <EditTab config={config} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// KONFIGURASI SECTION
// ═══════════════════════════════════════════════════════════════════════════════

function ConfigSection({
  config,
  onSaveMaster,
  onSaveExpedisiId,
  onError,
}: {
  config: ClaimSheetConfig;
  onSaveMaster: (id: string) => Promise<void>;
  onSaveExpedisiId: (code: string, id: string) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [masterInput, setMasterInput] = useState(config.masterSpreadsheetId);
  const [saving, setSaving]           = useState(false);
  const [editCode, setEditCode]       = useState<string | null>(null);
  const [editInput, setEditInput]     = useState("");
  const [savingCode, setSavingCode]   = useState<string | null>(null);
  const [addMode, setAddMode]         = useState(false);
  const [newCode, setNewCode]         = useState("");
  const [newId, setNewId]             = useState("");

  useEffect(() => { setMasterInput(config.masterSpreadsheetId); }, [config.masterSpreadsheetId]);

  const expedisiEntries = Object.entries(config.expedisiSheets ?? {}).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  return (
    <div className="card p-5 space-y-5">
      <p className="font-semibold text-slate-700 flex items-center gap-2 text-sm">
        <Settings2 className="w-4 h-4 text-slate-400" /> Konfigurasi Google Sheets
      </p>

      {/* Master sheet */}
      <div>
        <label className="text-xs text-slate-500 mb-1.5 block">
          Master Spreadsheet{" "}
          <span className="text-slate-400">(semua data — tab ALL)</span>
        </label>
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={masterInput}
            onChange={(e) => setMasterInput(e.target.value)}
            placeholder="Spreadsheet ID dari URL Google Sheets"
            className="input-field flex-1 font-mono text-xs"
          />
          <button
            onClick={async () => {
              setSaving(true);
              onError("");
              try {
                await onSaveMaster(masterInput);
              } catch (e) {
                onError(pesanError(e));
              } finally {
                setSaving(false);
              }
            }}
            disabled={saving || !masterInput.trim()}
            className="btn-primary flex-shrink-0"
          >
            {saving
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Check className="w-4 h-4" />}
            Simpan
          </button>
          {config.masterSpreadsheetId && (
            <a
              href={GSHEET_URL(config.masterSpreadsheetId)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary flex-shrink-0 flex items-center gap-1"
            >
              <ExternalLink className="w-4 h-4" /> Buka
            </a>
          )}
        </div>
        {!config.masterSpreadsheetId && (
          <p className="text-xs text-amber-600 mt-1.5">
            Buat Google Sheet baru, salin ID dari URL, tempel di sini
          </p>
        )}
      </div>

      {/* Per-expedisi sheets */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs text-slate-500">
            Per-Expedisi Spreadsheets{" "}
            <span className="text-slate-400">(1 file G-Sheet per expedisi)</span>
          </label>
          <button
            onClick={() => setAddMode((v) => !v)}
            className="text-xs text-green-600 hover:text-green-800 flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> Tambah Manual
          </button>
        </div>

        {expedisiEntries.length === 0 && !addMode ? (
          <p className="text-xs text-slate-400 italic py-2">
            Belum ada — akan otomatis dibuat saat pertama kali upload data.
          </p>
        ) : (
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs text-slate-500">
                  <th className="px-3 py-2 text-left w-24">Expedisi</th>
                  <th className="px-3 py-2 text-left w-56">Prefix Resi Dikenali</th>
                  <th className="px-3 py-2 text-left">Spreadsheet ID</th>
                  <th className="px-3 py-2 text-center w-24">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {expedisiEntries.map(([code, sheet]) => (
                  <tr key={code}>
                    <td className="px-3 py-2">
                      <span className={cn("px-2 py-0.5 rounded text-xs font-semibold", expColor(code))}>
                        {code}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {getPrefixesForExpedisi(code).map((p) => (
                          <span key={p} className="px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded text-xs font-mono">
                            {p}
                          </span>
                        ))}
                        {getPrefixesForExpedisi(code).length === 0 && (
                          <span className="text-xs text-slate-300 italic">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {editCode === code ? (
                        <div className="flex items-center gap-1">
                          <input
                            autoFocus
                            value={editInput}
                            onChange={(e) => setEditInput(e.target.value)}
                            className="input-field flex-1 font-mono text-xs py-1"
                          />
                          <button
                            onClick={async () => {
                              setSavingCode(code);
                              onError("");
                              try {
                                await onSaveExpedisiId(code, editInput);
                                setEditCode(null);
                              } catch (e) {
                                onError(pesanError(e));
                              } finally {
                                setSavingCode(null);
                              }
                            }}
                            disabled={savingCode === code}
                            className="p-1 text-green-600 hover:bg-green-50 rounded"
                          >
                            {savingCode === code
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <Check className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => setEditCode(null)}
                            className="p-1 text-slate-400 hover:bg-slate-100 rounded"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <span className="font-mono text-xs text-slate-600">
                          {sheet.spreadsheetId}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <a
                          href={sheet.url || GSHEET_URL(sheet.spreadsheetId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded text-slate-400 hover:text-green-600 hover:bg-green-50 transition-colors"
                          title="Buka G-Sheet"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                        <button
                          onClick={() => { setEditCode(code); setEditInput(sheet.spreadsheetId); }}
                          className="p-1.5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          title="Edit ID"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {addMode && (
                  <tr className="bg-green-50/50">
                    <td className="px-3 py-2">
                      <input
                        autoFocus
                        value={newCode}
                        onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                        placeholder="Kode"
                        className="input-field py-1 w-20 text-xs font-mono"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1 min-h-[20px]">
                        {newCode && getPrefixesForExpedisi(newCode).map((p) => (
                          <span key={p} className="px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded text-xs font-mono">
                            {p}
                          </span>
                        ))}
                        {newCode && getPrefixesForExpedisi(newCode).length === 0 && (
                          <span className="text-xs text-amber-500 italic">
                            Kode baru — prefix belum terdaftar
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={newId}
                        onChange={(e) => setNewId(e.target.value)}
                        placeholder="Spreadsheet ID"
                        className="input-field py-1 w-full text-xs font-mono"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={async () => {
                            if (!newCode.trim() || !newId.trim()) return;
                            onError("");
                            try {
                              await onSaveExpedisiId(newCode.trim(), newId.trim());
                              setNewCode(""); setNewId(""); setAddMode(false);
                            } catch (e) {
                              onError(pesanError(e));
                            }
                          }}
                          disabled={!newCode.trim() || !newId.trim()}
                          className="p-1.5 rounded text-green-600 hover:bg-green-100 disabled:opacity-40"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => { setAddMode(false); setNewCode(""); setNewId(""); }}
                          className="p-1.5 rounded text-slate-400 hover:bg-slate-100"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-slate-400 mt-1.5">
          Sheet expedisi dibuat otomatis saat upload.
          Link &quot;anyone with link&quot; dapat edit.
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// UPLOAD TAB  (parsing dilakukan di server untuk mendukung file besar)
// ═══════════════════════════════════════════════════════════════════════════════

function UploadTab({
  config,
  onNewSheets,
}: {
  config: ClaimSheetConfig;
  onNewSheets: (s: Record<string, { spreadsheetId: string; url: string }>) => Promise<void>;
}) {
  const [file, setFile]           = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult]       = useState<{
    added: number; skipped: number; total: number;
    expedisiSummary: Record<string, number>;
    newSheets: Record<string, { spreadsheetId: string; url: string }>;
  } | null>(null);
  const [error, setError] = useState("");

  const handleFile = (f: File) => {
    setFile(f);
    setResult(null);
    setError("");
  };

  const handleUpload = async () => {
    if (!file) return;
    if (!config.masterSpreadsheetId) {
      setError("Konfigurasi Master Spreadsheet ID terlebih dahulu.");
      return;
    }
    // Vercel Hobby limit ~4.5 MB — peringatkan sebelum upload
    const MB = file.size / 1024 / 1024;
    if (MB > 4.2) {
      setError(
        `File terlalu besar (${MB.toFixed(1)} MB). Vercel membatasi upload ~4 MB. ` +
        "Coba pecah file menjadi beberapa bagian, atau upgrade ke Vercel Pro."
      );
      return;
    }
    setUploading(true); setError(""); setResult(null);
    try {
      const expedisiSheets: Record<string, string> = {};
      for (const [code, sheet] of Object.entries(config.expedisiSheets ?? {})) {
        expedisiSheets[code] = sheet.spreadsheetId;
      }

      const fd = new FormData();
      fd.append("file",                file);
      fd.append("masterSpreadsheetId", config.masterSpreadsheetId);
      fd.append("expedisiSheets",      JSON.stringify(expedisiSheets));

      const res = await fetch("/api/claim/upload", { method: "POST", body: fd });

      // Platform-level errors (413 etc.) bukan JSON — tangani secara eksplisit
      if (res.status === 413) {
        throw new Error(
          `File terlalu besar (${MB.toFixed(1)} MB) — Vercel menolak request. ` +
          "Pecah file menjadi bagian ≤4 MB, atau upgrade ke Vercel Pro."
        );
      }

      let data: Record<string, unknown>;
      try {
        data = await res.json() as Record<string, unknown>;
      } catch {
        throw new Error(`Server error (HTTP ${res.status}): respons bukan JSON`);
      }

      if (!res.ok) {
        const msg = (data.error as string) || "Upload gagal";
        const detail = data.detail ? ` — ${data.detail}` : "";
        throw new Error(msg + detail);
      }

      setResult(data as Parameters<typeof setResult>[0]);
      if (Object.keys((data.newSheets as Record<string,unknown>) ?? {}).length > 0) {
        await onNewSheets(data.newSheets as Record<string, { spreadsheetId: string; url: string }>);
      }
    } catch (e) {
      setError(pesanError(e));
    } finally { setUploading(false); }
  };

  return (
    <div className="space-y-5">
      {/* Drop zone */}
      <label
        className={cn(
          "card p-8 border-2 border-dashed text-center cursor-pointer block transition-all",
          file
            ? "border-green-400 bg-green-50/40"
            : "border-slate-200 hover:border-green-300 hover:bg-slate-50"
        )}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
      >
        <input
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        {file
          ? <FileSpreadsheet className="w-10 h-10 mx-auto mb-3 text-green-600" />
          : <Upload className="w-10 h-10 mx-auto mb-3 text-slate-300" />}
        {file ? (
          <>
            <p className="font-semibold text-slate-700">{file.name}</p>
            <p className="text-sm text-slate-400 mt-1">
              {(file.size / 1024 / 1024).toFixed(1)} MB — klik untuk ganti file
            </p>
          </>
        ) : (
          <>
            <p className="font-semibold text-slate-600">Klik atau drag file Excel di sini</p>
            <p className="text-sm text-slate-400 mt-1">Format: .xlsx atau .xls (ekspor dari Jubelio)</p>
          </>
        )}
      </label>

      {/* Upload button */}
      {file && !result && (
        <div className="flex justify-end">
          <button
            onClick={handleUpload}
            disabled={uploading || !config.masterSpreadsheetId}
            className="btn-primary"
            title={!config.masterSpreadsheetId ? "Konfigurasi Master Spreadsheet ID dulu" : undefined}
          >
            {uploading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Upload className="w-4 h-4" />}
            {uploading ? "Memproses... (mohon tunggu)" : "Proses & Simpan"}
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-3 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError("")}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-3">
          <p className="font-semibold text-green-800 flex items-center gap-2">
            <Check className="w-5 h-5" /> Upload selesai
          </p>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              { val: result.added,   label: "Baris ditambahkan",    cls: "text-green-600" },
              { val: result.skipped, label: "Sudah ada (dilewati)", cls: "text-slate-400" },
              { val: result.total,   label: "Total baris di file",   cls: "text-slate-600" },
            ].map(({ val, label, cls }) => (
              <div key={label} className="bg-white rounded-xl p-3 border border-slate-100">
                <p className={cn("text-2xl font-bold", cls)}>{val.toLocaleString("id-ID")}</p>
                <p className="text-xs text-slate-500 mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {Object.keys(result.expedisiSummary).length > 0 && (
            <div>
              <p className="text-xs text-green-700 font-medium mb-1.5">Baris baru per expedisi:</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(result.expedisiSummary)
                  .sort((a, b) => b[1] - a[1])
                  .map(([code, cnt]) => (
                    <span key={code} className={cn("px-2.5 py-1 rounded-full text-xs font-medium", expColor(code))}>
                      {code}: {cnt.toLocaleString("id-ID")} baris
                    </span>
                  ))}
              </div>
            </div>
          )}

          {Object.keys(result.newSheets ?? {}).length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-amber-700 mb-1.5">
                G-Sheet baru otomatis dibuat:
              </p>
              <div className="space-y-1">
                {Object.entries(result.newSheets).map(([code, s]) => (
                  <div key={code} className="flex items-center gap-2 text-xs">
                    <span className={cn("px-1.5 py-0.5 rounded font-semibold", expColor(code))}>
                      {code}
                    </span>
                    <span className="font-mono text-slate-500 truncate flex-1">{s.spreadsheetId}</span>
                    <a href={s.url} target="_blank" rel="noopener noreferrer"
                      className="text-blue-600 hover:underline flex items-center gap-0.5">
                      Buka <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => { setFile(null); setResult(null); }}
            className="btn-secondary text-sm"
          >
            Upload file lain
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EDIT TAB
// ═══════════════════════════════════════════════════════════════════════════════

type SheetSource = { label: string; spreadsheetId: string; tab: string };

function EditTab({ config }: { config: ClaimSheetConfig }) {
  const sources: SheetSource[] = useMemo(() => {
    const list: SheetSource[] = [];
    if (config.masterSpreadsheetId) {
      list.push({ label: "Master (Semua Data)", spreadsheetId: config.masterSpreadsheetId, tab: "ALL" });
    }
    for (const [code, sheet] of Object.entries(config.expedisiSheets ?? {}).sort()) {
      list.push({ label: `Expedisi: ${code}`, spreadsheetId: sheet.spreadsheetId, tab: code });
    }
    return list;
  }, [config]);

  const [sourceIdx, setSourceIdx]   = useState(0);
  const [sortDir, setSortDir]       = useState<SortDir>("desc");
  const [search, setSearch]         = useState("");
  const [loading, setLoading]       = useState(false);
  const [rows, setRows]             = useState<SheetRow[]>([]);
  const [error, setError]           = useState("");

  const [editCell, setEditCell]     = useState<{ idx: number; field: string } | null>(null);
  const [editValue, setEditValue]   = useState("");
  const [saving, setSaving]         = useState(false);
  const [saveError, setSaveError]   = useState("");

  const [delConfirm, setDelConfirm] = useState<number | null>(null);
  const [deleting, setDeleting]     = useState<number | null>(null);
  const [delError, setDelError]     = useState("");

  const currentSource = sources[sourceIdx] ?? null;

  const fetchRows = useCallback(async () => {
    if (!currentSource) return;
    setLoading(true); setError(""); setEditCell(null); setDelConfirm(null);
    try {
      const p = new URLSearchParams({
        spreadsheetId: currentSource.spreadsheetId,
        tab:           currentSource.tab,
        sortDir,
        search,
      });
      const res  = await fetch(`/api/claim/read?${p}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal fetch");
      setRows(data.rows ?? []);
    } catch (e) { setError(pesanError(e)); }
    finally { setLoading(false); }
  }, [currentSource, sortDir, search]);

  // Auto-fetch when source or sortDir changes
  useEffect(() => {
    if (currentSource) fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceIdx, sortDir]);

  const startEdit = (idx: number, field: string, val: string) => {
    setSaveError(""); setDelConfirm(null);
    setEditCell({ idx, field }); setEditValue(val);
  };
  const cancelEdit = () => { setEditCell(null); setEditValue(""); setSaveError(""); };

  const saveEdit = async () => {
    if (!editCell || !currentSource) return;
    const row = rows[editCell.idx];
    if (!row) return;
    setSaving(true); setSaveError("");
    try {
      const res = await fetch("/api/claim/update-row", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spreadsheetId: currentSource.spreadsheetId,
          tab:           currentSource.tab,
          gsheetRow:     row.gsheetRow,
          field:         editCell.field,
          value:         editValue.trim(),
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Gagal menyimpan perubahan");
      }
      setRows((prev) =>
        prev.map((r, i) =>
          i === editCell.idx ? { ...r, [editCell.field]: editValue.trim() } : r
        )
      );
      setEditCell(null);
    } catch (e) { setSaveError(pesanError(e)); }
    finally { setSaving(false); }
  };

  const handleDelete = async (idx: number) => {
    const row = rows[idx];
    if (!row || !currentSource) return;
    setDeleting(idx); setDelError("");
    try {
      const res = await fetch("/api/claim/delete-row", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spreadsheetId: currentSource.spreadsheetId,
          tab:           currentSource.tab,
          gsheetRow:     row.gsheetRow,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Gagal menghapus baris");
      }
      setRows((prev) =>
        prev.filter((_, i) => i !== idx).map((r, i) => ({ ...r, no: String(i + 1) }))
      );
      setDelConfirm(null);
    } catch (e) { setDelError(pesanError(e)); }
    finally { setDeleting(null); }
  };

  const expStats = useMemo(() => {
    const m: Record<string, number> = {};
    rows.forEach((r) => { m[r.expedisi] = (m[r.expedisi] ?? 0) + 1; });
    return m;
  }, [rows]);

  if (sources.length === 0) {
    return (
      <div className="card p-12 text-center">
        <Settings2 className="w-12 h-12 mx-auto mb-4 text-slate-200" />
        <p className="font-semibold text-slate-500">Konfigurasi Spreadsheet ID terlebih dahulu</p>
      </div>
    );
  }

  const errors = [
    { msg: error,     clr: () => setError("") },
    { msg: saveError, clr: () => setSaveError("") },
    { msg: delError,  clr: () => setDelError("") },
  ].filter((e) => e.msg);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="card p-4 space-y-3">
        {/* Source selector */}
        <div>
          <p className="text-xs text-slate-500 mb-2">Pilih Sheet</p>
          <div className="flex flex-wrap gap-2">
            {sources.map((s, i) => (
              <button
                key={i}
                onClick={() => setSourceIdx(i)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all",
                  sourceIdx === i
                    ? cn("border-transparent", expColor(s.tab))
                    : "border-slate-200 text-slate-500 hover:bg-slate-50"
                )}
              >
                {s.label}
              </button>
            ))}
            {currentSource && (
              <a
                href={GSHEET_URL(currentSource.spreadsheetId)}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 text-slate-400 hover:text-green-600 hover:border-green-300 flex items-center gap-1"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Buka G-Sheet
              </a>
            )}
                   </div>
        </div>

        {/* Search + sort + fetch */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && fetchRows()}
              placeholder="Cari resi, SKU, kondisi..."
              className="input-field pl-9 w-full"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={() => setSortDir((d) => d === "desc" ? "asc" : "desc")}
            className="btn-secondary flex items-center gap-1.5"
          >
            <ArrowUpDown className="w-4 h-4" />
            {sortDir === "desc" ? "Terbaru dulu" : "Terlama dulu"}
          </button>
          <button onClick={fetchRows} disabled={loading} className="btn-secondary">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
          <button onClick={fetchRows} disabled={loading} className="btn-primary">
            {loading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Search className="w-4 h-4" />}
            Tampilkan
          </button>
        </div>
      </div>

      {/* Error banners */}
      {errors.map((e, i) => (
        <div key={i} className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-3 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">{e.msg}</span>
          <button onClick={e.clr}><X className="w-4 h-4" /></button>
        </div>
      ))}

      {/* Summary chips */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">{rows.length} baris</span>
          {currentSource?.tab !== "ALL"
            ? (
              <span className={cn("px-2.5 py-0.5 rounded-full text-xs font-medium", expColor(currentSource?.tab ?? ""))}>
                {currentSource?.tab}
              </span>
            )
            : Object.entries(expStats).sort((a, b) => b[1] - a[1]).map(([code, cnt]) => (
              <span key={code} className={cn("px-2.5 py-0.5 rounded-full text-xs font-medium", expColor(code))}>
                {code}: {cnt}
              </span>
            ))}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="card flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-green-600" />
          <p className="text-sm text-slate-400">Mengambil data dari Google Sheets...</p>
        </div>
      ) : rows.length > 0 ? (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs whitespace-nowrap">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="px-3 py-3 text-center w-10">No.</th>
                  {currentSource?.tab === "ALL" && (
                    <th className="px-3 py-3 text-center w-20">Expedisi</th>
                  )}
                  <th className="px-3 py-3 text-left min-w-[150px]">No. Pesanan/Resi</th>
                  <th className="px-3 py-3 text-left min-w-[80px]">Barcode</th>
                  <th className="px-3 py-3 text-left min-w-[80px]">No. Item</th>
                  <th className="px-3 py-3 text-left min-w-[180px]">SKU</th>
                  <th className="px-3 py-3 text-center w-12">Qty</th>
                  <th className="px-3 py-3 text-left w-28">Kondisi</th>
                  <th className="px-3 py-3 text-left w-24">Batch</th>
                  <th className="px-3 py-3 text-center w-24">Exp. Date</th>
                  <th className="px-3 py-3 text-left w-32">Created By</th>
                  <th className="px-3 py-3 text-center w-36">
                    <button
                      onClick={() => setSortDir((d) => d === "desc" ? "asc" : "desc")}
                      className="flex items-center gap-1 mx-auto hover:text-green-300"
                    >
                      Created Date
                      {sortDir === "desc"
                        ? <ChevronDown className="w-3 h-3" />
                        : <ChevronUp className="w-3 h-3" />}
                    </button>
                  </th>
                  <th className="px-2 py-3 w-16 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row, idx) => {
                  const isDelConf  = delConfirm === idx;
                  const isDeleting = deleting   === idx;

                  const editableFields: { field: keyof SheetRow; mono?: boolean; center?: boolean }[] = [
                    { field: "noResi",      mono: true },
                    { field: "barcode",     mono: true },
                    { field: "noItem" },
                    { field: "sku",         mono: true },
                    { field: "qty",         center: true },
                    { field: "kondisi" },
                    { field: "batch",       mono: true },
                    { field: "expDate",     center: true },
                    { field: "createdBy" },
                    { field: "createdDate", center: true },
                  ];

                  return (
                    <tr
                      key={`${row.gsheetRow}-${idx}`}
                      className={cn(
                        "transition-colors",
                        isDelConf
                          ? "bg-red-50"
                          : idx % 2 === 0 ? "bg-white" : "bg-slate-50/50",
                        "hover:bg-green-50/30"
                      )}
                    >
                      <td className="px-3 py-2 text-center text-slate-400">{row.no || idx + 1}</td>

                      {currentSource?.tab === "ALL" && (
                        <td className="px-3 py-2 text-center">
                          <span className={cn("px-1.5 py-0.5 rounded text-xs font-semibold", expColor(row.expedisi))}>
                            {row.expedisi}
                          </span>
                        </td>
                      )}

                      {editableFields.map(({ field, mono, center }) => {
                        const isEditing = editCell?.idx === idx && editCell.field === field;
                        const val = String(row[field] ?? "");
                        const display =
                          field === "expDate"     ? val.slice(0, 10) :
                          field === "createdDate" ? val.slice(0, 16) : val;

                        return (
                          <td key={field} className={cn("px-3 py-2", center && "text-center")}>
                            {isEditing ? (
                              <div className="flex items-center gap-1">
                                <input
                                  autoFocus
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") saveEdit();
                                    if (e.key === "Escape") cancelEdit();
                                  }}
                                  className="border border-green-400 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-400 w-28 font-mono"
                                />
                                <button
                                  onClick={saveEdit}
                                  disabled={saving}
                                  className="p-1 text-green-600 hover:bg-green-50 rounded"
                                >
                                  {saving
                                    ? <Loader2 className="w-3 h-3 animate-spin" />
                                    : <Check className="w-3 h-3" />}
                                </button>
                                <button
                                  onClick={cancelEdit}
                                  className="p-1 text-slate-400 hover:bg-slate-100 rounded"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <span
                                className={cn(
                                  "cursor-pointer hover:text-green-700",
                                  mono && "font-mono font-semibold text-slate-800",
                                  !mono && "text-slate-600"
                                )}
                                onDoubleClick={() => startEdit(idx, field, val)}
                                title="Double-click untuk edit"
                              >
                                {display}
                              </span>
                            )}
                          </td>
                        );
                      })}

                      <td className="px-2 py-2 text-center">
                        {isDelConf ? (
                          <div className="flex items-center justify-center gap-0.5">
                            <span className="text-xs text-red-600 mr-0.5">Hapus?</span>
                            <button
                              onClick={() => handleDelete(idx)}
                              disabled={isDeleting}
                              className="p-1 rounded text-red-600 hover:bg-red-100 disabled:opacity-50"
                            >
                              {isDeleting
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <Check className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              onClick={() => setDelConfirm(null)}
                              className="p-1 rounded text-slate-400 hover:bg-slate-100"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-0.5">
                            <button
                              onClick={() => startEdit(idx, "noResi", row.noResi)}
                              className="p-1.5 rounded text-slate-300 hover:text-green-600 hover:bg-green-50 transition-colors"
                              title="Edit baris"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => { setDelConfirm(idx); setEditCell(null); }}
                              className="p-1.5 rounded text-slate-300 hover:text-red-600 hover:bg-red-50 transition-colors"
                              title="Hapus dari sheet ini"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50 flex justify-between text-xs text-slate-400">
            <span>{rows.length} baris — <strong>{currentSource?.label}</strong></span>
            <span>Double-click sel untuk edit &nbsp;·&nbsp; hapus dari sheet ini saja</span>
          </div>
        </div>
      ) : !loading ? (
        <div className="card p-16 text-center">
          <FileSpreadsheet className="w-12 h-12 mx-auto mb-4 text-slate-200" />
          <p className="font-semibold text-slate-500">Klik Tampilkan untuk muat data</p>
        </div>
      ) : null}
    </div>
  );
}
