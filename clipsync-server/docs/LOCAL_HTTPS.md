# Local HTTPS for ClipSync

Browsers require a secure context for the Clipboard API and for the WebSocket
to use `wss`. On a local network without a public domain, generate a
certificate trusted by both the Mac and the Android phone using mkcert:

1. Install mkcert on the Mac: `brew install mkcert`.
2. Install the local CA: `mkcert -install`.
3. Generate a certificate for the Mac's LAN IP (find it with
   `ipconfig getifaddr en0`, e.g. `192.168.1.20`):

   ```bash
   mkcert -cert-file cert.pem -key-file key.pem 192.168.1.20 localhost 127.0.0.1
   ```

4. Point the server at the generated files and set the LAN bind address:

   ```bash
   export CLIPSYNC_TLS_CERT=$(pwd)/cert.pem
   export CLIPSYNC_TLS_KEY=$(pwd)/key.pem
   export CLIPSYNC_BIND_HOST=192.168.1.20
   npm start
   ```

5. On Android, install mkcert's root CA (`mkcert -CAROOT` shows where it
   lives) via Settings → Security → "Install a certificate", or accept the
   browser's certificate warning once if you skip this step (not recommended
   for anything beyond local testing).

Without this setup the server falls back to plain HTTP/`ws`, which the
Clipboard API and some PWA install prompts will refuse to work with outside
`localhost`.
