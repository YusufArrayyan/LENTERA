// Ringkasan hasil belajar per kelompok untuk guru, siap cetak (F-1.10).
import { $, api, html, render, tanggal, icon } from '/ui/app.js';

const view = $('#view');
try {
  const d = await api('/laporan/kelompok');
  render(view, html`
    <div class="report-head">
      <div><p class="small muted">Ringkasan hasil belajar · 28 hari terakhir</p><h1>${d.sekolah}</h1></div>
      <div class="row no-print"><button class="btn btn-primary" id="p">${icon('print')}Cetak</button></div>
      <p class="small muted">Dibuat ${tanggal(d.dibuat, { jam: true })}</p>
    </div>
    ${d.kelompok.map((g) => html`<section class="grp">
      <div class="section-head"><div><h2>${g.label}</h2><p>Level ${g.level} · ${g.nama_level} · ${g.anggota.length} murid · ${g.sesi_28_hari.n} sesi (${g.sesi_28_hari.menit} menit)</p></div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Nama</th><th class="num">Level awal</th><th class="num">Level kini</th><th class="num">Tingkat latihan</th><th class="num">Soal dijawab</th><th class="num">Ketepatan</th></tr></thead>
        <tbody>${g.anggota.map((m) => html`<tr><td>${m.name}</td><td class="num">${m.level_awal ?? '–'}</td><td class="num">${m.level ?? '–'}</td>
          <td class="num">${m.sub ? `${m.sub}/3` : '–'}</td><td class="num">${m.dijawab}</td><td class="num">${m.dijawab ? `${Math.round((m.benar / m.dijawab) * 100)}%` : '–'}</td></tr>`)}</tbody>
      </table></div></section>`)}
    <p class="small muted">Ketepatan dihitung dari soal latihan di tablet. Pakai bersama pengamatan guru saat menentukan bantuan tambahan.</p>`);
  $('#p').onclick = () => window.print();
} catch (e) {
  if (e.status === 401) location.replace('/#staf');
  else render(view, html`<div class="empty"><h3>Ringkasan belum bisa dibuat</h3><p>${e.message}</p></div>`);
}
