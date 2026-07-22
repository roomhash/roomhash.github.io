# RoomHash AppStore artifacts

## Mandatory WASM-only policy

Every application listed in RoomHash AppStore **must** be an embedded WASM
application with `runtime: "wasm"`, a valid `roomhash.app/v1` manifest, and a
supported RoomHash ABI. Standalone HTML/JavaScript sites, links, iframes, and
`standalone-web` catalog entries are not AppStore applications and must not be
published here.

Application state transitions and business rules belong inside the WASM. The
RoomHash host may provide only the documented capabilities such as bounded UI
rendering, Mesh transport, local persistence, and content-addressed media. The
catalog loader and publication tests enforce this policy.

This directory contains published artifacts only. Application source stays in
its independent workspace project:

- Pixel Garden: `/Users/zhuzhe/Workspace/github/pixel_garden`
- Shared Whiteboard: `/Users/zhuzhe/Workspace/RoomHash/whiteboard`
- Distributed Voting: `/Users/zhuzhe/Workspace/RoomHash/voting`
- Market: `/Users/zhuzhe/Workspace/RoomHash/market`

`catalog.json` is the machine-readable index. WASM entries include a torrent
whose HTTP Seed points back to the canonical `/appstore/<app>/` asset path.
Every AppStore entry is an embedded RoomHash WASM application.
