// Pemindai QR memakai kamera dan BarcodeDetector bawaan peramban (Chrome Android).
// Bila tidak didukung, pemanggil menampilkan isian kode manual.
export const scanSupported = () => 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

export async function scanQR({ title = 'Arahkan kamera ke kode QR' } = {}) {
  const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
  const dlg = document.createElement('dialog');
  dlg.className = 'scan-dialog';
  dlg.innerHTML = `
    <div class="scan-box">
      <p class="scan-title">${title}</p>
      <div class="scan-view"><video playsinline muted></video><span class="scan-frame" aria-hidden="true"></span></div>
      <p class="scan-msg" role="status">Menyalakan kamera…</p>
      <button type="button" class="btn btn-outline scan-cancel">Batal</button>
    </div>`;
  document.body.appendChild(dlg);
  dlg.showModal();
  const video = dlg.querySelector('video');
  const msg = dlg.querySelector('.scan-msg');
  let stream, stop = false;
  const cleanup = () => {
    stop = true;
    stream?.getTracks().forEach((t) => t.stop());
    dlg.close();
    dlg.remove();
  };
  return new Promise(async (resolve) => {
    dlg.querySelector('.scan-cancel').onclick = () => { cleanup(); resolve(null); };
    dlg.addEventListener('cancel', () => { cleanup(); resolve(null); });
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      video.srcObject = stream;
      await video.play();
      msg.textContent = 'Tahan kartu sampai kodenya masuk kotak.';
    } catch {
      msg.textContent = 'Kamera tidak bisa dibuka. Izinkan akses kamera, atau ketik kodenya.';
      return;
    }
    const tick = async () => {
      if (stop) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length) {
          const v = codes[0].rawValue;
          cleanup();
          return resolve(v);
        }
      } catch {}
      setTimeout(tick, 180);
    };
    tick();
  });
}
