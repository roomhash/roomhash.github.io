import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { MessageModuleRegistry } from '../src/modules/registry.js'
import { classifyTorrentFile, isMagnetUri } from '../src/modules/torrent-media.js'
import { SUPPORTED_WASM_ABIS } from '../src/modules/wasm-app.js'

describe('message modules', () => {
  it('registers versioned renderers', () => {
    const registry = new MessageModuleRegistry().register({
      id: 'test.card',
      version: 1,
      render: () => 'rendered'
    })
    assert.equal(registry.canRender({ module: 'test.card', moduleVersion: 1 }), true)
    assert.equal(registry.canRender({ module: 'test.card', moduleVersion: 2 }), false)
  })

  it('validates magnets and classifies supported previews', () => {
    assert.equal(isMagnetUri('magnet:?xt=urn:btih:abcdef'), true)
    assert.equal(isMagnetUri('https://example.com/file.mp4'), false)
    assert.equal(classifyTorrentFile({ name: 'clip.mp4' }), 'video')
    assert.equal(classifyTorrentFile({ name: 'photo.webp' }), 'image')
    assert.equal(classifyTorrentFile({ name: 'README.md' }), 'markdown')
    assert.equal(classifyTorrentFile({ name: 'notes.txt' }), 'text')
    assert.equal(classifyTorrentFile({ name: 'archive.zip' }), 'download')
  })

  it('supports both canvas and structured embedded WASM applications', () => {
    assert.equal(SUPPORTED_WASM_ABIS.has('roomhash-pixel-grid-v1'), true)
    assert.equal(SUPPORTED_WASM_ABIS.has('roomhash-form-v1'), true)
    assert.equal(SUPPORTED_WASM_ABIS.has('standalone-web'), false)
  })

  it('keeps the host adapter free of application-domain behavior', async () => {
    const sources = await Promise.all([
      readFile(new URL('../src/modules/wasm-app.js', import.meta.url), 'utf8'),
      readFile(new URL('../src/workers/wasm-runtime.worker.js', import.meta.url), 'utf8')
    ])
    const forbidden = /whiteboard|flower|plant|eraser|clear.?board|stroke|cell/i
    for (const source of sources) assert.doesNotMatch(source, forbidden)
    assert.match(sources[0], /save-image/)
    assert.match(sources[0], /file\.download/)
    assert.match(sources[0], /shell\.appendChild\(input\)/)
    assert.match(sources[0], /compositionstart/)
    assert.match(sources[0], /compositionend/)
    assert.doesNotMatch(sources[0], /doc\.body\.appendChild\(input\)/)
  })
})
