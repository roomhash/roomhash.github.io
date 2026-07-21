/** Built-in RoomHash demo torrent descriptors. Generated from the checked-in assets. */

export const DEMO_VIDEO = Object.freeze({
  "magnet": "magnet:?xt=urn:btih:365608e862ea451b8821c08c43a7c8e1c88617f8&dn=file_example_MP4_640_3MG.mp4&tr=wss%3A%2F%2Ftracker.openwebtorrent.com&ws=https%3A%2F%2Froomhash.github.io%2Fdemo%2Fvideo%2Ffile_example_MP4_640_3MG.mp4&xs=https%3A%2F%2Froomhash.github.io%2Fdemo%2Fvideo%2Ffile_example_MP4_640_3MG.torrent",
  "torrentUrl": "https://roomhash.github.io/demo/video/file_example_MP4_640_3MG.torrent",
  "title": "RoomHash demo video",
  "demo": "video",
  "webSeed": "https://roomhash.github.io/demo/video/file_example_MP4_640_3MG.mp4",
  "files": [
    {
      "name": "file_example_MP4_640_3MG.mp4",
      "size": 3114374,
      "mime": "video/mp4"
    }
  ]
})

export const DEMO_PIXEL_GARDEN = Object.freeze({
  "magnet": "magnet:?xt=urn:btih:203d5be59b06376f0b1ef18e2360fc0e33a07cd4&dn=pixel_garden.wasm&tr=wss%3A%2F%2Ftracker.openwebtorrent.com&ws=https%3A%2F%2Froomhash.github.io%2Fdemo%2Fwasm%2Fpixel-garden%2Fpixel_garden.wasm&xs=https%3A%2F%2Froomhash.github.io%2Fdemo%2Fwasm%2Fpixel-garden%2Fpixel_garden.torrent",
  "torrentUrl": "https://roomhash.github.io/demo/wasm/pixel-garden/pixel_garden.torrent",
  "title": "Pixel Garden - RoomHash WASM game",
  "manifest": {
    "schema": "roomhash.app/v1",
    "id": "org.roomhash.pixel-garden",
    "name": "Pixel Garden",
    "version": "1.0.0",
    "runtime": "wasm",
    "abi": "roomhash-pixel-grid-v1",
    "entry": "pixel_garden.wasm",
    "sha256": "340b7f1a3b8b1891bd7440b1b81a584a79124dca97f10c448d0e85bd23e162dc",
    "permissions": [
      "channel.messages",
      "storage:256kb"
    ]
  },
  "files": [
    {
      "name": "pixel_garden.wasm",
      "size": 1077,
      "mime": "application/wasm"
    }
  ]
})
