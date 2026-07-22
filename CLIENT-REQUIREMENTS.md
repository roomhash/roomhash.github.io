# RoomHash Client Development Requirements

## Native Torrent Gateway

Future desktop and service-capable RoomHash clients must be able to bridge a
conventional BitTorrent swarm into the browser WebTorrent swarm. This is a
native-client capability; the hosted browser client remains WebRTC-only because
browsers cannot open raw BitTorrent TCP, UDP, or DHT sockets.

### Required behavior

- Accept ordinary magnet links, including links containing only a v1 `btih`
  InfoHash.
- Discover conventional peers through DHT, HTTP/UDP trackers, LSD, and PEX when
  those transports are enabled by the user and available on the platform.
- Connect to browser peers through WebRTC and secure WebSocket trackers.
- Append the RoomHash browser tracker set to non-private torrents so a torrent
  learned from DHT becomes discoverable by browser clients.
- Fetch BEP 9 metadata from conventional peers, persist the resulting `.torrent`
  metadata, cache selected content, and resume seeding after restart.
- Deduplicate sessions by InfoHash across channels. A repeated message must not
  create another downloader or another copy of the payload.
- Preserve private-torrent semantics. Do not append public trackers or use DHT
  for torrents marked private.
- Show discovery sources, peer counts, transfer progress, cache size, and whether
  the client is currently bridging conventional peers to WebRTC peers.

### Product policy

- The desktop client must ask before enabling gateway mode for the first time.
- Users must be able to configure cache quota, retention, upload/download limits,
  inbound ports, UPnP/NAT-PMP, and allowed channels.
- Executable WASM remains subject to RoomHash manifest, hash, permission, and
  sandbox checks. Torrent gateway support never implies permission to execute a
  downloaded file.
- Gateway mode must expose pause, remove, and purge-data controls per InfoHash.
- Logs must identify DHT, tracker, TCP/uTP, WebRTC, web-seed, and cache events
  without recording chat message bodies.

### Shared core

Desktop clients should reuse the Headless torrent-gateway behavior and config
model instead of implementing a second protocol. Platform adapters may replace
the filesystem, keychain, notification, and network-port layers, but torrent
identity and browser tracker behavior must remain compatible.

### Acceptance case

Given a magnet URI containing only `xt=urn:btih:<40-hex-infohash>`, a gateway
client must obtain metadata and pieces from conventional peers, announce the
same InfoHash to the configured WSS trackers, and serve those pieces to a
RoomHash browser tab without changing the shared chat message.
