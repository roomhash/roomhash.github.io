# RoomHash Distributed Public Voting

An independent, dependency-free protocol core and browser demo for public
voting over a peer Mesh. Each collector counts only the ballots it has actually
collected. Ballots are keyed by the RoomHash user hash, forwarded over multiple
hops, deduplicated against echo loops, and repaired after reconnect through an
inventory/request/response anti-entropy exchange.

> **Local-view warning:** different users may see different statistics because
> their collectors may have received different ballots. A result is a local
> visible view, not a globally complete or strongly consistent total.

## What is implemented

- Public ballot fields: poll, nick, user hash, option, revision, timestamp, and
  deterministic event ID
- One counted ballot per user hash; edits use deterministic
  `(revision,eventId)` last-writer-wins ordering
- Frame-ID deduplication and ingress exclusion to stop echo/recount loops
- Flooded Mesh relay with a 16-hop bound, including addressed repair responses
- Anti-entropy using `inventory`, `want`, and `ballots` frames
- Export/import state for collector persistence
- Public raw-ballot audit view and collector-specific tally metadata
- Zero runtime dependencies

## Build, test, and run

Node.js 20 or newer is required.

```sh
npm run check
npm run serve
```

Open `http://127.0.0.1:4173` in two tabs. Each tab is a separate collector,
communicates through `BroadcastChannel`, persists its own collected state, and
periodically requests missing ballots. The browser demo is a transport adapter,
not a claim that `BroadcastChannel` simulates NAT.

`npm run build` reproducibly rebuilds `dist/`, including:

- `index.html`, `app.js`, and `styles.css`: runnable static demo
- `protocol.js`: reusable protocol core
- `host-adapter.js`: future RoomHash transport boundary
- `manifest.json`: catalog metadata that explicitly declares standalone web
  runtime and `currentRoomHashWasmCompatible: false`
- `integrity.json`: SHA-256 hashes for every other published file
- protocol, integration, security, and limitation documentation

The automated suite covers duplicate delivery, an echo loop, out-of-order vote
edits, deterministic equal-revision conflicts, A-B-C forwarding, divergent
partition results, reconnect repair and convergence, and invalid ballot
rejection.

## Current RoomHash integration status

This is deliberately not packaged as a WASM app. RoomHash currently accepts
only the canvas-oriented `roomhash-pixel-grid-v1` ABI, which cannot render form
controls or carry the structured identity and ballot records required here.
See [PROTOCOL.md](./PROTOCOL.md) for the exact host adapter interface needed to
integrate this protocol into the existing RoomHash Mesh.

**Trust boundary:** `userHash` and `eventId` are currently deduplication and
integrity identifiers, not cryptographic voter signatures. A malicious peer can
forge another user's hash or send an artificially high revision that wins LWW.
This v1 is suitable for informal public group polls once connected to a trusted
host identity hash; it must gain signed ballots and revision policy controls
before adversarial or high-stakes use.

## License

MIT
