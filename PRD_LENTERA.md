# PRD LENTERA: Sistem Server Belajar Luring dengan Pemantauan IoT

| Item | Isi |
|---|---|
| Versi | 1.0 (draf untuk pilot) |
| Tanggal | 6 November 2026 |
| Pemilik produk | [isi nama tim] |
| Status | Draf. Seluruh angka ambang dan biaya adalah asumsi rancangan yang harus dikalibrasi pada uji laboratorium dan pilot |
| Dokumen terkait | Esai LENTERA (Lomba Esai Nasional Fision Forsei 2026) |

---

## 1. Ringkasan

LENTERA (Layanan Edukasi Numerasi Terpadu Elektronik berbasis Relawan Adaptif) adalah sistem belajar numerasi untuk murid SD di sekolah tanpa internet. Sistem terdiri dari lima bagian:

1. **Kotak server**: komputer mini + SSD + titik akses Wi-Fi, menjalankan Kolibri dan konten numerasi.
2. **Modul IoT**: mikrokontroler (mis. ESP32) pembaca sensor daya, suhu, kelembapan, dan waktu aktif.
3. **Perangkat murid dan guru**: tablet murah dan ponsel guru yang membuka materi lewat peramban pada jaringan lokal.
4. **Mesin sinkronisasi**: pola simpan lalu teruskan (*store-and-forward*) berbasis log kejadian yang hanya bisa ditambah.
5. **Dasbor**: aplikasi web untuk perguruan tinggi dan dinas pendidikan (data agregat dan status perangkat).

Siklus belajar: diagnostik → pengelompokan menurut level → dua sesi 60 menit per pekan → asesmen ulang tiap empat pekan.

## 2. Latar belakang dan masalah

- Hanya 59,45% murid SD mencapai kompetensi minimum numerasi (Rapor Pendidikan 2025, dikutip GEBRAK, 2026).
- 10.692 sekolah 3T belum berinternet dan 5.758 belum berlistrik (Kemendikdasmen, dikutip Investortrust, 2025).
- Platform luring tanpa pelatihan dan pendampingan tidak berdampak (evaluasi Honduras; Barrera-Osorio & Zoido, n.d.).
- Sekolah tanpa internet biasanya tanpa teknisi, sehingga server yang mati tidak diketahui berbulan-bulan.

## 3. Tujuan dan non-tujuan

### 3.1 Tujuan produk

| ID | Tujuan | Ukuran | Ambang pilot |
|---|---|---|---|
| G1 | Meningkatkan numerasi murid | Kenaikan skor vs kelompok pembanding | ≥ 0,18 simpangan baku |
| G2 | Sistem benar-benar dipakai | Sesi terjadwal yang terlaksana (dari log) | ≥ 80% |
| G3 | Server andal | Waktu aktif pada jam sekolah (dari telemetri) | ≥ 90% |
| G4 | Mudah dipakai guru | Skor SUS | ≥ 68 |
| G5 | Relawan konsisten | Kehadiran relawan (dari log sesi) | ≥ 85% |

### 3.2 Non-tujuan (versi 1.0)

- Tidak menggantikan guru dan tidak menyediakan pembelajaran mandiri penuh tanpa fasilitator.
- Tidak mencakup mata pelajaran selain numerasi.
- Tidak menyediakan pengenalan wajah, biometrik, atau kamera.
- Tidak membutuhkan internet untuk fungsi belajar. Internet hanya dipakai untuk sinkronisasi opsional.
- Tidak menyediakan aplikasi seluler asli; seluruh akses melalui peramban.

## 4. Pengguna dan persona

| Persona | Deskripsi | Kebutuhan utama |
|---|---|---|
| **Murid** (kelas I–VI) | Belajar di tablet, literasi digital rendah | Antarmuka sederhana, ikon besar, latihan sesuai level, umpan balik cepat |
| **Guru kelas** | Penanggung jawab pembelajaran, ponsel pribadi, percaya diri digital rendah | Satu halaman, status server jelas, laporan kelompok yang mudah dibaca |
| **Relawan mahasiswa** | Fasilitator sesi, membawa ponsel berkuota | Jadwal sesi, daftar hadir, pemindaian QR, sinkronisasi saat berkunjung |
| **Koordinator kampus** | Mengelola konten dan relawan | Dasbor lintas sekolah, kurasi konten, pembaruan jarak jauh |
| **Petugas dinas pendidikan** | Memantau dan memutuskan perluasan | Data agregat anonim, status perangkat, laporan semester |
| **Orang tua** | Memberi persetujuan data | Penjelasan sederhana, formulir persetujuan tertulis |

## 5. Lingkup dan fitur (kebutuhan fungsional)

Prioritas: **P0** wajib untuk pilot, **P1** diinginkan, **P2** setelah pilot.

### 5.1 Pembelajaran (server)

| ID | Kebutuhan | Prioritas |
|---|---|---|
| F-1.1 | Server memancarkan Wi-Fi lokal dengan SSID dan kata sandi per sekolah, tanpa memerlukan internet | P0 |
| F-1.2 | Murid masuk dengan kode anonim atau kartu QR, tanpa mengisi nama lengkap | P0 |
| F-1.3 | Asesmen diagnostik numerasi per fase (A, B, C) dengan butir terkalibrasi | P0 |
| F-1.4 | Pengelompokan otomatis menurut level hasil diagnostik, dengan penggantian manual oleh guru | P0 |
| F-1.5 | Latihan adaptif: tingkat kesulitan naik atau turun menurut jawaban | P0 |
| F-1.6 | Konten dipetakan ke capaian Kurikulum Merdeka fase A–C dan dapat dicari menurut topik | P0 |
| F-1.7 | Mode sesi: guru atau relawan memulai sesi, memilih kelompok, dan menutup sesi dengan catatan durasi | P0 |
| F-1.8 | Asesmen ulang terjadwal tiap empat pekan dan pembaruan kelompok | P0 |
| F-1.9 | Pustaka alat peraga (panduan 20 menit aktivitas konkret) dapat dibuka dari halaman sesi | P1 |
| F-1.10 | Ringkasan hasil belajar per kelompok untuk guru (dapat dicetak) | P1 |

### 5.2 Modul IoT dan pemantauan perangkat

| ID | Kebutuhan | Prioritas |
|---|---|---|
| F-2.1 | Modul membaca tegangan dan arus baterai, suhu, kelembapan, dan status daya (adaptor/PLTS) | P0 |
| F-2.2 | Modul mengirim pembacaan ke server tiap 5 menit melalui jaringan lokal (MQTT atau HTTP) | P0 |
| F-2.3 | Server menyimpan telemetri sebagai kejadian bernomor unik, bukan menimpa nilai lama | P0 |
| F-2.4 | Aturan peringatan lokal (lampu indikator dan banner di layar guru) saat baterai atau suhu melewati ambang | P0 |
| F-2.5 | Setiap kotak punya kode QR berisi ID perangkat; pemindaian membuka halaman laporan kerusakan dan riwayat perawatan | P0 |
| F-2.6 | Penghitung waktu aktif (*uptime*) dan deteksi kotak mati melalui ketiadaan detak (*heartbeat*) di dasbor | P0 |
| F-2.7 | Modul bersifat terpisah: kegagalan modul tidak menghentikan fungsi belajar | P0 |
| F-2.8 | Pembaruan firmware modul lewat sinkronisasi (OTA) dengan tanda tangan digital | P2 |

### 5.3 Sinkronisasi dan dasbor

| ID | Kebutuhan | Prioritas |
|---|---|---|
| F-3.1 | Server membuat paket sinkronisasi terenkripsi berisi kejadian yang belum terkirim | P0 |
| F-3.2 | Pengiriman otomatis saat ada koneksi, atau lewat ponsel relawan (aplikasi web terpasang sebagai PWA) sebagai pembawa data | P0 |
| F-3.3 | Penggabungan idempoten: kejadian dengan ID yang sama diabaikan, tidak terjadi konflik | P0 |
| F-3.4 | Dasbor menampilkan status tiap sekolah: terakhir sinkron, waktu aktif, baterai, sesi terlaksana, kehadiran relawan | P0 |
| F-3.5 | Dasbor dinas hanya menampilkan data agregat tingkat kelompok dan sekolah, tanpa identitas murid | P0 |
| F-3.6 | Distribusi pembaruan konten dan perangkat lunak dari dasbor ke server saat sinkronisasi dua arah | P1 |
| F-3.7 | Ekspor laporan semester (PDF/CSV) | P1 |
| F-3.8 | Notifikasi (surel/WhatsApp) ke koordinator saat kotak tidak aktif lebih dari 72 jam | P1 |

### 5.4 Administrasi dan privasi

| ID | Kebutuhan | Prioritas |
|---|---|---|
| F-4.1 | Peran dan hak akses: murid, guru, relawan, koordinator, dinas, admin sistem | P0 |
| F-4.2 | Tabel identitas murid dipisah dari tabel hasil belajar; keduanya dihubungkan hanya oleh kode anonim | P0 |
| F-4.3 | Pencatatan persetujuan orang tua (tanggal, versi formulir) sebelum murid diaktifkan | P0 |
| F-4.4 | Log audit untuk akses data oleh pengguna | P0 |
| F-4.5 | Penghapusan atau penarikan data murid atas permintaan orang tua | P1 |

## 6. Cerita pengguna (contoh) dan kriteria penerimaan

| ID | Sebagai | Saya ingin | Agar | Kriteria penerimaan |
|---|---|---|---|---|
| US-1 | Murid | masuk dengan kartu QR dan langsung melihat latihan sesuai levelku | belajar tanpa bingung | Dari memindai QR sampai soal pertama ≤ 15 detik di tablet uji |
| US-2 | Guru | melihat status server dalam satu halaman | tahu sistem siap dipakai | Halaman status memuat: server aktif, baterai, sesi hari ini; dimuat ≤ 3 detik |
| US-3 | Relawan | memulai sesi, mencatat hadir, dan menutup sesi | kehadiran dan durasi tercatat | Sesi tersimpan walau Wi-Fi putus di tengah sesi; data muncul di dasbor setelah sinkron |
| US-4 | Relawan | memindai QR di kotak yang rusak | melapor tanpa formulir | Laporan tercatat dengan ID perangkat, waktu, dan foto opsional; muncul di dasbor setelah sinkron |
| US-5 | Koordinator | melihat kotak yang tidak aktif lebih dari 72 jam | mengirim relawan atau teknisi | Dasbor menandai kotak merah berdasarkan detak terakhir |
| US-6 | Petugas dinas | melihat kenaikan skor per sekolah tanpa nama murid | memutuskan perluasan | Dasbor tidak memuat nama atau kode murid; ada uji otomatis yang memverifikasi hal ini |
| US-7 | Orang tua | memberi persetujuan tertulis | anakku boleh memakai sistem | Murid tanpa catatan persetujuan tidak dapat diaktifkan |

## 7. Kebutuhan nonfungsional

| ID | Kategori | Kebutuhan |
|---|---|---|
| NF-1 | Kinerja | Server melayani minimal 15 perangkat bersamaan (satu kelompok) dengan waktu muat halaman soal ≤ 2 detik |
| NF-2 | Ketersediaan | Waktu aktif ≥ 90% pada jam sekolah; boot sampai siap ≤ 3 menit setelah listrik kembali |
| NF-3 | Ketahanan data | Tidak ada kehilangan data saat listrik mati mendadak (sistem berkas jurnal, SSD, penulisan atomik) |
| NF-4 | Daya | Konsumsi kotak rata-rata ≤ 15 W; baterai/UPS menopang minimal 4 jam jam-sekolah (target kalibrasi) |
| NF-5 | Lingkungan | Casing tahan debu dan percikan; suhu operasi 10–40 °C; ventilasi pasif |
| NF-6 | Kegunaan | Skor SUS guru ≥ 68; semua teks Bahasa Indonesia; ikon besar untuk murid kelas rendah |
| NF-7 | Kompatibilitas | Peramban Chromium/Firefox terbaru dan satu versi lama; tablet Android RAM ≥ 2 GB |
| NF-8 | Keamanan | Wi-Fi WPA2/WPA3; HTTPS lokal dengan sertifikat lokal; paket sinkronisasi dienkripsi dan ditandatangani |
| NF-9 | Privasi | Sesuai UU 27/2022: persetujuan orang tua, minimisasi data, anonimisasi, pembatasan akses |
| NF-10 | Pemeliharaan | Pembaruan konten tanpa penggantian perangkat keras; pemulihan dari SSD cadangan ≤ 1 jam |
| NF-11 | Lisensi | Menggunakan perangkat lunak sumber terbuka; semua konten bebas hak atau berlisensi terbuka |

## 8. Arsitektur sistem

### 8.1 Gambaran logis

```
[Sekolah, tanpa internet]
 Tablet murid / ponsel guru --Wi-Fi lokal--> Titik akses --> Mini-PC server
                                                              |- Kolibri + konten numerasi
                                                              |- Layanan LENTERA (diagnostik, kelompok, sesi)
                                                              |- Basis data lokal + event log (append-only)
                                                              |- Broker MQTT lokal
 Modul IoT (ESP32) --MQTT/Wi-Fi--> Broker --> event log
 Sensor: tegangan/arus, suhu, kelembapan, status daya
 Kode QR pada casing (ID perangkat)

 --- saat ada sinyal atau ponsel relawan ---
 Server --paket terenkripsi (store-and-forward)--> Layanan sinkronisasi (cloud/kampus)
                                                     |- Penyimpanan event log pusat
                                                     |- Dasbor web (agregat, status perangkat)
                                                     |- Distribusi pembaruan konten
```

### 8.2 Komponen dan pilihan teknologi (usulan, dapat disesuaikan)

| Lapisan | Pilihan | Alasan |
|---|---|---|
| Sistem operasi server | Linux (Debian/Ubuntu Server) | Stabil, ringan, sumber terbuka |
| Platform belajar | Kolibri | Luring, sumber terbuka, berjalan pada perangkat murah (Learning Equality, n.d.) |
| Layanan LENTERA | Aplikasi web (Python/FastAPI atau Node) dengan SQLite/PostgreSQL lokal | Sederhana, minim sumber daya |
| Pesan IoT | Mosquitto (MQTT) | Ringan untuk mikrokontroler |
| Mikrokontroler | ESP32 dengan sensor INA219 (tegangan/arus), SHT31 atau DHT22 (suhu/kelembapan), RTC | Murah, banyak sumber referensi |
| Jaringan lokal | hostapd/dnsmasq pada mini-PC atau router murah | Tanpa ketergantungan layanan eksternal |
| Sinkronisasi | Kirim paket JSON terkompresi + enkripsi; ID kejadian UUID; PWA di ponsel relawan | Idempoten, tahan putus-sambung |
| Dasbor | Aplikasi web (React/Vue) + API; basis data PostgreSQL | Standar dan mudah dikelola kampus |
| Pengamanan | TLS lokal, tanda tangan paket, pembatasan peran | Memenuhi NF-8 |

### 8.3 Aliran data sinkronisasi

1. Setiap tindakan (jawaban murid, sesi dimulai, pembacaan sensor, laporan kerusakan) ditulis sebagai kejadian: `event_id (UUID)`, `device_id`, `jenis`, `waktu (UTC + penghitung monoton)`, `payload`.
2. Kejadian hanya ditambahkan; koreksi dibuat sebagai kejadian baru yang merujuk kejadian lama.
3. Saat ada koneksi, server mengirim kejadian yang belum bertanda *acked* dalam paket terenkripsi.
4. Layanan pusat menyisipkan kejadian dengan `event_id` yang belum ada (idempoten) lalu membalas daftar `event_id` yang diterima.
5. Server menandai kejadian tersebut *acked*. Pengiriman berulang tidak menimbulkan duplikasi.
6. Pembaruan konten dan konfigurasi mengalir arah sebaliknya, ditandatangani dan diverifikasi sebelum dipasang.

Catatan: pendekatan ini menjawab celah protokol penyelesaian konflik pada log pembelajaran saat tanpa koneksi yang dilaporkan Febrianty et al. (2026), tetapi kebenarannya harus diuji (lihat bagian 13).

## 9. Model data (ringkas)

| Entitas | Atribut utama |
|---|---|
| Sekolah | school_id, nama, kode wilayah, device_id |
| Perangkat (kotak) | device_id, serial, tanggal pasang, versi perangkat lunak, versi firmware |
| Murid (tabel identitas, dipisah) | student_code, nama, kelas, status persetujuan (diakses terbatas di server sekolah saja) |
| Hasil belajar | student_code, sesi, butir, jawaban, benar/salah, waktu |
| Kelompok | group_id, school_id, level, daftar student_code, siklus |
| Sesi | session_id, group_id, pemandu (user_id), mulai, selesai, jumlah murid selesai |
| Telemetri | event_id, device_id, tegangan, arus, suhu, kelembapan, sumber daya, waktu |
| Laporan kerusakan | report_id, device_id, pelapor, deskripsi, foto opsional, status |
| Pengguna | user_id, peran, sekolah, tanggal pelatihan |
| Persetujuan | student_code, tanggal, versi formulir, pemberi persetujuan |
| Kejadian (inti) | event_id, device_id, jenis, waktu, payload, status sinkron |

Aturan: tabel identitas murid tidak ikut dikirim ke dasbor pusat. Dasbor hanya menerima `student_code` yang tidak dapat dipetakan ke nama.

## 10. Antarmuka (API garis besar)

Layanan lokal (server sekolah):

- `POST /auth/login` (kode murid atau akun guru/relawan)
- `GET /student/{code}/next-activity`
- `POST /student/{code}/answers`
- `POST /sessions` dan `PATCH /sessions/{id}` (mulai dan tutup sesi)
- `GET /groups` dan `POST /groups/reassign`
- `GET /device/status`
- `POST /device/reports` (laporan kerusakan lewat QR)
- `POST /ingest/telemetry` (dipakai modul IoT; MQTT topik `lentera/{device_id}/telemetry`)

Layanan pusat:

- `POST /sync/upload` (paket terenkripsi) → `{acked_event_ids: []}`
- `GET /sync/download?since=` (pembaruan konten dan konfigurasi)
- `GET /dashboard/schools`, `GET /dashboard/schools/{id}/metrics`
- `GET /dashboard/devices/{id}/health`
- `GET /reports/semester?format=pdf|csv`

## 11. Spesifikasi perangkat keras (BOM, asumsi harga)

| Komponen | Spesifikasi | Perkiraan biaya (Rp) |
|---|---|---|
| Mini-PC + SSD | CPU x86/ARM hemat daya, RAM ≥ 4 GB, SSD ≥ 256 GB | 3.000.000 |
| Titik akses Wi-Fi | Mendukung ≥ 20 klien | 600.000 |
| Daya (sekolah tanpa listrik) | PLTS mini + baterai | 4.000.000 |
| Tablet murid | 6 unit, @ 1.200.000 | 7.200.000 |
| Modul IoT | ESP32, INA219, sensor suhu/kelembapan, RTC | 750.000 |
| Perlengkapan | Kabel, casing, label QR | 400.000 |
| **Subtotal perangkat** | | **15.950.000** |

Seluruh angka mengacu pada RAB esai dan merupakan asumsi yang harus diverifikasi lewat penawaran penyedia.

## 12. Keamanan, privasi, dan etika

- Pengendalian data pribadi anak mengikuti UU No. 27 Tahun 2022 (Republik Indonesia, 2022): persetujuan orang tua atau wali, tujuan jelas, minimisasi data.
- Anonimisasi: kode murid acak; tabel nama berada hanya di server sekolah.
- Dasbor dinas hanya data agregat; ada uji otomatis agar tidak ada kolom identitas.
- Enkripsi data saat transit (paket sinkronisasi) dan saat diam (partisi data murid).
- Kontrol akses berbasis peran; log audit.
- Tanpa kamera, mikrofon, lokasi, atau pelacak pihak ketiga.
- Prosedur insiden: pemberitahuan ke koordinator dan sekolah, pemutusan kunci akses, laporan sesuai ketentuan.
- Konten: lisensi terbuka dan tinjauan kurikulum sebelum dipublikasikan.

## 13. Metrik, pengujian, dan gerbang keputusan

| Metrik | Sumber data | Ambang lolos | Tindakan jika gagal |
|---|---|---|---|
| Kenaikan skor numerasi | Tes awal dan akhir, kelompok pembanding | ≥ 0,18 SD | Perbaiki konten dan siklus; tidak diperluas |
| Sesi terlaksana | Log sesi | ≥ 80% | Tambah pelatihan dan pendampingan |
| Waktu aktif server | Telemetri | ≥ 90% jam sekolah | Tambah baterai; SSD cadangan |
| SUS guru | Kuesioner | ≥ 68 | Sederhanakan antarmuka |
| Kehadiran relawan | Log sesi | ≥ 85% | Perkuat rekrutmen; latih guru mandiri |
| Integritas sinkronisasi | Uji otomatis | 0 kejadian ganda atau hilang pada 1.000 percobaan putus-sambung | Perbaiki protokol |

Rencana uji:

- **Unit dan integrasi**: layanan lokal, MQTT, penggabungan kejadian.
- **Uji laboratorium**: kalibrasi ambang baterai dan suhu; uji mati listrik mendadak 50 kali; uji 15 klien bersamaan.
- **Uji sinkronisasi**: simulasi koneksi putus-sambung, paket terpotong, pengiriman ulang, dua perangkat mengirim kejadian tumpang tindih.
- **Uji keamanan**: pemeriksaan hak akses, uji data agregat, pemindaian kerentanan.
- **Uji kegunaan**: sesi dengan guru dan murid sasaran sebelum pilot, lalu SUS.
- **Pilot lapangan**: 5 SD, 12 bulan, dengan 5 SD pembanding.

## 14. Risiko dan mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Perangkat hilang atau rusak | Pembelajaran berhenti | Pemasangan tetap, label QR, telemetri, perjanjian pemeliharaan |
| Gangguan daya | Server mati, data rusak | UPS/baterai, sistem berkas jurnal, peringatan dini |
| Relawan tidak berkelanjutan | Sesi turun | Rekrutmen lewat pengabdian kampus, pelatihan guru mandiri, ambang 85% |
| Konten tidak selaras | Murid tidak maju | Kurasi kampus, pembaruan konten tiap kunjungan |
| Guru enggan memakai | Keterpakaian rendah | Antarmuka satu halaman, pelatihan, pendampingan bulanan, SUS |
| Kebocoran data anak | Pelanggaran UU PDP | Anonimisasi, persetujuan, enkripsi, audit |
| Modul IoT gagal | Tidak bisa memantau jarak jauh | Terpisah dari fungsi belajar; relawan memeriksa manual |
| Protokol sinkronisasi gagal pada kasus tepi | Data ganda atau hilang | Desain idempoten, uji putus-sambung, versi paket |

## 15. Peta jalan

| Fase | Bulan | Hasil |
|---|---|---|
| 0. Persiapan | 1–2 | Konten terkurasi, prototipe kotak, kalibrasi IoT, uji laboratorium, persetujuan etik dan orang tua |
| 1. Pelatihan dan pemasangan | 3–4 | 5 SD terpasang, guru dan relawan terlatih |
| 2. Operasi | 5–10 | Enam siklus empat pekan, pendampingan bulanan, dasbor aktif |
| 3. Evaluasi | 11–12 | Analisis kuasi-eksperimen, laporan, rekomendasi replikasi |
| 4. Perluasan (bersyarat) | Setelah gerbang lolos | ~50 SD per kabupaten bersama dinas pendidikan |

## 16. Asumsi, batasan, dan pertanyaan terbuka

- Semua ambang peringatan (baterai, suhu) dan lama baterai adalah asumsi; kalibrasi di laboratorium.
- Efek gabungan LENTERA belum diuji di Indonesia; pilot memakai gerbang keputusan.
- Dasar hukum penggunaan dana desa untuk transportasi relawan perlu dikaji lebih dahulu.
- Cakupan sinyal seluler di tiap sekolah perlu disurvei; jalur utama sinkronisasi adalah ponsel relawan.
- Nama "LENTERA" mirip dengan sistem "Lentera" yang dilaporkan Putri et al. (2025) di Maluku; tim perlu memutuskan apakah nama dipertahankan atau diubah agar tidak membingungkan.
- Pertanyaan terbuka: siapa penyelenggara dasbor jangka panjang (kampus atau dinas), dan siapa menanggung biaya penggantian perangkat setelah pilot.

## 17. Kriteria penerimaan rilis pilot (definition of done)

1. Seluruh kebutuhan P0 (bagian 5) lulus uji.
2. Uji laboratorium (mati listrik, 15 klien, sinkronisasi 1.000 percobaan) lulus.
3. Uji kegunaan awal: SUS guru uji ≥ 68.
4. Persetujuan orang tua tercatat untuk seluruh murid peserta.
5. Dokumen pelatihan guru dan relawan tersedia, dan prosedur pemulihan terdokumentasi.

## Rujukan

- Barrera-Osorio, F., & Zoido, P. (n.d.). *Evaluating the impact of a tablet-based learning platform in Honduras*. Innovations for Poverty Action.
- Febrianty, A., dkk. (2026). Learning analytics in low-connectivity educational environments: A systematic review of offline-first and edge architectures. *Jurnal VARIDIKA*.
- GEBRAK. (2026, 18 Juni). *Kemendikdasmen resmi rilis Rapor Pendidikan 2025*.
- Investortrust. (2025, 5 Agustus). *Program listrik masuk desa jangkau sekolah di daerah terpencil*.
- Learning Equality. (n.d.). *Our impact*.
- Putri, H., dkk. (2025). Frugal innovation in education: Designing and evaluating low-bandwidth, asynchronous learning systems for remote Indonesian schools. *Enigma in Education*.
- Republik Indonesia. (2022). *Undang-Undang Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi*.
