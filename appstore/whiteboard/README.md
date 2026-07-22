# RoomHash Shared Whiteboard

A responsive meeting whiteboard implemented as a dependency-free Rust WASM app.
It uses RoomHash's generic `portable-surface-v1` contract, so the app stays
independent of the RoomHash WebUI and can run in another compatible host.

## Features

- Four pen colors and three practical brush sizes: 2 px, 4 px, and 8 px
- A wider eraser, local undo, and a shared clear action
- PNG export of the current board through the host's controlled file-download capability
- Responsive two-row touch toolbar on phones and a compact side toolbar on desktop
- P2P event replication with user/clock IDs, duplicate rejection, and deterministic ordering
- Snapshot recovery for late joiners without requiring a central application server

The replicated state is an append-only set of stroke, undo, and clear events. Peers
sort events by logical clock, actor hash, and event ID, so reordered or echoed mesh
delivery converges to the same board once the same event set has been collected.

## Build and verify

```sh
rustup target add wasm32-unknown-unknown
npm run build
npm run check
```

`npm run build` writes `dist/whiteboard.wasm` and refreshes the SHA-256 fingerprint
in `dist/roomhash.json`. `npm run check` verifies the import-free WASM boundary,
manifest fingerprint, responsive mobile/fullscreen scenes, P2P convergence, brush
controls, and the PNG export request.

## Runtime boundary

The WASM module imports no DOM, file, network, or RoomHash-specific function. It
only emits portable scene descriptions, replicated events, snapshots, and controlled
effects. The host validates those values, relays events, persists snapshots, and
handles approved capabilities such as fullscreen and image download.

## License

MIT
