// Bank butir numerasi, aturan diagnostik, aturan latihan adaptif, katalog konten,
// dan pustaka alat peraga. Butir dibangkitkan dari ID (deterministik), jadi server
// selalu bisa memeriksa jawaban tanpa mempercayai data dari tablet.

export const LEVELS = [
  { level: 1, nama: 'Bilangan', ringkas: 'Membilang, membandingkan, dan mengurutkan bilangan sampai 50', fase: 'A' },
  { level: 2, nama: 'Tambah dan kurang', ringkas: 'Penjumlahan dan pengurangan sampai 100', fase: 'A' },
  { level: 3, nama: 'Perkalian', ringkas: 'Perkalian sebagai penjumlahan berulang sampai 10 × 10', fase: 'B' },
  { level: 4, nama: 'Pembagian', ringkas: 'Pembagian sebagai berbagi sama banyak sampai 100', fase: 'B' },
  { level: 5, nama: 'Pecahan', ringkas: 'Pecahan sederhana: membaca, membandingkan, pecahan dari banyak benda', fase: 'C' },
];

export const MAX_LEVEL = LEVELS.length;
export const SUBLEVELS = 3;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

function shuffle(r, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function numericOptions(r, answer, spread = 3, min = 0) {
  const set = new Set([answer]);
  const cands = [];
  for (let d = 1; d <= spread + 6; d++) cands.push(answer + d, answer - d);
  for (const c of shuffle(r, cands)) {
    if (set.size >= 4) break;
    if (c >= min && c !== answer) set.add(c);
  }
  return shuffle(r, [...set]).map(String);
}

function fractionOptions(r, num, den) {
  const ans = `${num}/${den}`;
  const set = new Set([ans]);
  const cands = [`${den - num}/${den}`, `${num}/${den + 1}`, `${num + 1}/${den}`, `${den}/${num}`, `1/${den}`, `${num}/${Math.max(2, den - 1)}`];
  for (const c of shuffle(r, cands)) {
    if (set.size >= 4) break;
    const [a, b] = c.split('/').map(Number);
    if (a > 0 && b > 0 && a <= b && c !== ans) set.add(c);
  }
  let k = 2;
  while (set.size < 4) set.add(`${k++}/${den + 2}`);
  return shuffle(r, [...set]);
}

const GEN = {
  1: {
    1(r) {
      const n = int(r, 3, 10);
      return { prompt: 'Ada berapa titik?', visual: { type: 'titik', jumlah: n }, answer: String(n), options: numericOptions(r, n, 2, 1) };
    },
    2(r) {
      const set = new Set();
      while (set.size < 4) set.add(int(r, 5, 50));
      const opts = shuffle(r, [...set]);
      const max = Math.max(...opts);
      return { prompt: 'Mana bilangan yang paling besar?', visual: null, answer: String(max), options: opts.map(String) };
    },
    3(r) {
      const start = int(r, 10, 45);
      const gap = int(r, 1, 3);
      return {
        prompt: `Lengkapi urutan: ${start}, ${start + 1}, ${gap === 1 ? '…' : start + 2}, ${gap === 1 ? start + 3 : '…'}`,
        visual: null,
        answer: String(gap === 1 ? start + 2 : start + 3),
        options: numericOptions(r, gap === 1 ? start + 2 : start + 3, 2, 1),
      };
    },
  },
  2: {
    1(r) {
      const a = int(r, 1, 6), b = int(r, 1, 10 - a);
      return { prompt: `${a} + ${b} = …`, visual: { type: 'titik-dua', a, b }, answer: String(a + b), options: numericOptions(r, a + b, 2, 0) };
    },
    2(r) {
      if (r() < 0.5) {
        const a = int(r, 6, 12), b = int(r, 3, 20 - a);
        return { prompt: `${a} + ${b} = …`, visual: null, answer: String(a + b), options: numericOptions(r, a + b, 3, 0) };
      }
      const a = int(r, 11, 20), b = int(r, 2, 9);
      return { prompt: `${a} − ${b} = …`, visual: null, answer: String(a - b), options: numericOptions(r, a - b, 3, 0) };
    },
    3(r) {
      if (r() < 0.5) {
        const a = int(r, 15, 60), b = int(r, 12, 99 - a);
        return { prompt: `${a} + ${b} = …`, visual: null, answer: String(a + b), options: numericOptions(r, a + b, 10, 0) };
      }
      const a = int(r, 40, 99), b = int(r, 12, a - 5);
      return { prompt: `${a} − ${b} = …`, visual: null, answer: String(a - b), options: numericOptions(r, a - b, 10, 0) };
    },
  },
  3: {
    1(r) {
      const g = int(r, 2, 4), n = int(r, 2, 5);
      return {
        prompt: `Ada ${g} kelompok. Tiap kelompok ${n} titik. Semuanya berapa?`,
        visual: { type: 'kelompok', kelompok: g, isi: n },
        answer: String(g * n),
        options: numericOptions(r, g * n, 3, 1),
      };
    },
    2(r) {
      const t = [2, 5, 10][int(r, 0, 2)], k = int(r, 2, 10);
      return { prompt: `${k} × ${t} = …`, visual: null, answer: String(k * t), options: numericOptions(r, k * t, t === 2 ? 4 : t, 1) };
    },
    3(r) {
      const a = int(r, 3, 9), b = int(r, 3, 9);
      return { prompt: `${a} × ${b} = …`, visual: null, answer: String(a * b), options: [...new Set([a * b, a * (b + 1), (a - 1) * b, a * b + 2])].length === 4 ? shuffle(r, [a * b, a * (b + 1), (a - 1) * b, a * b + 2].map(String)) : numericOptions(r, a * b, 6, 1) };
    },
  },
  4: {
    1(r) {
      const k = int(r, 2, 4), each = int(r, 2, 5);
      const benda = ['kelereng', 'jeruk', 'pensil', 'kue'][int(r, 0, 3)];
      return {
        prompt: `${k * each} ${benda} dibagi rata kepada ${k} anak. Tiap anak dapat berapa?`,
        visual: { type: 'titik', jumlah: k * each },
        answer: String(each),
        options: numericOptions(r, each, 2, 1),
      };
    },
    2(r) {
      const d = [2, 5, 10][int(r, 0, 2)], q = int(r, 2, 10);
      return { prompt: `${d * q} : ${d} = …`, visual: null, answer: String(q), options: numericOptions(r, q, 3, 1) };
    },
    3(r) {
      const d = int(r, 3, 9), q = int(r, 3, 11);
      return { prompt: `${d * q} : ${d} = …`, visual: null, answer: String(q), options: numericOptions(r, q, 3, 1) };
    },
  },
  5: {
    1(r) {
      const den = [2, 3, 4, 5, 6, 8][int(r, 0, 5)], num = int(r, 1, den - 1);
      return { prompt: 'Berapa bagian yang diwarnai?', visual: { type: 'pecahan', pembilang: num, penyebut: den }, answer: `${num}/${den}`, options: fractionOptions(r, num, den) };
    },
    2(r) {
      const den = [4, 5, 6, 8][int(r, 0, 3)];
      let a = int(r, 1, den - 1), b = int(r, 1, den - 1);
      while (b === a) b = int(r, 1, den - 1);
      const big = Math.max(a, b);
      const opts = shuffle(r, [`${a}/${den}`, `${b}/${den}`]);
      return { prompt: 'Mana pecahan yang lebih besar?', visual: null, answer: `${big}/${den}`, options: opts };
    },
    3(r) {
      const den = [2, 3, 4, 5][int(r, 0, 3)], num = int(r, 1, den - 1), m = int(r, 2, 6);
      const total = den * m;
      return { prompt: `${num}/${den} dari ${total} = …`, visual: null, answer: String(num * m), options: numericOptions(r, num * m, 3, 1) };
    },
  },
};

export function itemId(level, sub, seed) {
  return `L${level}S${sub}-${seed}`;
}

export function parseItemId(id) {
  const m = /^L([1-5])S([1-3])-(\d{1,9})$/.exec(String(id || ''));
  if (!m) return null;
  return { level: +m[1], sub: +m[2], seed: +m[3] };
}

export function getItem(id) {
  const p = parseItemId(id);
  if (!p) return null;
  const r = rng(p.seed * 7919 + p.level * 131 + p.sub);
  const it = GEN[p.level][p.sub](r);
  return { item_id: id, level: p.level, sub: p.sub, ...it };
}

// Bentuk butir untuk tablet: tanpa kunci jawaban.
export function publicItem(item) {
  const { answer, ...rest } = item;
  return rest;
}

export function checkAnswer(id, response) {
  const it = getItem(id);
  if (!it) return null;
  return { correct: String(response).trim() === it.answer, answer: it.answer, item: it };
}

export function randomItemId(level, sub) {
  return itemId(level, sub, 1000 + Math.floor(Math.random() * 900000));
}

// ---- Diagnostik ----
// Tiga butir tetap per level (benih tetap = butir terkalibrasi). Tingkat kesulitan
// (b) di bawah ini adalah asumsi awal dan dikalibrasi ulang setelah uji coba.
export const DIAGNOSTIC = {
  perLevel: 3,
  lulus: 2, // minimal benar per level agar lanjut ke level berikutnya
  butir: {
    1: [itemId(1, 1, 11), itemId(1, 2, 12), itemId(1, 3, 13)],
    2: [itemId(2, 1, 21), itemId(2, 2, 22), itemId(2, 3, 23)],
    3: [itemId(3, 1, 31), itemId(3, 2, 32), itemId(3, 3, 33)],
    4: [itemId(4, 1, 41), itemId(4, 2, 42), itemId(4, 3, 43)],
    5: [itemId(5, 1, 51), itemId(5, 2, 52), itemId(5, 3, 53)],
  },
  // Butir untuk asesmen ulang memakai benih berbeda agar tidak dihafal.
  butirUlang(siklus) {
    const out = {};
    for (let l = 1; l <= MAX_LEVEL; l++) out[l] = [1, 2, 3].map((s) => itemId(l, s, l * 10 + s + siklus * 100));
    return out;
  },
};

// answers: [{level, correct}] sesuai urutan. Mengembalikan { selesai, nextItem?, level, skor, total }
export function diagnosticStep(answers, siklus = 0) {
  const bank = siklus > 0 ? DIAGNOSTIC.butirUlang(siklus) : DIAGNOSTIC.butir;
  const total = answers.length;
  const skor = answers.filter((a) => a.correct).length;
  let level = 1;
  for (let l = 1; l <= MAX_LEVEL; l++) {
    const atL = answers.filter((a) => a.level === l);
    if (atL.length < DIAGNOSTIC.perLevel) {
      return { selesai: false, nextItemId: bank[l][atL.length], level: l, skor, total };
    }
    const benar = atL.filter((a) => a.correct).length;
    if (benar < DIAGNOSTIC.lulus) return { selesai: true, level: l, skor, total, mahir: false };
    level = l;
  }
  return { selesai: true, level: MAX_LEVEL, skor, total, mahir: true };
}

// ---- Latihan adaptif ----
// Dua benar berturut-turut: tingkat naik. Dua salah berturut-turut: tingkat turun.
export function adaptStep(state, correct) {
  const s = { ...state };
  s.total = (s.total || 0) + 1;
  if (correct) {
    s.correct = (s.correct || 0) + 1;
    s.streak = (s.streak || 0) + 1;
    s.wrong_streak = 0;
    if (s.streak >= 2 && s.sub < SUBLEVELS) {
      s.sub += 1;
      s.streak = 0;
      s.perubahan = 'naik';
    } else if (s.streak >= 3 && s.sub === SUBLEVELS) {
      s.siap_naik = 1;
      s.perubahan = null;
    } else s.perubahan = null;
  } else {
    s.wrong_streak = (s.wrong_streak || 0) + 1;
    s.streak = 0;
    s.siap_naik = 0;
    if (s.wrong_streak >= 2 && s.sub > 1) {
      s.sub -= 1;
      s.wrong_streak = 0;
      s.perubahan = 'turun';
    } else s.perubahan = null;
  }
  return s;
}

// ---- Katalog konten (F-1.6) ----
// Pemetaan ke elemen Bilangan pada Capaian Pembelajaran Kurikulum Merdeka fase A–C
// (diparafrasekan). Konten Kolibri mengikuti kanal yang dipasang di server.
export const KATALOG = [
  { id: 'K01', level: 1, fase: 'A', elemen: 'Bilangan', topik: 'Membilang benda sampai 20', capaian: 'Membilang dan menuliskan banyak benda', kata: ['membilang', 'hitung', 'benda', 'titik'] },
  { id: 'K02', level: 1, fase: 'A', elemen: 'Bilangan', topik: 'Membandingkan dan mengurutkan bilangan', capaian: 'Membandingkan dan mengurutkan bilangan cacah sampai 100', kata: ['banding', 'urut', 'lebih besar', 'lebih kecil'] },
  { id: 'K03', level: 1, fase: 'A', elemen: 'Bilangan', topik: 'Nilai tempat puluhan dan satuan', capaian: 'Memahami nilai tempat bilangan dua angka', kata: ['nilai tempat', 'puluhan', 'satuan'] },
  { id: 'K04', level: 2, fase: 'A', elemen: 'Bilangan', topik: 'Penjumlahan sampai 20', capaian: 'Menjumlahkan bilangan cacah sampai 20 dengan benda konkret', kata: ['tambah', 'jumlah', 'penjumlahan'] },
  { id: 'K05', level: 2, fase: 'A', elemen: 'Bilangan', topik: 'Pengurangan sampai 20', capaian: 'Mengurangkan bilangan cacah sampai 20 dengan benda konkret', kata: ['kurang', 'pengurangan', 'sisa'] },
  { id: 'K06', level: 2, fase: 'A', elemen: 'Bilangan', topik: 'Tambah dan kurang sampai 100', capaian: 'Menjumlahkan dan mengurangkan bilangan cacah sampai 100', kata: ['tambah', 'kurang', 'menyimpan', 'meminjam'] },
  { id: 'K07', level: 3, fase: 'B', elemen: 'Bilangan', topik: 'Perkalian sebagai penjumlahan berulang', capaian: 'Memahami perkalian sebagai penjumlahan berulang', kata: ['kali', 'perkalian', 'kelompok', 'berulang'] },
  { id: 'K08', level: 3, fase: 'B', elemen: 'Bilangan', topik: 'Fakta perkalian 2, 5, dan 10', capaian: 'Menghafal dan memakai fakta perkalian dasar', kata: ['kali', 'tabel', 'fakta'] },
  { id: 'K09', level: 3, fase: 'B', elemen: 'Bilangan', topik: 'Perkalian sampai 10 × 10', capaian: 'Mengalikan bilangan satu angka', kata: ['kali', 'perkalian'] },
  { id: 'K10', level: 4, fase: 'B', elemen: 'Bilangan', topik: 'Pembagian sebagai berbagi sama banyak', capaian: 'Memahami pembagian sebagai berbagi sama banyak', kata: ['bagi', 'pembagian', 'rata'] },
  { id: 'K11', level: 4, fase: 'B', elemen: 'Bilangan', topik: 'Hubungan perkalian dan pembagian', capaian: 'Memakai perkalian untuk menyelesaikan pembagian', kata: ['bagi', 'kali', 'kebalikan'] },
  { id: 'K12', level: 5, fase: 'B', elemen: 'Bilangan', topik: 'Mengenal pecahan setengah, sepertiga, seperempat', capaian: 'Mengenal pecahan sebagai bagian dari keseluruhan', kata: ['pecahan', 'setengah', 'seperempat', 'bagian'] },
  { id: 'K13', level: 5, fase: 'C', elemen: 'Bilangan', topik: 'Membandingkan pecahan', capaian: 'Membandingkan dan mengurutkan pecahan', kata: ['pecahan', 'banding', 'penyebut'] },
  { id: 'K14', level: 5, fase: 'C', elemen: 'Bilangan', topik: 'Pecahan dari banyak benda', capaian: 'Menentukan pecahan dari suatu jumlah', kata: ['pecahan', 'dari', 'kelompok'] },
];

export function cariKatalog(q) {
  const s = String(q || '').toLowerCase().trim();
  if (!s) return KATALOG;
  return KATALOG.filter((k) =>
    [k.topik, k.capaian, k.elemen, `fase ${k.fase}`, ...k.kata].some((t) => t.toLowerCase().includes(s))
  );
}

// ---- Pustaka alat peraga (F-1.9): aktivitas konkret 20 menit per level ----
export const ALAT_PERAGA = [
  {
    level: 1,
    judul: 'Ikat lidi per sepuluh',
    bahan: ['50 batang lidi atau sedotan', 'karet gelang', 'kapur atau spidol'],
    langkah: [
      'Bagikan 10 sampai 25 lidi ke tiap pasangan murid. Minta mereka menghitung satu per satu sambil menunjuk.',
      'Saat hitungan sampai sepuluh, ikat sepuluh lidi dengan karet. Katakan: "Ini satu puluhan."',
      'Tulis di papan bilangan yang mereka pegang, misalnya 23: dua ikat dan tiga batang lepas.',
      'Sebutkan bilangan acak di bawah 50. Pasangan yang lebih dulu menyusun ikatan dan batang lepas dengan benar mendapat giliran menyebut bilangan berikutnya.',
    ],
    tanda: 'Murid bisa menyusun bilangan dua angka dengan ikatan puluhan tanpa menghitung ulang dari satu.',
  },
  {
    level: 2,
    judul: 'Toko batu',
    bahan: ['batu kecil atau tutup botol (40 buah per kelompok)', 'kartu harga dari kertas bekas'],
    langkah: [
      'Susun "barang" di meja dengan kartu harga 3 sampai 15 batu.',
      'Satu murid jadi penjual. Pembeli membawa 20 batu dan memilih dua barang.',
      'Pembeli menghitung total harga dengan menggabungkan batu, lalu penjual menghitung sisa batu pembeli.',
      'Tulis kalimat matematikanya di papan: 7 + 5 = 12, lalu 20 − 12 = 8. Tukar peran setiap dua transaksi.',
    ],
    tanda: 'Murid menuliskan kalimat penjumlahan dan pengurangan yang sesuai dengan transaksi.',
  },
  {
    level: 3,
    judul: 'Kebun bibit',
    bahan: ['tutup botol atau biji jagung', 'kertas bergaris kotak atau petak yang digambar di tanah'],
    langkah: [
      'Gambar petak kebun berisi beberapa baris. Tiap baris diisi jumlah bibit yang sama.',
      'Minta murid menghitung semua bibit dengan penjumlahan berulang: 4 + 4 + 4.',
      'Tunjukkan bahwa 3 baris berisi 4 bibit ditulis 3 × 4. Putar petaknya: 4 baris berisi 3 bibit juga 12.',
      'Kelompok membuat petak sendiri, kelompok lain menebak kalimat perkaliannya.',
    ],
    tanda: 'Murid menjelaskan bahwa 3 × 4 sama dengan 4 + 4 + 4 dan sama banyaknya dengan 4 × 3.',
  },
  {
    level: 4,
    judul: 'Bagi rata kue',
    bahan: ['24 tutup botol sebagai "kue"', 'piring kertas atau lingkaran kapur di lantai'],
    langkah: [
      'Letakkan 12 kue dan 3 piring. Minta satu murid membagi kue satu per satu ke tiap piring bergiliran.',
      'Hitung isi tiap piring. Tulis: 12 : 3 = 4.',
      'Ulangi dengan 4 piring dan 6 piring. Tanyakan: "Kalau piringnya lebih banyak, isinya jadi lebih banyak atau lebih sedikit?"',
      'Hubungkan dengan perkalian: 3 piring × 4 kue = 12 kue.',
    ],
    tanda: 'Murid memeriksa hasil pembagian dengan perkalian.',
  },
  {
    level: 5,
    judul: 'Lipat kertas pecahan',
    bahan: ['kertas bekas berbentuk persegi panjang, 4 lembar per murid', 'pensil warna atau arang'],
    langkah: [
      'Lipat lembar pertama jadi dua bagian sama besar, warnai satu bagian, tulis 1/2.',
      'Lipat lembar lain jadi empat dan delapan. Warnai sebagian dan tulis pecahannya.',
      'Jajarkan lembar 1/2, 2/4, dan 4/8. Tanyakan mana yang lebih besar, lalu biarkan murid menemukan bahwa luasnya sama.',
      'Bagikan 12 batu. Minta murid mengambil 1/4 dari batu itu dengan membaginya ke empat lipatan.',
    ],
    tanda: 'Murid menunjukkan 1/4 dari 12 benda dan menjelaskan mengapa 2/4 sama dengan 1/2.',
  },
];

export function levelInfo(level) {
  return LEVELS.find((l) => l.level === Number(level)) || null;
}
