import { $, $$, api, html, raw, render, icon, BRAND_MARK, toast, withBusy, tanggal, jam2, lalu, angka, persen, hari, uuid, outbox } from '/ui/app.js';
import { lineChart } from '/ui/chart.js';

const view = $('#view');
const APP = document.body.dataset.app;
let me, info;

// ---------- kerangka ----------
const TABS = {
  guru: [['hari-ini', 'Hari ini'], ['kelompok', 'Kelompok'], ['murid', 'Murid'], ['konten', 'Konten'], ['perangkat', 'Perangkat & sinkron']],
  relawan: [['hari-ini', 'Hari ini'], ['sinkron', 'Bawa data'], ['kelompok', 'Kelompok'], ['konten', 'Konten'], ['perangkat', 'Perangkat']],
};

function drawTabs(active) {
  const tabs = TABS[APP];
  render($('#tabs'), html`${tabs.map(([id, label]) => html`<a class="tab" role="tab" href="#${id}" aria-selected="${String(id === active)}">${label}</a>`)}`);
}

$('#logout').onclick = async () => {
  if (outbox.count() > 0 && !confirm(`${outbox.count()} catatan belum terkirim ke server. Tetap keluar? Catatan akan dikirim saat ada yang masuk lagi dari perangkat ini.`)) return;
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  location.href = APP === 'relawan' ? '/#staf' : '/#staf';
};

outbox.onChange((n) => {
  const b = $('#outbox');
  b.hidden = n === 0;
  b.textContent = `${n} catatan menunggu Wi-Fi`;
});

function fail(e) {
  if (e.status === 401) return location.replace('/#staf');
  toast(e.message, 'bad');
}

const levelChip = (l) => html`<span class="lvl lvl-${l}" aria-label="Level ${l}">${l}</span>`;

// ---------- router ----------
let timers = [];
function clearTimers() {
  timers.forEach(clearInterval);
  timers = [];
}
async function route() {
  clearTimers();
  const [name, arg] = (location.hash.slice(1) || 'hari-ini').split('/');
  drawTabs(name === 'sesi' ? 'hari-ini' : name);
  const fn = { 'hari-ini': pageToday, sesi: pageSession, kelompok: pageGroups, murid: pageStudents, konten: pageContent, perangkat: pageDevice, sinkron: pageCarrier }[name];
  if (!fn || (name === 'murid' && APP === 'relawan')) return (location.hash = '#hari-ini');
  try {
    await fn(arg);
  } catch (e) {
    fail(e);
  }
  view.focus({ preventScroll: true });
}
window.addEventListener('hashchange', route);

// ---------- HARI INI ----------
function statusStrip(st) {
  const iot = st.iot;
  const up = st.server.waktu_aktif_hari_ini;
  const sync = st.sinkron;
  const battTone = iot && iot.baterai_pct !== null ? (iot.baterai_pct <= 15 ? 'bad' : iot.baterai_pct <= 30 ? 'warn' : 'ok') : '';
  return html`
    <div class="status-strip" aria-label="Status server">
      <div class="status-cell">
        <span class="k"><span class="dot dot-ok"></span>Server</span>
        <span class="v">Aktif</span>
        <span class="s">${up.persen === null ? up.catatan : `${up.persen}% jam sekolah hari ini`}</span>
      </div>
      <div class="status-cell">
        <span class="k">${icon('battery')}Baterai</span>
        <span class="v">${iot && iot.baterai_pct !== null ? html`<span class="dot dot-${battTone}" style="margin-right:8px;vertical-align:4px"></span>${iot.baterai_pct}%` : '–'}</span>
        <span class="s">${iot ? ({ plts: 'Diisi panel surya', adaptor: 'Diisi listrik PLN', baterai: 'Memakai baterai' }[iot.sumber_daya] || 'Sumber daya tak terbaca') : 'Belum ada data modul'}</span>
      </div>
      <div class="status-cell">
        <span class="k">${icon('temp')}Suhu kotak</span>
        <span class="v">${iot && iot.suhu !== null ? `${angka(iot.suhu, 1)} °C` : '–'}</span>
        <span class="s">${iot && iot.kelembapan !== null ? `Kelembapan ${Math.round(iot.kelembapan)}%` : ''}</span>
      </div>
      <div class="status-cell">
        <span class="k">${icon('chip')}Modul pemantau</span>
        <span class="v">${!iot ? 'Belum ada' : iot.hilang ? 'Diam' : 'Aktif'}</span>
        <span class="s">${iot ? `Data terakhir ${lalu(iot.terakhir)}` : 'Modul belum pernah mengirim data'}</span>
      </div>
      <div class="status-cell">
        <span class="k">${icon('sync')}Sinkron ke pusat</span>
        <span class="v">${angka(sync.belum_terkirim)}</span>
        <span class="s">catatan belum terkirim · terakhir ${sync.terakhir ? lalu(sync.terakhir.at) : 'belum pernah'}</span>
      </div>
    </div>`;
}

function alertNotices(st) {
  const items = [];
  for (const a of st.peringatan) {
    const title = { baterai: 'Baterai menipis', suhu: 'Kotak terlalu panas', kelembapan: 'Udara terlalu lembap', iot: 'Modul pemantau tidak mengirim data' }[a.jenis] || 'Peringatan perangkat';
    items.push(html`<div class="notice ${a.level === 'kritis' ? 'notice-bad' : 'notice-warn'}" role="alert">${icon('alert')}<div><strong>${title}</strong><p>${a.pesan}</p></div></div>`);
  }
  if (st.pengumuman) items.push(html`<div class="notice notice-brand">${icon('megaphone')}<div><strong>Pesan dari ${st.pengumuman.dari}</strong><p>${st.pengumuman.teks}</p></div></div>`);
  return items.length ? html`<div class="stack-sm" style="margin-bottom:var(--s-5)">${items}</div>` : '';
}

async function pageToday() {
  const [st, gr] = await Promise.all([api('/device/status'), api('/groups')]);
  const open = gr.kelompok.filter((g) => g.sesi_terbuka);
  const days = st.hari_sesi.map(hari).join(' dan ');
  const today = new Date();
  render(view, html`
    <div class="page-title">
      <h1>${hari(today.getDay())}, ${tanggal(today.toISOString())}</h1>
      <p>${st.jadwal_sesi_hari_ini ? `Hari ini jadwal sesi belajar. Sesi rutin tiap ${days}.` : `Hari ini tidak ada jadwal sesi. Sesi rutin tiap ${days}.`}</p>
    </div>
    ${alertNotices(st)}
    ${statusStrip(st)}

    ${open.length ? html`
      <section class="block">
        <h2>Sesi yang sedang berjalan</h2>
        <ul class="list">${open.map((g) => html`
          <li>${levelChip(g.level)}<div class="grow"><strong>${g.label}</strong><div class="small muted">Mulai ${jam2(g.sesi_terbuka.started_at)} · ${lalu(g.sesi_terbuka.started_at)}</div></div>
          <a class="btn btn-primary" href="#sesi/${g.sesi_terbuka.session_id}">${icon('play')}Buka sesi</a></li>`)}</ul>
      </section>` : ''}

    <section class="block">
      <div class="section-head"><div><h2>Mulai sesi</h2><p>Pilih kelompok yang belajar sekarang. Satu kelompok paling banyak ${gr.maks_per_kelompok} murid.</p></div></div>
      ${gr.kelompok.length ? html`<ul class="list">${gr.kelompok.map((g) => html`
        <li class="group-row">${levelChip(g.level)}
          <div><strong>${g.label}</strong><div class="small muted">${g.anggota.length} murid · Level ${g.level}</div></div>
          ${g.sesi_terbuka ? html`<span class="badge badge-ok">Sedang berjalan</span>`
            : html`<button class="btn btn-outline" data-start="${g.group_id}" ${g.anggota.length ? '' : raw('disabled')}>${icon('play')}Mulai</button>`}
        </li>`)}</ul>`
      : html`<div class="empty"><h3>Belum ada kelompok</h3><p>Kelompok terbentuk otomatis setelah murid mengerjakan diagnostik pertama. Aktifkan murid di halaman Murid, lalu minta mereka masuk dengan kartu.</p>${APP === 'guru' ? html`<a class="btn btn-primary" href="#murid">Buka halaman Murid</a>` : ''}</div>`}
    </section>

    <section class="block">
      <h2>Sesi hari ini</h2>
      ${st.sesi_hari_ini.length ? html`<div class="table-wrap" style="margin-top:var(--s-3)"><table>
        <thead><tr><th>Kelompok</th><th>Pemandu</th><th>Mulai</th><th class="num">Durasi</th></tr></thead>
        <tbody>${st.sesi_hari_ini.map((s) => html`<tr class="clickable" data-href="#sesi/${s.session_id}">
          <td><strong>${s.group_label}</strong></td><td>${s.facilitator_name || '–'} <span class="muted small">(${s.facilitator_role})</span></td>
          <td class="num">${jam2(s.started_at)}</td><td class="num">${s.ended_at ? `${s.duration_min} menit` : html`<span class="badge badge-ok">berjalan</span>`}</td></tr>`)}</tbody></table></div>`
      : html`<p class="muted" style="margin-top:6px">Belum ada sesi yang dimulai hari ini.</p>`}
    </section>

    ${gr.asesmen_ulang_jatuh_tempo || gr.perlu_pengelompokan_ulang ? html`
      <section class="block"><div class="notice notice-brand">${icon('info')}<div>
        ${gr.asesmen_ulang_jatuh_tempo ? html`<p><strong>${gr.asesmen_ulang_jatuh_tempo} murid</strong> sudah empat pekan sejak asesmen terakhir. Mereka otomatis mengerjakan asesmen ulang saat masuk berikutnya.</p>` : ''}
        ${gr.perlu_pengelompokan_ulang ? html`<p><strong>${gr.perlu_pengelompokan_ulang} murid</strong> punya hasil asesmen yang berbeda dari level kelompoknya. <a href="#kelompok">Perbarui kelompok</a>.</p>` : ''}
      </div></div></section>` : ''}
  `);
  $$('[data-start]', view).forEach((b) => (b.onclick = () => withBusy(b, async () => {
    try {
      const s = await api('/sessions', { method: 'POST', body: { session_id: uuid(), group_id: b.dataset.start, started_at: new Date().toISOString() } });
      location.hash = `#sesi/${s.session_id}`;
    } catch (e) { fail(e); }
  })));
  $$('tr[data-href]', view).forEach((tr) => (tr.onclick = () => (location.hash = tr.dataset.href)));
  timers.push(setInterval(async () => {
    if (location.hash.slice(1).split('/')[0] !== 'hari-ini' && location.hash) return;
    try {
      const st2 = await api('/device/status');
      const strip = $('.status-strip', view);
      if (strip) strip.outerHTML = statusStrip(st2).__raw;
    } catch {}
  }, 30000));
}

// ---------- SESI ----------
async function pageSession(id) {
  const s = await api(`/sessions/${id}`);
  const state = new Map(s.anggota.map((a) => [a.student_code, a.present ? true : null]));
  const closed = !!s.ended_at;

  const draw = () => {
    const present = [...state.values()].filter((v) => v === true).length;
    render(view, html`
      <div class="session-head">
        <div><p class="muted small">${closed ? 'Sesi selesai' : 'Sesi berjalan'} · ${s.level ? `Level ${s.level}` : ''}</p><h1>${s.group_label}</h1>
          <p class="muted small">Mulai ${tanggal(s.started_at, { jam: true })}${closed ? ` · selesai ${jam2(s.ended_at)}` : ''}</p></div>
        <div style="text-align:right"><div class="timer" id="timer">${closed ? `${s.duration_min} mnt` : '00.00'}</div><p class="muted small">${present} dari ${s.anggota.length} murid hadir</p></div>
      </div>

      ${s.alat_peraga ? html`
        <details class="disclosure panel guide block" ${closed ? '' : raw('open')}>
          <summary>${icon('chev', 'chev')}${icon('book')} 20 menit pertama: ${s.alat_peraga.judul}</summary>
          <div class="bahan">${s.alat_peraga.bahan.map((b) => html`<span class="badge badge-flame">${b}</span>`)}</div>
          <ol>${s.alat_peraga.langkah.map((l) => html`<li>${l}</li>`)}</ol>
          <p class="small" style="margin-top:var(--s-3)"><strong>Tanda berhasil:</strong> ${s.alat_peraga.tanda}</p>
        </details>` : ''}

      <section class="block">
        <div class="section-head"><div><h2>Daftar hadir</h2><p>Setelah aktivitas alat peraga, murid latihan di tablet. Jumlah soal di bawah nama bertambah selama sesi.</p></div>
          ${closed ? '' : html`<button class="btn btn-outline btn-sm" id="all">${icon('check')}Tandai semua hadir</button>`}</div>
        <ul class="list">${s.anggota.map((a) => {
          const v = state.get(a.student_code);
          return html`<li class="att">
            <div><div class="att-name">${a.name || a.student_code}</div><div class="att-meta">${a.dijawab ? `${a.dijawab} soal, ${a.benar || 0} benar` : 'Belum menjawab soal di sesi ini'}</div></div>
            <div class="toggle" role="group" aria-label="Kehadiran ${a.name}">
              <button class="yes" data-code="${a.student_code}" data-v="1" aria-pressed="${String(v === true)}" ${closed ? raw('disabled') : ''}>Hadir</button>
              <button class="no" data-code="${a.student_code}" data-v="0" aria-pressed="${String(v === false)}" ${closed ? raw('disabled') : ''}>Tidak</button>
            </div></li>`;
        })}</ul>
      </section>

      ${closed ? html`
        <section class="block panel-soft"><h2>Catatan sesi</h2><p style="margin-top:6px">${s.notes || 'Tidak ada catatan.'}</p>
          <p class="small muted" style="margin-top:6px">Relawan ${s.volunteer_present ? 'hadir' : 'tidak hadir'} · ${s.students_finished ?? 0} murid menyelesaikan latihan.</p></section>
        <p class="block"><a class="btn btn-outline" href="#hari-ini">${icon('back')}Kembali ke Hari ini</a></p>`
      : html`
        <section class="block panel">
          <h2>Tutup sesi</h2>
          <form id="close" class="stack" style="margin-top:var(--s-3)">
            <div class="field"><label for="notes">Catatan untuk guru dan koordinator (boleh kosong)</label>
              <textarea class="input" id="notes" placeholder="Contoh: tiga murid masih menghitung dari satu saat menjumlah."></textarea></div>
            ${s.facilitator_role !== 'relawan' ? html`<label class="check"><input type="checkbox" id="vol"> Relawan ikut memandu sesi ini</label>` : ''}
            <div class="row"><button class="btn btn-primary btn-lg">${icon('stop')}Tutup sesi</button><span class="small muted">Durasi dicatat otomatis.</span></div>
          </form>
        </section>`}
    `);
    bind();
  };

  const bind = () => {
    $$('.toggle button', view).forEach((b) => (b.onclick = async () => {
      const code = b.dataset.code, present = b.dataset.v === '1';
      state.set(code, present);
      draw();
      const r = await outbox.send(`/sessions/${id}`, 'PATCH', { hadir: [{ student_code: code, present }] }, 'kehadiran').catch(fail);
      if (r?.queued) toast('Wi-Fi putus. Kehadiran disimpan di ponsel dan dikirim otomatis.');
    }));
    const all = $('#all');
    if (all) all.onclick = async () => {
      const list = [...state.keys()].map((code) => ({ student_code: code, present: true }));
      list.forEach((a) => state.set(a.student_code, true));
      draw();
      const r = await outbox.send(`/sessions/${id}`, 'PATCH', { hadir: list }, 'kehadiran').catch(fail);
      if (r?.queued) toast('Wi-Fi putus. Kehadiran disimpan di ponsel dan dikirim otomatis.');
    };
    const form = $('#close');
    if (form) form.onsubmit = async (e) => {
      e.preventDefault();
      const marked = [...state.values()].filter((v) => v !== null).length;
      if (marked === 0 && !confirm('Belum ada murid yang ditandai hadir. Tutup sesi tanpa daftar hadir?')) return;
      const body = { tutup: { ended_at: new Date().toISOString(), notes: $('#notes').value, volunteer_present: $('#vol')?.checked || false, students_finished: [...state.values()].filter((v) => v === true).length, event_id: uuid() } };
      await withBusy(e.submitter, async () => {
        try {
          const r = await outbox.send(`/sessions/${id}`, 'PATCH', body, 'tutup sesi');
          toast(r.queued ? 'Sesi ditutup. Datanya dikirim ke server begitu Wi-Fi kembali.' : 'Sesi ditutup dan tercatat.');
          location.hash = '#hari-ini';
        } catch (ex) { fail(ex); }
      });
    };
  };

  draw();
  if (!closed) {
    const tick = () => {
      const t = $('#timer');
      if (!t) return;
      const m = Math.floor((Date.now() - Date.parse(s.started_at)) / 1000);
      t.textContent = `${String(Math.floor(m / 60)).padStart(2, '0')}.${String(m % 60).padStart(2, '0')}`;
    };
    tick();
    timers.push(setInterval(tick, 1000));
    timers.push(setInterval(async () => {
      try {
        const fresh = await api(`/sessions/${id}`);
        fresh.anggota.forEach((a) => {
          const row = s.anggota.find((x) => x.student_code === a.student_code);
          if (row) Object.assign(row, { dijawab: a.dijawab, benar: a.benar });
        });
        if (!$('#notes') || document.activeElement !== $('#notes')) {
          const notes = $('#notes')?.value;
          draw();
          if (notes !== undefined && $('#notes')) $('#notes').value = notes;
        }
      } catch {}
    }, 15000));
  }
}

// ---------- KELOMPOK ----------
async function pageGroups() {
  const gr = await api('/groups');
  const canEdit = APP === 'guru' && me.role !== 'relawan';
  const opts = (cur) => gr.kelompok.map((g) => html`<option value="${g.group_id}" ${g.group_id === cur ? raw('selected') : ''}>${g.label}</option>`);
  render(view, html`
    <div class="page-title row-between">
      <div><h1>Kelompok belajar</h1><p>Murid dikelompokkan menurut level hasil diagnostik, bukan menurut kelas.</p></div>
      <a class="btn btn-outline" href="/laporan" target="_blank" rel="noopener">${icon('print')}Cetak ringkasan</a>
    </div>
    ${gr.perlu_pengelompokan_ulang && canEdit ? html`<div class="notice notice-brand" style="margin-bottom:var(--s-4)">${icon('layers')}<div class="grow"><strong>${gr.perlu_pengelompokan_ulang} murid siap pindah kelompok</strong><p>Hasil asesmen ulang mereka berbeda dari level kelompok sekarang.</p></div><button class="btn btn-primary" id="regroup">Perbarui kelompok</button></div>` : ''}
    ${gr.belum_berkelompok.length ? html`<div class="notice notice-warn" style="margin-bottom:var(--s-4)">${icon('info')}<div><strong>${gr.belum_berkelompok.length} murid aktif belum punya kelompok</strong><p>Mereka masuk kelompok otomatis setelah menyelesaikan diagnostik pertama: ${gr.belum_berkelompok.map((m) => m.name).join(', ')}.</p></div></div>` : ''}
    ${gr.kelompok.length ? '' : html`<div class="empty"><h3>Belum ada kelompok</h3><p>Kelompok terbentuk otomatis setelah murid menyelesaikan diagnostik pertama.</p></div>`}
    ${gr.kelompok.map((g) => html`
      <section class="block">
        <div class="section-head">
          <div class="row">${levelChip(g.level)}<div><h2>${g.label}</h2><p>Level ${g.level} · ${g.anggota.length} dari ${gr.maks_per_kelompok} murid</p></div></div>
          ${canEdit ? html`<button class="btn btn-quiet btn-sm" data-reassess="${g.group_id}">Buka asesmen ulang</button>` : ''}
        </div>
        ${g.anggota.length ? html`<div class="table-wrap"><table>
          <thead><tr><th>Nama</th><th class="hide-sm">Kelas</th><th>Tingkat latihan</th><th class="num">Ketepatan</th><th>Catatan</th>${canEdit ? html`<th>Pindahkan ke</th>` : ''}</tr></thead>
          <tbody>${g.anggota.map((m) => html`<tr>
            <td><strong>${m.name}</strong></td>
            <td class="hide-sm">${'I II III IV V VI'.split(' ')[m.class_grade - 1] || '–'}</td>
            <td>${m.sub ? `${m.sub} dari 3` : '–'}</td>
            <td class="num">${m.total ? `${Math.round((m.correct / m.total) * 100)}%` : '–'} <span class="muted xs">${m.total ? `(${m.total} soal)` : ''}</span></td>
            <td>${m.reassess_open ? html`<span class="badge badge-brand">Asesmen ulang dibuka</span>` : ''}
                ${m.level && m.level !== g.level ? html`<span class="badge badge-flame">Hasil asesmen: Level ${m.level}</span>` : ''}
                ${m.siap_naik && m.sub === 3 && m.level === g.level ? html`<span class="badge badge-ok">Lancar di tingkat 3</span>` : ''}</td>
            ${canEdit ? html`<td><select class="input" style="min-height:38px;padding:6px 10px" data-move="${m.student_code}" aria-label="Pindahkan ${m.name}">${opts(g.group_id)}</select></td>` : ''}
          </tr>`)}</tbody></table></div>` : html`<p class="muted">Kelompok ini kosong.</p>`}
      </section>`)}
    ${canEdit ? html`
      <section class="block panel-soft">
        <h2>Buat kelompok baru</h2>
        <p class="muted small" style="margin-top:4px">Pakai bila satu level punya lebih dari ${gr.maks_per_kelompok} murid atau kamu ingin memecah kelompok.</p>
        <div class="row" style="margin-top:var(--s-3)">
          <select class="input" id="newlvl" style="max-width:280px" aria-label="Level kelompok baru">${gr.levels.map((l) => html`<option value="${l.level}">Level ${l.level} · ${l.nama}</option>`)}</select>
          <button class="btn btn-outline" id="newgroup">${icon('plus')}Buat kelompok</button>
        </div>
      </section>` : ''}
  `);
  if (!canEdit) return;
  $('#regroup')?.addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    try {
      const r = await api('/groups/regroup', { method: 'POST' });
      toast(`${r.dipindah} murid dipindahkan ke kelompok sesuai level barunya.`);
      pageGroups();
    } catch (ex) { fail(ex); }
  }));
  $$('[data-reassess]', view).forEach((b) => (b.onclick = () => withBusy(b, async () => {
    try {
      const r = await api('/groups/reassess', { method: 'POST', body: { group_id: b.dataset.reassess } });
      toast(`Asesmen ulang dibuka untuk ${r.murid} murid. Mereka mengerjakannya saat masuk berikutnya.`);
      pageGroups();
    } catch (ex) { fail(ex); }
  })));
  $$('[data-move]', view).forEach((s) => (s.onchange = async () => {
    try {
      await api('/groups/reassign', { method: 'POST', body: { student_code: s.dataset.move, group_id: s.value } });
      toast('Murid dipindahkan.');
      pageGroups();
    } catch (ex) { fail(ex); pageGroups(); }
  }));
  $('#newgroup').onclick = (e) => withBusy(e.currentTarget, async () => {
    try {
      await api('/groups', { method: 'POST', body: { level: Number($('#newlvl').value) } });
      toast('Kelompok baru dibuat.');
      pageGroups();
    } catch (ex) { fail(ex); }
  });
}

// ---------- MURID ----------
const KELAS = ['I', 'II', 'III', 'IV', 'V', 'VI'];
async function pageStudents() {
  const rows = (await api('/students')).sort((a, b) => (a.status === 'aktif') - (b.status === 'aktif'));
  const waiting = rows.filter((r) => r.status !== 'aktif');
  render(view, html`
    <div class="page-title row-between">
      <div><h1>Murid</h1><p>${rows.length} murid terdaftar · ${waiting.length} belum aktif. Nama hanya tersimpan di server sekolah ini.</p></div>
      <button class="btn btn-outline" id="cards">${icon('qr')}Cetak kartu QR</button>
    </div>

    <form class="panel" id="add" novalidate>
      <h2>Tambah murid</h2>
      <div class="inline-form" style="background:none;padding:0;margin-top:var(--s-3)">
        <div class="field"><label for="nm">Nama lengkap</label><input class="input" id="nm" autocomplete="off" required></div>
        <div class="field"><label for="kl">Kelas</label><select class="input" id="kl">${KELAS.map((k, i) => html`<option value="${i + 1}">Kelas ${k}</option>`)}</select></div>
        <button class="btn btn-primary">${icon('plus')}Tambah</button>
      </div>
      <p class="field-error" id="add-err" role="alert"></p>
      <p class="help" style="margin-top:6px">Murid baru bisa belajar setelah persetujuan tertulis orang tua atau wali dicatat dan kartunya diaktifkan.</p>
    </form>

    ${rows.length ? html`<div class="table-wrap block"><table>
      <thead><tr><th><input type="checkbox" id="pickall" aria-label="Pilih semua"></th><th>Nama</th><th>Kelas</th><th>Kode kartu</th><th>Status</th><th>Persetujuan orang tua</th><th></th></tr></thead>
      <tbody>${rows.map((r) => html`<tr data-code="${r.student_code}">
        <td><input type="checkbox" class="pick" value="${r.student_code}" aria-label="Pilih ${r.name}"></td>
        <td><strong>${r.name}</strong>${r.group_label ? html`<div class="xs muted">${r.group_label}</div>` : ''}</td>
        <td>${KELAS[r.class_grade - 1]}</td>
        <td><span class="code">${r.student_code}</span></td>
        <td>${r.status === 'aktif' ? html`<span class="badge badge-ok">Aktif</span>` : r.consent_at ? html`<span class="badge badge-flame">Siap diaktifkan</span>` : html`<span class="badge badge-warn">Menunggu persetujuan</span>`}</td>
        <td class="small" style="white-space:nowrap">${r.consent_at ? html`${tanggal(r.consent_at)} · ${r.giver_relation}<div class="xs muted">Formulir ${r.form_version}</div>` : html`<span class="muted">Belum ada</span>`}</td>
        <td style="text-align:right;white-space:nowrap">
          ${!r.consent_at ? html`<button class="btn btn-outline btn-sm" data-consent="${r.student_code}">Catat persetujuan</button>` : ''}
          ${r.consent_at && r.status !== 'aktif' ? html`<button class="btn btn-primary btn-sm" data-activate="${r.student_code}">Aktifkan</button>` : ''}
          <button class="btn btn-quiet btn-sm muted" data-withdraw="${r.student_code}" data-name="${r.name}">Tarik data</button>
        </td></tr>`)}</tbody></table></div>`
    : html`<div class="empty block"><h3>Belum ada murid</h3><p>Tambahkan murid dengan formulir di atas. Setelah itu cetak kartu QR untuk dibagikan.</p></div>`}
  `);

  $('#add').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#add-err');
    err.textContent = '';
    await withBusy(e.submitter, async () => {
      try {
        const r = await api('/students', { method: 'POST', body: { name: $('#nm').value, grade: Number($('#kl').value) } });
        toast(`${$('#nm').value.trim()} ditambahkan dengan kode ${r.student_code}.`);
        pageStudents();
      } catch (ex) {
        err.textContent = ex.message;
      }
    });
  };
  $('#pickall')?.addEventListener('change', (e) => $$('.pick', view).forEach((c) => (c.checked = e.target.checked)));
  $('#cards').onclick = () => {
    const codes = $$('.pick:checked', view).map((c) => c.value);
    window.open(`/kartu${codes.length ? `?kode=${codes.join(',')}` : ''}`, '_blank', 'noopener');
  };

  const rowAfter = (code) => view.querySelector(`tr[data-code="${code}"]`);
  const insertRow = (code, tpl) => {
    view.querySelector('tr.extra')?.remove();
    const tr = document.createElement('tr');
    tr.className = 'extra';
    tr.innerHTML = `<td colspan="7">${tpl.__raw}</td>`;
    rowAfter(code).after(tr);
    return tr;
  };

  $$('[data-consent]', view).forEach((b) => (b.onclick = () => {
    const code = b.dataset.consent;
    const tr = insertRow(code, html`<form class="inline-form" novalidate>
      <div class="field"><label>Tanggal tanda tangan</label><input class="input" type="date" name="tgl" value="${new Date().toISOString().slice(0, 10)}" max="${new Date().toISOString().slice(0, 10)}" required></div>
      <div class="field"><label>Versi formulir</label><input class="input" name="versi" value="PO-2026.1" required></div>
      <div class="field"><label>Ditandatangani oleh</label><select class="input" name="pemberi"><option>Ibu</option><option>Ayah</option><option>Wali</option></select></div>
      <div class="row"><button class="btn btn-primary">Simpan persetujuan</button><button type="button" class="btn btn-quiet" data-cancel>Batal</button></div>
      <p class="field-error" role="alert" style="grid-column:1/-1"></p>
    </form>`);
    const f = $('form', tr);
    $('[data-cancel]', tr).onclick = () => tr.remove();
    f.onsubmit = async (e) => {
      e.preventDefault();
      await withBusy(e.submitter, async () => {
        try {
          await api(`/students/${code}/consent`, { method: 'POST', body: { given_at: f.tgl.value, form_version: f.versi.value, giver_relation: f.pemberi.value } });
          toast('Persetujuan tercatat. Murid siap diaktifkan.');
          pageStudents();
        } catch (ex) {
          $('.field-error', tr).textContent = ex.message;
        }
      });
    };
  }));
  $$('[data-activate]', view).forEach((b) => (b.onclick = () => withBusy(b, async () => {
    try {
      await api(`/students/${b.dataset.activate}/activate`, { method: 'POST' });
      toast('Kartu aktif. Murid bisa masuk dan mengerjakan diagnostik.');
      pageStudents();
    } catch (ex) { fail(ex); }
  })));
  $$('[data-withdraw]', view).forEach((b) => (b.onclick = () => {
    const code = b.dataset.withdraw;
    const tr = insertRow(code, html`<div class="confirm">
      <p><strong>Tarik data ${b.dataset.name}?</strong> Nama dihapus dari server sekolah, kartu berhenti berfungsi, dan hasil belajarnya tidak dipakai lagi di laporan mana pun. Tindakan ini tidak bisa dibatalkan.</p>
      <div class="row"><button class="btn btn-danger" data-yes>Tarik data</button><button class="btn btn-outline" data-no>Batal</button></div></div>`);
    $('[data-no]', tr).onclick = () => tr.remove();
    $('[data-yes]', tr).onclick = (e) => withBusy(e.currentTarget, async () => {
      try {
        await api(`/students/${code}/withdraw`, { method: 'POST', body: { alasan: 'permintaan_ortu' } });
        toast('Data murid sudah ditarik.');
        pageStudents();
      } catch (ex) { fail(ex); }
    });
  }));
}

// ---------- KONTEN ----------
async function pageContent() {
  const [kat, guides] = await Promise.all([api('/konten'), api('/alat-peraga')]);
  const list = (items) => items.length
    ? html`<ul class="list">${items.map((k) => html`<li>${levelChip(k.level)}<div class="grow"><strong>${k.topik}</strong><div class="small muted">Fase ${k.fase} · ${k.elemen} · ${k.capaian}</div></div></li>`)}</ul>`
    : html`<div class="empty"><h3>Topik tidak ditemukan</h3><p>Coba kata lain, misalnya "pecahan", "kali", atau "fase B".</p></div>`;
  render(view, html`
    <div class="page-title row-between">
      <div><h1>Konten dan alat peraga</h1><p>Topik dipetakan ke Capaian Pembelajaran Kurikulum Merdeka fase A sampai C.</p></div>
      ${kat.kolibri_url ? html`<a class="btn btn-outline" href="${kat.kolibri_url}" target="_blank" rel="noopener">${icon('book')}Buka Kolibri</a>` : ''}
    </div>
    <div class="field" style="max-width:520px"><label for="q">Cari topik</label>
      <input class="input" id="q" type="search" placeholder="Contoh: pecahan, perkalian, fase B" autocomplete="off"></div>
    <div id="res" class="block" style="margin-top:var(--s-4)">${list(kat.hasil)}</div>
    <section class="block">
      <h2>Pustaka alat peraga</h2>
      <p class="muted" style="margin:4px 0 var(--s-3)">Aktivitas 20 menit dengan benda sekitar, dipakai di awal setiap sesi sesuai level kelompok.</p>
      <div class="stack-sm">${guides.map((g) => html`
        <details class="disclosure panel guide"><summary>${icon('chev', 'chev')}${levelChip(g.level)} ${g.judul}</summary>
          <div class="bahan">${g.bahan.map((b) => html`<span class="badge badge-flame">${b}</span>`)}</div>
          <ol>${g.langkah.map((l) => html`<li>${l}</li>`)}</ol>
          <p class="small" style="margin-top:var(--s-3)"><strong>Tanda berhasil:</strong> ${g.tanda}</p>
        </details>`)}</div>
    </section>`);
  let t;
  $('#q').oninput = (e) => {
    clearTimeout(t);
    t = setTimeout(async () => {
      try {
        const r = await api(`/konten?q=${encodeURIComponent(e.target.value)}`);
        render($('#res'), list(r.hasil));
      } catch (ex) { fail(ex); }
    }, 200);
  };
}

// ---------- PERANGKAT ----------
async function pageDevice() {
  const [st, tel, hist] = await Promise.all([api('/device/status'), api('/device/telemetry?jam=72'), api(`/device/${info.device_id}/history`)]);
  const isGuru = me.role !== 'relawan';
  render(view, html`
    <div class="page-title row-between">
      <div><h1>Kotak ${st.device_id}</h1><p>Dipasang ${tanggal(hist.dipasang)} · perangkat lunak ${hist.versi_perangkat_lunak} · firmware ${hist.versi_firmware}</p></div>
      <div class="row">
        <a class="btn btn-outline" href="/perangkat/${st.device_id}">${icon('wrench')}Lapor kerusakan</a>
        <a class="btn btn-quiet" href="/kartu?perangkat=1" target="_blank" rel="noopener">${icon('qr')}Cetak label QR kotak</a>
      </div>
    </div>
    ${alertNotices(st)}
    ${statusStrip(st)}
    <div class="grid-2 block">
      <div class="chart-box"><h3>Baterai, 72 jam terakhir</h3>${raw(lineChart(tel.map((t) => ({ t: t.ts, v: t.battery_pct })), { min: 0, max: 100, unit: '%', label: 'Persentase baterai 72 jam terakhir', fmt: (v) => `${v}%`, thresholds: [{ v: 30, label: 'waspada 30%' }, { v: 15, label: 'kritis 15%', color: 'var(--bad)' }] }))}</div>
      <div class="chart-box"><h3>Suhu kotak, 72 jam terakhir</h3>${raw(lineChart(tel.map((t) => ({ t: t.ts, v: t.temp })), { min: 20, max: 50, unit: ' °C', color: 'var(--flame-ink)', label: 'Suhu kotak 72 jam terakhir', fmt: (v) => `${v}°`, thresholds: [{ v: 40, label: 'waspada 40 °C' }] }))}</div>
    </div>
    <p class="small muted" style="margin-top:6px">Ambang peringatan adalah asumsi rancangan dan dikalibrasi di laboratorium sebelum pilot.</p>

    <section class="block">
      <h2>Riwayat laporan kerusakan</h2>
      ${hist.laporan.length ? html`<ul class="list" style="margin-top:var(--s-3)">${hist.laporan.map((r) => html`<li>
        <span class="badge ${r.status === 'selesai' ? 'badge-ok' : 'badge-warn'}">${r.status === 'selesai' ? 'Selesai' : 'Terbuka'}</span>
        <div class="grow"><strong>${r.description}</strong><div class="small muted">${tanggal(r.created_at, { jam: true })}${r.resolution ? ` · ${r.resolution}` : ''}</div></div>
        ${r.ada_foto ? html`<a class="btn btn-quiet btn-sm" href="/device/reports/${r.report_id}/photo" target="_blank" rel="noopener">${icon('camera')}Foto</a>` : ''}
        ${r.status !== 'selesai' ? html`<button class="btn btn-outline btn-sm" data-resolve="${r.report_id}">Tandai selesai</button>` : ''}
      </li>`)}</ul>` : html`<p class="muted" style="margin-top:6px">Belum ada laporan kerusakan untuk kotak ini.</p>`}
    </section>

    ${isGuru ? html`<section class="block panel-soft">
      <h2>Sinkron ke pusat</h2>
      <p style="margin-top:6px">${angka(st.sinkron.belum_terkirim)} catatan belum terkirim. Pengiriman terakhir: ${st.sinkron.terakhir ? `${tanggal(st.sinkron.terakhir.at, { jam: true })} lewat ${st.sinkron.terakhir.via}` : 'belum pernah'}.</p>
      <p class="small muted" style="margin-top:4px">Server mencoba mengirim sendiri tiap 10 menit bila ada sinyal. Tanpa sinyal, relawan membawa data lewat ponselnya.</p>
      <div class="row" style="margin-top:var(--s-3)"><button class="btn btn-primary" id="push">${icon('upload')}Kirim sekarang</button><span id="push-msg" class="small" role="status"></span></div>
    </section>` : ''}
  `);
  $$('[data-resolve]', view).forEach((b) => (b.onclick = () => {
    const what = prompt('Apa yang sudah dilakukan? (contoh: kabel diganti)');
    if (what === null) return;
    withBusy(b, async () => {
      try {
        await api(`/device/reports/${b.dataset.resolve}/resolve`, { method: 'POST', body: { tindakan: what } });
        toast('Laporan ditandai selesai.');
        pageDevice();
      } catch (ex) { fail(ex); }
    });
  }));
  $('#push')?.addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    try {
      const r = await api('/sync/now', { method: 'POST' });
      $('#push-msg').textContent = r.ok ? `${angka(r.terkirim)} catatan terkirim ke pusat.` : `${r.alasan} Data tetap aman di server sekolah.`;
      if (r.ok) setTimeout(pageDevice, 1200);
    } catch (ex) { fail(ex); }
  }));
}

// ---------- BAWA DATA (relawan sebagai pembawa paket) ----------
const idb = {
  db: null,
  async open() {
    if (this.db) return this.db;
    this.db = await new Promise((res, rej) => {
      const r = indexedDB.open('lentera-relawan', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return this.db;
  },
  async get(k) {
    const db = await this.open();
    return new Promise((res) => {
      const r = db.transaction('kv').objectStore('kv').get(k);
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(undefined);
    });
  },
  async set(k, v) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('kv', 'readwrite');
      v === undefined ? t.objectStore('kv').delete(k) : t.objectStore('kv').put(v, k);
      t.oncomplete = res;
      t.onerror = () => rej(t.error);
    });
  },
};

async function pageCarrier() {
  const bag = (await idb.get('paket')) || null;
  const receipt = (await idb.get('tanda_terima')) || null;
  let pending = null;
  try { pending = await api('/sync/status'); } catch {}
  const step = !bag ? 1 : !receipt ? 2 : 3;
  const cls = (n) => (n < step ? 'step done' : n === step ? 'step active' : 'step');
  render(view, html`
    <div class="page-title">
      <h1>Bawa data ke pusat</h1>
      <p>Sekolah ini tanpa sinyal. Ponselmu membawa paket terenkripsi dari server sekolah ke pusat, lalu membawa tanda terimanya kembali.</p>
    </div>
    <ol class="steps">
      <li class="${cls(1)}"><div>
        <h3>Ambil paket di sekolah</h3>
        <p>${pending ? `${angka(pending.belum_terkirim)} catatan menunggu dikirim.` : 'Sambungkan ponsel ke Wi-Fi sekolah untuk melihat jumlah catatan.'} Paket terkunci; isinya tidak bisa dibaca di ponsel.</p>
        ${bag ? html`<p class="small" style="margin-top:6px">${icon('check')} Paket ${angka(bag.jumlah)} catatan dari ${bag.sekolah}, diambil ${tanggal(bag.diambil, { jam: true })}.</p>` : ''}
        <div class="row"><button class="btn ${step === 1 ? 'btn-primary' : 'btn-outline'}" id="take">${icon('download')}${bag ? 'Ambil ulang paket' : 'Ambil paket'}</button></div>
      </div></li>
      <li class="${cls(2)}"><div>
        <h3>Kirim ke pusat saat ada sinyal</h3>
        <p>Buka halaman ini lagi begitu ponsel dapat internet, lalu tekan tombol di bawah. Mengirim dua kali tidak membuat data ganda.</p>
        ${bag ? html`<p class="small muted" style="margin-top:6px">Tujuan: ${bag.pusat_url || 'alamat pusat belum diatur'}</p>` : ''}
        <div class="row"><button class="btn ${step === 2 ? 'btn-primary' : 'btn-outline'}" id="send" ${bag ? '' : raw('disabled')}>${icon('upload')}Kirim ke pusat</button><span class="small" id="send-msg" role="status"></span></div>
      </div></li>
      <li class="${cls(3)}"><div>
        <h3>Serahkan tanda terima ke server sekolah</h3>
        <p>Pada kunjungan berikutnya, sambungkan ke Wi-Fi sekolah. Server menandai catatan yang sudah sampai dan memasang pembaruan dari pusat.</p>
        ${receipt ? html`<p class="small" style="margin-top:6px">${icon('check')} Pusat menerima ${angka(receipt.acked_event_ids.length)} catatan (${angka(receipt.baru)} baru) pada ${tanggal(receipt.received_at, { jam: true })}.</p>` : ''}
        <div class="row"><button class="btn ${step === 3 ? 'btn-primary' : 'btn-outline'}" id="ack" ${receipt ? '' : raw('disabled')}>${icon('check')}Serahkan tanda terima</button></div>
      </div></li>
    </ol>
  `);
  $('#take').onclick = (e) => withBusy(e.currentTarget, async () => {
    try {
      const r = await api('/sync/paket');
      if (!r.jumlah) return toast('Semua catatan sudah terkirim. Tidak ada yang perlu dibawa.');
      await idb.set('paket', { packet: r.packet, jumlah: r.jumlah, pusat_url: r.pusat_url, sekolah: r.sekolah, since: r.since, diambil: new Date().toISOString() });
      await idb.set('tanda_terima', undefined);
      toast(`Paket ${r.jumlah} catatan tersimpan di ponsel.`);
      pageCarrier();
    } catch (ex) { fail(ex); }
  });
  $('#send').onclick = (e) => withBusy(e.currentTarget, async () => {
    const msg = $('#send-msg');
    try {
      const b = await idb.get('paket');
      const rc = await api('/sync/upload', { method: 'POST', base: b.pusat_url, body: { packet: b.packet, via: 'relawan', since: b.since }, timeout: 60000 });
      await idb.set('tanda_terima', rc);
      toast('Pusat sudah menerima paket.');
      pageCarrier();
    } catch (ex) {
      msg.textContent = ex.network ? 'Pusat belum terjangkau. Pastikan ponsel dapat internet, lalu coba lagi.' : ex.message;
    }
  });
  $('#ack').onclick = (e) => withBusy(e.currentTarget, async () => {
    try {
      const rc = await idb.get('tanda_terima');
      const r = await api('/sync/ack', { method: 'POST', body: { receipt: rc } });
      await idb.set('paket', undefined);
      await idb.set('tanda_terima', undefined);
      toast(`${r.ditandai} catatan ditandai terkirim${r.pembaruan ? `, ${r.pembaruan} pembaruan dipasang` : ''}.`);
      pageCarrier();
    } catch (ex) { fail(ex); }
  });
}

// ---------- mulai ----------
(async () => {
  try {
    [me, info] = await Promise.all([api('/auth/me'), api('/api/info')]);
  } catch (e) {
    return location.replace('/#staf');
  }
  if (me.role === 'murid') return location.replace('/murid');
  if (APP === 'guru' && me.role === 'relawan') return location.replace('/relawan' + location.hash);
  render($('#brand'), html`${BRAND_MARK}<span>LENTERA<small>${info.sekolah}</small></span>`);
  $('#who').textContent = `${me.name} · ${me.role}`;
  outbox.flush().catch(() => {});
  route();
  if (APP === 'relawan' && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
