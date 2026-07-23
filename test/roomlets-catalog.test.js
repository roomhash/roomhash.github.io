import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  loadRoomletCatalog,
  localizeRoomletMetadata,
  normalizeRoomletCatalog,
  normalizeRoomletManifest,
  normalizeRoomletReference,
  roomletArtifactUrl,
  roomletRuntimeMagnet
} from '../src/roomlets.js'

const catalogUrl = new URL('../roomlets/catalog.json', import.meta.url)

function manifest({
  id = 'org.roomhash.example',
  repo = 'example',
  entry = 'example.wasm',
  name = 'Example',
  base = `https://raw.githubusercontent.com/roomhash/${repo}/main/dist`
} = {}) {
  const infoHash = '0123456789abcdef0123456789abcdef01234567'
  const webSeed = `${base}/${entry}`
  const exactSource = `${base}/${entry.replace(/\.wasm$/, '.torrent')}`
  const magnet = new URL('magnet:?')
  magnet.searchParams.set('xt', `urn:btih:${infoHash}`)
  magnet.searchParams.set('dn', entry)
  magnet.searchParams.set('ws', webSeed)
  magnet.searchParams.set('xs', exactSource)
  return {
    schema: 'roomhash.app/v1',
    id,
    name,
    description: `${name} description`,
    i18n: {
      en: { name, description: `${name} description` },
      'zh-CN': { name: `${name} 中文`, description: `${name} 中文说明` }
    },
    runtime: 'wasm',
    abi: 'portable-surface-v1',
    entry,
    sha256: 'a'.repeat(64),
    permissions: ['channel.messages'],
    distribution: {
      torrent: entry.replace(/\.wasm$/, '.torrent'),
      infoHash,
      entrySize: 12,
      webSeed,
      exactSource,
      magnet: magnet.href
    }
  }
}

describe('Roomlet catalog', () => {
  it('publishes four versioned Pages manifest references with canonical ids', async () => {
    const input = JSON.parse(await readFile(catalogUrl, 'utf8'))
    const roomlets = normalizeRoomletCatalog(input, 'https://roomhash.github.io/roomlets/catalog.json')
    assert.deepEqual(roomlets.map(({ id }) => id), [
      'org.roomhash.pixel-garden',
      'org.roomhash.whiteboard',
      'org.roomhash.voting',
      'org.roomhash.market'
    ])
    assert.equal(roomlets.every(({ manifestUrl }) =>
      /^https:\/\/roomhash\.github\.io\/roomlets\/[a-z-]+\/[a-f0-9]{64}\/roomhash\.json$/.test(manifestUrl)
    ), true)
  })

  it('loads and validates metadata from each application repository', async () => {
    const references = [
      ['org.roomhash.pixel-garden', 'pixel_garden', 'pixel_garden.wasm', 'Shared Garden'],
      ['org.roomhash.whiteboard', 'whiteboard', 'whiteboard.wasm', 'Shared Whiteboard'],
      ['org.roomhash.voting', 'voting', 'voting.wasm', 'Shared Polls'],
      ['org.roomhash.market', 'market', 'market.wasm', 'Shared Market']
    ]
    const catalog = {
      schema: 'roomhash.roomlets/v1',
      roomlets: references.map(([id, repo]) => ({
        id,
        manifestUrl: `https://raw.githubusercontent.com/roomhash/${repo}/main/dist/roomhash.json`
      }))
    }
    const manifests = new Map(references.map(([id, repo, entry, name]) => [
      `https://raw.githubusercontent.com/roomhash/${repo}/main/dist/roomhash.json`,
      manifest({ id, repo, entry, name })
    ]))
    const fetcher = async (url) => {
      if (url === './roomlets/catalog.json') {
        return {
          ok: true,
          url: 'https://roomhash.github.io/roomlets/catalog.json',
          json: async () => catalog
        }
      }
      return { ok: manifests.has(url), status: manifests.has(url) ? 200 : 404, json: async () => manifests.get(url) }
    }
    const roomlets = await loadRoomletCatalog(fetcher)
    assert.equal(roomlets.length, 4)
    assert.equal(localizeRoomletMetadata(roomlets[1], 'en').name, 'Shared Whiteboard')
    assert.equal(localizeRoomletMetadata(roomlets[1], 'zh-CN').name, 'Shared Whiteboard 中文')
    assert.equal(localizeRoomletMetadata(roomlets[3], 'zh-CN').summary, 'Shared Market 中文说明')
    assert.equal(roomletArtifactUrl(roomlets[0]).href, roomlets[0].webSeed)
    assert.equal(new URL(roomletRuntimeMagnet(roomlets[0])).searchParams.get('xs'), roomlets[0].torrentUrl)
  })

  it('rejects mismatched identities, unsafe sources, malformed magnets, and non-WASM apps', () => {
    const reference = normalizeRoomletReference({
      id: 'org.roomhash.example',
      manifestUrl: 'https://raw.githubusercontent.com/roomhash/example/main/dist/roomhash.json'
    })
    const base = manifest()
    assert.throws(() => normalizeRoomletManifest({ ...base, id: 'org.roomhash.other' }, reference), /id mismatch/)
    assert.throws(() => normalizeRoomletManifest({ ...base, runtime: 'standalone-web' }, reference), /runtime/)
    assert.throws(() => normalizeRoomletManifest({
      ...base,
      distribution: { ...base.distribution, webSeed: 'https://example.com/example.wasm' }
    }, reference), /not colocated/)
    assert.throws(() => normalizeRoomletManifest({
      ...base,
      distribution: { ...base.distribution, magnet: 'magnet:?xt=nope' }
    }, reference), /magnet/)
    assert.throws(() => normalizeRoomletReference({
      id: 'org.roomhash.bad',
      manifestUrl: 'http://example.com/roomhash.json'
    }), /manifest URL/)
  })

  it('uses a loopback publication mirror during local preview', () => {
    const reference = normalizeRoomletReference({
      id: 'org.roomhash.example',
      manifestUrl: './example/roomhash.json'
    }, 'http://127.0.0.1:4173/roomlets/catalog.json')
    const input = manifest({ base: 'https://roomhash.github.io/roomlets/example' })
    const roomlet = normalizeRoomletManifest(input, reference)
    assert.equal(roomlet.webSeed, 'http://127.0.0.1:4173/roomlets/example/example.wasm')
    assert.equal(roomlet.torrentUrl, 'http://127.0.0.1:4173/roomlets/example/example.torrent')
    assert.equal(
      new URL(roomletRuntimeMagnet(roomlet)).searchParams.get('ws'),
      roomlet.webSeed
    )
  })
})
