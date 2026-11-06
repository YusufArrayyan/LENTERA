// Jembatan MQTT -> HTTP. Mosquitto menerima pesan dari ESP32 di topik
// lentera/{device_id}/telemetry; jembatan ini meneruskannya ke layanan LENTERA.
//
// Pakai di server sekolah:
//   mosquitto_sub -h localhost -t 'lentera/+/telemetry' | node iot/mqtt-bridge.js
//
// Setiap baris masukan berisi satu JSON pembacaan (sama dengan format HTTP).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(process.env.LENTERA_DATA || path.join(root, 'data', 'sekolah'), 'config.json'), 'utf8'));
const SERVER = process.env.SERVER_URL || 'http://localhost:8080';

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  let body;
  try {
    body = JSON.parse(line);
  } catch {
    console.error('Baris bukan JSON, dilewati:', line.slice(0, 80));
    return;
  }
  try {
    const res = await fetch(`${SERVER}/ingest/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lentera-Key': cfg.iot_key },
      body: JSON.stringify(body),
    });
    const out = await res.json();
    // Balas status lampu lewat topik terpisah bila mosquitto_pub tersedia (opsional).
    console.log(JSON.stringify({ topic: `lentera/${cfg.device_id}/lampu`, lampu: out.lampu }));
  } catch (e) {
    console.error('Gagal meneruskan pembacaan:', e.message);
  }
});
