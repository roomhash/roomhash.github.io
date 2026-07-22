# RoomHash Rust WASM Hello World

This demo compiles a dependency-free Rust library to browser-native WebAssembly.

Build it with:

```sh
cargo build --target wasm32-unknown-unknown --release
cp target/wasm32-unknown-unknown/release/roomhash_hello_wasm.wasm hello_world.wasm
```

Open the repository through an HTTP server and visit `/demo/wasm/`.

Published RoomHash application artifacts now live under `/appstore/`; this
directory only contains the standalone ABI example.
