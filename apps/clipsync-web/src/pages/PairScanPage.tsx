import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import jsQR from 'jsqr';
import { useAppState } from '../lib/appState.js';
import { decodePairingPayload } from '../lib/pairingQr.js';
import { LockIcon, PhoneIcon } from '../components/icons.js';
import './PairShell.css';

export function PairScanPage() {
  const { completePairingAsJoiner } = useAppState();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeRef = useRef(true);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let rafId = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    async function handleDecoded(raw: string) {
      activeRef.current = false;
      setPairing(true);
      try {
        const payload = decodePairingPayload(raw);
        await completePairingAsJoiner(payload);
        navigate('/pair/success', { replace: true });
      } catch {
        setError("That code isn't a valid ClipSync pairing code, or it has expired. Ask the other device to show a new one.");
        setPairing(false);
        activeRef.current = true;
        tick();
      }
    }

    function tick() {
      if (!activeRef.current) return;
      const video = videoRef.current;
      if (video && ctx && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code && code.data) {
          handleDecoded(code.data);
          return;
        }
      }
      rafId = requestAnimationFrame(tick);
    }

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }
        tick();
      } catch {
        setError('Camera access is required to scan the pairing code. Allow camera access and reload this page.');
      }
    }

    start();
    return () => {
      activeRef.current = false;
      cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [completePairingAsJoiner, navigate]);

  return (
    <div className="pair-shell">
      <span className="pair-shell__icon">
        <PhoneIcon size={28} />
      </span>
      <div>
        <div className="pair-shell__title">Pair with your other device</div>
        <p className="pair-shell__body">Point your camera at the code shown on the other device's screen.</p>
      </div>
      <div className="pair-shell__camera-frame">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} muted playsInline />
        <div className="pair-shell__viewfinder" />
      </div>
      {pairing && <p className="pair-shell__body">Pairing…</p>}
      {error && <p className="pair-shell__error">{error}</p>}
      <div className="pair-shell__hint">
        <LockIcon />
        <span>Your phone and this device exchange a private key over Wi-Fi. The pairing code expires in minutes and can't be reused.</span>
      </div>
    </div>
  );
}
