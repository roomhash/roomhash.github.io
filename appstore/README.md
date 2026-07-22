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

AppStore applications must also be structurally independent from the RoomHash
WebUI. An application release is one self-contained `.wasm` artifact: no
application-specific HTML, CSS, JavaScript, iframe, RoomHash DOM contract, or
RoomHash component schema. Responsive layout, interaction state, validation,
domain events, merge rules, encryption, and persistence decisions belong to
WASM. RoomHash only implements the generic portable host capabilities defined
by the Portable Surface ABI; another conforming host must be able to run the
same artifact unchanged.

This directory contains published artifacts only. Application source stays in
its independent workspace project:

- Pixel Garden: `/Users/zhuzhe/Workspace/github/pixel_garden`
- Shared Whiteboard: `/Users/zhuzhe/Workspace/RoomHash/whiteboard`
- Distributed Voting: `/Users/zhuzhe/Workspace/RoomHash/voting`
- Market: `/Users/zhuzhe/Workspace/RoomHash/market`

`catalog.json` is the machine-readable index. WASM entries include a torrent
whose HTTP Seed points back to the canonical `/appstore/<app>/` asset path.
Every AppStore entry is an embedded RoomHash WASM application.

## Portable ABI migration status

Shared Whiteboard v2 is the first `portable-surface-v1` preview: its responsive
scene, controls, hit testing, and collaboration state are owned by the WASM and
the same artifact can run in a third-party conforming host. Pixel Garden remains
on the legacy pixel-grid ABI. Voting and Market remain on the legacy form ABI
until their canvas UI migrations and multi-peer acceptance tests are complete;
they are not examples of the final portable application architecture.
