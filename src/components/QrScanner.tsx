import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

/**
 * In-app QR scanner using the phone camera (MediaDevices + jsQR).
 * - Needs HTTPS or localhost (browser security rule) — the deployed Vercel
 *   site satisfies this; plain HTTP on a LAN IP will not open the camera.
 * - Accepts any QR whose text looks like a canteen link; the PARENT decides
 *   meal routing from the server clock, the QR itself only needs to contain
 *   the counter page URL.
 */
export default function QrScanner({
  onDetected,
  onClose,
}: {
  onDetected: (url: string) => void;
  onClose: () => void;
}): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    let alive = true;
    let canvas: HTMLCanvasElement | null = null;

    async function start(): Promise<void> {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('UNSUPPORTED');
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (!alive) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true'); // iOS Safari
        await video.play().catch(() => undefined);

        canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const cv = canvas as HTMLCanvasElement;

        const tick = (): void => {
          if (!alive || !video || !ctx || video.readyState !== video.HAVE_ENOUGH_DATA) {
            rafRef.current = requestAnimationFrame(tick);
            return;
          }
          const w = video.videoWidth;
          const h = video.videoHeight;
          if (!w || !h) {
            rafRef.current = requestAnimationFrame(tick);
            return;
          }
          // Scan the central square for speed and steadier aiming.
          const side = Math.min(w, h) * 0.8;
          const sx = (w - side) / 2;
          const sy = (h - side) / 2;
          cv.width = 320;
          cv.height = 320;
          ctx.drawImage(video, sx, sy, side, side, 0, 0, 320, 320);
          const img = ctx.getImageData(0, 0, 320, 320);
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (code?.data) {
            stop();
            onDetected(code.data.trim());
            return;
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        setStarting(false);
      } catch (err) {
        if (!alive) return;
        setStarting(false);
        const name = err instanceof DOMException ? err.name : '';
        if (name === 'NotAllowedError') {
          setError('Camera permission was denied. Allow camera access in your browser settings and try again.');
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setError('No usable camera was found on this device.');
        } else if (err instanceof Error && err.message === 'UNSUPPORTED') {
          setError('This browser does not support camera scanning. Open the canteen link directly instead.');
        } else {
          setError('Camera could not start. You can still open the counter link directly.');
        }
      }
    }

    void start();
    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stop(): void {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  return (
    <div className="qrscanner">
      <div className="qrscanner-view">
        <video ref={videoRef} className="qrscanner-video" muted playsInline />
        {!error && (
          <div className="qrscanner-frame" aria-hidden>
            <span />
          </div>
        )}
        {starting && !error && <p className="qrscanner-status">Starting camera…</p>}
        {error && (
          <div className="qrscanner-error">
            <p>{error}</p>
          </div>
        )}
      </div>
      <p className="muted small center-text">Point the camera at the canteen counter QR code.</p>
      <button type="button" className="btn-ghost btn-block" onClick={() => { stop(); onClose(); }}>
        Cancel
      </button>
    </div>
  );
}
