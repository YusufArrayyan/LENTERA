import { $, $$, api, html, raw, render, icon, BRAND_MARK, toast, withBusy, tanggal, lalu, angka, persen, hari } from '/ui/app.js';
import { lineChart, barList } from '/ui/chart.js';

const view = $('#view');
let me = null;
let data = null;
let selected = null;

render($('#brand'), html`${BRAND_MARK}<span>LENTERA<small>Dasbor pusat</small></span>`);

$('#logout').onclick = async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  location.reload();
};

function fail(e) {
  if (e.status === 401) return showLogin();
  toast(e.message, 'bad');
}

// ---------- masuk ----------
function showLogin() {
  $('#logout').hidden = true;
  $('#who').textContent = '';
  render(view, html`
    <form class="login panel stack" id="login" novalidate>
      <div><h1>Masuk ke dasbor</h1><p class="muted">Untuk koordinator kampus dan petugas dinas pendidikan.</p></div>
      <div class="field"><label for="u">Nama pengguna</label><input class="input" id="u" autocomplete="username" autocapitalize="none" spellcheck="false"></div>
      <div class="field"><label for="p">Kata sandi</label><input class="input" id="p" type="password" autocomplete="current-password" aria-describedby="err"></div>
      <p class="field-error" id="err" role="alert"></p>
      <button class="btn btn-primary btn-lg">Masuk</button>
    </form>`);
  $('#u').focus();
  $('#login').onsubmit = async (e) => {
    e.preventDefault();
    await withBusy(e.submitter, async () => {
      try {
        await api('/auth/login', { method: 'POST', body: { username: $('#u').value, password: $('#p').value } });
        start();
      } catch (ex) {
        $('#err').textContent = ex.message;
      }
    });
  };
}

// ---------- utilitas tampilan ----------
const STATUS = {
  hijau: ['dot-hijau', 'Aktif'],
  kuning: ['dot-kuning', 'Tanpa detak > 24 jam'],
  merah: ['dot-merah', 'Tanpa detak > 72 jam'],
  abu: ['', 'Belum pernah sinkron'],
};
const flag = (v, min, unit = '%') =>
  v === null || v === undefined ? html`<span class="muted">–</span>` : html`<span class="cell-flag ${v < min ? 'fail' : ''}" title="${v < min ? `Di bawah ambang ${min}${unit}` : ''}">${angka(v, v % 1 ? 1 : 0)}${unit}${v < min ? html`<span class="sr-only"> (di bawah ambang)</span>` : ''}</span>`;
function levelPair(n) {
  if (n.rata_level_awal === null) return html`<span class="muted">–</span>`;
  const d = Math.round((n.rata_level_kini - n.rata_level_awal) * 100) / 100;
  return html`<span class="lv">${angka(n.rata_level_awal, 2)} → <b>${angka(n.rata_level_kini, 2)}</b>${d > 0 ? html`<span class="up">+${angka(d, 2)}</span>` : d < 0 ? html`<span class="down">${angka(d, 2)}</span>` : ''}</span>`;
}

function gateCell(label, list, pick, min) {
  const vals = list.map(pick).filter((v) => v !== null && v !== undefined);
  const pass = vals.filter((v) => v >= min).length;
  return html`<div class="gate-cell">
    <span class="k">${label}</span>
    <span class="v">${pass}<small> dari ${list.length} sekolah lolos</small></span>
    <span class="pips" aria-hidden="true">${list.map((s) => {
      const v = pick(s);
      return raw(`<i class="${v === null || v === undefined ? '' : v >= min ? 'pass' : 'fail'}"></i>`);
    })}</span>
  </div>`;
}

// ---------- halaman utama ----------
async function start() {
  try {
    me = await api('/auth/me');
  } catch {
    return showLogin();
  }
  $('#who').textContent = `${me.name} · ${me.role}`;
  $('#logout').hidden = false;
  await load();
}

async function load() {
  try {
    data = await api('/dashboard/schools');
  } catch (e) {
    return fail(e);
  }
  const isKoor = data.peran !== 'dinas';
  const S = data.sekolah;
  const A = data.ambang;
  const red = S.filter((s) => s.status === 'merah');

  render(view, html`
    <div class="head">
      <div>
        <h1>Pilot LENTERA</h1>
        <p>${S.length} sekolah · angka dihitung dari data yang sudah sampai ke pusat · dibuka ${tanggal(data.dibuat, { jam: true })}</p>
      </div>
      <div class="row no-print">
        <a class="btn btn-outline" href="/reports/semester?format=csv">${icon('download')}Unduh CSV</a>
        <button class="btn btn-outline" id="print">${icon('print')}Cetak laporan</button>
      </div>
    </div>

    <section class="gates" aria-label="Gerbang keputusan pilot">
      ${gateCell(`Waktu aktif jam sekolah ≥ ${A.waktu_aktif}%`, S, (s) => s.waktu_aktif_persen ?? s.waktu_aktif?.persen, A.waktu_aktif)}
      ${gateCell(`Sesi terlaksana ≥ ${A.sesi_terlaksana}%`, S, (s) => s.sesi.persen_terlaksana, A.sesi_terlaksana)}
      ${gateCell(`Kehadiran relawan ≥ ${A.relawan_hadir}%`, S, (s) => s.sesi.persen_relawan_hadir, A.relawan_hadir)}
      <div class="gate-cell"><span class="k">Kotak tanpa detak > ${A.tidak_aktif_jam} jam</span>
        <span class="v">${red.length}<small> kotak</small></span>
        <span class="small ${red.length ? '' : 'muted'}" style="color:${red.length ? 'var(--bad-ink)' : ''}">${red.length ? red.map((s) => s.sekolah).join(', ') : 'Semua kotak mengirim detak'}</span></div>
    </section>
    <p class="small muted" style="margin-top:8px">Ambang dari PRD bagian 13. Kenaikan skor numerasi ≥ 0,18 simpangan baku diukur terhadap sekolah pembanding lewat tes awal dan akhir di luar sistem; dasbor ini menampilkan perubahan level di dalam sekolah pilot.</p>

    <section class="block">
      <div class="section-head"><h2>Sekolah</h2><p>${isKoor ? 'Pilih baris untuk melihat kesehatan kotak dan hasil belajar.' : 'Pilih baris untuk melihat hasil belajar agregat.'} Angka merah berada di bawah ambang.</p></div>
      <div class="table-wrap"><table>
        <thead><tr>
          <th>Sekolah</th><th>Kotak</th><th class="num">Waktu aktif</th><th class="num">Sesi terlaksana</th><th class="num">Relawan hadir</th>
          <th class="num">Level awal → kini</th>${isKoor ? html`<th class="num">Baterai</th>` : ''}<th>Sinkron terakhir</th>
        </tr></thead>
        <tbody>${S.map((s) => {
          const [dot, label] = STATUS[s.status];
          const up = s.waktu_aktif_persen ?? s.waktu_aktif?.persen;
          return html`<tr class="clickable ${selected === s.device_id ? 'selected' : ''}" data-id="${s.device_id}" tabindex="0">
            <td><div class="school-name">${s.sekolah}</div><div class="xs muted">${s.wilayah}</div></td>
            <td><span class="row" style="gap:8px;flex-wrap:nowrap"><span class="dot ${dot}"></span><span class="small" style="white-space:nowrap">${label}</span></span></td>
            <td class="num">${flag(up, A.waktu_aktif)}</td>
            <td class="num">${flag(s.sesi.persen_terlaksana, A.sesi_terlaksana)}<div class="xs muted">${s.sesi.terlaksana} dari ${s.sesi.terjadwal}</div></td>
            <td class="num">${flag(s.sesi.persen_relawan_hadir, A.relawan_hadir)}</td>
            <td class="num">${levelPair(s.numerasi)}<div class="xs muted">${s.numerasi.murid_terdiagnosis} murid</div></td>
            ${isKoor ? html`<td class="num">${s.baterai_pct === null ? '–' : `${Math.round(s.baterai_pct)}%`}</td>` : ''}
            <td class="small" style="white-space:nowrap">${lalu(s.sinkron_terakhir)}</td>
          </tr>`;
        })}</tbody>
      </table></div>
    </section>

    <div class="layout-2 block">
      <div id="detail"><div class="empty"><h3>Pilih satu sekolah</h3><p>Rincian hasil belajar${isKoor ? ', kesehatan kotak, laporan kerusakan, dan riwayat sinkron' : ' dan pelaksanaan sesi'} muncul di sini.</p></div></div>
      <aside class="stack">
        ${isKoor ? html`<section><h2 style="margin-bottom:var(--s-3)">Perlu tindakan</h2><div id="todo"></div></section>` : ''}
        ${isKoor ? html`<section class="panel" id="updates"></section>` : html`<section class="panel-soft"><h2>Tentang data ini</h2>
          <p class="small" style="margin-top:6px">Akun dinas hanya menerima angka gabungan per sekolah. Nama murid tidak pernah meninggalkan server sekolah, dan kode murid tidak dikirim ke dasbor.</p></section>`}
      </aside>
    </div>
  `);

  $('#print').onclick = () => window.print();
  $$('tr[data-id]', view).forEach((tr) => {
    const open = () => openDetail(tr.dataset.id);
    tr.onclick = open;
    tr.onkeydown = (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open());
  });
  if (isKoor) {
    renderTodo(S);
    renderUpdates(S);
  }
  if (selected) openDetail(selected, false);
}

async function renderTodo(S) {
  const items = [];
  for (const s of S) {
    if (s.status === 'merah') items.push({ tone: 'bad', ic: 'alert', t: `${s.sekolah}: kotak tanpa detak sejak ${tanggal(s.detak_terakhir, { jam: true })}`, d: 'Kirim relawan atau teknisi untuk memeriksa daya dan kabel.' });
    for (const a of s.peringatan || []) items.push({ tone: a.level === 'kritis' ? 'bad' : 'warn', ic: 'alert', t: `${s.sekolah}: ${a.pesan}`, d: `Sejak ${tanggal(a.sejak, { jam: true })}` });
    if (s.laporan_terbuka) items.push({ tone: 'warn', ic: 'wrench', t: `${s.sekolah}: ${s.laporan_terbuka} laporan kerusakan terbuka`, d: 'Lihat rincian di panel sekolah.' });
    if (s.sesi.persen_relawan_hadir !== null && s.sesi.persen_relawan_hadir < 85) items.push({ tone: 'warn', ic: 'users', t: `${s.sekolah}: relawan hadir ${angka(s.sesi.persen_relawan_hadir, 1)}% sesi`, d: 'Atur ulang jadwal relawan atau latih guru memandu sendiri.' });
  }
  let notif = [];
  try { notif = await api('/dashboard/notifications'); } catch {}
  render($('#todo'), items.length
    ? html`<ul class="list todo">${items.map((i) => html`<li><span style="color:var(--${i.tone}-ink)">${icon(i.ic)}</span><div><strong class="small">${i.t}</strong><div class="xs muted">${i.d}</div></div></li>`)}</ul>
      ${notif.length ? html`<p class="xs muted" style="margin-top:8px">${notif.length} notifikasi kotak tidak aktif tercatat${notif.some((n) => n.delivered) ? ', sebagian sudah dikirim lewat webhook' : '. Atur NOTIFY_WEBHOOK untuk meneruskannya ke surel atau WhatsApp'}.</p>` : ''}`
    : html`<div class="empty"><h3>Tidak ada yang mendesak</h3><p>Semua kotak mengirim detak dan tidak ada laporan kerusakan terbuka.</p></div>`);
}

async function renderUpdates(S) {
  let recent = [];
  try { recent = await api('/updates'); } catch {}
  const KIND = { pengumuman: 'Pengumuman', ambang: 'Ambang peringatan', jadwal: 'Hari sesi' };
  render($('#updates'), html`
    <h2>Kirim pembaruan ke sekolah</h2>
    <p class="small muted" style="margin:4px 0 var(--s-4)">Pembaruan ditandatangani pusat dan dipasang saat sekolah berikutnya sinkron, langsung atau lewat ponsel relawan.</p>
    <form id="upd" class="stack" novalidate>
      <div class="field"><label for="kind">Jenis</label>
        <select class="input" id="kind"><option value="pengumuman">Pengumuman untuk guru</option><option value="ambang">Ambang peringatan perangkat</option><option value="jadwal">Hari sesi belajar</option></select></div>
      <div class="field"><label for="target">Untuk</label>
        <select class="input" id="target"><option value="*">Semua sekolah</option>${S.map((s) => html`<option value="${s.device_id}">${s.sekolah}</option>`)}</select></div>
      <div id="kind-fields"></div>
      <p class="field-error" id="upd-err" role="alert"></p>
      <button class="btn btn-primary">${icon('send')}Terbitkan pembaruan</button>
    </form>
    ${recent.length ? html`<h3 class="sub-h">Terbit terakhir</h3><ul class="list">${recent.slice(0, 5).map((u) => html`<li><div><strong class="small">${KIND[u.kind]}</strong> <span class="xs muted">· ${u.target === '*' ? 'semua sekolah' : u.target} · ${lalu(u.created_at)}</span>
      <div class="xs">${u.kind === 'pengumuman' ? u.payload.teks : u.kind === 'jadwal' ? u.payload.hari.map(hari).join(', ') : Object.entries(u.payload).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(' · ')}</div></div></li>`)}</ul>` : ''}
  `);
  const fields = () => {
    const k = $('#kind').value;
    render($('#kind-fields'), k === 'pengumuman'
      ? html`<div class="field"><label for="teks">Isi pengumuman</label><textarea class="input" id="teks" maxlength="500" placeholder="Contoh: Relawan berkunjung Selasa depan untuk asesmen ulang."></textarea></div>`
      : k === 'ambang'
      ? html`<div class="inline-grid">
          <div class="field"><label for="bw">Baterai waspada (%)</label><input class="input" id="bw" type="number" min="5" max="90" value="30"></div>
          <div class="field"><label for="bk">Baterai kritis (%)</label><input class="input" id="bk" type="number" min="1" max="50" value="15"></div>
          <div class="field"><label for="sw">Suhu waspada (°C)</label><input class="input" id="sw" type="number" min="25" max="60" value="40"></div>
          <div class="field"><label for="sk">Suhu kritis (°C)</label><input class="input" id="sk" type="number" min="30" max="70" value="45"></div></div>`
      : html`<fieldset class="field" style="border:0;padding:0;margin:0"><legend class="label">Hari sesi</legend><div class="row">${[1, 2, 3, 4, 5, 6].map((d) => html`<label class="check"><input type="checkbox" class="hari" value="${d}" ${[2, 4].includes(d) ? raw('checked') : ''}> ${hari(d)}</label>`)}</div></fieldset>`);
  };
  $('#kind').onchange = fields;
  fields();
  $('#upd').onsubmit = async (e) => {
    e.preventDefault();
    const kind = $('#kind').value;
    const payload = kind === 'pengumuman' ? { teks: $('#teks').value }
      : kind === 'ambang' ? { baterai_waspada_pct: +$('#bw').value, baterai_kritis_pct: +$('#bk').value, suhu_waspada_c: +$('#sw').value, suhu_kritis_c: +$('#sk').value }
      : { hari: $$('.hari:checked').map((c) => +c.value) };
    $('#upd-err').textContent = '';
    await withBusy(e.submitter, async () => {
      try {
        await api('/updates', { method: 'POST', body: { kind, target: $('#target').value, payload } });
        toast('Pembaruan terbit. Sekolah memasangnya saat sinkron berikutnya.');
        renderUpdates(S);
      } catch (ex) {
        $('#upd-err').textContent = ex.message;
      }
    });
  };
}

async function openDetail(id, scroll = true) {
  selected = id;
  $$('tr[data-id]', view).forEach((tr) => tr.classList.toggle('selected', tr.dataset.id === id));
  const box = $('#detail');
  render(box, html`<div class="detail"><div class="skeleton" style="height:180px"></div></div>`);
  if (scroll) box.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  const isKoor = data.peran !== 'dinas';
  try {
    const [m, h] = await Promise.all([api(`/dashboard/schools/${id}/metrics`), isKoor ? api(`/dashboard/devices/${id}/health?jam=168`) : Promise.resolve(null)]);
    const n = m.numerasi;
    const lv = data.levels.map((l) => ({ k: `${l.level} · ${l.nama}`, v: n.sebaran_level_kini[l.level] || 0 }));
    render(box, html`<div class="detail">
      <div class="detail-head">
        <div><h2>${m.sekolah}</h2><p class="small muted">${m.wilayah} · ${m.kode_wilayah || ''} · kotak ${m.device_id || id}</p></div>
        <button class="btn btn-quiet btn-sm" id="close-detail">${icon('x')}Tutup</button>
      </div>

      <h3 class="sub-h" style="margin-top:0">Hasil belajar</h3>
      <dl class="kv">
        <div><dt>Murid terdiagnosis</dt><dd>${n.murid_terdiagnosis}</dd></div>
        <div><dt>Sudah asesmen ulang</dt><dd>${n.murid_diases_ulang}</dd></div>
        <div><dt>Skor diagnostik awal → kini</dt><dd>${persen(n.rata_skor_awal_persen, 1)} → ${persen(n.rata_skor_kini_persen, 1)}</dd></div>
        <div><dt>Naik level setelah asesmen ulang</dt><dd>${persen(n.persen_naik_level, 1)}</dd></div>
        <div><dt>Ketepatan latihan 28 hari</dt><dd>${persen(n.persen_benar_28_hari, 1)} <span class="xs muted">(${angka(n.jawaban_28_hari)} jawaban)</span></dd></div>
      </dl>
      <p class="small muted" style="margin-bottom:8px">Sebaran murid per level saat ini</p>
      ${raw(barList(lv))}

      <h3 class="sub-h">Sesi 28 hari terakhir</h3>
      <dl class="kv">
        <div><dt>Terlaksana</dt><dd>${m.sesi.terlaksana} dari ${m.sesi.terjadwal}</dd></div>
        <div><dt>Rata-rata durasi</dt><dd>${m.sesi.rata_menit ?? '–'} menit</dd></div>
        <div><dt>Dipandu relawan</dt><dd>${m.sesi.oleh_relawan} sesi</dd></div>
        <div><dt>Kelompok aktif</dt><dd>${m.sesi.kelompok_aktif}</dd></div>
      </dl>

      ${h ? html`
        <h3 class="sub-h">Kesehatan kotak, 7 hari terakhir</h3>
        <dl class="kv">
          <div><dt>Detak terakhir</dt><dd>${lalu(h.detak_terakhir)}</dd></div>
          <div><dt>Waktu aktif 7 / 28 hari</dt><dd>${persen(h.waktu_aktif_7_hari.persen, 1)} / ${persen(h.waktu_aktif_28_hari.persen, 1)}</dd></div>
          <div><dt>Menyala ulang (28 hari)</dt><dd>${h.nyala_ulang_28_hari} kali</dd></div>
          <div><dt>Versi</dt><dd class="small">${h.versi_perangkat_lunak} · ${h.versi_firmware}</dd></div>
        </dl>
        <div class="grid-2" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:var(--s-4)">
          <div class="chart-box"><p class="small" style="font-weight:700;margin-bottom:6px">Baterai (%)</p>${raw(lineChart(h.telemetri.map((t) => ({ t: t.ts, v: t.baterai })), { min: 0, max: 100, label: 'Baterai 7 hari', fmt: (v) => `${v}%`, thresholds: [{ v: 30, label: 'waspada' }, { v: 15, label: 'kritis', color: 'var(--bad)' }], height: 150 }))}</div>
          <div class="chart-box"><p class="small" style="font-weight:700;margin-bottom:6px">Suhu (°C)</p>${raw(lineChart(h.telemetri.map((t) => ({ t: t.ts, v: t.suhu })), { min: 20, max: 50, color: 'var(--flame-ink)', label: 'Suhu 7 hari', fmt: (v) => `${v}°`, thresholds: [{ v: 40, label: 'waspada' }], height: 150 }))}</div>
        </div>
        <h3 class="sub-h">Laporan kerusakan</h3>
        ${h.laporan.length ? html`<ul class="list">${h.laporan.map((r) => html`<li><span class="badge ${r.status === 'selesai' ? 'badge-ok' : 'badge-warn'}">${r.status === 'selesai' ? 'Selesai' : 'Terbuka'}</span>
          <div class="grow"><strong class="small">${r.deskripsi}</strong><div class="xs muted">${tanggal(r.dibuat, { jam: true })} · dilaporkan ${r.pelapor}${r.tindakan ? ` · ${r.tindakan}` : ''}</div></div></li>`)}</ul>` : html`<p class="small muted">Belum ada laporan.</p>`}
        <h3 class="sub-h">Riwayat sinkron</h3>
        <div class="table-wrap"><table><thead><tr><th>Diterima</th><th>Jalur</th><th class="num">Catatan</th><th class="num">Baru</th></tr></thead>
          <tbody>${h.riwayat_sinkron.map((r) => html`<tr><td>${tanggal(r.received_at, { jam: true })}</td><td>${r.via}</td><td class="num">${angka(r.n_events)}</td><td class="num">${angka(r.n_new)}</td></tr>`)}</tbody></table></div>
      ` : ''}
    </div>`);
    $('#close-detail').onclick = () => {
      selected = null;
      render(box, html`<div class="empty"><h3>Pilih satu sekolah</h3><p>Rincian sekolah muncul di sini.</p></div>`);
      $$('tr[data-id]', view).forEach((tr) => tr.classList.remove('selected'));
    };
  } catch (e) {
    fail(e);
  }
}

start();
setInterval(() => me && !document.hidden && !document.activeElement?.closest('form') && load(), 120000);
