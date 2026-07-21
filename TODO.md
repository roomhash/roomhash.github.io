# RoomHash TODO

## Message modules

- Define a capability and permission model before allowing third-party modules.
- Design signed plugin packages, sandboxed execution, version pinning, revocation, and user consent.
- Never execute JavaScript received directly from chat or from an untrusted torrent.

## Runtime capabilities

- Implement the `roomHashHost.network` adapter in desktop and headless clients.
- Add UPnP lease renewal, shutdown cleanup, and an authenticated external reachability probe.
- Add NAT-PMP/PCP providers behind the same capability interface.
- Sign public-node capability announcements so remote peers cannot self-claim relay trust.
- Add relay traffic telemetry, queue pressure indicators, and abuse controls.

## Future room features

- Peer-to-peer video and audio calls.
- Online multiplayer mini-games with deterministic state synchronization.
- Module discovery, installation UI, and compatibility negotiation.
- Optional channel aliases and per-channel directory sharing controls.
- Persistent torrent seeding with File System Access or OPFS where browser support allows it.
- Torrent file selection, per-file preload controls, cancellation, and storage quotas.
- Content safety controls, reporting, block lists, and magnet allow/deny policies.
