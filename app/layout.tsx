import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/lib/auth-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scan Retur — PT. IEG",
  description: "Sistem scan resi retur",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Mencegah browser mem-zoom saat field scan difokuskan di perangkat PDT.
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body className="bg-slate-50 text-slate-900 antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
