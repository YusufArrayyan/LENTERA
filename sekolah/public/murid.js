import { $, $$, api, html, raw, render, icon, BRAND_MARK, uuid } from '/ui/app.js';

const app = $('#app');
render($('#brand'), BRAND_MARK);
let me = null;
let current = null;
let shownAt = 0;
let levels = [];

$('#logout').onclick = async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  location.href = '/';
};

function setNet(msg) {
  const n = $('#net');
  n.hidden = !msg;
  n.textContent = msg || '';
}

// Kirim dengan pengulangan otomatis: jawaban punya event_id sehingga aman dikirim ulang.
async function reliable(fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      const out = await fn();
      setNet('');
      return out;
    } catch (e) {
      if (!e.network) throw e;
      setNet('Sambungan ke server terputus. Jawabanmu disimpan di tablet dan dikirim lagi otomatis.');
      await new Promise((r) => setTimeout(r, Math.min(8000, 1500 + attempt * 1000)));
    }
  }
}

// ---------- Gambar soal ----------
function dotsGrid(n, color, startIdx = 0, perRow = 5, r = 15, gap = 42, ox = 26, oy = 26) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const k = i + startIdx;
    const x = ox + (k % perRow) * gap + (k % perRow >= 5 ? 14 : 0);
    const y = oy + Math.floor(k / perRow) * gap;
    s += `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`;
  }
  return s;
}
function visual(v) {
  if (!v) return '';
  if (v.type === 'titik' || v.type === 'titik-dua') {
    const total = v.type === 'titik' ? v.jumlah : v.a + v.b;
    const perRow = total > 10 ? 10 : 5;
    const rows = Math.ceil(total / perRow);
    const w = 26 * 2 + (perRow - 1) * 42 + (perRow > 5 ? 14 : 0);
    const h = 26 * 2 + (rows - 1) * 42;
    const body = v.type === 'titik'
      ? dotsGrid(v.jumlah, 'var(--flame-strong)', 0, perRow)
      : dotsGrid(v.a, 'var(--brand)', 0, perRow) + dotsGrid(v.b, 'var(--flame-strong)', v.a, perRow);
    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${total} titik">${body}</svg>`;
  }
  if (v.type === 'kelompok') {
    const cw = 120, w = v.kelompok * cw + (v.kelompok - 1) * 16;
    let s = '';
    for (let g = 0; g < v.kelompok; g++) {
      const x0 = g * (cw + 16);
      s += `<rect x="${x0 + 2}" y="2" width="${cw - 4}" height="116" rx="22" fill="var(--surface)" stroke="var(--line-strong)" stroke-width="2.5"/>`;
      for (let i = 0; i < v.isi; i++) {
        const cx = x0 + 32 + (i % 3) * 28, cy = 34 + Math.floor(i / 3) * 30;
        s += `<circle cx="${cx}" cy="${cy}" r="11" fill="var(--brand)"/>`;
      }
    }
    return `<svg viewBox="0 0 ${w} 120" role="img" aria-label="${v.kelompok} kelompok, tiap kelompok ${v.isi} titik">${s}</svg>`;
  }
  if (v.type === 'pecahan') {
    const w = 400, h = 90, pw = w / v.penyebut;
    let s = '';
    for (let i = 0; i < v.penyebut; i++) {
      s += `<rect x="${i * pw + 2}" y="4" width="${pw - 4}" height="${h - 8}" rx="8" fill="${i < v.pembilang ? 'var(--brand)' : 'var(--bg)'}" stroke="var(--ink)" stroke-width="2.5"/>`;
    }
    return `<svg viewBox="0 0 ${w + 4} ${h}" role="img" aria-label="${v.pembilang} dari ${v.penyebut} bagian diwarnai">${s}</svg>`;
  }
  return '';
}

function updateBar(act) {
  if (act.mode === 'latihan') {
    const chip = $('#level');
    chip.hidden = false;
    render(chip, html`${act.nama_level}<span class="subdots" aria-label="tingkat ${act.sub} dari 3">${raw([1, 2, 3].map((i) => `<i class="${i <= act.sub ? 'on' : ''}"></i>`).join(''))}</span>`);
    const st = $('#stars');
    st.hidden = false;
    render(st, html`${icon('star')}<span>${act.benar}</span><span class="sr-only">jawaban benar</span>`);
  } else {
    $('#level').hidden = true;
    $('#stars').hidden = true;
  }
}

function showQuestion(act) {
  current = act;
  updateBar(act);
  const it = act.item;
  const isEq = /^[\d\s+−×:=…/dari]+$/.test(it.prompt) && it.prompt.includes('…');
  const meta = act.mode === 'diagnostik' ? `Soal ${act.nomor}` : 'Latihan';
  render(app, html`
    <p class="q-meta">${meta}</p>
    <h1 class="q-prompt ${isEq ? 'is-eq' : ''}">${it.prompt}</h1>
    <div class="q-visual">${raw(visual(it.visual))}</div>
    <div class="opts ${it.options.length === 2 ? 'two' : ''}" role="group" aria-label="Pilihan jawaban">
      ${it.options.map((o) => html`<button class="opt" data-v="${o}">${o}</button>`)}
    </div>
    <div id="fb"></div>`);
  shownAt = performance.now();
  $$('.opt', app).forEach((b) => (b.onclick = () => answer(b)));
}

async function answer(btn) {
  const value = btn.dataset.v;
  $$('.opt', app).forEach((b) => (b.disabled = true));
  btn.classList.add('is-picked');
  const ms = Math.round(performance.now() - shownAt);
  const body = { event_id: uuid(), item_id: current.item.item_id, response: value, ms };
  let r;
  try {
    r = await reliable(() => api(`/student/${me.student_code}/answers`, { method: 'POST', body }));
  } catch (e) {
    return fatal(e);
  }
  if (r.kedaluwarsa) return showQuestion(r.berikutnya);
  if (current.mode === 'diagnostik') {
    if (r.diagnostik_selesai) return showDiagDone(r.diagnostik_selesai, r.berikutnya);
    render($('#fb'), html`<div class="fb fb-neutral">${icon('check')}<p>Jawaban tersimpan.</p></div>`);
    setTimeout(() => showQuestion(r.berikutnya), 450);
    return;
  }
  btn.classList.remove('is-picked');
  if (r.benar) {
    btn.classList.add('is-right');
    const extra = r.perubahan === 'naik' ? 'Soal berikutnya sedikit lebih menantang.' : '';
    render($('#fb'), html`<div class="fb fb-ok">${icon('star')}<div><strong>Benar!</strong>${extra ? html`<p>${extra}</p>` : ''}</div></div>`);
    setTimeout(() => showQuestion(r.berikutnya), r.perubahan === 'naik' ? 1600 : 1000);
  } else {
    btn.classList.add('is-wrong');
    $$('.opt', app).find((b) => b.dataset.v === r.jawaban_benar)?.classList.add('is-right');
    const tip = r.perubahan === 'turun' ? 'Kita coba soal yang sedikit lebih mudah dulu.' : 'Lihat jawaban yang hijau, lalu coba soal berikutnya.';
    render($('#fb'), html`<div class="fb fb-bad"><div><strong>Belum tepat. Jawabannya ${r.jawaban_benar}.</strong><p>${tip}</p></div><button class="btn btn-primary btn-lg" id="next">Lanjut</button></div>`);
    $('#next').focus();
    $('#next').onclick = () => showQuestion(r.berikutnya);
  }
}

function lampSvg() {
  return raw(`<svg class="lamp" viewBox="0 0 112 112" aria-hidden="true">
    <circle class="glow" cx="56" cy="64" r="46" fill="var(--flame-pale)"/>
    <path d="M38 30h36M43 30v8M69 30v8" stroke="var(--ink)" stroke-width="5" stroke-linecap="round"/>
    <path d="M36 42h40l-4 38a6 6 0 0 1-6 5H46a6 6 0 0 1-6-5z" fill="var(--bg)" stroke="var(--ink)" stroke-width="5" stroke-linejoin="round"/>
    <path d="M56 50c6 6 7 11 7 14a7 7 0 0 1-14 0c0-3 1-8 7-14z" fill="var(--flame-strong)"/>
  </svg>`);
}

function showDiagIntro(act) {
  updateBar(act);
  const ulang = act.jenis === 'ulang';
  render(app, html`
    <div class="hello">
      ${lampSvg()}
      <h1>${ulang ? 'Saatnya mengecek kemajuanmu' : 'Kita mulai dengan beberapa soal'}</h1>
      <p>${ulang ? 'Kerjakan soal-soal ini. Hasilnya dipakai guru untuk memilih latihanmu berikutnya.' : 'Soal-soal ini membantu memilih latihan yang pas untukmu. Kalau ada yang belum bisa, pilih jawaban yang menurutmu paling dekat.'}</p>
      <button class="btn btn-flame btn-lg" id="go">Mulai</button>
    </div>`);
  $('#go').focus();
  $('#go').onclick = () => showQuestion(act);
}

function showDiagDone(res, next) {
  const ladder = levels.map((l) => `<span class="${l.level < res.level ? 'on' : l.level === res.level ? 'here' : ''}"></span>`).join('');
  render(app, html`
    <div class="hello">
      ${lampSvg()}
      <h1>Selesai! Kamu mulai dari ${res.nama_level}.</h1>
      <div class="level-ladder" aria-label="Level ${res.level} dari ${levels.length}">${raw(ladder)}</div>
      <p>Kamu menjawab ${res.skor} dari ${res.total} soal dengan benar. Latihan berikutnya disesuaikan dengan kemampuanmu.</p>
      <button class="btn btn-flame btn-lg" id="go">Mulai latihan</button>
    </div>`);
  $('#go').focus();
  $('#go').onclick = () => (next.mode === 'diagnostik' ? showQuestion(next) : showQuestion(next));
}

function fatal(e) {
  if (e.status === 401) return location.replace('/');
  render(app, html`<div class="hello"><h1>Latihan belum bisa dibuka</h1><p>${e.message}</p><button class="btn btn-primary btn-lg" id="retry">Coba lagi</button></div>`);
  $('#retry').onclick = start;
}

async function start() {
  try {
    me = await reliable(() => api('/auth/me'));
    if (me.role !== 'murid') return location.replace('/guru');
    const info = await reliable(() => api('/api/info'));
    levels = info.levels;
    const act = await reliable(() => api(`/student/${me.student_code}/next-activity`));
    if (act.mode === 'diagnostik' && act.nomor === 1) showDiagIntro(act);
    else showQuestion(act);
  } catch (e) {
    fatal(e);
  }
}
start();
