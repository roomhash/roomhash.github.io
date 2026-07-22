# RoomHash Roomlet / WASM App v1

Roomlet means “Room Applet”; its Chinese product name is “聊应用”. User-facing
interfaces use Roomlet / 聊应用, while WASM and ABI terminology stays in this
developer specification.

RoomHash treats an ordinary `.wasm` attachment as a downloadable torrent. It is
executable only when a `roomhash.json` manifest declares a supported ABI and the
downloaded bytes match the manifest SHA-256 fingerprint.

## Roomlet catalog admission rule

The Roomlet catalog is WASM-only. Every catalog entry must use `runtime: "wasm"`,
provide a `roomhash.app/v1` manifest, target a supported embedded ABI, and keep
its application state and business logic inside WASM. Standalone web bundles,
external application links, and iframe-based applications are not eligible for
the Roomlet catalog. RoomHash acts as the bounded host and transport layer; it is not a
place to move an application's business logic into page JavaScript.

App releases must also be WebUI-independent. App-specific HTML/CSS/JavaScript,
RoomHash DOM dependencies, and RoomHash component/view schemas are forbidden.
New interactive applications target the host-neutral `portable-surface-v1`
contract documented in the workspace `wasm-app-sdk/ABI.md`: WASM owns the
responsive scene, hit testing, focus/draft state, validation, and domain
behavior; RoomHash is only a generic canvas/input/P2P/storage/media adapter. The
same `.wasm` must run in a third-party conforming host without recompilation.

## Manifest

```json
{
  "schema": "roomhash.app/v1",
  "id": "org.roomhash.pixel-garden",
  "name": "Shared Garden",
  "description": "Plant a shared pixel garden with everyone in the channel.",
  "i18n": {
    "en": { "name": "Shared Garden", "description": "Plant a shared pixel garden with everyone in the channel." },
    "zh-CN": { "name": "共享花园", "description": "和频道成员一起种下共享花园。" }
  },
  "version": "1.0.0",
  "runtime": "wasm",
  "abi": "roomhash-pixel-grid-v1",
  "entry": "pixel_garden.wasm",
  "sha256": "hex-encoded-sha256",
  "permissions": ["channel.messages", "storage:256kb"]
}
```

To publish a local app, select `roomhash.json` and its WASM entry together. An
invalid or unsupported declaration falls back to an ordinary downloadable
attachment.

Catalog metadata and manifests must provide both `i18n.en` and `i18n.zh-CN`.
The receiving client selects the localized name and description from its own
language setting; canonical top-level metadata remains the English fallback.

## `portable-surface-v1`

New interactive apps use ABI version 3 and own their responsive scene, hit
testing, drafts, validation, domain events, and merge rules inside WASM. The
generic host paints validated canvas operations and passes pointer, keyboard,
viewport, remote-event, snapshot, and host-result inputs back to the module.

Controlled effects include fullscreen, text input, random bytes, clipboard
write, file picking, content-addressed media loading, and PNG scene export. An
app with `file.download` permission may request an image crop without accessing
the DOM or filesystem directly:

```json
{
  "type": "save-image",
  "requestId": "export-1",
  "filename": "shared-board.png",
  "background": "#ffffff",
  "region": { "x": 80, "y": 80, "width": 800, "height": 520 }
}
```

The host validates and crops the current portable scene, downloads a PNG, then
returns `{ "kind": "host-result", "requestId": "export-1", "ok": true }`.
No application-specific behavior belongs in the host adapter.

## `roomhash-pixel-grid-v1`

The module must not import any functions or memory. It exports `memory` and:

```text
rh_abi_version() -> i32                 // must return 1
rh_width() -> i32
rh_height() -> i32
rh_framebuffer_ptr() -> i32
rh_framebuffer_len() -> i32             // RGBA8888, width * height * 4
rh_init()
rh_input(x, y, flower, actor, clock)
rh_apply_event(x, y, flower, actor, clock)
rh_cell_count() -> i32
rh_cell_actor(index) -> i32
rh_cell_flower(index) -> i32
rh_cell_clock(index) -> i32
```

Canvas applications may additionally export `rh_grid_width()` and
`rh_grid_height()` when their logical grid is not 32×32. Whiteboard-style apps
can export `rh_begin_stroke(actor)` and `rh_end_stroke(actor)`; RoomHash then
delivers coalesced pointer movement rather than only a single press. Tool value
`0` is reserved for erasing and `255` for a shared clear operation when the
manifest declares `"ui": { "mode": "whiteboard" }`.

For order-independent continuous lines, a whiteboard should also export
`rh_apply_stroke(from_x, from_y, x, y, tool, actor, clock)`. Replicated events
carry both segment endpoints, so applying the same segments in a different
arrival order still converges.

## `roomhash-form-v1`

Structured applications use ABI version 2. Business state and event handling
remain inside WASM; RoomHash only renders a bounded JSON view schema and carries
actions, media descriptors, snapshots, and Mesh events.

The module has no imports and exports:

```text
memory
rh_abi_version() -> i32                 // must return 2
rh_alloc(length) -> i32
rh_dealloc(pointer, length)
rh_init(pointer, length)
rh_dispatch(pointer, length)
rh_output_ptr() -> i32
rh_output_len() -> i32
```

Inputs and outputs are UTF-8 JSON capped at 2 MB. `rh_init` receives the local
nickname, peer ID, a persistent 32-byte entropy seed, channel/instance IDs, and
optional locally persisted app state. `rh_dispatch` receives one of:

```json
{ "kind": "action", "action": "...", "values": {}, "random": "64 hex chars" }
{ "kind": "remote", "event": {} }
{ "kind": "state-request" }
{ "kind": "snapshot", "state": {} }
```

The output may contain `view`, public `events`, a public `snapshot`, and private
local `persist` state. Views are rendered only from whitelisted notice, stats,
form, table, and card components; WASM cannot inject HTML or execute script.
File inputs are seeded by the host and delivered back to WASM as content-
addressed media descriptors. The WASM remains responsible for validating those
descriptors and deciding what becomes public.

Execution is opt-in, isolated in a Web Worker, limited to 10 MB of code and 64
MB of linear memory, and terminated when the worker stops responding. P2P
events are namespaced by channel, app fingerprint, and app instance.
