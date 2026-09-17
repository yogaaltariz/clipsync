#!/usr/bin/env node
// Regenerates the local HTTPS certificate for whatever LAN IP this Mac
// currently has, prints a scannable QR code for the URL, and starts the
// dev server bound to that address. Run this instead of `npm run dev`
// whenever you're testing across devices — no more copy-pasting IPs or
// hunting for a stale cert.
import { execSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function detectLanIp() {
  for (const iface of ['en0', 'en1', 'en2']) {
    try {
      const ip = execSync(`ipconfig getifaddr ${iface}`, { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
      if (ip) return ip;
    } catch {
      // that interface has no IP — try the next one
    }
  }
  console.error('Could not detect a LAN IP address on en0/en1/en2. Are you connected to Wi-Fi?');
  process.exit(1);
}

function requireMkcert() {
  try {
    execSync('mkcert -help', { stdio: 'ignore' });
  } catch {
    console.error('mkcert is not installed. Run: brew install mkcert && mkcert -install');
    process.exit(1);
  }
}

const ip = detectLanIp();
requireMkcert();

const certPath = path.join(serverRoot, 'cert.pem');
const keyPath = path.join(serverRoot, 'key.pem');

console.log(`Generating certificate for ${ip}...`);
execSync(
  `mkcert -cert-file ${JSON.stringify(certPath)} -key-file ${JSON.stringify(keyPath)} ${ip} localhost 127.0.0.1`,
  { cwd: serverRoot, stdio: 'inherit' },
);

const port = process.env.CLIPSYNC_PORT ?? '3000';
const url = `https://${ip}:${port}`;

console.log(`\nScan this on your phone to open ${url}\n`);
console.log(await QRCode.toString(url, { type: 'terminal', small: true }));

console.log('Starting dev server (Ctrl+C to stop)...\n');
const child = spawn('npm', ['run', 'dev'], {
  cwd: serverRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    CLIPSYNC_TLS_CERT: certPath,
    CLIPSYNC_TLS_KEY: keyPath,
    CLIPSYNC_BIND_HOST: '0.0.0.0',
  },
});

child.on('exit', (code) => process.exit(code ?? 0));
