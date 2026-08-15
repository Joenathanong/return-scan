"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { ScanLine, Loader2, AlertCircle, Eye, EyeOff } from "lucide-react";

function LoginInner() {
  const { signIn, appUser, loading, gangguan } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";

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
    <div className="min-h-screen flex items-center justify-center px-4 bg-slate-100">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-green-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ScanLine className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Scan Retur</h1>
          <p className="text-slate-500 text-sm mt-1">PT. IEG</p>
        </div>

        <form
          onSubmit={submit}
          className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4"
        >
          <div>
            <label htmlFor="email" className="text-sm font-medium text-slate-700 mb-1.5 block">
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
            <label htmlFor="password" className="text-sm font-medium text-slate-700 mb-1.5 block">
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
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                tabIndex={-1}
                aria-label={lihatPassword ? "Sembunyikan password" : "Tampilkan password"}
              >
                {lihatPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {(error || gangguan) && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 space-y-2">
              <div className="flex gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{error || gangguan}</p>
              </div>
              {/* Kalau masalahnya di server (bukan password salah), tunjukkan
                  jalan untuk memeriksanya sendiri. */}
              {(gangguan || /server|hubungi|menjawab|dikenali/i.test(error)) && (
                <a
                  href="/api/health"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-red-600 underline"
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

        <p className="text-center text-xs text-slate-400 mt-6">
          Lupa password? Hubungi admin untuk direset.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-100" />}>
      <LoginInner />
    </Suspense>
  );
}
