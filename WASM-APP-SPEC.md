# RoomHash WASM App v1

RoomHash treats an ordinary `.wasm` attachment as a downloadable torrent. It is
executable only when a `roomhash.json` manifest declares a supported ABI and the
downloaded bytes match the manifest SHA-256 fingerprint.

## Manifest

```json
{
  "schema": "roomhash.app/v1",
  "id": "org.roomhash.pixel-garden",
  "name": "Pixel Garden",
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

Execution is opt-in, isolated in a Web Worker, limited to 10 MB of code and 64
MB of linear memory, and terminated when the worker stops responding. P2P
events are namespaced by channel, app fingerprint, and app instance.
