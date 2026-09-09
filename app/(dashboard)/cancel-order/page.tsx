"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import AuthGuard from "@/components/AuthGuard";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { mintaJson, pesanError } from "@/lib/http";
import { bersihkanKode } from "@/lib/produk";
import {
  periksaItemCancel, edDariBatch, MAKS_ITEM, type ItemCancel,
} from "@/lib/cancel-order";
import {
  sinkron, cariBarcode, saranBatch, isiCache, catatBatchLokal,
  cacheTersedia, MIN_KARAKTER_SARAN, type BatchCache,
} from "@/lib/cache-bongkaran";
import {
  XCircle, Loader2, AlertCircle, CheckCircle2, X, Plus, Trash2,
  RefreshCw, ScanLine, History, ChevronDown,
} from "lucide-react";

/* ══════════════════════════════════════════════════════════════════════════
   Satu baris barang di layar
   ══════════════════════════════════════════════════════════════════════════ */

interface Baris {
  kunci: string;
  barcode: string;
  sku: string;
  nama: string;
  tidakDikenal: boolean;
  namaManual: string;
  qty: string;
  batch: string;
  edDate: string;
  edOtomatis: boolean;
  peringatanBatch: string;
}

let nomorBaris = 0;
const barisBaru = (): Baris => ({
  kunci: `b${++nomorBaris}`,
  barcode: "", sku: "", nama: "", tidakDikenal: false, namaManual: "",
  qty: "1", batch: "", edDate: "", edOtomatis: false, peringatanBatch: "",
});

const keItem = (b: Baris): ItemCancel => ({
  barcode: b.barcode,
  sku: b.sku,
  namaProduk: b.nama || b.namaManual,
  produkTidakDikenal: b.tidakDikenal,
  qty: Number(b.qty),
  batch: b.batch,
  edDate: b.edDate,
  edOtomatis: b.edOtomatis,
});

const hariIniWIB = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());

/* ══════════════════════════════════════════════════════════════════════════
   Halaman
   ══════════════════════════════════════════════════════════════════════════ */

export default function CancelOrderPage() {
  return (
    <AuthGuard>
      <Penjaga />
    </AuthGuard>
  );
}

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
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  // ── Cache master produk (dipakai bersama modul Bongkaran) ─────────────
  const [statusCache, setStatusCache] = useState<"memuat" | "siap" | "gagal">("memuat");
  const [isi, setIsi] = useState({ produk: 0, barcode: 0, batch: 0 });
  const [pesanSinkron, setPesanSinkron] = useState("Menyiapkan data produk…");

  const jalankanSinkron = useCallback(async (diam = false) => {
    if (!cacheTersedia()) {
      setStatusCache("gagal");
      setPesanSinkron(
        "Peramban ini tidak mendukung penyimpanan lokal. Pencatatan tetap bisa " +
          "jalan, tapi barcode tidak akan dikenali otomatis — nama barang diketik manual."
      );
      return;
    }
    if (!diam) setStatusCache("memuat");
    try {
      const h = await sinkron((k) => {
        if (k.penuh) {
          setPesanSinkron(
            `Mengunduh master produk… ${k.produk.toLocaleString("id-ID")} produk`
          );
        }
      });
      setIsi(await isiCache());
      if (h.terpotong) {
        setStatusCache("gagal");
        setPesanSinkron(
          "Pengunduhan data produk terhenti sebelum selesai. Tekan Sinkronkan " +
            "sekali lagi untuk melanjutkan."
        );
        return;
      }
      setStatusCache("siap");
      if (!diam) setInfo("Data produk sudah paling baru.");
    } catch (e) {
      setStatusCache("gagal");
      setPesanSinkron(pesanError(e, "Gagal menyiapkan data produk."));
    }
  }, []);

  useEffect(() => { jalankanSinkron(true); }, [jalankanSinkron]);

  // ── Sesi input ────────────────────────────────────────────────────────
  const [catatan, setCatatan] = useState("");
  const [baris, setBaris] = useState<Baris[]>(() => [barisBaru()]);
  const [fokusKunci, setFokusKunci] = useState<string | null>(null);
  const [menyimpan, setMenyimpan] = useState(false);

  const lupakanFokus = useCallback(() => setFokusKunci(null), []);

  const ubah = useCallback((kunci: string, patch: Partial<Baris>) => {
    setBaris((arr) => arr.map((b) => (b.kunci === kunci ? { ...b, ...patch } : b)));
  }, []);

  const tambah = useCallback(() => {
    setBaris((arr) => {
      // Batas yang sama dengan server. Menahan tombolnya di sini jauh lebih
      // baik daripada menolak seluruh sesi saat Simpan ditekan, ketika
      // operator sudah memasukkan tiga ratus baris.
      if (arr.length >= MAKS_ITEM) return arr;
      const b = barisBaru();
      setFokusKunci(b.kunci);
      return [...arr, b];
    });
  }, []);

  const buang = (kunci: string) =>
    setBaris((arr) => (arr.length <= 1 ? arr : arr.filter((b) => b.kunci !== kunci)));

  const kosongkan = () => {
    const b = barisBaru();
    setBaris([b]);
    setCatatan("");
    // Kursor langsung ke kolom barcode baris pertama — sesi berikutnya
    // biasanya dimulai detik itu juga, dengan tangan masih memegang
    // pemindai.
    setFokusKunci(b.kunci);
  };

  const masalah = useMemo(
    () => baris.map((b, i) => periksaItemCancel(keItem(b), i + 1)),
    [baris]
  );
  const masalahPertama = masalah.find(Boolean) ?? "";
  const bisaSimpan = baris.length > 0 && !masalahPertama && !menyimpan;
  const totalQty = baris.reduce((a, b) => a + (Number(b.qty) || 0), 0);

  const simpan = async () => {
    if (!bisaSimpan) return;
    setMenyimpan(true);
    setError("");
    try {
      const d = await mintaJson<{ kode: string; jumlahBaris: number; totalQty: number }>(
        "/api/cancel-order",
        { method: "POST", timeoutMs: 45_000, body: { catatan, items: baris.map(keItem) } }
      );

      // Batch yang barusan dipakai langsung masuk cache lokal supaya
      // muncul sebagai saran di sesi berikutnya, tanpa menunggu sinkron.
      await Promise.all(
        baris
          .filter((b) => b.sku && b.batch && b.edDate)
          .map((b) => catatBatchLokal(b.sku, b.batch, b.edDate))
      );

      setInfo(
        `${d.kode} tersimpan — ${d.jumlahBaris} baris, total ${d.totalQty.toLocaleString("id-ID")} pcs.`
      );
      kosongkan();
    } catch (e) {
      setError(pesanError(e, "Gagal menyimpan."));
    } finally {
      setMenyimpan(false);
    }
  };

  return (
    <div className="shell pb-28">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Scan Cancel Order</h1>
          <p className="page-sub">
            Pendataan barang batal kirim — belum pernah berangkat, jadi tidak ada
            nomor resi. Kumpulkan barangnya dulu, lalu daftarkan sekaligus di sini.
          </p>
        </div>
        <div className="flex gap-1.5">
          <Link href="/cancel-order/riwayat" className="btn-ghost text-sm">
            <History className="w-4 h-4" /> Riwayat
          </Link>
          <button
            onClick={() => jalankanSinkron(false)}
            disabled={statusCache === "memuat"}
            className="btn-ghost text-sm"
          >
            <RefreshCw className={cn("w-4 h-4", statusCache === "memuat" && "animate-spin")} />
            Sinkronkan
          </button>
        </div>
      </div>

      {statusCache !== "siap" && (
        <div
          className={cn(
            "rounded-xl px-4 py-3 flex gap-2.5 text-sm border",
            statusCache === "gagal"
              ? "bg-warn-bg border-warn/30 text-warn"
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

      {/*
        DUA KOLOM MULAI 1280 px (`xl:`), SATU KOLOM DI BAWAH ITU.

        Kiri  — daftar barang, satu-satunya bagian yang panjang.
        Kanan — keterangan sesi dan hitungan berjalan; keduanya cuma diisi
                sekali di awal lalu hanya dilihat, jadi tidak perlu ikut
                menggeser daftar barang ke bawah.

        Rel kanan ditulis LEBIH DULU di DOM supaya saat grid runtuh ke satu
        kolom, urutannya kembali seperti semula: keterangan sesi di atas,
        daftar barang di bawahnya.
      */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">

      <aside className="space-y-3 min-w-0 xl:col-start-2 xl:row-start-1 xl:sticky xl:top-4">
      {/* ── Keterangan sesi ── */}
      <div className="card p-4">
        <label className="text-xs font-medium text-gray-600 mb-1.5 block">
          Keterangan sesi <span className="text-gray-400 font-normal">(opsional)</span>
        </label>
        <input
          value={catatan}
          onChange={(e) => setCatatan(e.target.value)}
          className="input-field"
          placeholder="Mis. nomor berita acara, asal barang, atau nama pengumpul…"
          maxLength={255}
        />
        <p className="mt-1.5 text-xs text-gray-400">
          {isi.produk.toLocaleString("id-ID")} produk dikenali di perangkat ini.
          Nomor sesi dibuat otomatis saat disimpan.
        </p>
      </div>

      <div className="card p-4">
        <p className="text-xs font-medium text-gray-600 mb-2">Hitungan berjalan</p>
        <div className="flex items-center gap-6">
          <div>
            <p className="text-2xl font-semibold text-heading tabular-nums">
              {baris.length}
            </p>
            <p className="text-xs text-gray-500">baris</p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-heading tabular-nums">
              {totalQty.toLocaleString("id-ID")}
            </p>
            <p className="text-xs text-gray-500">pcs</p>
          </div>
        </div>
      </div>
      </aside>

      {/* ── Kolom utama: baris barang ── */}
      <div className="space-y-5 min-w-0 xl:col-start-1 xl:row-start-1">

      {/* ── Baris barang ── */}
      {baris.map((b, i) => (
        <KartuBaris
          key={b.kunci}
          nomor={i + 1}
          total={baris.length}
          baris={b}
          masalah={masalah[i]}
          fokus={fokusKunci === b.kunci}
          onSudahFokus={lupakanFokus}
          onUbah={(patch) => ubah(b.kunci, patch)}
          onBuang={() => buang(b.kunci)}
          onLanjut={tambah}
        />
      ))}

      <button
        onClick={tambah}
        disabled={baris.length >= MAKS_ITEM}
        className="btn-ghost w-full justify-center border border-dashed border-gray-300 py-3"
      >
        <Plus className="w-4 h-4" />
        {baris.length >= MAKS_ITEM
          ? `Batas ${MAKS_ITEM} baris tercapai — simpan dulu`
          : "Barang"}
      </button>
      </div>
      </div>

      {/* Bilah simpan menempel di bawah — sesi input gabungan bisa panjang,
          dan tombol simpan tidak boleh ikut hanyut ke bawah layar. */}
      <div className="fixed bottom-0 left-0 right-0 lg:left-sidebar bg-white/95 backdrop-blur border-t border-brand-600/10 p-3 z-20">
        <div className="mx-auto w-full max-w-[1600px] space-y-2 xl:flex xl:items-center xl:gap-4 xl:space-y-0">
          {masalahPertama && (
            <p className="text-xs text-warn flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {masalahPertama}
            </p>
          )}
          <div className="flex gap-2 xl:ml-auto xl:min-w-[26rem]">
            <button onClick={kosongkan} className="btn-secondary flex-shrink-0">
              Kosongkan
            </button>
            <button
              onClick={simpan}
              disabled={!bisaSimpan}
              className="btn-primary flex-1 justify-center py-3 text-base disabled:opacity-40"
            >
              {menyimpan && <Loader2 className="w-5 h-5 animate-spin" />}
              Simpan {baris.length} baris · {totalQty.toLocaleString("id-ID")} pcs
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Kartu satu barang
   ══════════════════════════════════════════════════════════════════════════ */

function KartuBaris({
  nomor, total, baris, masalah, fokus, onSudahFokus, onUbah, onBuang, onLanjut,
}: {
  nomor: number;
  total: number;
  baris: Baris;
  masalah: string | null;
  fokus: boolean;
  onSudahFokus: () => void;
  onUbah: (patch: Partial<Baris>) => void;
  onBuang: () => void;
  onLanjut: () => void;
}) {
  const barcodeRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const batchRef = useRef<HTMLInputElement>(null);
  const namaRef = useRef<HTMLInputElement>(null);
  const [mencari, setMencari] = useState(false);

  useEffect(() => {
    if (fokus) {
      barcodeRef.current?.focus();
      onSudahFokus();
    }
  }, [fokus, onSudahFokus]);

  const cariProduk = async () => {
    const kode = bersihkanKode(baris.barcode);
    if (!kode) return;
    setMencari(true);

    // Nama hasil pencarian INI, bukan `baris.nama` dari prop.
    //
    // Prop `baris` yang tertangkap fungsi ini adalah keadaan SEBELUM
    // pencarian — namanya selalu kosong, karena onChange barcode baru saja
    // mengosongkannya. Membacanya berarti selalu mengarahkan fokus ke
    // kolom nama manual, yang pada jalur sukses tidak dirender sama sekali,
    // sehingga `?.focus()` diam-diam tidak melakukan apa pun dan kursor
    // tertinggal di kolom barcode. Tarikan pemindai berikutnya lalu
    // menyambung barcode kedua ke barcode pertama.
    let namaKetemu = "";

    try {
      const p = await cariBarcode(kode);
      if (p && p.nama) {
        namaKetemu = p.nama;
        onUbah({ barcode: kode, sku: p.sku, nama: p.nama, tidakDikenal: false, namaManual: "" });
      } else if (p) {
        onUbah({ barcode: kode, sku: p.sku, nama: "", tidakDikenal: false });
      } else {
        onUbah({ barcode: kode, sku: "", nama: "", tidakDikenal: true });
      }
    } catch {
      onUbah({ barcode: kode, sku: "", nama: "", tidakDikenal: true });
    } finally {
      setMencari(false);
      setTimeout(() => {
        (namaKetemu ? qtyRef : namaRef).current?.focus();
      }, 0);
    }
  };

  const ubahBatch = (nilai: string) => {
    const b = bersihkanKode(nilai);
    const terbaca = edDariBatch(b, hariIniWIB());
    if (terbaca) {
      onUbah({
        batch: b, edDate: terbaca.edDate, edOtomatis: true,
        peringatanBatch: terbaca.peringatan ?? "",
      });
    } else {
      onUbah({ batch: b, edOtomatis: false, peringatanBatch: "" });
    }
  };

  /**
   * Kolom nama manual hanya muncul SESUDAH pencarian menghasilkan sesuatu —
   * entah "tidak terdaftar" (`tidakDikenal`) atau "SKU ketemu, nama belum
   * tersinkron" (`sku` terisi). Tanpa syarat itu, peringatan merahnya
   * menyala pada karakter pertama yang diketik, lengkap dengan kalimat
   * "menunjuk SKU " yang SKU-nya kosong.
   */
  const perluNamaManual =
    Boolean(baris.barcode) && !baris.nama && (baris.tidakDikenal || Boolean(baris.sku));

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-600">Barang {nomor}</p>
        {total > 1 && (
          <button
            onClick={onBuang}
            className="text-gray-400 hover:text-bad p-1 rounded"
            aria-label={`Buang barang ${nomor}`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/*
        DI LAYAR LEBAR baris "barcode + qty" dan baris "batch + ED" berdiri
        BERDAMPINGAN, bukan bertumpuk: satu barang muat dalam satu baris
        pandang, dan sepuluh baris barang tidak lagi menjadi sepuluh layar.

        Keterangan produk (nama ketemu / belum terdaftar / tanpa barcode)
        selalu melebar dua kolom di bawahnya. Ketiganya tidak pernah muncul
        bersamaan — yang satu mensyaratkan nama ada, dua lainnya
        mensyaratkan nama tidak ada — jadi aman berbagi baris yang sama.
      */}
      <div className="grid gap-3 xl:grid-cols-2 xl:gap-x-5">

      <div className="flex flex-col sm:flex-row gap-3 xl:col-start-1 xl:row-start-1">
        <div className="flex-1 min-w-0">
          <label className="text-xs font-medium text-gray-600 mb-1.5 block">
            Kode / Barcode Produk
          </label>
          <div className="relative">
            <ScanLine className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              ref={barcodeRef}
              value={baris.barcode}
              onChange={(e) =>
                onUbah({
                  barcode: e.target.value,
                  sku: "", nama: "", tidakDikenal: false, namaManual: "",
                })
              }
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); cariProduk(); } }}
              onBlur={() => { if (baris.barcode && !baris.sku && !baris.tidakDikenal) cariProduk(); }}
              className="input-field pl-9 font-mono"
              placeholder="Scan barcode produk atau BPOM…"
              autoComplete="off"
            />
            {mencari && (
              <Loader2 className="w-4 h-4 animate-spin text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />
            )}
          </div>
        </div>

        <div className="w-full sm:w-28 flex-shrink-0">
          <label className="text-xs font-medium text-gray-600 mb-1.5 block">Quantity</label>
          <input
            ref={qtyRef}
            value={baris.qty}
            onChange={(e) => onUbah({ qty: e.target.value.replace(/[^0-9]/g, "") })}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); batchRef.current?.focus(); }
            }}
            inputMode="numeric"
            className="input-field text-center sm:text-left tabular-nums"
          />
        </div>
      </div>

      {baris.nama && (
        <p className="text-sm text-ok-strong flex items-start gap-1.5 xl:col-span-2 xl:row-start-2">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            {baris.nama}
            <span className="text-gray-400 font-mono text-xs ml-2">{baris.sku}</span>
          </span>
        </p>
      )}

      {perluNamaManual && (
        <div className="space-y-1.5 xl:col-span-2 xl:row-start-2">
          <p className="text-sm text-bad flex items-start gap-1.5">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {baris.tidakDikenal
              ? "Barcode belum terdaftar di Master Produk. Kodenya tetap disimpan — ketik nama barangnya."
              : `Barcode ini menunjuk SKU ${baris.sku}, tapi nama produknya belum ada di perangkat ini.`}
          </p>
          <input
            ref={namaRef}
            value={baris.namaManual}
            onChange={(e) => onUbah({ namaManual: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); qtyRef.current?.focus(); }
            }}
            className="input-field"
            placeholder="Ketik nama barangnya…"
          />
        </div>
      )}

      {/* Barang tanpa barcode sama sekali — cukup ketik namanya. */}
      {!baris.barcode && (
        <div className="xl:col-span-2 xl:row-start-2">
          <label className="text-xs font-medium text-gray-600 mb-1.5 block">
            Nama barang <span className="text-gray-400 font-normal">(kalau tanpa barcode)</span>
          </label>
          <input
            value={baris.namaManual}
            onChange={(e) => onUbah({ namaManual: e.target.value })}
            className="input-field"
            placeholder="Ketik nama barangnya…"
          />
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 xl:col-start-2 xl:row-start-1">
        <div className="flex-1 min-w-0">
          <KolomBatch
            inputRef={batchRef}
            sku={baris.sku}
            nilai={baris.batch}
            peringatan={baris.peringatanBatch}
            onUbah={ubahBatch}
            onPilih={(b) => onUbah({
              batch: b.batch, edDate: b.edDate, edOtomatis: false, peringatanBatch: "",
            })}
            onLanjut={onLanjut}
          />
        </div>
        <div className="w-full sm:w-[11.5rem] flex-shrink-0">
          <label className="text-xs font-medium text-gray-600 mb-1.5 block">
            Exp. Date
            {baris.edOtomatis && (
              <span className="ml-1.5 text-ok-strong font-normal">otomatis</span>
            )}
            <span className="ml-1.5 text-gray-400 font-normal">opsional</span>
          </label>
          <input
            type="date"
            value={baris.edDate}
            onChange={(e) => onUbah({ edDate: e.target.value, edOtomatis: false })}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onLanjut(); } }}
            className="input-field"
          />
        </div>
      </div>

      {masalah && (
        <p className="text-xs text-gray-400 xl:col-span-2 xl:row-start-3">{masalah}</p>
      )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Kolom batch + saran (aturan sama dengan modul Bongkaran)
   ══════════════════════════════════════════════════════════════════════════ */

function KolomBatch({
  inputRef, sku, nilai, peringatan, onUbah, onPilih, onLanjut,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  sku: string;
  nilai: string;
  peringatan: string;
  onUbah: (v: string) => void;
  onPilih: (b: BatchCache) => void;
  onLanjut: () => void;
}) {
  const [saran, setSaran] = useState<BatchCache[]>([]);
  const [buka, setBuka] = useState(false);
  const [sorot, setSorot] = useState(0);
  const daftarRef = useRef<HTMLDivElement>(null);
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
        setSaran(r); setSorot(0); setBuka(r.length > 0);
      })
      .catch(() => { if (!batal) setSaran([]); });
    return () => { batal = true; };
  }, [sku, nilai]);

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
    if (!buka || saran.length === 0) {
      if (e.key === "Enter") { e.preventDefault(); onLanjut(); }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault(); setSorot((s) => (s + 1) % saran.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault(); setSorot((s) => (s - 1 + saran.length) % saran.length);
    } else if (e.key === "Enter") {
      e.preventDefault(); pilih(saran[sorot]);
    } else if (e.key === "Escape") {
      setBuka(false);
    }
  };

  return (
    <div className="relative">
      <label className="text-xs font-medium text-gray-600 mb-1.5 block">
        Batch <span className="text-gray-400 font-normal">opsional</span>
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
        <p className="mt-1.5 text-xs text-warn flex items-start gap-1.5">
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
          className="absolute z-30 left-0 top-full mt-1 w-full min-w-[15rem]
                     max-h-52 overflow-y-auto scroll-slim
                     bg-white border border-gray-300 rounded-xl shadow-hover"
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
              <span className="font-mono text-ink">{b.batch}</span>
              <span className="text-xs text-gray-500">ED {b.edDate}</span>
            </button>
          ))}
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
