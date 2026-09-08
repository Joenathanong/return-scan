import type { Config } from "tailwindcss";

/**
 * Tema mengikuti IEG OCS Design System (design-ocs.md).
 *
 * `brand` DULUNYA hijau — warna aksi lama aplikasi ini. Sekarang ia indigo,
 * dan itu disengaja: satu token yang sama diganti isinya sekali di sini
 * membuat seluruh aplikasi berpindah palet tanpa perlu mengubah arti kelas
 * di setiap halaman.
 *
 * Hijau TIDAK hilang, tapi kedudukannya turun: ia sekarang hanya berarti
 * "status berhasil / aman" (`ok`), bukan lagi warna tombol. Aturan nomor 1
 * di design system: satu warna aksi saja, #4F46E5.
 */
const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#EEF2FF",
          100: "#E0E7FF",
          200: "#C7D2FE",
          400: "#818CF8",
          500: "#6366F1",
          600: "#4F46E5",
          700: "#4338CA",
          800: "#3730A3",
          900: "#312E81",
          950: "#1E1B4B",
        },
        accent: {
          DEFAULT: "#7C3AED",
          violet:  "#8B5CF6",
          pink:    "#EC4899",
          pink400: "#F472B6",
          pink100: "#FCE7F3",
        },
        app:     "#F8F9FF",
        subtle:  "#FAFBFF",
        ink:     "#242424",
        heading: "#1F2937",

        // Semantik — HANYA untuk status, tidak pernah untuk dekorasi.
        ok:   { DEFAULT: "#4CAF50", strong: "#107C10", bg: "#F1FAF1" },
        warn: { DEFAULT: "#FB8C00", bg: "#FFF7ED" },
        bad:  { DEFAULT: "#B00020", alt: "#D13438", bg: "#FDF6F6" },
        info: { DEFAULT: "#2196F3", bg: "#EBF3FC" },

        // Khusus interaksi grid (seleksi baris, sorotan pencarian).
        // Bukan warna brand — jangan dipakai untuk tombol.
        grid: { DEFAULT: "#0F6CBD", bg: "#EBF3FC", strong: "#D0E5FB" },
      },
      borderRadius: {
        card: "14px",
      },
      boxShadow: {
        card:  "0 1px 2px rgba(15,23,42,.04), 0 1px 3px rgba(15,23,42,.04)",
        hover: "0 4px 10px rgba(15,23,42,.06)",
        btn:   "0 6px 14px -6px rgba(79,70,229,.5)",
        modal: "0 20px 45px -15px rgba(30,27,75,.35)",
      },
      backgroundImage: {
        "ocs-accent":  "linear-gradient(135deg,#4F46E5 0%,#7C3AED 55%,#EC4899 100%)",
        "ocs-primary": "linear-gradient(135deg,#4F46E5 0%,#7C3AED 100%)",
        "ocs-sidebar": "linear-gradient(180deg,#1E1B4B 0%,#312E81 50%,#1E3A8A 100%)",
        "ocs-topbar":  "linear-gradient(135deg,#FFFFFF 0%,#F8F9FF 100%)",
        "ocs-thead":   "linear-gradient(135deg,#EEF2FF 0%,#FCE7F3 100%)",
        "ocs-hero":    "linear-gradient(135deg,#1E3A8A 0%,#1D4ED8 35%,#6366F1 70%,#8B5CF6 100%)",
        "ocs-nav":     "linear-gradient(135deg,rgba(99,102,241,.40) 0%,rgba(236,72,153,.25) 100%)",
      },
      spacing: {
        sidebar: "260px",
        topbar:  "64px",
      },
      animation: {
        "fade-in": "fadeIn 0.3s ease-in-out",
        "slide-up": "slideUp 0.3s ease-out",
        "pulse-success": "pulseSuccess 1.5s ease-in-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseSuccess: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
