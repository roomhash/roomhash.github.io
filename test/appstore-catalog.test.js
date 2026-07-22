import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  appstoreArtifactUrl,
  appstoreRuntimeMagnet,
  localizeAppMetadata,
  normalizeAppstoreCatalog,
  normalizeAppstoreEntry
} from '../src/appstore.js'

const catalogUrl = new URL('../appstore/catalog.json', import.meta.url)

describe('Roomlet chat catalog', () => {
  it('normalizes every published app into a shareable descriptor', async () => {
    const input = JSON.parse(await readFile(catalogUrl, 'utf8'))
    const apps = normalizeAppstoreCatalog(input)
    assert.equal(apps.length, 4)
    assert.equal(apps.every((app) => app.runtime === 'wasm'), true)
    assert.equal(apps.every((app) => app.summary.length > 0), true)
    assert.equal(apps.every((app) => app.i18n.en?.name && app.i18n['zh-CN']?.name), true)
    assert.equal(localizeAppMetadata(apps[1], 'en').name, 'Shared Whiteboard')
    assert.equal(localizeAppMetadata(apps[1], 'zh-CN').name, '共享白板')
    assert.match(localizeAppMetadata(apps[3], 'zh-CN').summary, /买家联系方式/)
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
      magnet: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&ws=https%3A%2F%2Froomhash.github.io%2Fappstore%2Fexample%2Fexample.wasm&xs=https%3A%2F%2Froomhash.github.io%2Fappstore%2Fexample%2Fexample.torrent'
    })
    assert.equal(
      appstoreArtifactUrl(app, app.manifest, 'https://roomhash.github.io').href,
      'https://roomhash.github.io/appstore/example/roomhash.json'
    )
    assert.equal(
      new URL(appstoreRuntimeMagnet(app, 'http://127.0.0.1:4173')).searchParams.get('ws'),
      'http://127.0.0.1:4173/appstore/example/example.wasm'
    )
    assert.equal(
      new URL(appstoreRuntimeMagnet(app, 'http://127.0.0.1:4173')).searchParams.get('xs'),
      'http://127.0.0.1:4173/appstore/example/example.torrent'
    )
    assert.throws(
      () => appstoreArtifactUrl(app, '../catalog.json', 'https://roomhash.github.io'),
      /unsafe/
    )
  })

  it('rejects unsafe paths, malformed magnets and standalone web apps', () => {
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
    }), /runtime/)
    assert.throws(() => normalizeAppstoreEntry({
      ...base,
      path: '/appstore/bad/',
      i18n: { en: { summary: 'Missing a localized name' } }
    }), /i18n name/)
  })
})
