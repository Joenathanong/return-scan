"use client";

import { useState } from "react";
import Sidebar from "@/components/Sidebar";
import AuthGuard from "@/components/AuthGuard";
import { Menu } from "lucide-react";

/**
 * CATATAN CETAK — jangan hapus kelas `no-print` di bawah.
 *
 * Halaman tanda terima ikut dibungkus layout ini, jadi apa pun yang ada di
 * sini ikut tercetak kecuali ditandai. Sistem lama membungkus Sidebar dalam
 * `<div className="no-print">` dan memberi `no-print` pada header — saat
 * memindahkan layout ini saya lupa membawa keduanya, sehingga sidebar hitam
 * dan bar atas ikut muncul di kertas.
 *
 * Header memakai `lg:hidden`, dan itu TIDAK cukup untuk menyembunyikannya
 * saat mencetak: lebar kertas A4 setara ±793 px CSS, di bawah ambang `lg`
 * (1024 px), jadi header justru dianggap "layar kecil" dan tetap tampil.
 * `no-print` yang menanganinya, bukan breakpoint.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <AuthGuard>
      {/* print:min-h-0 mencegah halaman kosong tambahan di akhir cetakan:
          min-h-screen saat mencetak berarti setinggi satu halaman penuh. */}
      <div className="min-h-screen print:min-h-0">
        <div className="no-print">
          <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        </div>

        <div className="lg:pl-64 print:pl-0">
          {/* Bar atas — hanya tampil di layar kecil, tidak pernah tercetak */}
          <header className="no-print lg:hidden sticky top-0 z-20 bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-lg"
              aria-label="Buka menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="font-semibold text-slate-800">Scan Retur</span>
          </header>

          <main className="p-4 sm:p-6 lg:p-8">{children}</main>
        </div>
      </div>
    </AuthGuard>
  );
}
