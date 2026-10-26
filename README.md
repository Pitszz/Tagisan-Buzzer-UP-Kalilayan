# Tagisan 41 Quiz Show Buzzer

Real-time quiz buzzer for UP Kalilayan's Tagisan 41 (Node.js + Express + Socket.io).

## Run it

1. Install Node.js 18 or newer (check with `node -v`).
2. In this folder:

```bash
npm install
npm start
```

3. The terminal prints the addresses to open:
   - Host laptop: `http://localhost:3000/index.html`
   - Players and projector (same Wi-Fi/LAN): `http://<LAN-IP>:3000/index.html`

Always open the pages through the server URL. Double-clicking the HTML files will not work because the sockets need the server.

If port 3000 is busy: `PORT=3001 npm start` (macOS/Linux) or `set PORT=3001 && npm start` (Windows cmd).

## Pages
- `index.html` menu / join
- `host.html` control panel
- `player.html` buzzer
- `spectator.html` projector display
- `schools.txt` school dropdown list (one per line)

## Assets
- `assets/fonts/` Archivo and Inter Tight (OFL), self-hosted so it works offline
- `assets/brand/tagisan-logo.png`, `assets/brand/upk-logo.png` brand marks shown on the menu
- `assets/buzzer/` buzzer faces: `buzzer-ready.png`, `buzzer-buzzed.png`, `buzzer-locked.png` (transparent PNG, ~1024x1024, under ~200 KB each). The pressed look reuses the ready image.
- `assets/logos/` school logos for the spectator view. The filename is the school name in lowercase with dashes, e.g. "Quezon Science High School" -> `quezon-science-high-school.png`

## iOS note
`navigator.vibrate` is not supported by iOS Safari. Everything else works; audio unlocks after the first tap on the buzzer.
