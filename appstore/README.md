# RoomHash AppStore artifacts

This directory contains published artifacts only. Application source stays in
its independent workspace project:

- Pixel Garden: `/Users/zhuzhe/Workspace/github/pixel_garden`
- Shared Whiteboard: `/Users/zhuzhe/Workspace/RoomHash/whiteboard`
- Distributed Voting: `/Users/zhuzhe/Workspace/RoomHash/voting`
- Market: `/Users/zhuzhe/Workspace/RoomHash/market`

`catalog.json` is the machine-readable index. WASM entries include a torrent
whose HTTP Seed points back to the canonical `/appstore/<app>/` asset path.
Every AppStore entry is an embedded RoomHash WASM application; standalone web
bundles are intentionally rejected by the catalog loader.
