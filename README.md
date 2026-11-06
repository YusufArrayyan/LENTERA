# LENTERA

Server belajar numerasi untuk SD tanpa internet, dengan modul pemantau IoT, sinkronisasi simpan-lalu-teruskan, dan dasbor pusat. Dibangun dari [PRD_LENTERA.md](PRD_LENTERA.md) versi 1.0.

Tidak ada dependensi npm. Cukup Node.js 22.13 atau lebih baru (memakai SQLite dan kriptografi bawaan Node), sehingga kotak server bisa dipasang tanpa internet.

## Menjalankan

```bash
npm run siapkan
```

Perintah ini membuat kunci pusat dan kunci tiap kotak, lalu mengisi data contoh enam pekan untuk lima sekolah pilot. Akun demo tercatat di `data/AKUN-DEMO.txt`. Untuk mengulang dari nol: `node scripts/provision.js --ulang && node scripts/seed.js`.

Jalankan tiap layanan di terminal terpisah:

```bash
npm run pusat
```

```bash
npm run sekolah
```

```bash
node iot/simulator.js --cepat
```

- Server sekolah: http://localhost:8080 (murid, guru, relawan)
- Dasbor pusat: http://localhost:9090 (koordinator, dinas)

Simulator punya skenario `--skenario panas` dan `--skenario baterai` untuk memicu peringatan.

```bash
npm test
```

## Isi sistem

| Bagian | Berkas | Kebutuhan PRD |
|---|---|---|
| Log kejadian hanya-tambah, proyeksi, aturan domain | `sekolah/core.js`, `sekolah/db.js` | F-2.3, F-4.2, NF-3 |
| Bank butir, diagnostik, latihan adaptif, katalog, alat peraga | `shared/numerasi.js` | F-1.3 sampai F-1.9 |
| API server sekolah | `sekolah/server.js` | Bagian 10 |
| Paket terenkripsi dan bertanda tangan | `shared/packet.js`, `sekolah/sync.js` | F-3.1, F-3.2, NF-8 |
| Penggabungan idempoten di pusat | `pusat/ingest.js` | F-3.3 |
| Metrik dasbor | `pusat/metrics.js` | F-3.4, F-3.5, bagian 13 |
| Antarmuka murid, guru, relawan (PWA), laporan kotak via QR | `sekolah/public/` | US-1 sampai US-4, F-2.5 |
| Dasbor pusat | `pusat/public/` | US-5, US-6, F-3.6 sampai F-3.8 |
| Simulator, jembatan MQTT, firmware ESP32 | `iot/` | F-2.1, F-2.2, F-2.4, F-2.7 |
| Uji otomatis | `test/` | Bagian 13 |

## Cara kerja sinkronisasi

1. Setiap tindakan ditulis sebagai kejadian ber-UUID dengan nomor urut monoton. Pemicu SQLite menolak `DELETE` dan `UPDATE` pada log.
2. Server sekolah membungkus kejadian yang belum di-ack: JSON, gzip, AES-256-GCM dengan kunci sinkron kotak, lalu ditandatangani Ed25519 dengan kunci privat kotak.
3. Pusat memverifikasi tanda tangan, membuka paket, dan menyisipkan kejadian dengan `INSERT OR IGNORE`. Paket terpotong atau diubah ditolak utuh.
4. Pusat membalas tanda terima yang ditandatangani kunci pusat, berisi daftar `event_id` dan pembaruan yang menunggu. Ponsel relawan tidak bisa memalsukan tanda terima.
5. Jalur otomatis dicoba tiap 10 menit bila ada sinyal. Tanpa sinyal, relawan memakai halaman "Bawa data" di ponselnya.

## Privasi

- Nama murid ada di tabel `student_identity` yang tidak pernah masuk log kejadian. Pusat hanya menerima kode acak.
- Murid tidak bisa diaktifkan sebelum persetujuan orang tua tercatat.
- Akun dinas hanya menerima angka gabungan per sekolah. `test/privasi.test.js` memeriksa bahwa tidak ada kode atau nama murid di respons dasbor.
- Penarikan data menghapus nama dari server sekolah, dan hasil belajar murid itu dikeluarkan dari semua agregat.

## Yang perlu disiapkan sebelum pilot

- **HTTPS lokal (NF-8).** Isi `TLS_CERT` dan `TLS_KEY` dengan sertifikat lokal. Service worker PWA relawan hanya aktif di HTTPS atau localhost.
- **Kolibri.** Tidak dibundel. Pasang terpisah di kotak, lalu isi `kolibri_url` di `data/sekolah/config.json`.
- **MQTT.** Server menerima telemetri lewat HTTP. Untuk Mosquitto: `mosquitto_sub -t 'lentera/+/telemetry' | node iot/mqtt-bridge.js`.
- **Pemindaian QR** memakai `BarcodeDetector` bawaan Chrome Android. Di peramban lain murid mengetik kode kartu.
- **Ambang dan kalibrasi.** Ambang baterai, suhu, dan tingkat kesulitan butir diagnostik adalah asumsi rancangan. Kalibrasi di laboratorium.
- **Notifikasi 72 jam (F-3.8)** tercatat di dasbor. Isi `NOTIFY_WEBHOOK` agar diteruskan ke surel atau WhatsApp lewat layanan perantara.
- Ganti semua akun demo dan kata sandi Wi-Fi.

Data contoh, nama sekolah, dan nama murid dalam `npm run siapkan` adalah fiktif.
