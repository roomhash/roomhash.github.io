import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import parseTorrent from 'parse-torrent'

import { DEMO_PIXEL_GARDEN } from '../src/demo-content.js'

const root = new URL('../appstore/', import.meta.url)

async function json(path) {
  return JSON.parse(await readFile(new URL(path, root), 'utf8'))
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(new URL(path, root))).digest('hex')
}

describe('AppStore publication', () => {
  it('indexes every checked-in application artifact', async () => {
    const catalog = await json('catalog.json')
    assert.equal(catalog.schema, 'roomhash.appstore/v1')
    assert.deepEqual(catalog.apps.map((app) => app.id), [
      'org.roomhash.pixel-garden',
      'org.roomhash.whiteboard',
      'roomhash-voting',
      'org.roomhash.market'
    ])

    for (const app of catalog.apps) {
      const manifest = await json(`${app.path.replace('/appstore/', '')}${app.manifest}`)
      assert.equal(manifest.id, app.id)
      assert.equal(manifest.runtime, 'wasm')
      assert.match(manifest.abi, /^(roomhash-(pixel-grid|form)-v1|portable-surface-v1)$/)
      const entry = await readFile(new URL(`${app.path.replace('/appstore/', '')}${app.entry}`, root))
      assert.equal(entry.length, app.entrySize)
    }
  })

  it('publishes WASM fingerprints and canonical HTTP Seeds', async () => {
    const catalog = await json('catalog.json')
    for (const app of catalog.apps.filter((entry) => entry.runtime === 'wasm')) {
      const relative = app.path.replace('/appstore/', '')
      const manifest = await json(`${relative}${app.manifest}`)
      assert.equal(await sha256(`${relative}${app.entry}`), manifest.sha256)
      const torrent = await readFile(new URL(`${relative}${app.torrent}`, root))
      assert.equal(torrent.includes(Buffer.from(app.webSeed)), true)
      const parsed = await parseTorrent(torrent)
      assert.equal(parsed.infoHash, app.infoHash)
      assert.equal(new URL(app.magnet).searchParams.get('xt'), `urn:btih:${parsed.infoHash}`)
      assert.equal(new URL(app.magnet).searchParams.get('ws'), app.webSeed)
      assert.equal(new URL(app.magnet).searchParams.get('xs'), `https://roomhash.github.io${app.path}${app.torrent}`)
    }
  })

  it('keeps the Pixel Garden info hash while moving its seed to AppStore', () => {
    const magnet = new URL(DEMO_PIXEL_GARDEN.magnet)
    assert.equal(magnet.searchParams.get('xt'), 'urn:btih:203d5be59b06376f0b1ef18e2360fc0e33a07cd4')
    assert.equal(magnet.searchParams.get('ws'), 'https://roomhash.github.io/appstore/pixel-garden/pixel_garden.wasm')
    assert.equal(magnet.searchParams.get('xs'), 'https://roomhash.github.io/appstore/pixel-garden/pixel_garden.torrent')
    assert.equal(DEMO_PIXEL_GARDEN.torrentUrl, 'https://roomhash.github.io/appstore/pixel-garden/pixel_garden.torrent')
  })
})
