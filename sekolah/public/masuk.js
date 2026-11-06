import { $, api, render, html, icon, BRAND_MARK, withBusy } from '/ui/app.js';
import { scanSupported, scanQR } from '/ui/scan.js';

render($('#brand'), html`${BRAND_MARK}<span>LENTERA<small>Belajar numerasi tanpa internet</small></span>`);

api('/api/info').then((info) => {
  $('#school').textContent = info.sekolah;
  document.title = `Masuk · ${info.sekolah}`;
  render($('#facts'), html`
    <div>${icon('wifi')}<span>Wi-Fi <strong>${info.wifi || 'sekolah'}</strong></span></div>
    <div>${icon('server')}<span>Kotak <strong>${info.device_id}</strong></span></div>`);
}).catch(() => {});

// Sudah masuk? langsung arahkan.
api('/auth/me').then((me) => {
  location.replace(me.role === 'murid' ? '/murid' : me.role === 'relawan' ? '/relawan' : '/guru');
}).catch(() => {});

function selectTab(which) {
  const murid = which === 'murid';
  $('#tab-murid').setAttribute('aria-selected', murid);
  $('#tab-staf').setAttribute('aria-selected', !murid);
  $('#form-murid').hidden = !murid;
  $('#form-staf').hidden = murid;
  (murid ? $('#kode') : $('#username')).focus();
}
$('#tab-murid').onclick = () => selectTab('murid');
$('#tab-staf').onclick = () => selectTab('staf');
if (location.hash === '#staf') selectTab('staf');

const kode = $('#kode');
kode.addEventListener('input', () => {
  let v = kode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (v.length > 3) v = `${v.slice(0, 3)}-${v.slice(3)}`;
  kode.value = v;
  kode.removeAttribute('aria-invalid');
  $('#kode-err').textContent = '';
});

async function loginMurid(code, btn) {
  const err = $('#kode-err');
  if (code.replace('-', '').length !== 6) {
    kode.setAttribute('aria-invalid', 'true');
    err.textContent = 'Kode terdiri dari 6 huruf dan angka. Cek lagi kartumu.';
    kode.focus();
    return;
  }
  await withBusy(btn, async () => {
    try {
      const r = await api('/auth/login', { method: 'POST', body: { kode: code } });
      location.href = r.ke;
    } catch (e) {
      kode.setAttribute('aria-invalid', 'true');
      err.textContent = e.message;
    }
  });
}

$('#form-murid').addEventListener('submit', (e) => {
  e.preventDefault();
  loginMurid(kode.value, e.submitter);
});

if (scanSupported()) {
  const b = $('#scan');
  render(b, html`${icon('qr')} Pindai kartu`);
  b.hidden = false;
  $('#or').hidden = false;
  b.onclick = async () => {
    const v = await scanQR({ title: 'Arahkan kamera ke kartumu' });
    if (!v) return;
    const m = /([A-Z0-9]{3})-?([A-Z0-9]{3})\s*$/i.exec(v);
    if (!m) {
      $('#kode-err').textContent = 'Kode QR ini bukan kartu LENTERA.';
      return;
    }
    kode.value = `${m[1]}-${m[2]}`.toUpperCase();
    loginMurid(kode.value, b);
  };
}

$('#form-staf').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#staf-err');
  err.textContent = '';
  const username = $('#username').value.trim();
  const password = $('#password').value;
  if (!username || !password) {
    err.textContent = 'Isi nama pengguna dan kata sandi.';
    return;
  }
  await withBusy(e.submitter, async () => {
    try {
      const r = await api('/auth/login', { method: 'POST', body: { username, password } });
      location.href = r.ke;
    } catch (ex) {
      err.textContent = ex.message;
      $('#password').select();
    }
  });
});
