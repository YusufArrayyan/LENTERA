// Paket sinkronisasi: JSON -> gzip -> AES-256-GCM -> tanda tangan Ed25519.
// Server sekolah menandatangani dengan kunci privat perangkat; pusat memverifikasi
// dengan kunci publik perangkat yang terdaftar. Pembaruan dari pusat ditandatangani
// kunci pusat dan diverifikasi sekolah sebelum dipasang (PRD 8.3 butir 6, NF-8).
import crypto from 'node:crypto';
import zlib from 'node:zlib';

export const PACKET_VERSION = 1;

function signingInput(env) {
  return Buffer.from([env.v, env.device_id, env.packet_id, env.iv, env.tag, env.ct].join('.'), 'utf8');
}

export function sealPacket({ deviceId, events, syncKeyHex, privateKeyPem, meta = {} }) {
  const packet_id = crypto.randomUUID();
  const body = Buffer.from(
    JSON.stringify({ v: PACKET_VERSION, device_id: deviceId, packet_id, created_at: new Date().toISOString(), meta, events }),
    'utf8'
  );
  const gz = zlib.gzipSync(body);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(syncKeyHex, 'hex'), iv);
  cipher.setAAD(Buffer.from(deviceId, 'utf8'));
  const ct = Buffer.concat([cipher.update(gz), cipher.final()]);
  const env = {
    v: PACKET_VERSION,
    device_id: deviceId,
    packet_id,
    n: events.length,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ct.toString('base64'),
  };
  env.sig = crypto.sign(null, signingInput(env), crypto.createPrivateKey(privateKeyPem)).toString('base64');
  return env;
}

export class PacketError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// lookup(deviceId) -> { publicKeyPem, syncKeyHex } | null
export function openPacket(env, lookup) {
  if (!env || typeof env !== 'object') throw new PacketError('paket_rusak', 'Paket kosong atau rusak.');
  for (const k of ['v', 'device_id', 'packet_id', 'iv', 'tag', 'ct', 'sig']) {
    if (env[k] === undefined || env[k] === null || env[k] === '') throw new PacketError('paket_rusak', `Paket tidak lengkap (${k}).`);
  }
  if (env.v !== PACKET_VERSION) throw new PacketError('versi_paket', `Versi paket ${env.v} belum didukung.`);
  const dev = lookup(env.device_id);
  if (!dev) throw new PacketError('perangkat_asing', 'Perangkat pengirim belum terdaftar di pusat.');
  let ok = false;
  try {
    ok = crypto.verify(null, signingInput(env), crypto.createPublicKey(dev.publicKeyPem), Buffer.from(env.sig, 'base64'));
  } catch {
    ok = false;
  }
  if (!ok) throw new PacketError('tanda_tangan', 'Tanda tangan paket tidak cocok. Paket mungkin terpotong atau diubah.');
  let body;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(dev.syncKeyHex, 'hex'), Buffer.from(env.iv, 'base64'));
    decipher.setAAD(Buffer.from(env.device_id, 'utf8'));
    decipher.setAuthTag(Buffer.from(env.tag, 'base64'));
    const gz = Buffer.concat([decipher.update(Buffer.from(env.ct, 'base64')), decipher.final()]);
    body = JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
  } catch {
    throw new PacketError('dekripsi', 'Paket tidak bisa dibuka. Kunci sinkronisasi tidak cocok atau isi paket rusak.');
  }
  if (body.device_id !== env.device_id || body.packet_id !== env.packet_id) {
    throw new PacketError('paket_rusak', 'Isi paket tidak sesuai dengan amplopnya.');
  }
  if (!Array.isArray(body.events)) throw new PacketError('paket_rusak', 'Paket tidak berisi daftar kejadian.');
  return body;
}

// ---- Pembaruan bertanda tangan dari pusat ----
export function canonical(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonical).join(',') + ']';
  return '{' + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
}

export function signUpdate(update, privateKeyPem) {
  const sig = crypto.sign(null, Buffer.from(canonical(update)), crypto.createPrivateKey(privateKeyPem)).toString('base64');
  return { ...update, sig };
}

export function verifyUpdate(signed, publicKeyPem) {
  const { sig, ...rest } = signed;
  if (!sig) return false;
  try {
    return crypto.verify(null, Buffer.from(canonical(rest)), crypto.createPublicKey(publicKeyPem), Buffer.from(sig, 'base64'));
  } catch {
    return false;
  }
}

export function generateKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

// ---- Kata sandi (scrypt) ----
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, saltHex, hashHex] = stored.split('$');
  const hash = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 32);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

export function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}
