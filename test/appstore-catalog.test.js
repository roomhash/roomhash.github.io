import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  appstoreArtifactUrl,
  normalizeAppstoreCatalog,
  normalizeAppstoreEntry
} from '../src/appstore.js'

const catalogUrl = new URL('../appstore/catalog.json', import.meta.url)

describe('AppStore chat catalog', () => {
  it('normalizes every published app into a shareable descriptor', async () => {
    const input = JSON.parse(await readFile(catalogUrl, 'utf8'))
    const apps = normalizeAppstoreCatalog(input)
    assert.equal(apps.length, 4)
    assert.equal(apps.filter((app) => app.runtime === 'wasm').length, 2)
    assert.equal(apps.filter((app) => app.runtime === 'standalone-web').length, 2)
    assert.equal(apps.every((app) => app.summary.length > 0), true)
  })

  it('resolves artifacts only within a catalog app directory', () => {
    const app = normalizeAppstoreEntry({
      id: 'org.roomhash.example',
      name: 'Example',
      runtime: 'wasm',
      path: '/appstore/example/',
      manifest: 'roomhash.json',
      entry: 'example.wasm',
      entrySize: 12,
      magnet: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567'
    })
    assert.equal(
      appstoreArtifactUrl(app, app.manifest, 'https://roomhash.github.io').href,
      'https://roomhash.github.io/appstore/example/roomhash.json'
    )
    assert.throws(
      () => appstoreArtifactUrl(app, '../catalog.json', 'https://roomhash.github.io'),
      /unsafe/
    )
  })

  it('rejects unsafe paths, malformed magnets and off-site web apps', () => {
    const base = {
      id: 'org.roomhash.bad',
      name: 'Bad',
      runtime: 'wasm',
      path: '/appstore/../bad/',
      manifest: 'roomhash.json',
      entry: 'bad.wasm',
      entrySize: 1,
      magnet: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567'
    }
    assert.throws(() => normalizeAppstoreEntry(base), /unsafe/)
    assert.throws(() => normalizeAppstoreEntry({ ...base, path: '/appstore/bad/', magnet: 'magnet:?xt=nope' }), /magnet/)
    assert.throws(() => normalizeAppstoreEntry({
      ...base,
      runtime: 'standalone-web',
      path: '/appstore/bad/',
      shareUrl: 'https://example.com/app/'
    }), /share URL/)
  })
})
