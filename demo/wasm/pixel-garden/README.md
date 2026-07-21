# RoomHash Pixel Garden

Pixel Garden is a hostless, drop-in multiplayer demo built with Rust WebAssembly and Trystero.

The Rust module owns the deterministic 32 by 32 board reducer. Each cell is an independent last-writer-wins register ordered by Lamport clock and actor ID. JavaScript provides rendering, local persistence, gossip forwarding, deduplication, presence, and snapshot exchange.

Build the WASM module with:

```sh
cargo build --target wasm32-unknown-unknown --release
cp target/wasm32-unknown-unknown/release/roomhash_pixel_garden.wasm pixel_garden.wasm
```

Run the RoomHash Vite server and open `/demo/wasm/pixel-garden/`. Share the resulting URL, including its `room` query parameter, with another browser.

This demo intentionally does not provide publisher signatures or the future RoomHash Plugin SDK capability boundary.
