import { handle, requireAdmin, writeAudit } from "@/lib/api";
import { sapuDraftBasi } from "@/lib/draft-server";
import { UMUR_DRAFT_SAPU_JAM } from "@/lib/draft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/bongkaran/draft/sapu
 *
 * Menjalankan penyapuan draft basi SEKARANG, tanpa menunggu giliran satu
 * jam sekali yang menumpang permintaan dashboard.
 *
 * Kenapa ada, padahal penyapuan sudah otomatis: setelah satu hari yang
 * kacau (jaringan gudang putus-putus, PDT mati berkali-kali) admin ingin
 * melihat daftarnya bersih SEKARANG, bukan besok. Tanpa tombol ini,
 * satu-satunya jalan adalah menekan Buang satu per satu — dan itu justru
 * satu kueri per baris.
 *
 * Hanya admin. Bukan karena berbahaya (yang dihapus hanya draft yang
 * benar-benar kosong dan sudah lewat ambang umur), tapi karena ini
 * pekerjaan merapikan sistem, bukan pekerjaan membongkar barang.
 */
export async function POST() {
  return handle(async () => {
    const me = await requireAdmin();

    const h = await sapuDraftBasi();

    if (h.dihapus > 0) {
      await writeAudit(
        me.id, me.name, "BONGKARAN_SAPU_DRAFT",
        `${h.dihapus} draft kosong dibuang (lebih tua dari ${UMUR_DRAFT_SAPU_JAM} jam)`,
        { diperiksa: h.diperiksa, adaIsinya: h.adaIsinya }
      );
    }

    return {
      ok: true,
      ...h,
      umurJam: UMUR_DRAFT_SAPU_JAM,
      pesan:
        h.dihapus > 0
          ? `${h.dihapus} draft kosong dibuang.` +
            (h.adaIsinya > 0
              ? ` ${h.adaIsinya} dilewati karena ternyata ada isinya — periksa lewat "Lihat isi".`
              : "")
          : h.adaIsinya > 0
            ? `Tidak ada yang dibuang. ${h.adaIsinya} draft lama ternyata ada isinya — periksa lewat "Lihat isi".`
            : `Tidak ada draft kosong yang lebih tua dari ${UMUR_DRAFT_SAPU_JAM} jam.`,
    };
  });
}
