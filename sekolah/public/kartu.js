import { $, api, html, raw, render } from '/ui/app.js';
import { qrSvg } from '/ui/qr.js';

const KELAS = ['I', 'II', 'III', 'IV', 'V', 'VI'];
const params = new URLSearchParams(location.search);
$('#print').onclick = () => window.print();

async function main() {
  try {
    if (params.get('perangkat')) {
      const info = await api('/api/info');
      const url = `${location.origin}/perangkat/${info.device_id}`;
      $('#title').textContent = 'Label QR kotak server';
      $('#count').textContent = 'Tempel di sisi casing yang mudah dijangkau.';
      render($('#sheet'), html`<div class="card device">
        <div class="qr">${raw(qrSvg(url, { label: `QR kotak ${info.device_id}` }))}</div>
        <div class="meta"><span class="school">${info.sekolah}</span><span class="name">Kotak ${info.device_id}</span>
          <span class="kls">Pindai untuk melapor kerusakan dan melihat riwayat perawatan.</span>
          <span class="hint" style="margin-top:auto">${url}</span></div></div>`);
      return;
    }
    const d = await api(`/students/cards${params.get('kode') ? `?kode=${encodeURIComponent(params.get('kode'))}` : ''}`);
    $('#count').textContent = `${d.kartu.length} kartu · ukuran kartu ATM, 8 per halaman A4`;
    if (!d.kartu.length) {
      render($('#sheet'), html`<div class="empty" style="grid-column:1/-1;background:white"><h3>Belum ada murid</h3><p>Tambahkan murid di halaman Murid, lalu buka halaman ini lagi.</p></div>`);
      return;
    }
    render($('#sheet'), html`${d.kartu.map((k) => html`<div class="card">
      <div class="qr">${raw(qrSvg(`LENTERA:${k.student_code}`, { label: `QR kartu ${k.name}` }))}</div>
      <div class="meta"><span class="school">${d.sekolah}</span><span class="name">${k.name}</span><span class="kls">Kelas ${KELAS[k.class_grade - 1]}</span>
        <span class="code">${k.student_code}</span><span class="hint">Pindai atau ketik kode ini untuk mulai belajar.</span></div></div>`)}`);
  } catch (e) {
    if (e.status === 401) return location.replace('/#staf');
    render($('#sheet'), html`<div class="empty" style="grid-column:1/-1;background:white"><h3>Kartu belum bisa dibuat</h3><p>${e.message}</p></div>`);
  }
}
main();
