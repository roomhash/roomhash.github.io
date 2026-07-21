# Headless Seed Roadmap

RoomHash's browser client can only exchange torrent data with WebRTC-capable peers. A future always-on headless seed service should bridge browser WebRTC swarms and conventional BitTorrent TCP/uTP swarms.

Planned scope:

- Run as a separately deployable, opt-in service rather than browser code.
- Join RoomHash channels and discover `torrent.media` messages without executing arbitrary plugins.
- Support WebRTC trackers plus conventional HTTP/UDP trackers and DHT where deployment policy permits.
- Cache content under configurable disk quotas, retention windows, and allowlists.
- Announce health, available info hashes, capacity, and bandwidth limits to RoomHash peers.
- Preserve message and piece deduplication; never relay content that has not passed operator policy.
- Provide authentication, abuse controls, audit logs, and a remote disable switch before public deployment.
