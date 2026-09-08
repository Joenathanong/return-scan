"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Loader2 } from "lucide-react";

interface Props {
  children: React.ReactNode;
  adminOnly?: boolean;
}

/**
 * Penjaga sisi klien. Ini hanya soal pengalaman pemakaian — bukan keamanan.
 * Keamanan sebenarnya ada di API: setiap route memanggil requireUser() /
 * requireAdmin(), jadi menembus komponen ini tidak memberi akses data apa pun.
 */
export default function AuthGuard({ children, adminOnly }: Props) {
  const { appUser, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!appUser) {
      router.replace("/login");
    } else if (appUser.mustChangePassword) {
      // Password sementara (hasil seed atau reset admin) harus diganti
      // sebelum aplikasi bisa dipakai.
      router.replace("/ganti-password");
    } else if (adminOnly && appUser.role !== "admin") {
      router.replace("/dashboard");
    }
  }, [appUser, loading, router, adminOnly]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
      </div>
    );
  }

  if (!appUser || appUser.mustChangePassword) return null;
  if (adminOnly && appUser.role !== "admin") return null;

  return <>{children}</>;
}
