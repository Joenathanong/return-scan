"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import { cn } from "@/lib/utils";
import { mintaJson, pesanError } from "@/lib/http";
import {
  bersihkanKode, bersihkanNama, pisahBarcode, periksaBaris, tebakKolom,
  bentrokJenis, PESAN_TOLAK, type BarisProduk,
} from "@/lib/produk";
import {
  Package, Upload, Loader2, AlertCircle, CheckCircle2, X, Search,
  FileSpreadsheet, Plus, Barcode, ChevronLeft, ChevronRight, Save, Download,
} from "lucide-react";

/** Sebesar potongan yang diterima /api/produk/impor. */
const PER_POTONG = 500;

interface ProdukRow {
  sku: string;
  nama: string;
  active: boolean;
  updatedAt: string;
  barcodes: string[];
  barcodesBpom: string[];
}

interface HasilImpor {
  dibuat: number;
  namaDiperbarui: number;
  tidakBerubah: number;
  barcodeBaru: number;
  barcodeDipindah: number;
  barcodeUbahJenis: number;
  barcodeBentrok: { barcode: string; sku: string; miliknya: string }[];
  ditolak: { sku: string; alasan: string }[];
  diproses: number;
}

export default function AdminProdukPage() {
  return (
    <AuthGuard adminOnly>
      <Isi />
    </AuthGuard>
  );
}

function Isi() {
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  // ── Daftar ────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<ProdukRow[]>([]);
  const [total, setTotal] = useState(0);
  const [halaman, setHalaman] = useState(1);
  const [cari, setCari] = useState("");
  const [cariAktif, setCariAktif] = useState("");
  const [loading, setLoading] = useState(true);
  const LIMIT = 50;

  const muat = useCallback(async () => {
    setLoading(true);
    try {
      const d = await mintaJson<{ rows: ProdukRow[]; total: number }>(
        `/api/produk?halaman=${halaman}&limit=${LIMIT}` +
          (cariAktif ? `&q=${encodeURIComponent(cariAktif)}` : "")
      );
      setRows(d.rows);
      setTotal(d.total);
    } catch (e) {
      setError(pesanError(e, "Gagal memuat produk."));
    } finally {
      setLoading(false);
    }
  }, [halaman, cariAktif]);

  useEffect(() => { muat(); }, [muat]);

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Package className="w-6 h-6 text-green-600" /> Master Produk
        </h1>
        <p className="text-slate-500 mt-1">
          {total.toLocaleString("id-ID")} SKU terdaftar — dipakai modul Bongkaran
          untuk mengenali barcode yang di-scan
        </p>
      </div>

      {error && <Kotak jenis="error" pesan={error} onTutup={() => setError("")} />}
      {info && <Kotak jenis="info" pesan={info} onTutup={() => setInfo("")} />}

      <PanelImpor
        onSelesai={(pesan) => { setInfo(pesan); setHalaman(1); muat(); }}
        onError={setError}
      />

      <TambahManual onSelesai={(pesan) => { setInfo(pesan); muat(); }} onError={setError} />

      {/* ── Daftar ── */}
      <div className="card">
        <div className="p-4 border-b border-slate-100 flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { setHalaman(1); setCariAktif(cari.trim()); }
              }}
              placeholder="Cari SKU, nama, barcode, atau BPOM…"
              className="input-field pl-9"
            />
          </div>
          <button
            onClick={() => { setHalaman(1); setCariAktif(cari.trim()); }}
            className="btn-ghost text-sm"
          >
            Cari
          </button>
          {cariAktif && (
            <button
              onClick={() => { setCari(""); setCariAktif(""); setHalaman(1); }}
              className="btn-ghost text-sm text-slate-500"
            >
              Bersihkan
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-7 h-7 animate-spin text-green-600" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-center text-slate-400 py-12 text-sm">
            {cariAktif ? "Tidak ada yang cocok." : "Belum ada produk. Impor file Excel di atas."}
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map((p) => (
              <BarisDaftar
                key={p.sku}
                p={p}
                onSelesai={(pesan) => { setInfo(pesan); muat(); }}
                onError={setError}
              />
            ))}
          </div>
        )}

        {total > LIMIT && (
          <div className="p-3 border-t border-slate-100 flex items-center justify-between text-sm">
            <button
              onClick={() => setHalaman((h) => Math.max(1, h - 1))}
              disabled={halaman <= 1}
              className="btn-ghost text-xs disabled:opacity-30"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Sebelumnya
            </button>
            <span className="text-slate-500">
              Halaman {halaman} dari {Math.ceil(total / LIMIT)}
            </span>
            <button
              onClick={() => setHalaman((h) => h + 1)}
              disabled={halaman >= Math.ceil(total / LIMIT)}
              className="btn-ghost text-xs disabled:opacity-30"
            >
              Berikutnya <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   IMPOR EXCEL
   ──────────────────────────────────────────────────────────────────────── */

function PanelImpor({
  onSelesai, onError,
}: { onSelesai: (pesan: string) => void; onError: (pesan: string) => void }) {
  const berkasRef = useRef<HTMLInputElement>(null);

  const [namaBerkas, setNamaBerkas] = useState("");
  const [header, setHeader] = useState<string[]>([]);
  const [mentah, setMentah] = useState<unknown[][]>([]);
  const [kolom, setKolom] = useState({ sku: -1, nama: -1, barcode: -1, bpom: -1 });
  const [membaca, setMembaca] = useState(false);
  const [mengirim, setMengirim] = useState(false);
  const [maju, setMaju] = useState(0);
  const [hasil, setHasil] = useState<HasilImpor | null>(null);

  /**
   * Membuat berkas contoh berisi header yang persis dicari pembaca impor,
   * plus tiga baris yang menunjukkan aturan yang paling sering salah
   * dipahami: satu SKU dengan banyak barcode, dan SKU tanpa barcode.
   *
   * Templatenya dirakit di peramban, bukan disimpan sebagai berkas statis
   * di /public. Alasannya: berkas statis akan menjadi usang diam-diam
   * begitu daftar header yang diterima berubah, dan tidak ada yang
   * mengingatkan. Yang di bawah ini memakai pustaka `xlsx` yang sama dengan
   * pembacanya, jadi keduanya selalu berbicara tentang kolom yang sama.
   */
  const unduhTemplate = async () => {
    try {
      const XLSX = await import("xlsx");

      const contoh = [
        {
          "Kode SKU": "SKU-00123", "Nama SKU": "MINYAK GORENG X 1 LITER",
          "Barcode": "8991234567890", "Barcode BPOM": "",
        },
        // SKU yang sama ditulis dua kali → dua barcode untuk satu produk
        // (mis. kemasan lama dan kemasan baru).
        {
          "Kode SKU": "SKU-00124", "Nama SKU": "SABUN CAIR Y 500 ML",
          "Barcode": "8990001112223", "Barcode BPOM": "NA18201700123",
        },
        {
          "Kode SKU": "SKU-00124", "Nama SKU": "SABUN CAIR Y 500 ML",
          "Barcode": "8990001112230", "Barcode BPOM": "",
        },
        // Beberapa kode dalam satu sel juga boleh — dipisah koma.
        {
          "Kode SKU": "SKU-00125", "Nama SKU": "PASTA GIGI Z 190 GR",
          "Barcode": "8993334445556, 8993334445563", "Barcode BPOM": "MD224513004123",
        },
        // Kedua kolom boleh kosong: banyak SKU memang belum punya barcode
        // terdaftar, dan memaksa mengisinya hanya membuat orang mengarang.
        {
          "Kode SKU": "SKU-00126", "Nama SKU": "SHAMPO W 170 ML",
          "Barcode": "", "Barcode BPOM": "NA11221900456",
        },
      ];

      const wsData = XLSX.utils.json_to_sheet(contoh);
      wsData["!cols"] = [{ wch: 16 }, { wch: 40 }, { wch: 34 }, { wch: 22 }];

      const petunjuk = [
        ["TEMPLATE MASTER PRODUK — Scan Bongkaran, PT. IEG"],
        [],
        ["Isi sheet \"Master Produk\". Baris pertama adalah header, jangan dihapus."],
        [],
        ["Kolom", "Wajib?", "Keterangan"],
        ["Kode SKU", "Wajib", "Kode produk. Maksimal 64 karakter. Tidak boleh diubah setelah dipakai — kalau kodenya salah, nonaktifkan yang lama lalu buat yang baru."],
        ["Nama SKU", "Wajib", "Nama yang akan muncul di layar operator saat barcode di-scan. Maksimal 191 karakter."],
        ["Barcode", "Boleh kosong", "Barcode dagang (EAN/UPC) yang tertempel di kemasan. Maksimal 64 karakter."],
        ["Barcode BPOM", "Boleh kosong", "Barcode nomor izin edar BPOM. Sering justru inilah yang paling mudah terbaca scanner, karena dicetak besar dan rapi sementara barcode dagangnya tertutup stiker promo."],
        [],
        ["Operator boleh men-scan yang mana saja — keduanya menemukan produk yang sama."],
        ["Satu kode fisik hanya boleh ada di SATU kolom. Kode yang sama diisi di kedua kolom akan ditolak, bukan ditebak."],
        [],
        ["Satu SKU, banyak barcode — dua cara, keduanya diterima:"],
        ["", "1.", "Tulis SKU-nya di beberapa baris, satu barcode per baris."],
        ["", "2.", "Tulis sekali, barcode dipisah koma dalam satu sel."],
        [],
        ["Yang perlu diketahui:"],
        ["", "•", "Impor ulang file yang sama aman. Yang sudah ada tidak diduplikasi, dan nama hanya ditulis kalau memang berubah."],
        ["", "•", "Barcode yang sudah dipakai SKU lain TIDAK dipindahkan otomatis. Ia dilaporkan setelah impor, untuk diperbaiki manual."],
        ["", "•", "SKU yang tidak ada di file TIDAK dinonaktifkan. Menonaktifkan produk dilakukan satu per satu lewat daftar di halaman Master Produk."],
        ["", "•", "Nama header boleh berbeda-beda (SKU / Kode SKU / Item Code, Nama / Nama Barang / Deskripsi, Barcode / EAN, Barcode BPOM / BPOM / NIE). Kolomnya tetap bisa dipilih manual sebelum impor."],
      ];
      const wsPetunjuk = XLSX.utils.aoa_to_sheet(petunjuk);
      wsPetunjuk["!cols"] = [{ wch: 16 }, { wch: 14 }, { wch: 96 }];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, wsData, "Master Produk");
      XLSX.utils.book_append_sheet(wb, wsPetunjuk, "Petunjuk");
      XLSX.writeFile(wb, "template-master-produk.xlsx");
    } catch (e) {
      onError(pesanError(e, "Gagal membuat template."));
    }
  };

  const bacaBerkas = async (file: File) => {
    setMembaca(true);
    setHasil(null);
    try {
      // Dimuat saat dibutuhkan saja — pustaka xlsx berat, dan halaman ini
      // sering dibuka hanya untuk mencari satu SKU.
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error("File tidak punya sheet yang bisa dibaca.");

      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
      if (aoa.length < 2) throw new Error("File hanya berisi header, tidak ada data.");

      const h = (aoa[0] as unknown[]).map((x) => String(x ?? ""));
      setHeader(h);
      setMentah(aoa.slice(1) as unknown[][]);
      setKolom(tebakKolom(h));
      setNamaBerkas(file.name);
    } catch (e) {
      onError(pesanError(e, "File tidak bisa dibaca."));
      setHeader([]); setMentah([]); setNamaBerkas("");
    } finally {
      setMembaca(false);
    }
  };

  /**
   * Baris yang siap kirim + baris yang dilewati.
   *
   * useMemo bukan penghias di sini: file master bisa puluhan ribu baris, dan
   * tanpa memo seluruhnya dihitung ulang setiap kali `setMaju` berdetak —
   * yaitu sekali per potongan selama impor berlangsung, tepat ketika
   * peramban paling sibuk.
   */
  const { siap, ditolak } = useMemo(() => {
    const siap: BarisProduk[] = [];
    const ditolak: { baris: number; sku: string; alasan: string }[] = [];
    if (kolom.sku >= 0 && kolom.nama >= 0) {
      mentah.forEach((r, i) => {
        const b: BarisProduk = {
          sku: bersihkanKode(r[kolom.sku]),
          nama: bersihkanNama(r[kolom.nama]),
          barcodes: kolom.barcode >= 0 ? pisahBarcode(r[kolom.barcode]) : [],
          barcodesBpom: kolom.bpom >= 0 ? pisahBarcode(r[kolom.bpom]) : [],
        };
        // Baris yang benar-benar kosong (sisa baris di bawah tabel) dilewati
        // diam-diam — melaporkannya sebagai "ditolak" hanya membuat panik.
        if (!b.sku && !b.nama) return;

        const salah = periksaBaris(b);
        if (salah) {
          ditolak.push({ baris: i + 2, sku: b.sku || "(kosong)", alasan: PESAN_TOLAK[salah] });
          return;
        }
        const tumpang = bentrokJenis(b);
        if (tumpang.length > 0) {
          ditolak.push({
            baris: i + 2,
            sku: b.sku,
            alasan: `${tumpang.join(", ")} ada di kolom Barcode sekaligus Barcode BPOM`,
          });
          return;
        }
        siap.push(b);
      });
    }
    return { siap, ditolak };
  }, [mentah, kolom]);

  const kirim = async () => {
    setMengirim(true);
    setMaju(0);
    const gabung: HasilImpor = {
      dibuat: 0, namaDiperbarui: 0, tidakBerubah: 0, barcodeBaru: 0,
      barcodeDipindah: 0, barcodeUbahJenis: 0,
      barcodeBentrok: [], ditolak: [], diproses: 0,
    };
    // Penghitung LOKAL, bukan state `maju`. Fungsi ini menangkap nilai
    // `maju` dari render saat tombol ditekan — yaitu selalu 0 — sehingga
    // pesan kegagalannya dulu selalu berbunyi "0 baris terkirim", persis
    // ketika orangnya paling butuh tahu berapa yang sudah masuk.
    let terkirim = 0;
    try {
      for (let i = 0; i < siap.length; i += PER_POTONG) {
        const potong = siap.slice(i, i + PER_POTONG);
        const d = await mintaJson<HasilImpor>("/api/produk/impor", {
          method: "POST",
          body: { rows: potong },
          timeoutMs: 60_000,
        });
        gabung.dibuat += d.dibuat;
        gabung.namaDiperbarui += d.namaDiperbarui;
        gabung.tidakBerubah += d.tidakBerubah;
        gabung.barcodeBaru += d.barcodeBaru;
        gabung.barcodeDipindah += d.barcodeDipindah;
        gabung.barcodeUbahJenis += d.barcodeUbahJenis;
        gabung.diproses += d.diproses;
        gabung.barcodeBentrok.push(...d.barcodeBentrok);
        gabung.ditolak.push(...d.ditolak);
        terkirim = Math.min(i + PER_POTONG, siap.length);
        setMaju(terkirim);
      }
      setHasil(gabung);
      onSelesai(
        `Impor selesai: ${gabung.dibuat} SKU baru, ${gabung.namaDiperbarui} nama diperbarui, ` +
          `${gabung.barcodeBaru} barcode baru.`
      );
      setHeader([]); setMentah([]); setNamaBerkas("");
      if (berkasRef.current) berkasRef.current.value = "";
    } catch (e) {
      onError(
        pesanError(e, "Impor gagal.") +
          ` ${terkirim.toLocaleString("id-ID")} dari ${siap.length.toLocaleString("id-ID")} baris ` +
          "sudah tersimpan. Impor ulang file yang sama aman — baris yang sudah ada tidak diduplikasi."
      );
    } finally {
      setMengirim(false);
    }
  };

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <FileSpreadsheet className="w-5 h-5 text-green-600" />
        <h2 className="font-semibold text-slate-800">Impor dari Excel</h2>
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-600 space-y-1">
        <p>
          File <code className="text-xs bg-white px-1 py-0.5 rounded border">.xlsx</code> dengan
          baris pertama sebagai header. Kolom yang dicari: <strong>SKU</strong>,{" "}
          <strong>Nama</strong>, <strong>Barcode</strong>, dan{" "}
          <strong>Barcode BPOM</strong> (dua terakhir opsional). Operator boleh
          men-scan yang mana saja — keduanya menemukan produk yang sama.
        </p>
        <p className="text-slate-500">
          Satu SKU boleh ditulis di beberapa baris untuk mendaftarkan beberapa barcode,
          atau ditulis sekali dengan barcode dipisah koma. Impor ulang file yang sama
          aman — yang sudah ada tidak diduplikasi, dan nama hanya ditulis kalau berubah.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <button onClick={unduhTemplate} className="btn-ghost text-sm">
          <Download className="w-4 h-4" /> Unduh template
        </button>
        <span className="text-xs text-slate-400">
          Berisi contoh isian dan sheet petunjuk. Isi lalu unggah kembali di bawah.
        </span>
      </div>

      <input
        ref={berkasRef}
        type="file"
        accept=".xlsx,.xls"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) bacaBerkas(f);
        }}
        className="block w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-4
                   file:rounded-lg file:border-0 file:text-sm file:font-medium
                   file:bg-green-50 file:text-green-700 hover:file:bg-green-100
                   file:cursor-pointer cursor-pointer"
      />

      {membaca && (
        <p className="text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Membaca file…
        </p>
      )}

      {header.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            <strong>{namaBerkas}</strong> — {mentah.length.toLocaleString("id-ID")} baris data
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {([
              ["sku", "Kolom SKU", true],
              ["nama", "Kolom Nama", true],
              ["barcode", "Kolom Barcode", false],
            ] as const).map(([key, label, wajib]) => (
              <div key={key}>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">
                  {label} {!wajib && <span className="text-slate-400 font-normal">(opsional)</span>}
                </label>
                <select
                  value={kolom[key]}
                  onChange={(e) => setKolom((k) => ({ ...k, [key]: Number(e.target.value) }))}
                  className={cn("input-field", wajib && kolom[key] < 0 && "border-red-300")}
                >
                  <option value={-1}>— tidak dipakai —</option>
                  {header.map((h, i) => (
                    <option key={i} value={i}>{h || `(kolom ${i + 1})`}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {kolom.sku < 0 || kolom.nama < 0 ? (
            <p className="text-sm text-red-600">
              Kolom SKU dan Nama harus dipilih dulu.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="text-green-700 font-medium">
                  {siap.length.toLocaleString("id-ID")} baris siap
                </span>
                {ditolak.length > 0 && (
                  <span className="text-amber-700">
                    {ditolak.length.toLocaleString("id-ID")} baris dilewati
                  </span>
                )}
              </div>

              {siap.length > 0 && (
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">SKU</th>
                        <th className="text-left px-3 py-2 font-medium">Nama</th>
                        <th className="text-left px-3 py-2 font-medium">Barcode</th>
                        <th className="text-left px-3 py-2 font-medium">Barcode BPOM</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {siap.slice(0, 5).map((b, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2 font-mono text-xs">{b.sku}</td>
                          <td className="px-3 py-2">{b.nama}</td>
                          <td className="px-3 py-2 font-mono text-xs text-slate-500">
                            {b.barcodes.join(", ") || "—"}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-slate-500">
                            {b.barcodesBpom.join(", ") || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {siap.length > 5 && (
                    <p className="px-3 py-2 text-xs text-slate-400 bg-slate-50">
                      …dan {(siap.length - 5).toLocaleString("id-ID")} baris lagi
                    </p>
                  )}
                </div>
              )}

              {ditolak.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-amber-700">
                    Lihat {ditolak.length} baris yang dilewati
                  </summary>
                  <div className="mt-2 max-h-40 overflow-y-auto border border-amber-200 rounded-lg bg-amber-50 p-2 space-y-0.5">
                    {ditolak.slice(0, 100).map((d, i) => (
                      <p key={i} className="text-xs text-amber-800">
                        Baris {d.baris} ({d.sku}): {d.alasan}
                      </p>
                    ))}
                    {ditolak.length > 100 && (
                      <p className="text-xs text-amber-600">…dan {ditolak.length - 100} lagi</p>
                    )}
                  </div>
                </details>
              )}

              <button
                onClick={kirim}
                disabled={mengirim || siap.length === 0}
                className="btn-primary"
              >
                {mengirim
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Mengimpor {maju}/{siap.length}…</>
                  : <><Upload className="w-4 h-4" /> Impor {siap.length.toLocaleString("id-ID")} baris</>}
              </button>
            </>
          )}
        </div>
      )}

      {hasil && (
        <div className="border border-slate-200 rounded-xl p-4 space-y-2 text-sm">
          <p className="font-medium text-slate-800">Hasil impor</p>
          <ul className="text-slate-600 space-y-0.5">
            <li>{hasil.dibuat.toLocaleString("id-ID")} SKU baru dibuat</li>
            <li>{hasil.namaDiperbarui.toLocaleString("id-ID")} nama diperbarui</li>
            <li>{hasil.tidakBerubah.toLocaleString("id-ID")} tidak berubah (tidak ditulis ulang)</li>
            <li>{hasil.barcodeBaru.toLocaleString("id-ID")} barcode baru terdaftar</li>
            {hasil.barcodeUbahJenis > 0 && (
              <li>
                {hasil.barcodeUbahJenis.toLocaleString("id-ID")} barcode berpindah antara
                kolom Barcode dan Barcode BPOM
              </li>
            )}
            {hasil.barcodeDipindah > 0 && (
              <li>
                {hasil.barcodeDipindah.toLocaleString("id-ID")} barcode diambil alih
                dari SKU yang sudah melepasnya
              </li>
            )}
          </ul>

          {hasil.barcodeBentrok.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
              <p className="text-amber-800 font-medium">
                {hasil.barcodeBentrok.length} barcode tidak dipasang karena sudah dipakai SKU lain
              </p>
              <p className="text-xs text-amber-700">
                Barcode tidak dipindahkan otomatis: kalau ia berpindah pemilik diam-diam,
                hasil scan sebelum dan sesudah impor akan menunjuk produk berbeda tanpa jejak.
                Perbaiki manual lewat daftar di bawah.
              </p>
              <div className="max-h-32 overflow-y-auto space-y-0.5 pt-1">
                {hasil.barcodeBentrok.slice(0, 50).map((b, i) => (
                  <p key={i} className="text-xs font-mono text-amber-800">
                    {b.barcode} → diminta {b.sku}, sekarang milik {b.miliknya}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   TAMBAH SATU PRODUK
   ──────────────────────────────────────────────────────────────────────── */

function TambahManual({
  onSelesai, onError,
}: { onSelesai: (pesan: string) => void; onError: (pesan: string) => void }) {
  const [buka, setBuka] = useState(false);
  const [sku, setSku] = useState("");
  const [nama, setNama] = useState("");
  const [barcode, setBarcode] = useState("");
  const [barcodeBpom, setBarcodeBpom] = useState("");
  const [menyimpan, setMenyimpan] = useState(false);

  const simpan = async () => {
    setMenyimpan(true);
    try {
      const d = await mintaJson<{ sku: string; bentrok: string[] }>("/api/produk", {
        method: "POST",
        body: { sku, nama, barcodes: barcode, barcodesBpom: barcodeBpom },
      });
      onSelesai(
        `Produk ${d.sku} ditambahkan.` +
          (d.bentrok.length ? ` Barcode ${d.bentrok.join(", ")} tidak dipasang — sudah dipakai SKU lain.` : "")
      );
      setSku(""); setNama(""); setBarcode(""); setBarcodeBpom(""); setBuka(false);
    } catch (e) {
      onError(pesanError(e, "Gagal menambah produk."));
    } finally {
      setMenyimpan(false);
    }
  };

  if (!buka) {
    return (
      <button onClick={() => setBuka(true)} className="btn-ghost text-sm">
        <Plus className="w-4 h-4" /> Tambah satu produk manual
      </button>
    );
  }

  return (
    <div className="card p-5 space-y-3">
      <h2 className="font-semibold text-slate-800">Produk baru</h2>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-slate-700 mb-1.5 block">Kode SKU</label>
          <input value={sku} onChange={(e) => setSku(e.target.value)} className="input-field font-mono" />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700 mb-1.5 block">Nama produk</label>
          <input value={nama} onChange={(e) => setNama(e.target.value)} className="input-field" />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700 mb-1.5 block">
            Barcode <span className="text-slate-400 font-normal">(pisah koma)</span>
          </label>
          <input value={barcode} onChange={(e) => setBarcode(e.target.value)} className="input-field font-mono" />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700 mb-1.5 block">
            Barcode BPOM <span className="text-slate-400 font-normal">(pisah koma)</span>
          </label>
          <input
            value={barcodeBpom}
            onChange={(e) => setBarcodeBpom(e.target.value)}
            className="input-field font-mono"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={simpan} disabled={menyimpan || !sku || !nama} className="btn-primary">
          {menyimpan && <Loader2 className="w-4 h-4 animate-spin" />} Simpan
        </button>
        <button onClick={() => setBuka(false)} className="btn-ghost">Batal</button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   SATU BARIS DAFTAR
   ──────────────────────────────────────────────────────────────────────── */

function BarisDaftar({
  p, onSelesai, onError,
}: {
  p: ProdukRow;
  onSelesai: (pesan: string) => void;
  onError: (pesan: string) => void;
}) {
  const [edit, setEdit] = useState(false);
  const [nama, setNama] = useState(p.nama);
  const [barcode, setBarcode] = useState(p.barcodes.join(", "));
  const [barcodeBpom, setBarcodeBpom] = useState(p.barcodesBpom.join(", "));
  const [menyimpan, setMenyimpan] = useState(false);

  const simpan = async () => {
    setMenyimpan(true);
    try {
      const d = await mintaJson<{ bentrok?: string[] }>(
        `/api/produk/${encodeURIComponent(p.sku)}`,
        {
          method: "PATCH",
          body: {
            nama,
            barcodes: pisahBarcode(barcode),
            barcodesBpom: pisahBarcode(barcodeBpom),
          },
        }
      );
      setEdit(false);
      onSelesai(
        `${p.sku} disimpan.` +
          (d.bentrok?.length
            ? ` Barcode ${d.bentrok.join(", ")} tidak dipasang — sudah dipakai SKU lain.`
            : "")
      );
    } catch (e) {
      onError(pesanError(e, "Gagal menyimpan."));
    } finally {
      setMenyimpan(false);
    }
  };

  const ubahAktif = async () => {
    try {
      await mintaJson(`/api/produk/${encodeURIComponent(p.sku)}`, {
        method: "PATCH",
        body: { active: !p.active },
      });
      onSelesai(`${p.sku} ${p.active ? "dinonaktifkan" : "diaktifkan"}.`);
    } catch (e) {
      onError(pesanError(e, "Gagal mengubah status."));
    }
  };

  if (edit) {
    return (
      <div className="p-4 space-y-3 bg-slate-50">
        <p className="font-mono text-xs text-slate-500">{p.sku}</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Nama</label>
            <input value={nama} onChange={(e) => setNama(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">
              Barcode (pisah koma)
            </label>
            <input
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              className="input-field font-mono text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-slate-600 mb-1 block">
              Barcode BPOM (pisah koma)
            </label>
            <input
              value={barcodeBpom}
              onChange={(e) => setBarcodeBpom(e.target.value)}
              className="input-field font-mono text-sm"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={simpan} disabled={menyimpan} className="btn-primary text-xs">
            {menyimpan ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Simpan
          </button>
          <button
            onClick={() => {
              setEdit(false);
              setNama(p.nama);
              setBarcode(p.barcodes.join(", "));
              setBarcodeBpom(p.barcodesBpom.join(", "));
            }}
            className="btn-ghost text-xs"
          >
            Batal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-[200px]">
        <p className="text-sm font-medium text-slate-800 flex items-center gap-2">
          <span className="font-mono text-xs text-slate-500">{p.sku}</span>
          {!p.active && <span className="badge-danger">Nonaktif</span>}
        </p>
        <p className="text-sm text-slate-700">{p.nama}</p>
        <p className="text-xs text-slate-400 font-mono flex items-center gap-1.5 mt-0.5">
          <Barcode className="w-3.5 h-3.5 flex-shrink-0" />
          {p.barcodes.length > 0 ? p.barcodes.join(", ") : "belum ada barcode"}
        </p>
        {p.barcodesBpom.length > 0 && (
          <p className="text-xs text-blue-600/80 font-mono flex items-center gap-1.5 mt-0.5">
            <Barcode className="w-3.5 h-3.5 flex-shrink-0" />
            BPOM: {p.barcodesBpom.join(", ")}
          </p>
        )}
      </div>
      <div className="flex gap-1.5">
        <button onClick={() => setEdit(true)} className="btn-ghost text-xs">Edit</button>
        <button
          onClick={ubahAktif}
          className={cn(
            "btn-ghost text-xs",
            p.active ? "text-red-600 hover:bg-red-50" : "text-green-700 hover:bg-green-50"
          )}
        >
          {p.active ? "Nonaktifkan" : "Aktifkan"}
        </button>
      </div>
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
        err ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"
      )}
    >
      {err
        ? <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
        : <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />}
      <p className={cn("text-sm flex-1", err ? "text-red-700" : "text-green-700")}>{pesan}</p>
      <button onClick={onTutup} className={err ? "text-red-400" : "text-green-500"}>
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
