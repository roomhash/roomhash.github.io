import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  TorrentMediaController,
  createTorrentMediaPayload
} from '../src/modules/torrent-media.js'

const INFO_HASH = 'a'.repeat(40)
const MAGNET = `magnet:?xt=urn:btih:${INFO_HASH}&dn=notes`

function torrentSource() {
  return {
    infoHash: INFO_HASH,
    magnetURI: MAGNET,
    name: 'notes',
    files: [
      { name: 'one.txt', length: 3, type: 'text/plain' },
      { name: 'two.bin', length: 7, type: '' }
    ]
  }
}

describe('local seed sharing', () => {
  it('recognizes a completed active Roomlet entry as locally cached', async () => {
    const controller = new TorrentMediaController({ cache: { get: async () => null } })
    controller.client = {
      get: async () => ({
        done: true,
        files: [{ name: 'voting.wasm', length: 309531 }]
      })
    }

    assert.equal(await controller.hasCached(INFO_HASH, {
      entry: 'voting.wasm',
      size: 309531
    }), true)
    assert.equal(await controller.hasCached(INFO_HASH, {
      entry: 'voting.wasm',
      size: 1
    }), false)
  })

  it('recognizes a matching persisted Roomlet entry while stopped', async () => {
    const controller = new TorrentMediaController({
      cache: {
        get: async () => ({
          torrentFile: new ArrayBuffer(1),
          files: [{ path: 'bundle/market.wasm', length: 433129 }]
        })
      }
    })

    assert.equal(await controller.hasCached(INFO_HASH, {
      entry: 'market.wasm',
      size: 433129
    }), true)
    assert.equal(await controller.hasCached('not-an-info-hash', {
      entry: 'market.wasm',
      size: 433129
    }), false)
  })

  it('creates a torrent.media payload from an IndexedDB-shaped record without blobs', () => {
    const source = torrentSource()
    source.files[0].blob = { size: 3, privateContents: 'do not send' }
    const payload = createTorrentMediaPayload(source)

    assert.deepEqual(payload, {
      magnet: MAGNET,
      title: 'notes',
      files: [
        { name: 'one.txt', size: 3, mime: 'text/plain' },
        { name: 'two.bin', size: 7, mime: '' }
      ]
    })
    assert.doesNotMatch(JSON.stringify(payload), /blob|privateContents/)
  })

  it('uses an active torrent without reading the cache', async () => {
    const torrent = torrentSource()
    const controller = new TorrentMediaController({
      cache: { get: async () => { throw new Error('cache should not be read') } }
    })
    controller.client = { get: async () => torrent }
    controller.start = async () => controller.client

    assert.deepEqual(await controller.prepareLocalSeedShare(INFO_HASH), createTorrentMediaPayload(torrent))
  })

  it('resumes a stopped cached seed before creating its payload', async () => {
    const torrent = torrentSource()
    let activeTorrent = null
    let resumed = 0
    const controller = new TorrentMediaController({ cache: { get: async () => null } })
    controller.client = { get: async () => activeTorrent }
    controller.start = async () => controller.client
    controller.resumeSeed = async (infoHash) => {
      assert.equal(infoHash, INFO_HASH)
      resumed += 1
      activeTorrent = torrent
    }

    const payload = await controller.prepareLocalSeedShare(INFO_HASH)
    assert.equal(resumed, 1)
    assert.deepEqual(payload, createTorrentMediaPayload(torrent))
  })

  it('waits for an in-progress cached restore before sharing', async () => {
    const torrent = torrentSource()
    let finishRestore
    const restoring = new Promise((resolve) => { finishRestore = resolve })
    const controller = new TorrentMediaController({ cache: { get: async () => null } })
    controller.client = { get: async () => torrent }
    controller.start = async () => controller.client
    controller.seedRestorePromises.set(INFO_HASH, restoring)

    let settled = false
    const preparing = controller.prepareLocalSeedShare(INFO_HASH).then((payload) => {
      settled = true
      return payload
    })
    await Promise.resolve()
    assert.equal(settled, false)
    finishRestore(torrent)
    assert.deepEqual(await preparing, createTorrentMediaPayload(torrent))
  })

  it('rejects malformed cached metadata', () => {
    assert.throws(
      () => createTorrentMediaPayload({ magnetURI: 'https://example.com/file', files: [{ name: 'x' }] }),
      /valid magnet/
    )
    assert.throws(
      () => createTorrentMediaPayload({ magnetURI: MAGNET, files: [] }),
      /shareable files/
    )
  })
})
