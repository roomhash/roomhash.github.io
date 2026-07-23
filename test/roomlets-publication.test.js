import { createHash } from 'node:crypto'
import { access, readFile, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import parseTorrent from 'parse-torrent'

const root = new URL('../', import.meta.url)
const roomletsRoot = new URL('roomlets/', root)

describe('Roomlet publication boundary', () => {
  it('keeps source separate while publishing verified runtime snapshots on Pages', async () => {
    const catalog = JSON.parse(await readFile(new URL('catalog.json', roomletsRoot), 'utf8'))
    assert.equal(catalog.schema, 'roomhash.roomlets/v1')
    assert.equal(catalog.roomlets.length, 4)

    for (const reference of catalog.roomlets) {
      const manifestUrl = new URL(reference.manifestUrl, 'https://roomhash.github.io/roomlets/catalog.json')
      assert.equal(manifestUrl.origin, 'https://roomhash.github.io')
      assert.match(manifestUrl.pathname, /^\/roomlets\/[a-z-]+\/[a-f0-9]{64}\/roomhash\.json$/)
      const relativeManifest = manifestUrl.pathname.replace(/^\/roomlets\//, '')
      const manifestFile = new URL(relativeManifest, roomletsRoot)
      const releaseDirectory = new URL('./', manifestFile)
      const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
      assert.equal(manifest.id, reference.id)
      assert.equal(manifest.runtime, 'wasm')
      assert.equal(manifestUrl.pathname.split('/').at(-2), manifest.sha256)

      const files = (await readdir(releaseDirectory)).sort()
      assert.deepEqual(files, [manifest.entry, 'roomhash.json', manifest.distribution.torrent].sort())
      const wasm = await readFile(new URL(manifest.entry, releaseDirectory))
      const torrentBytes = await readFile(new URL(manifest.distribution.torrent, releaseDirectory))
      const torrent = await parseTorrent(torrentBytes)
      const digest = createHash('sha256').update(wasm).digest('hex')
      assert.equal(digest, manifest.sha256)
      assert.equal(wasm.length, manifest.distribution.entrySize)
      assert.equal(torrent.length, wasm.length)
      assert.equal(torrent.name, manifest.entry)
      assert.equal(torrent.infoHash, manifest.distribution.infoHash)
      assert.deepEqual(torrent.urlList, [manifest.distribution.webSeed])
      assert.equal(manifest.distribution.webSeed, new URL(manifest.entry, manifestUrl).href)
      assert.equal(
        manifest.distribution.exactSource,
        new URL(manifest.distribution.torrent, manifestUrl).href
      )
      const magnet = new URL(manifest.distribution.magnet)
      assert.equal(magnet.searchParams.get('xt'), `urn:btih:${torrent.infoHash}`)
      assert.equal(magnet.searchParams.get('ws'), manifest.distribution.webSeed)
      assert.equal(magnet.searchParams.get('xs'), manifest.distribution.exactSource)
    }

    await assert.rejects(access(new URL('appstore/', root), constants.F_OK))
    await assert.rejects(access(new URL('demo/wasm/', root), constants.F_OK))
  })

  it('does not hardcode Shared Garden application payloads in demo content', async () => {
    const source = await readFile(new URL('src/demo-content.js', root), 'utf8')
    assert.doesNotMatch(source, /PIXEL_GARDEN|pixel_garden|roomhash\.app\/v1/)
    assert.match(source, /DEMO_VIDEO/)
  })

  it('copies the complete Roomlet publication mirror during the Pages build', async () => {
    const source = await readFile(new URL('vite.config.js', root), 'utf8')
    assert.match(source, /cpSync\(resolve\(root, 'roomlets'\)/)
    assert.doesNotMatch(source, /appstore|demo\/wasm/)
  })
})
