// Halaman yang terbuka saat QR di casing kotak dipindai (F-2.5, US-4).
import { $, api, html, render, icon, BRAND_MARK, toast, withBusy, tanggal, uuid, outbox } from '/ui/app.js';

const view = $('#view');
render($('#brand'), html`${BRAND_MARK}<span>LENTERA<small>Kotak server</small></span>`);
const deviceId = decodeURIComponent(location.pathname.split('/').pop());

// Perkecil foto di ponsel sebelum dikirim agar paket sinkron tetap ringan.
function shrinkPhoto(file, max = 960) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      let q = 0.72, out = c.toDataURL('image/jpeg', q);
      while (out.length > 380000 && q > 0.3) out = c.toDataURL('image/jpeg', (q -= 0.12));
      URL.revokeObjectURL(img.src);
      resolve(out);
    };
    img.onerror = () => reject(new Error('Foto tidak bisa dibaca. Coba ambil ulang.'));
    img.src = URL.createObjectURL(file);
  });
}

async function load() {
  let d;
  try {
    d = await api(`/device/${encodeURIComponent(deviceId)}/history`);
  } catch (e) {
    render(view, html`<div class="empty"><h3>Kotak tidak dikenali</h3><p>${e.message} Pastikan ponsel tersambung ke Wi-Fi sekolah tempat kotak ini dipasang.</p><a class="btn btn-primary" href="/">Ke halaman masuk</a></div>`);
    return;
  }
  if (d.masuk) $('#back').textContent = 'Kembali ke aplikasi';
  if (d.masuk) $('#back').href = '/guru#perangkat';
  let photo = null;
  render(view, html`
    <div class="page-title">
      <p class="small muted">Kotak ${d.device_id} · ${d.sekolah}</p>
      <h1>Ada yang rusak?</h1>
      <p>Tulis singkat apa yang terjadi. Laporan sampai ke koordinator kampus saat data dibawa ke pusat.</p>
    </div>
    <form id="f" class="stack" novalidate>
      <div class="field">
        <label for="desc">Apa yang rusak atau aneh?</label>
        <textarea class="input" id="desc" required placeholder="Contoh: lampu Wi-Fi mati sejak pagi, tablet tidak bisa tersambung."></textarea>
        <p class="field-error" id="desc-err" role="alert"></p>
      </div>
      <div class="field">
        <span class="label">Foto (boleh dilewati)</span>
        <label class="btn btn-outline" style="justify-self:start">${icon('camera')}<span id="ph-label">Ambil foto</span>
          <input type="file" id="ph" accept="image/*" capture="environment" class="sr-only"></label>
        <img id="ph-prev" alt="Pratinjau foto" hidden style="max-width:220px;border-radius:12px;border:1px solid var(--line)">
      </div>
      <button class="btn btn-primary btn-lg" style="justify-self:start">${icon('send')}Kirim laporan</button>
    </form>
    <section class="block">
      <h2>Riwayat perawatan</h2>
      <p class="small muted" style="margin:4px 0 var(--s-3)">Dipasang ${tanggal(d.dipasang)} · perangkat lunak ${d.versi_perangkat_lunak} · firmware ${d.versi_firmware}</p>
      ${d.laporan.length ? html`<ul class="list">${d.laporan.map((r) => html`<li>
        <span class="badge ${r.status === 'selesai' ? 'badge-ok' : 'badge-warn'}">${r.status === 'selesai' ? 'Selesai' : 'Terbuka'}</span>
        <div class="grow"><strong>${r.description}</strong><div class="small muted">${tanggal(r.created_at, { jam: true })}${r.resolution ? ` · ${r.resolution}` : ''}</div></div></li>`)}</ul>`
      : html`<p class="muted">Belum ada laporan untuk kotak ini.</p>`}
    </section>`);

  $('#ph').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      photo = await shrinkPhoto(file);
      $('#ph-prev').src = photo;
      $('#ph-prev').hidden = false;
      $('#ph-label').textContent = 'Ganti foto';
    } catch (ex) {
      toast(ex.message, 'bad');
    }
  };
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const desc = $('#desc').value.trim();
    if (desc.length < 3) {
      $('#desc').setAttribute('aria-invalid', 'true');
      $('#desc-err').textContent = 'Tulis singkat apa yang rusak, misalnya "lampu Wi-Fi mati".';
      return;
    }
    await withBusy(e.submitter, async () => {
      try {
        const r = await outbox.send('/device/reports', 'POST', { report_id: uuid(), device_id: d.device_id, description: desc, photo }, 'laporan kerusakan');
        toast(r.queued ? 'Wi-Fi putus. Laporan disimpan di ponsel dan dikirim otomatis.' : 'Laporan terkirim. Terima kasih.');
        load();
      } catch (ex) {
        $('#desc-err').textContent = ex.message;
      }
    });
  };
}
load();
