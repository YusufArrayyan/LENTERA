// Simulator modul IoT (pengganti ESP32 saat uji tanpa perangkat keras).
// Mengirim pembacaan ke POST /ingest/telemetry dan mencetak warna lampu indikator.
//
// Pakai:
//   node iot/simulator.js                    kirim tiap 5 menit (sesuai F-2.2)
//   node iot/simulator.js --cepat            kirim tiap 5 detik untuk demo
//   node iot/simulator.js --skenario panas   suhu naik sampai melewati ambang
//   node iot/simulator.js --skenario baterai baterai turun cepat
//   node iot/simulator.js --sekali           kirim satu pembacaan lalu keluar
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);

const cfg = JSON.parse(fs.readFileSync(path.join(process.env.LENTERA_DATA || path.join(root, 'data', 'sekolah'), 'config.json'), 'utf8'));
const URL_SERVER = opt('--server', process.env.SERVER_URL || 'http://localhost:8080');
const intervalMs = flag('--cepat') ? 5000 : Number(opt('--detik', 300)) * 1000;
const scenario = opt('--skenario', 'normal');

let battery = scenario === 'baterai' ? 40 : 78;
let temp = scenario === 'panas' ? 36 : 29;
let t = 0;

function reading() {
  t++;
  const sun = Math.max(0, Math.sin((new Date().getHours() - 6) / 12 * Math.PI));
  if (scenario === 'baterai') battery = Math.max(3, battery - 2.5);
  else battery = Math.max(5, Math.min(100, battery + (sun > 0.3 ? 0.4 : -0.3) + (Math.random() - 0.5) * 0.4));
  if (scenario === 'panas') temp = Math.min(48, temp + 0.8);
  else temp = 27 + sun * 6 + (Math.random() - 0.5);
  return {
    event_id: crypto.randomUUID(),
    module_id: `${cfg.device_id}-IOT`,
    voltage: Math.round((12.0 + (battery / 100) * 1.4) * 100) / 100,
    current: Math.round((0.95 + Math.random() * 0.3) * 100) / 100,
    temp: Math.round(temp * 10) / 10,
    humidity: Math.round(60 + Math.random() * 15),
    power_source: sun > 0.3 && scenario !== 'baterai' ? 'plts' : 'baterai',
    measured_at: new Date().toISOString(),
  };
}

async function send() {
  const r = reading();
  try {
    const res = await fetch(`${URL_SERVER}/ingest/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lentera-Key': cfg.iot_key },
      body: JSON.stringify(r),
    });
    const out = await res.json();
    const lamp = { hijau: '\x1b[32m●\x1b[0m', kuning: '\x1b[33m●\x1b[0m', merah: '\x1b[31m●\x1b[0m' }[out.lampu] || '○';
    console.log(`${new Date().toLocaleTimeString('id-ID')} ${lamp} ${r.voltage} V · ${r.temp} °C · ${r.humidity}% · ${r.power_source}${out.peringatan?.length ? '  ' + out.peringatan.map((p) => p.pesan).join(' | ') : ''}`);
  } catch (e) {
    // Firmware asli menyimpan pembacaan di memori dan mengirim ulang; simulator cukup mencatat.
    console.log(`${new Date().toLocaleTimeString('id-ID')} ○ server tidak terjangkau, pembacaan dibuang (${e.cause?.code || e.message})`);
  }
}

console.log(`Simulator modul IoT ${cfg.device_id} → ${URL_SERVER} tiap ${intervalMs / 1000} detik (skenario: ${scenario})`);
await send();
if (!flag('--sekali')) setInterval(send, intervalMs);
