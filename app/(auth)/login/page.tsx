"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { ScanLine, Loader2, AlertCircle, Eye, EyeOff, MonitorSmartphone } from "lucide-react";

function LoginInner() {
  const { signIn, appUser, loading, gangguan } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";

  /**
   * Datang ke sini karena sesinya diambil alih perangkat lain — bukan karena
   * membuka /login sendiri. Tanpa penjelasan ini, operator yang tiba-tiba
   * terlempar dari tengah pekerjaan akan mengira aplikasinya rusak.
   */
  const karenaSesiDiganti = params.get("alasan") === "sesi";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [lihatPassword, setLihatPassword] = useState(false);
  const [error, setError] = useState("");
  const [proses, setProses] = useState(false);

  // Sudah login (mis. buka /login dari bookmark) → langsung masuk.
  useEffect(() => {
    if (!loading && appUser) {
      router.replace(appUser.mustChangePassword ? "/ganti-password" : next);
    }
  }, [appUser, loading, next, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (proses) return;
    setError("");
    setProses(true);
    try {
      await signIn(email.trim(), password);
      // Tujuan berikutnya ditentukan oleh useEffect di atas setelah
      // appUser terisi — supaya user yang wajib ganti password tidak
      // sempat masuk ke halaman lain dulu.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal login.");
      setPassword("");
    } finally {
      setProses(false);
    }
  };

  return (
    // Panel kiri hanya muncul dari lg ke atas. Di ponsel dan PDT ia
    // dihilangkan sama sekali, bukan diperkecil: ruang layar di sana lebih
    // berharga untuk formulir daripada untuk hiasan.
    <div className="min-h-screen lg:grid lg:grid-cols-2 bg-app">
      <aside className="hidden lg:flex flex-col justify-between bg-ocs-hero text-white p-12">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/10 ring-1 ring-white/20 flex items-center justify-center">
            <ScanLine className="w-5 h-5" />
          </div>
          <span className="font-semibold tracking-wide">PT. IEG</span>
        </div>

        <div className="max-w-md">
          <h2 className="text-[44px] leading-[1.05] font-extrabold">
            Scan Retur
          </h2>
          <p className="text-white/70 mt-4 text-base leading-relaxed">
            Pencatatan resi retur dan bongkaran barang — satu sumber data,
            tanpa salinan yang saling bertentangan.
          </p>
        </div>

        <p className="text-white/45 text-xs">
          © {new Date().getFullYear()} PT. Indo Extrusions Group
        </p>
      </aside>

      <div className="min-h-screen lg:min-h-0 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8 lg:hidden">
          <div className="w-16 h-16 bg-ocs-primary rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-btn">
            <ScanLine className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-heading">Scan Retur</h1>
          <p className="text-gray-500 text-sm mt-1">PT. IEG</p>
        </div>

        <div className="hidden lg:block mb-7">
          <h1 className="page-title">Masuk</h1>
          <p className="page-sub">Gunakan akun yang diberikan admin.</p>
        </div>

        {karenaSesiDiganti && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex gap-2.5">
            <MonitorSmartphone className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800">
              <p className="font-medium">Sesi di perangkat ini diakhiri.</p>
              <p className="text-amber-700 mt-0.5">
                Akun Anda dipakai login di perangkat lain. Satu akun hanya bisa
                aktif di satu perangkat. Silakan masuk lagi kalau perangkat ini
                yang mau dipakai.
              </p>
            </div>
          </div>
        )}

        <form
          onSubmit={submit}
          className="bg-white rounded-2xl shadow-sm border border-gray-300 p-6 space-y-4"
        >
          <div>
            <label htmlFor="email" className="text-sm font-medium text-ink mb-1.5 block">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
              autoComplete="username"
              autoFocus
              required
              disabled={proses}
            />
          </div>

          <div>
            <label htmlFor="password" className="text-sm font-medium text-ink mb-1.5 block">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={lihatPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field pr-11"
                autoComplete="current-password"
                required
                disabled={proses}
              />
              <button
                type="button"
                onClick={() => setLihatPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                tabIndex={-1}
                aria-label={lihatPassword ? "Sembunyikan password" : "Tampilkan password"}
              >
                {lihatPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {(error || gangguan) && (
            <div className="bg-bad-bg border border-bad/25 rounded-xl px-4 py-3 space-y-2">
              <div className="flex gap-2">
                <AlertCircle className="w-4 h-4 text-bad flex-shrink-0 mt-0.5" />
                <p className="text-sm text-bad">{error || gangguan}</p>
              </div>
              {/* Kalau masalahnya di server (bukan password salah), tunjukkan
                  jalan untuk memeriksanya sendiri. */}
              {(gangguan || /server|hubungi|menjawab|dikenali/i.test(error)) && (
                <a
                  href="/api/health"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-bad underline"
                >
                  Periksa keadaan server →
                </a>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={proses || !email || !password}
            className="btn-primary w-full justify-center"
          >
            {proses && <Loader2 className="w-4 h-4 animate-spin" />}
            {proses ? "Memproses..." : "Masuk"}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-6">
          Lupa password? Hubungi admin untuk direset.
        </p>
      </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-app" />}>
      <LoginInner />
    </Suspense>
  );
}
