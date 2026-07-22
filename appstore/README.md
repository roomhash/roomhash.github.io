# RoomHash Roomlet artifacts

Roomlet means “Room Applet”, called “聊应用” in Chinese. Product UI uses this
name consistently; WASM remains the implementation and packaging format.

## Mandatory WASM-only policy

Every application listed in the Roomlet catalog **must** be an embedded WASM
application with `runtime: "wasm"`, a valid `roomhash.app/v1` manifest, and a
supported RoomHash ABI. Standalone HTML/JavaScript sites, links, iframes, and
`standalone-web` catalog entries are not Roomlets and must not be
published here.

Application state transitions and business rules belong inside the WASM. The
RoomHash host may provide only the documented capabilities such as bounded UI
rendering, Mesh transport, local persistence, and content-addressed media. The
catalog loader and publication tests enforce this policy.

Roomlets must also be structurally independent from the RoomHash
WebUI. An application release is one self-contained `.wasm` artifact: no
application-specific HTML, CSS, JavaScript, iframe, RoomHash DOM contract, or
RoomHash component schema. Responsive layout, interaction state, validation,
domain events, merge rules, encryption, and persistence decisions belong to
WASM. RoomHash only implements the generic portable host capabilities defined
by the Portable Surface ABI; another conforming host must be able to run the
same artifact unchanged.

This directory contains published artifacts only. Application source stays in
its independent workspace project:

- Shared Garden: `/Users/zhuzhe/Workspace/github/pixel_garden`
- Shared Whiteboard: `/Users/zhuzhe/Workspace/RoomHash/whiteboard`
- Shared Polls: `/Users/zhuzhe/Workspace/RoomHash/voting`
- Shared Market: `/Users/zhuzhe/Workspace/RoomHash/market`

`catalog.json` is the machine-readable index. WASM entries include a torrent
whose HTTP Seed points back to the canonical `/appstore/<app>/` asset path.
Every catalog entry is an embedded RoomHash WASM application.

## Portable ABI migration status

Shared Whiteboard v2, Shared Polls v1, and Shared Market v2 use
`portable-surface-v1`. Their responsive scenes, controls, forms, hit testing,
scrolling, domain state, validation, P2P merge rules, and cryptography are owned
by Rust WASM, and the same artifacts can run in a third-party conforming host.
Shared Garden remains on the legacy pixel-grid ABI during its separate migration.
The `roomhash-form-v1` adapter is retained only for backward compatibility with
old chat messages; no current Roomlet uses it.
