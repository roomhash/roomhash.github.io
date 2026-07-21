import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MessageModuleRegistry } from '../src/modules/registry.js'
import { classifyTorrentFile, isMagnetUri } from '../src/modules/torrent-media.js'

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
    assert.equal(classifyTorrentFile({ name: 'README.md' }), 'markdown')
    assert.equal(classifyTorrentFile({ name: 'notes.txt' }), 'text')
    assert.equal(classifyTorrentFile({ name: 'archive.zip' }), 'download')
  })
})
