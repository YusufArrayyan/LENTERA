// Titik mulai di Render (atau layanan cloud serupa).
// Pakai: node scripts/render-start.js pusat|sekolah
//
// - Menyiapkan data demo bila belum ada. Kunci diturunkan dari LENTERA_SECRET sehingga
//   layanan pusat dan sekolah yang berjalan terpisah tetap saling cocok.
// - Layanan sekolah demo menjalankan simulator modul IoT di dalam proses (DEMO_IOT=1),
//   karena di cloud tidak ada ESP32.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const role = process.argv[2];
if (!['pusat', 'sekolah'].includes(role)) {
  console.error('Pakai: node scripts/render-start.js pusat|sekolah');
  process.exit(1);
}
if (!process.env.LENTERA_SECRET) {
  console.error('LENTERA_SECRET belum diisi. Layanan pusat dan sekolah membutuhkan rahasia yang sama.');
  process.exit(1);
}

const DATA = path.resolve(process.env.LENTERA_DATA_ROOT || (fs.existsSync('/var/data') ? '/var/data' : path.join(root, 'data')));
const env = { ...process.env, LENTERA_DATA_ROOT: DATA };
const node = (args) => execFileSync(process.execPath, ['--no-warnings', ...args], { cwd: root, env, stdio: 'inherit' });

if (!fs.existsSync(path.join(DATA, 'pusat', 'config.json'))) {
  console.log(`Menyiapkan data demo di ${DATA}…`);
  node(['scripts/provision.js']);
  node(['scripts/seed.js']);
}

let child;
if (role === 'pusat') {
  child = spawn(process.execPath, ['--no-warnings', 'pusat/server.js'], { cwd: root, env: { ...env, LENTERA_PUSAT_DATA: path.join(DATA, 'pusat') }, stdio: 'inherit' });
} else {
  const cfgFile = path.join(DATA, 'sekolah', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  const url = (process.env.PUSAT_URL || '').replace(/\/+$/, '');
  if (url && cfg.pusat.url !== url) {
    cfg.pusat.url = url;
    fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  }
  child = spawn(process.execPath, ['--no-warnings', 'sekolah/server.js'], { cwd: root, env: { ...env, LENTERA_DATA: path.join(DATA, 'sekolah') }, stdio: 'inherit' });

  if (process.env.DEMO_IOT !== '0') {
    const port = process.env.PORT || 8080;
    const menit = Number(process.env.DEMO_IOT_MENIT) || 5;
    let batt = 72;
    const kirim = async () => {
      const jam = new Date(Date.now() + (cfg.school.tz_offset_min ?? 480) * 60000).getUTCHours();
      const siang = jam >= 8 && jam <= 15;
      batt = Math.max(35, Math.min(98, batt + (siang ? 1.2 : -0.6) + (Math.random() - 0.5)));
      const body = {
        event_id: crypto.randomUUID(),
        module_id: `${cfg.device_id}-IOT`,
        voltage: Math.round((12 + (batt / 100) * 1.4) * 100) / 100,
        current: Math.round((0.95 + Math.random() * 0.3) * 100) / 100,
        temp: Math.round((28 + (siang ? 5 : 0) + Math.random() * 1.5) * 10) / 10,
        humidity: Math.round(60 + Math.random() * 15),
        power_source: siang ? 'plts' : 'baterai',
      };
      try {
        await fetch(`http://127.0.0.1:${port}/ingest/telemetry`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lentera-Key': cfg.iot_key }, body: JSON.stringify(body) });
      } catch {}
    };
    setTimeout(kirim, 8000);
    setInterval(kirim, menit * 60000);
    console.log(`Simulator modul IoT demo aktif, kirim tiap ${menit} menit.`);
  }
}

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { child.kill(sig); process.exit(0); });
child.on('exit', (code) => process.exit(code ?? 1));
