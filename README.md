# RoomHash

> A room in a link. Messages move peer to peer.

Pure-static **P2P chat rooms** for GitHub Pages. No app backend: only HTML/CSS/JS.

## How it works

1. First visit without a room id mints a UUID and puts it in the URL hash (`#<uuid>`). That hash **is** the room id.
2. Share the full URL. Others who open it join the same room.
3. Peers discover each other through a **WebTorrent-compatible WebSocket tracker** (BitTorrent announce as WebRTC signaling) via [`@trystero-p2p/torrent`](https://github.com/dmotz/trystero) (Trystero torrent strategy).
4. Chat text, module messages, images, and small files go over **WebRTC data channels** (peer-to-peer). History and nickname live in **localStorage** only.
5. By default Trystero connects to a deterministic pool of three public WebTorrent trackers for redundancy. Change the tracker in the UI to pin one custom tracker; the share URL embeds `?tracker=` so recipients use the same one.

## Torrent media sharing

- Paste a magnet link as a message to create a torrent media card.
- Use **Seed & share files** to create a torrent from local files and publish its magnet link. Keep that browser tab open so it remains a seed.
- Torrent cards load file metadata first. **Preload** starts downloading all files; the global auto-preload toggle applies to newly opened cards.
- Browser-supported video files such as MP4 can stream into the built-in video player. TXT files have a raw preview; Markdown has sanitized rendered and raw views.
- RoomHash browser peers use WebRTC-capable WebTorrent swarms. A traditional BitTorrent peer that exposes only TCP/uTP cannot connect directly to a browser.

Chat extensions use versioned, data-only module messages and locally registered renderers. Received JavaScript is never executed.

## Develop

```bash
npm install
npm run dev      # Vite dev server
npm test         # unit + protocol tests (shipped modules)
npm run build    # static assets → dist/
npm run preview  # serve dist/
```

Deploy the contents of `dist/` to GitHub Pages (project or user site). Relative paths (`base: './'`) work under subpaths.

## Limits (by design)

- No central message store: if nobody else is online, there is nothing to sync from.
- Trystero's default Google + Cloudflare STUN pool handles ordinary NATs; restrictive NATs still need a TURN server (not provided).
- Public trackers are best-effort signaling only; they never see chat payloads after the WebRTC handshake.
- Torrent availability depends on at least one compatible WebTorrent seed being online. Browser codec support still determines whether a downloaded video can play.

## Stack

- `@trystero-p2p/torrent` — WebRTC rooms over BitTorrent trackers  
- WebTorrent — browser torrent seeding and streaming  
- Marked + DOMPurify — sanitized Markdown preview  
- Vite — static build  
- Node test runner — pure module tests (room URL, nick, framing, session fan-out)
