# Headless Seed Roadmap

RoomHash's browser client can only exchange torrent data with WebRTC-capable
peers. RoomHash Headless now acts as an optional gateway between browser WebRTC
swarms and conventional BitTorrent swarms.

Implemented:

- [x] Run as a separately deployable, opt-in service rather than browser code.
- [x] Join RoomHash channels and discover `torrent.media` and `wasm.app`
  messages without executing their payloads.
- [x] Discover conventional peers through DHT, TCP, LSD, PEX, and torrent
  tracker metadata.
- [x] Append configurable WSS trackers so browser peers can discover content
  learned from a bare InfoHash or a conventional swarm.
- [x] Persist magnets, downloaded content, and `.torrent` metadata across
  restarts.
- [x] Deduplicate downloads by InfoHash through a single WebTorrent client.
- [x] Expose transfer and discovery state through structured logs.

Remaining production controls:

- [ ] Add configurable total disk quota, per-torrent size limit, retention, and
  least-recently-used eviction.
- [ ] Add channel and InfoHash allow/deny policies before public deployment.
- [ ] Announce health, available InfoHashes, capacity, and bandwidth limits to
  RoomHash peers.
- [ ] Add an authenticated local management API and remote disable switch.
- [ ] Add audit export without persisting chat message bodies.
- [ ] Package the shared gateway core for future desktop RoomHash clients; see
  `CLIENT-REQUIREMENTS.md`.
