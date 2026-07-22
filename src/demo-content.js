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
  "magnet": "magnet:?xt=urn:btih:203d5be59b06376f0b1ef18e2360fc0e33a07cd4&dn=pixel_garden.wasm&tr=wss%3A%2F%2Ftracker.openwebtorrent.com&ws=https%3A%2F%2Froomhash.github.io%2Fappstore%2Fpixel-garden%2Fpixel_garden.wasm&xs=https%3A%2F%2Froomhash.github.io%2Fappstore%2Fpixel-garden%2Fpixel_garden.torrent",
  "torrentUrl": "https://roomhash.github.io/appstore/pixel-garden/pixel_garden.torrent",
  "title": "Shared Garden - RoomHash mini app",
  "manifest": {
    "schema": "roomhash.app/v1",
    "id": "org.roomhash.pixel-garden",
    "name": "Shared Garden",
    "description": "Plant a shared pixel garden and watch it grow with everyone in the channel.",
    "i18n": {
      "en": {
        "name": "Shared Garden",
        "description": "Plant a shared pixel garden and watch it grow with everyone in the channel."
      },
      "zh-CN": {
        "name": "共享花园",
        "description": "和频道成员一起种下像素花园，让每一次互动都成为共同生长的一部分。"
      }
    },
    "version": "1.0.0",
    "runtime": "wasm",
    "abi": "roomhash-pixel-grid-v1",
    "entry": "pixel_garden.wasm",
    "sha256": "340b7f1a3b8b1891bd7440b1b81a584a79124dca97f10c448d0e85bd23e162dc",
    "legacyNumericGrid": {
      "schema": "roomhash.numeric-grid/v1",
      "columns": 32,
      "rows": 32,
      "exports": {
        "width": "rh_width",
        "height": "rh_height",
        "framebufferPointer": "rh_framebuffer_ptr",
        "framebufferLength": "rh_framebuffer_len",
        "initialize": "rh_init",
        "write": "rh_input",
        "merge": "rh_apply_event",
        "recordCount": "rh_cell_count",
        "recordActor": "rh_cell_actor",
        "recordValue": "rh_cell_flower",
        "recordClock": "rh_cell_clock"
      },
      "controls": [
        { "value": 1, "color": "#f5b84b", "label": "样式 1" },
        { "value": 2, "color": "#51d7b7", "label": "样式 2" },
        { "value": 3, "color": "#ff7b72", "label": "样式 3" },
        { "value": 4, "color": "#74b9ff", "label": "样式 4" }
      ]
    },
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
