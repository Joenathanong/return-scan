"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { mintaJson, pesanError } from "@/lib/http";
import {
  KONDISI, LABEL_KONDISI, butuhBarcode, bacaBatch, periksaItem,
  type Kondisi, type ItemMasuk,
} from "@/lib/bongkaran";
import {
  sinkron, cariBarcode, saranBatch, isiCache, catatBatchLokal,
  kosongkanCache, cacheTersedia, MIN_KARAKTER_SARAN, type BatchCache,
} from "@/lib/cache-bongkaran";
import { bersihkanKode } from "@/lib/produk";
import {
  PackageOpen, Loader2, AlertCircle, CheckCircle2, X, Plus, Trash2,
  RefreshCw, ScanLine, Clock, WifiOff, Info, ChevronDown,
} from "lucide-react";

/* ══════════════════════════════════════════════════════════════════════════
   Bentuk data di layar
   ══════════════════════════════════════════════════════════════════════════ */

interface Item {
  kunci: string;
  kondisi: Kondisi | null;
  barcode: string;
  sku: string;
  /** Nama dari master. Kosong kalau barcode belum terdaftar. */
  nama: string;
  tidakDikenal: boolean;
  /** Nama yang diketik operator ketika barcode belum terdaftar. */
  namaManual: string;
  /** Nama barang yang benar-benar diterima — hanya untuk ISI_SALAH. */
  namaDiterima: string;
  /**
   * Jenis barcode yang cocok saat lookup: "PRODUK" atau "BPOM".
   *
   * TIDAK ikut disimpan ke database — yang tersimpan tetap kode yang
   * benar-benar di-scan. Ini murni umpan balik layar: operator yang tanpa
   * sadar menembak label izin edar perlu tahu bahwa itulah yang terbaca,
   * bukan barcode dagangnya.
   */
  jenisBarcode: string;
  qty: string;
  batch: string;
  edDate: string;
  edOtomatis: boolean;
  peringatanBatch: string;
  /**
   * Milidetik sejak resi di-scan, dicatat SEKALI pada saat barang ini
   * teridentifikasi (barcode masuk, atau kondisi Isi Salah dipilih).
   * Tidak pernah ditimpa: memperbaiki qty lima menit kemudian tidak boleh
   * mengubah kapan barang itu sebenarnya dibongkar.
   */
  offsetMs: number | null;
}

interface Sesi {
  /** null kalau /mulai gagal dan kita jalan luring. */
  id: string | null;
  noResi: string;
  /** Jam dari SERVER, kecuali saat luring. */
  scannedAt: string;
  luring: boolean;
  /** Titik acuan lokal untuk menghitung offset tiap barang. */
  t0: number;
  duplikat: { tanggal: string; oleh: string; jumlahBarang: number } | null;
  retur: { tanggal: string; expedisi: string; karung: string } | null;
  /**
   * Kunci idempoten untuk jalur luring. Dibuat SEKALI per sesi scan,
   * sehingga menekan Simpan dua kali (karena balasan pertama hilang di
   * jaringan) tidak menghasilkan dua resi. Lihat catatan di schema.prisma.
   */
  klienKunci: string;
}

/** Id acak sederhana — tidak perlu kriptografis, hanya perlu tidak kembar. */
function kunciAcak(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Warna tiap kondisi saat terpilih — dipakai juga di dashboard. */
const WARNA_KONDISI: Record<Kondisi, string> = {
  BAGUS:         "bg-ok border-ok text-white",
  RUSAK_KEMASAN: "bg-warn border-warn text-white",
  RUSAK_TOTAL:   "bg-bad border-bad text-white",
  ISI_SALAH:     "bg-accent border-accent text-white",
};

let nomorKartu = 0;
const itemBaru = (): Item => ({
  kunci: `i${++nomorKartu}`,
  kondisi: null,
  barcode: "", sku: "", nama: "", tidakDikenal: false, namaManual: "",
  namaDiterima: "", jenisBarcode: "", qty: "1", batch: "", edDate: "",
  edOtomatis: false, peringatanBatch: "", offsetMs: null,
});

function keItemMasuk(it: Item): ItemMasuk {
  const perluBarcode = it.kondisi ? butuhBarcode(it.kondisi) : true;
  return {
    kondisi: it.kondisi ?? "",
    barcode: perluBarcode ? it.barcode : "",
    sku: perluBarcode ? it.sku : "",
    // Nama dari master kalau ada; kalau tidak (barcode belum terdaftar,
    // atau master baru tersinkron separuh) pakai ketikan operator.
    namaProduk: perluBarcode ? (it.nama || it.namaManual) : "",
    produkTidakDikenal: perluBarcode && it.tidakDikenal,
    namaDiterima: perluBarcode ? "" : it.namaDiterima,
    qty: Number(it.qty),
    batch: it.batch,
    edDate: it.edDate,
    edOtomatis: it.edOtomatis,
    offsetMs: it.offsetMs ?? 0,
  };
}

/** "YYYY-MM-DD" lokal, hanya untuk pemeriksaan kewajaran batch di layar. */
function hariIniLokal(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

function jamWIB(iso: string): string {
  try {
    return new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Halaman
   ══════════════════════════════════════════════════════════════════════════ */

export default function BongkaranPage() {
  return (
    <AuthGuard>
      <Penjaga />
    </AuthGuard>
  );
}

/** Menyembunyikan halaman dari operator yang belum diberi izin modul. */
function Penjaga() {
  const { appUser } = useAuth();
  if (!appUser) return null;
  if (appUser.role !== "admin" && !appUser.bisaBongkaran) {
    return (
      <div className="max-w-md card p-6 text-center space-y-2">
        <PackageOpen className="w-8 h-8 text-gray-300 mx-auto" />
        <p className="font-medium text-heading">Menu Bongkaran belum dibuka</p>
        <p className="text-sm text-gray-500">
          Minta admin mencentang &ldquo;Bisa Bongkaran&rdquo; untuk akun Anda di menu Kelola User.
        </p>
      </div>
    );
  }
  return <Isi />;
}

function Isi() {
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  // ── Cache ─────────────────────────────────────────────────────────────
  const [statusCache, setStatusCache] = useState<"memuat" | "siap" | "gagal">("memuat");
  const [isi, setIsi] = useState({ produk: 0, barcode: 0, batch: 0 });
  const [pesanSinkron, setPesanSinkron] = useState("Menyiapkan data produk…");

  const jalankanSinkron = useCallback(async (diam = false) => {
    if (!cacheTersedia()) {
      setStatusCache("gagal");
      setPesanSinkron(
        "Peramban ini tidak mendukung penyimpanan lokal (IndexedDB). " +
          "Scan masih bisa jalan, tapi barcode tidak akan dikenali otomatis."
      );
      return;
    }
    if (!diam) setStatusCache("memuat");
    try {
      const h = await sinkron((k) => {
        if (k.penuh) {
          setPesanSinkron(
            `Mengunduh master produk… ${k.produk.toLocaleString("id-ID")} produk, ` +
              `${k.barcode.toLocaleString("id-ID")} barcode`
          );
        }
      });
      setIsi(await isiCache());

      // Sinkron yang berhenti karena batas putaran TIDAK boleh dilaporkan
      // sebagai "siap": barcode yang belum sampai akan terlihat seperti
      // barang yang memang belum terdaftar, dan operator tidak punya cara
      // membedakannya.
      if (h.terpotong) {
        setStatusCache("gagal");
        setPesanSinkron(
          "Pengunduhan data produk terhenti sebelum selesai. Tekan Sinkronkan " +
            "sekali lagi untuk melanjutkan dari titik terakhir."
        );
        return;
      }

      setStatusCache("siap");
      if (!diam) {
        setInfo(
          h.produk + h.barcode + h.batch === 0
            ? "Data produk sudah paling baru."
            : `Sinkron selesai: ${h.produk} produk, ${h.barcode} barcode, ${h.batch} batch diperbarui.`
        );
      }
    } catch (e) {
      setStatusCache("gagal");
      setPesanSinkron(pesanError(e, "Gagal menyiapkan data produk."));
    }
  }, []);

  useEffect(() => { jalankanSinkron(true); }, [jalankanSinkron]);

  /**
   * Buang seluruh cache lalu unduh ulang dari nol.
   *
   * Jalan keluar terakhir kalau isi cache dicurigai tidak cocok dengan
   * master — misalnya barcode yang jelas sudah didaftarkan admin tapi tetap
   * tidak dikenali di perangkat ini. Mahal (mengunduh ulang semuanya), jadi
   * ditaruh di balik konfirmasi, bukan di samping tombol Sinkronkan.
   */
  const [tanyaReset, setTanyaReset] = useState(false);
  const resetCache = async () => {
    setTanyaReset(false);
    try {
      await kosongkanCache();
      setIsi({ produk: 0, barcode: 0, batch: 0 });
      await jalankanSinkron(false);
    } catch (e) {
      setError(pesanError(e, "Gagal mengosongkan cache."));
    }
  };

  // ── Sesi scan ─────────────────────────────────────────────────────────
  const [resi, setResi] = useState("");
  const [sesi, setSesi] = useState<Sesi | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [memulai, setMemulai] = useState(false);
  const [menyimpan, setMenyimpan] = useState(false);

  const resiRef = useRef<HTMLInputElement>(null);
  /**
   * Kartu mana yang harus menerima fokus berikutnya.
   *
   * STATE, bukan ref: ref yang dibaca saat render membuat keluaran render
   * bergantung pada nilai yang boleh dibuang React, dan permintaan fokusnya
   * hilang diam-diam kalau render itu tidak jadi dipakai.
   */
  const [fokusKunci, setFokusKunci] = useState<string | null>(null);

  useEffect(() => { resiRef.current?.focus(); }, []);

  const mulai = async () => {
    const kode = resi.replace(/\s+/g, "").toUpperCase();
    if (!kode || memulai) return;
    setMemulai(true);
    setError("");

    const t0 = Date.now();
    const pertama = itemBaru();

    try {
      const d = await mintaJson<{
        id: string; noResi: string; scannedAt: string;
        duplikat: Sesi["duplikat"]; retur: Sesi["retur"];
      }>("/api/bongkaran/mulai", { method: "POST", body: { noResi: kode }, timeoutMs: 15_000 });

      // t0 disetel ULANG di sini, bukan dipakai apa adanya dari sebelum
      // permintaan: server menulis `scannedAt` saat permintaan TIBA, jadi
      // memakai t0 yang lama akan menghitung lama perjalanan jaringan ke
      // dalam offset setiap barang — dan selisihnya membesar justru ketika
      // jaringan gudang sedang buruk.
      setSesi({
        id: d.id, noResi: d.noResi, scannedAt: d.scannedAt,
        luring: false, t0: Date.now(), duplikat: d.duplikat, retur: d.retur,
        klienKunci: kunciAcak(),
      });
    } catch (e) {
      // JARINGAN PUTUS — jangan hentikan operator. Sesi dibuat lokal, jam
      // diambil dari perangkat, dan barisnya nanti ditandai di server
      // sebagai "waktu dari klien" supaya bisa ditelusuri.
      console.error("[bongkaran] /mulai gagal, lanjut luring:", e);
      setSesi({
        id: null, noResi: kode, scannedAt: new Date(t0).toISOString(),
        luring: true, t0, duplikat: null, retur: null,
        klienKunci: kunciAcak(),
      });
    } finally {
      setItems([pertama]);
      setFokusKunci(pertama.kunci);
      setResi("");
      setMemulai(false);
    }
  };

  const lupakanFokus = useCallback(() => setFokusKunci(null), []);

  const ubahItem = useCallback((kunci: string, patch: Partial<Item>) => {
    setItems((arr) => arr.map((it) => (it.kunci === kunci ? { ...it, ...patch } : it)));
  }, []);

  const tandaiWaktu = useCallback((kunci: string, t0: number) => {
    setItems((arr) =>
      arr.map((it) =>
        it.kunci === kunci && it.offsetMs === null
          ? { ...it, offsetMs: Date.now() - t0 }
          : it
      )
    );
  }, []);

  const tambahBarang = () => {
    const b = itemBaru();
    setItems((arr) => [...arr, b]);
    setFokusKunci(b.kunci);
  };

  const buangBarang = (kunci: string) => {
    setItems((arr) => (arr.length <= 1 ? arr : arr.filter((it) => it.kunci !== kunci)));
  };

  const batalkanSesi = async () => {
    const id = sesi?.id;
    setSesi(null);
    setItems([]);
    setResi("");
    resiRef.current?.focus();
    if (id) {
      try {
        await mintaJson(`/api/bongkaran/${id}`, { method: "DELETE" });
      } catch {
        // Draft yang gagal dibuang cuma jadi baris "belum selesai" di
        // dashboard — tidak layak menghentikan operator.
      }
    }
  };

  // ── Validasi seluruh keranjang ────────────────────────────────────────
  const masalah = useMemo(
    () => items.map((it, i) => periksaItem(keItemMasuk(it), i + 1)),
    [items]
  );
  const masalahPertama = masalah.find(Boolean) ?? "";
  const bisaSimpan = items.length > 0 && !masalahPertama && !menyimpan;

  const simpan = async () => {
    if (!sesi || !bisaSimpan) return;
    setMenyimpan(true);
    setError("");
    try {
      const muatan = items.map(keItemMasuk);
      const d = await mintaJson<{ noResi: string; jumlahBarang: number }>(
        "/api/bongkaran/simpan",
        {
          method: "POST",
          timeoutMs: 45_000,
          body: sesi.id
            ? { bongkaranId: sesi.id, items: muatan }
            : {
                noResi: sesi.noResi,
                scannedAtKlien: sesi.scannedAt,
                klienKunci: sesi.klienKunci,
                items: muatan,
              },
        }
      );

      // Batch yang barusan dipakai langsung masuk cache lokal, tanpa
      // menunggu sinkron berikutnya — resi berikutnya sering memakai batch
      // yang sama persis.
      await Promise.all(
        items
          .filter((it) => it.sku && it.batch && it.edDate)
          .map((it) => catatBatchLokal(it.sku, it.batch, it.edDate))
      );

      setInfo(`${d.noResi} tersimpan — ${d.jumlahBarang} barang.`);
      setSesi(null);
      setItems([]);
      setResi("");
      setTimeout(() => resiRef.current?.focus(), 0);
    } catch (e) {
      setError(pesanError(e, "Gagal menyimpan."));
    } finally {
      setMenyimpan(false);
    }
  };

  /* ────────────────────────────────────────────────────────────────────── */

  return (
    <div className="max-w-2xl space-y-4 pb-28">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Scan Bongkaran</h1>
          <p className="page-sub">
            {statusCache === "siap"
              ? `${isi.produk.toLocaleString("id-ID")} produk · ${isi.barcode.toLocaleString("id-ID")} barcode di perangkat ini`
              : "Menyiapkan data produk…"}
          </p>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => jalankanSinkron(false)}
            disabled={statusCache === "memuat"}
            className="btn-ghost text-sm"
          >
            <RefreshCw className={cn("w-4 h-4", statusCache === "memuat" && "animate-spin")} />
            Sinkronkan
          </button>
          <button
            onClick={() => setTanyaReset(true)}
            disabled={statusCache === "memuat" || !!sesi}
            className="btn-ghost text-sm text-gray-500 disabled:opacity-40"
            title={
              sesi
                ? "Selesaikan atau batalkan resi yang sedang dibuka dulu"
                : "Buang cache lalu unduh ulang dari awal"
            }
          >
            Muat ulang total
          </button>
        </div>
      </div>

      {tanyaReset && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 space-y-2">
          <p className="text-sm text-amber-800">
            Seluruh data produk di perangkat ini akan dibuang lalu diunduh ulang dari
            awal. Butuh jaringan yang stabil dan bisa memakan beberapa menit.
          </p>
          <div className="flex gap-2">
            <button onClick={resetCache} className="btn-primary text-xs">Lanjutkan</button>
            <button onClick={() => setTanyaReset(false)} className="btn-ghost text-xs">Batal</button>
          </div>
        </div>
      )}

      {statusCache !== "siap" && (
        <div
          className={cn(
            "rounded-xl px-4 py-3 flex gap-2.5 text-sm border",
            statusCache === "gagal"
              ? "bg-amber-50 border-amber-200 text-amber-800"
              : "bg-gray-50 border-gray-300 text-gray-600"
          )}
        >
          {statusCache === "gagal"
            ? <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            : <Loader2 className="w-4 h-4 flex-shrink-0 mt-0.5 animate-spin" />}
          <p>{pesanSinkron}</p>
        </div>
      )}

      {error && <Kotak jenis="error" pesan={error} onTutup={() => setError("")} />}
      {info && <Kotak jenis="info" pesan={info} onTutup={() => setInfo("")} />}

      {/* ── Langkah 1: resi ── */}
      {!sesi ? (
        <div className="card p-5 space-y-3">
          <label className="text-sm font-medium text-ink block">No. Resi</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <ScanLine className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                ref={resiRef}
                value={resi}
                onChange={(e) => setResi(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); mulai(); } }}
                className="input-field pl-10 text-lg font-mono tracking-wide"
                placeholder="Scan atau ketik resi…"
                autoComplete="off"
                disabled={memulai}
              />
            </div>
            <button onClick={mulai} disabled={!resi.trim() || memulai} className="btn-primary">
              {memulai ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Mulai
            </button>
          </div>
          <p className="text-xs text-gray-400">
            Waktu scan dicatat saat resi ini masuk, bukan saat Simpan ditekan.
          </p>
        </div>
      ) : (
        <>
          <KepalaSesi sesi={sesi} onBatal={batalkanSesi} />

          {items.map((it, i) => (
            <KartuBarang
              key={it.kunci}
              nomor={i + 1}
              item={it}
              total={items.length}
              masalah={masalah[i]}
              fokusBarcode={fokusKunci === it.kunci}
              onSudahFokus={lupakanFokus}
              onUbah={(patch) => ubahItem(it.kunci, patch)}
              onTandaiWaktu={() => tandaiWaktu(it.kunci, sesi.t0)}
              onBuang={() => buangBarang(it.kunci)}
              onLanjut={tambahBarang}
            />
          ))}

          <button onClick={tambahBarang} className="btn-ghost w-full justify-center border border-dashed border-gray-300 py-3">
            <Plus className="w-4 h-4" /> Barang
          </button>

          {/* Bilah simpan — menempel di bawah supaya selalu terjangkau ibu
              jari di layar PDT yang sempit. */}
          <div className="fixed bottom-0 left-0 right-0 lg:left-sidebar bg-white/95 backdrop-blur border-t border-brand-600/10 p-3 z-20">
            <div className="max-w-2xl mx-auto space-y-2">
              {masalahPertama && (
                <p className="text-xs text-amber-700 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {masalahPertama}
                </p>
              )}
              <button
                onClick={simpan}
                disabled={!bisaSimpan}
                className="btn-primary w-full justify-center py-3 text-base disabled:opacity-40"
              >
                {menyimpan && <Loader2 className="w-5 h-5 animate-spin" />}
                Simpan ({items.length} barang)
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Kepala sesi — resi + jam + dua petunjuk dari server
   ══════════════════════════════════════════════════════════════════════════ */

function KepalaSesi({ sesi, onBatal }: { sesi: Sesi; onBatal: () => void }) {
  return (
    <div className="card p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-lg font-semibold text-heading truncate">
            {sesi.noResi}
          </p>
          <p className="text-xs text-gray-500 flex items-center gap-1.5 mt-0.5">
            <Clock className="w-3.5 h-3.5" />
            {jamWIB(sesi.scannedAt)} WIB
            {sesi.luring && <span className="text-amber-600">· jam perangkat</span>}
          </p>
        </div>
        <button onClick={onBatal} className="btn-ghost text-xs text-gray-500">
          <X className="w-3.5 h-3.5" /> Batal
        </button>
      </div>

      {sesi.luring && (
        <p className="text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-800 flex gap-2">
          <WifiOff className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          Server tidak terjangkau saat resi di-scan, jadi waktunya diambil dari jam
          perangkat ini. Data tetap bisa disimpan, dan akan ditandai untuk ditelusuri.
        </p>
      )}

      {sesi.duplikat && (
        <p className="text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-800 flex gap-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          Resi ini sudah pernah dibongkar {sesi.duplikat.tanggal} oleh{" "}
          {sesi.duplikat.oleh} ({sesi.duplikat.jumlahBarang} barang). Lanjutkan saja
          kalau ini koli yang berbeda.
        </p>
      )}

      {sesi.retur ? (
        <p className="text-xs bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-gray-600 flex gap-2">
          <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          Cocok dengan Scan Retur — {sesi.retur.expedisi}, karung {sesi.retur.karung},{" "}
          {sesi.retur.tanggal}.
        </p>
      ) : !sesi.luring ? (
        <p className="text-xs text-gray-400 flex gap-2">
          <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          Belum ada di Scan Retur. Bukan masalah — bongkar boleh mendahului scan retur.
        </p>
      ) : null}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Kartu barang
   ══════════════════════════════════════════════════════════════════════════ */

interface PropsKartu {
  nomor: number;
  total: number;
  item: Item;
  masalah: string | null;
  fokusBarcode: boolean;
  onSudahFokus: () => void;
  onUbah: (patch: Partial<Item>) => void;
  onTandaiWaktu: () => void;
  onBuang: () => void;
  /** Enter di kolom terakhir → langsung buka kartu barang berikutnya. */
  onLanjut: () => void;
}

function KartuBarang({
  nomor, total, item, masalah, fokusBarcode, onSudahFokus,
  onUbah, onTandaiWaktu, onBuang, onLanjut,
}: PropsKartu) {
  const barcodeRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const batchRef = useRef<HTMLInputElement>(null);
  const edRef = useRef<HTMLInputElement>(null);
  const namaDiterimaRef = useRef<HTMLInputElement>(null);
  const [mencari, setMencari] = useState(false);

  useEffect(() => {
    if (fokusBarcode) {
      barcodeRef.current?.focus();
      onSudahFokus();
    }
  }, [fokusBarcode, onSudahFokus]);

  const perluBarcode = item.kondisi === null || butuhBarcode(item.kondisi);

  const pilihKondisi = (k: Kondisi) => {
    if (k === "ISI_SALAH") {
      // Barcode dibuang, bukan sekadar disembunyikan: kolom yang tidak
      // terlihat tapi masih berisi akan ikut terkirim dan ditolak server.
      onUbah({
        kondisi: k, barcode: "", sku: "", nama: "",
        tidakDikenal: false, namaManual: "",
      });
      onTandaiWaktu();
      setTimeout(() => namaDiterimaRef.current?.focus(), 0);
    } else {
      onUbah({ kondisi: k, namaDiterima: "" });
      if (!item.barcode) setTimeout(() => barcodeRef.current?.focus(), 0);
    }
  };

  const cariProduk = async () => {
    const kode = item.barcode.replace(/\s+/g, "").toUpperCase();
    if (!kode) return;
    onTandaiWaktu();
    setMencari(true);
    try {
      const p = await cariBarcode(kode);
      if (p && p.nama) {
        onUbah({
          barcode: kode, sku: p.sku, nama: p.nama,
          tidakDikenal: false, namaManual: "", jenisBarcode: p.jenis ?? "PRODUK",
        });
      } else if (p) {
        // Barcode ADA di cache, hanya baris produknya yang belum sampai
        // (master baru tersinkron separuh). Ini BUKAN "tidak dikenal":
        // menandainya begitu akan memasukkan barcode yang sebenarnya sudah
        // terdaftar ke daftar "belum terdaftar" di dashboard, dan admin akan
        // mengejar masalah yang tidak ada.
        onUbah({
          barcode: kode, sku: p.sku, nama: "",
          tidakDikenal: false, jenisBarcode: p.jenis ?? "PRODUK",
        });
      } else {
        onUbah({ barcode: kode, sku: "", nama: "", tidakDikenal: true, jenisBarcode: "" });
      }
    } catch {
      onUbah({ barcode: kode, sku: "", nama: "", tidakDikenal: true, jenisBarcode: "" });
    } finally {
      setMencari(false);
      setTimeout(() => qtyRef.current?.focus(), 0);
    }
  };

  const ubahBatch = (nilai: string) => {
    // Normalisasi yang SAMA PERSIS dengan server (bersihkanKode): scanner
    // kadang menyelipkan spasi, dan kalau klien hanya menaikkan huruf besar
    // sementara server juga merapatkan spasi, keduanya bisa membaca batch
    // yang sama secara berbeda — layar tidak mengisi ED otomatis, server
    // mengisinya.
    const b = bersihkanKode(nilai);
    const terbaca = bacaBatch(b, hariIniLokal());
    if (terbaca) {
      onUbah({
        batch: b,
        edDate: terbaca.edDate,
        edOtomatis: true,
        peringatanBatch: terbaca.peringatan ?? "",
      });
    } else {
      // ED yang sudah diketik manual TIDAK dihapus hanya karena batch-nya
      // diedit — operator akan mengetiknya ulang tanpa alasan.
      onUbah({ batch: b, edOtomatis: false, peringatanBatch: "" });
    }
  };

  /**
   * Enter di kolom Batch saat daftar saran tertutup.
   *
   * Kalau Exp. Date masih kosong padahal wajib (batch tidak berpola
   * tanggal), kursor turun ke sana dulu — melompatinya berarti operator
   * baru menyadari kolom yang tertinggal setelah menekan Simpan. Kalau ED
   * sudah terisi (biasanya otomatis dari batch), langsung ke barang
   * berikutnya, dan rantai scanner tidak terputus.
   */
  const selesaiBatch = () => {
    if (perluBarcode && !item.edDate) {
      edRef.current?.focus();
      return;
    }
    onLanjut();
  };

  /** Alt+1..4 memilih kondisi dari kolom mana pun di kartu ini. */
  const pintasKondisi = (e: React.KeyboardEvent) => {
    if (!e.altKey) return;
    const i = ["1", "2", "3", "4"].indexOf(e.key);
    if (i < 0) return;
    e.preventDefault();
    pilihKondisi(KONDISI[i]);
  };

  return (
    <div
      onKeyDown={pintasKondisi}
      className={cn(
        "card p-4 space-y-3",
        masalah ? "border-gray-300" : "border-brand-200"
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-ink">Barang {nomor}</p>
        {total > 1 && (
          <button
            onClick={onBuang}
            className="text-gray-400 hover:text-red-600 p-1 rounded"
            aria-label={`Buang barang ${nomor}`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ── Kondisi: baris PERTAMA, aktif sejak kartu muncul ── */}
      <div>
        <label className="text-xs font-medium text-gray-600 mb-1.5 block">
          Kondisi <span className="text-gray-400 font-normal">· Alt+1…4</span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          {KONDISI.map((k, i) => {
            const aktif = item.kondisi === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => pilihKondisi(k)}
                className={cn(
                  "px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors text-left",
                  // Kondisi yang terpilih memakai warna STATUS-nya sendiri,
                  // bukan warna aksi. Ini satu-satunya tempat di aplikasi
                  // yang begitu, dan alasannya: yang sedang dipilih di sini
                  // BUKAN sebuah tindakan, melainkan nilai status yang akan
                  // tersimpan. Operator yang menoleh sebentar harus bisa
                  // membaca "merah" sebagai rusak total tanpa mengeja
                  // tulisannya.
                  aktif ? WARNA_KONDISI[k] : "bg-white border-gray-300 text-ink hover:border-brand-400"
                )}
              >
                <span className="text-[10px] opacity-60 mr-1">{i + 1}</span>
                {LABEL_KONDISI[k]}
              </button>
            );
          })}
        </div>
      </div>

      {/*
        BERDAMPINGAN MULAI 640 px (`sm:`), BERTUMPUK DI BAWAH ITU.

        Layar PDT genggam sering hanya ~360 px. Di lebar itu, kolom barcode
        yang dibagi dua tinggal ~150 px — nomor barcode 13 digit tidak
        terbaca seluruhnya, dan daftar saran batch jadi terlalu sempit untuk
        menampilkan batch beserta ED-nya. Jadi berdampingannya hanya berlaku
        di layar yang memang cukup lebar; di PDT sempit tetap bertumpuk.
      */}
      {perluBarcode ? (
        <>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 min-w-0">
            <label className="text-xs font-medium text-gray-600 mb-1.5 block">Barcode</label>
            <div className="relative">
              <input
                ref={barcodeRef}
                value={item.barcode}
                // Hasil lookup lama HARUS ikut dibuang saat barcode diketik
                // ulang. Kalau tidak: scan barcode A (dapat SKU-1), sadar
                // salah, hapus, ketik barcode B, lalu pindah kolom — barisnya
                // tersimpan sebagai barcode B dengan SKU dan nama milik A,
                // dan tidak ada satu pun pemeriksaan yang menangkapnya karena
                // semua kolomnya terisi.
                onChange={(e) =>
                  onUbah({
                    barcode: e.target.value,
                    sku: "", nama: "", tidakDikenal: false, namaManual: "",
                    jenisBarcode: "",
                  })
                }
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); cariProduk(); } }}
                onBlur={() => { if (item.barcode && !item.sku && !item.tidakDikenal) cariProduk(); }}
                // Scanner yang tidak mengirim Enter tetap tertangani lewat
                // onBlur di atas; keduanya sekarang aman karena kolom
                // turunannya sudah dikosongkan oleh onChange.
                className="input-field font-mono"
                placeholder="Scan barcode produk atau BPOM…"
                autoComplete="off"
              />
              {mencari && (
                <Loader2 className="w-4 h-4 animate-spin text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />
              )}
            </div>
            </div>

            <KolomQty item={item} inputRef={qtyRef} batchRef={batchRef} onUbah={onUbah} />
          </div>

          {/* Wadah keterangan produk. Disembunyikan (bukan sekadar kosong)
              saat belum ada apa-apa, supaya tidak menyisakan jarak mati di
              antara baris barcode dan baris batch. */}
          <div className={cn(!(item.barcode && (item.sku || item.tidakDikenal)) && "hidden")}>
            {item.sku && !item.tidakDikenal && (
              <p className="mt-1.5 text-sm text-ok-strong flex items-start gap-1.5">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>
                  {item.nama}
                  <span className="text-gray-400 font-mono text-xs ml-2">{item.sku}</span>
                  {item.jenisBarcode === "BPOM" && (
                    <span className="ml-2 badge-info">via barcode BPOM</span>
                  )}
                </span>
              </p>
            )}

            {item.barcode && !item.nama && (item.tidakDikenal || item.sku) && (
              <div className="mt-1.5 space-y-1.5">
                <p className="text-sm text-red-600 flex items-start gap-1.5">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  {item.tidakDikenal
                    ? "Barcode belum terdaftar di Master Produk. Barcode-nya tetap disimpan dan akan muncul di dashboard untuk didaftarkan admin."
                    : `Barcode ini menunjuk SKU ${item.sku}, tapi nama produknya belum ada di perangkat ini. Tekan Sinkronkan, atau ketik namanya.`}
                </p>
                <input
                  value={item.namaManual}
                  onChange={(e) => onUbah({ namaManual: e.target.value })}
                  className="input-field"
                  placeholder="Ketik nama barangnya…"
                />
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 min-w-0">
              <label className="text-xs font-medium text-gray-600 mb-1.5 block">
                Nama Barang yang Diterima
              </label>
              <input
                ref={namaDiterimaRef}
                value={item.namaDiterima}
                onChange={(e) => onUbah({ namaDiterima: e.target.value })}
                className="input-field"
                placeholder="Ketik nama barang yang benar-benar ada di dalam…"
              />
            </div>

            {/* Quantity tetap di posisi yang sama — di kanan kolom identitas
                barang — supaya mata operator tidak perlu mencarinya di
                tempat berbeda hanya karena kondisinya berbeda. */}
            <KolomQty item={item} inputRef={qtyRef} batchRef={batchRef} onUbah={onUbah} />
          </div>

          <p className="text-xs text-gray-400">
            Kondisi Isi Salah tidak memakai barcode — barang asing biasanya tidak
            punya barcode yang dikenali sistem ini.
          </p>
        </>
      )}

      {/*
        Batch di KIRI, Exp. Date di KANAN — arah baca yang sama dengan arah
        pengisian: batch berpola tanggal mengisi ED, jadi kolom yang mengisi
        dibaca lebih dulu daripada kolom yang terisi.
      */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-0">
          <KolomBatch
            inputRef={batchRef}
            sku={item.sku}
            nilai={item.batch}
            opsional={!perluBarcode}
            peringatan={item.peringatanBatch}
            onUbah={ubahBatch}
            onPilih={(b) => onUbah({
              batch: b.batch, edDate: b.edDate, edOtomatis: false, peringatanBatch: "",
            })}
            onLanjut={selesaiBatch}
          />
        </div>

        <div className="w-full sm:w-[11.5rem] flex-shrink-0">
          <label className="text-xs font-medium text-gray-600 mb-1.5 block">
            Exp. Date
            {item.edOtomatis && (
              <span className="ml-1.5 text-brand-600 font-normal">otomatis</span>
            )}
            {!perluBarcode && <span className="ml-1.5 text-gray-400 font-normal">opsional</span>}
          </label>
          <input
            ref={edRef}
            type="date"
            value={item.edDate}
            onChange={(e) => onUbah({ edDate: e.target.value, edOtomatis: false })}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onLanjut(); } }}
            className="input-field"
          />
        </div>
      </div>

      {masalah && (
        <p className="text-xs text-gray-400">{masalah}</p>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Kolom Quantity — dipakai di dua tempat (di samping Barcode, dan di samping
   Nama Barang Diterima), jadi ditulis sekali supaya lebar, pintasan Enter,
   dan penyaringan angkanya tidak pernah berbeda di antara keduanya.
   ══════════════════════════════════════════════════════════════════════════ */

function KolomQty({
  item, inputRef, batchRef, onUbah,
}: {
  item: Item;
  inputRef: React.RefObject<HTMLInputElement | null>;
  batchRef: React.RefObject<HTMLInputElement | null>;
  onUbah: (patch: Partial<Item>) => void;
}) {
  return (
    // LEBAR PENUH saat kartu bertumpuk (layar PDT), selebar 7rem saat
    // berdampingan. Sebelumnya kolom ini dibatasi 8rem di semua lebar,
    // sehingga di PDT ia berdiri sendiri jauh lebih pendek daripada Barcode
    // dan Batch di atas-bawahnya — satu kolom kerdil di tengah tumpukan
    // kolom penuh, dan tepi kanannya tidak sejajar dengan apa pun.
    <div className="w-full sm:w-28 flex-shrink-0">
      <label className="text-xs font-medium text-gray-600 mb-1.5 block">Quantity</label>
      <input
        ref={inputRef}
        value={item.qty}
        onChange={(e) => onUbah({ qty: e.target.value.replace(/[^0-9]/g, "") })}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); batchRef.current?.focus(); }
        }}
        inputMode="numeric"
        // Rata tengah supaya angka satu digit — yang paling sering —
        // tidak tersudut sendirian di kiri kolom yang lebar.
        className="input-field text-center sm:text-left"
      />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Kolom batch + saran
   ══════════════════════════════════════════════════════════════════════════ */

function KolomBatch({
  inputRef, sku, nilai, opsional, peringatan, onUbah, onPilih, onLanjut,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  sku: string;
  nilai: string;
  opsional: boolean;
  peringatan: string;
  onUbah: (v: string) => void;
  onPilih: (b: BatchCache) => void;
  onLanjut: () => void;
}) {
  const [saran, setSaran] = useState<BatchCache[]>([]);
  const [buka, setBuka] = useState(false);
  const [sorot, setSorot] = useState(0);
  const daftarRef = useRef<HTMLDivElement>(null);

  /**
   * Nilai yang BARU SAJA dipilih dari daftar.
   *
   * Memilih sebuah saran mengubah `nilai`, yang memicu efek di bawah, yang
   * membuka daftarnya lagi — tepat di atas kolom Exp. Date, dan tidak mau
   * tertutup karena `onMouseDown` sudah mencegah blur. Penanda ini membuat
   * efek itu melewatkan satu putaran untuk nilai yang barusan diterima.
   */
  const terpilihRef = useRef<string | null>(null);

  useEffect(() => {
    let batal = false;

    if (terpilihRef.current === nilai) {
      terpilihRef.current = null;
      setBuka(false);
      return;
    }
    if (!sku || nilai.length < MIN_KARAKTER_SARAN) {
      setSaran([]); setBuka(false);
      return;
    }
    saranBatch(sku, nilai)
      .then((r) => {
        if (batal) return;
        setSaran(r);
        setSorot(0);
        setBuka(r.length > 0);
      })
      .catch(() => { if (!batal) setSaran([]); });
    return () => { batal = true; };
  }, [sku, nilai]);

  // Menjaga baris tersorot tetap terlihat saat dinavigasi dengan panah.
  useEffect(() => {
    if (!buka) return;
    daftarRef.current
      ?.querySelector<HTMLElement>(`[data-i="${sorot}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [sorot, buka]);

  const pilih = (b: BatchCache) => {
    terpilihRef.current = b.batch;
    onPilih(b);
    setBuka(false);
  };

  const tombol = (e: React.KeyboardEvent) => {
    // Enter saat daftar TERTUTUP berarti "barang ini selesai" — inilah yang
    // menyambung rantai scanner sampai ke barang berikutnya tanpa perlu
    // menyentuh layar.
    if (!buka || saran.length === 0) {
      if (e.key === "Enter") { e.preventDefault(); onLanjut(); }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSorot((s) => (s + 1) % saran.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSorot((s) => (s - 1 + saran.length) % saran.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pilih(saran[sorot]);
    } else if (e.key === "Escape") {
      setBuka(false);
    }
  };

  return (
    <div className="relative">
      <label className="text-xs font-medium text-gray-600 mb-1.5 block">
        Batch
        {opsional && <span className="ml-1.5 text-gray-400 font-normal">opsional</span>}
      </label>
      <input
        ref={inputRef}
        value={nilai}
        onChange={(e) => onUbah(e.target.value)}
        onKeyDown={tombol}
        onFocus={() => { if (saran.length > 0) setBuka(true); }}
        onBlur={() => setTimeout(() => setBuka(false), 150)}
        className="input-field font-mono"
        placeholder="Ketik atau scan batch…"
        autoComplete="off"
      />

      {peringatan && (
        <p className="mt-1.5 text-xs text-amber-700 flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {peringatan}
        </p>
      )}

      {sku && nilai.length > 0 && nilai.length < MIN_KARAKTER_SARAN && (
        <p className="mt-1.5 text-xs text-gray-400 flex items-center gap-1">
          <ChevronDown className="w-3 h-3" />
          Saran batch muncul setelah {MIN_KARAKTER_SARAN} karakter.
        </p>
      )}

      {buka && saran.length > 0 && (
        <div
          ref={daftarRef}
          // Sejak kolom Batch hanya setengah lebar, daftarnya diberi lebar
          // minimum dan dibiarkan melebar ke kanan melewati kolomnya. Tanpa
          // itu, baris "B26A01 · ED 01-02-2029" terpotong justru pada bagian
          // yang membuatnya berguna.
          className="absolute z-30 left-0 top-full mt-1 w-full min-w-[15rem]
                     max-h-52 overflow-y-auto scroll-slim
                     bg-white border border-gray-300 rounded-xl shadow-lg"
        >
          {saran.map((b, i) => (
            <button
              key={b.kunci}
              type="button"
              data-i={i}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pilih(b)}
              onMouseEnter={() => setSorot(i)}
              className={cn(
                "w-full text-left px-3 py-2 flex items-center justify-between gap-3 text-sm",
                i === sorot ? "bg-brand-50" : "bg-white"
              )}
            >
              <span className="font-mono text-heading">{b.batch}</span>
              <span className="text-xs text-gray-500">ED {b.edDate}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */

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
