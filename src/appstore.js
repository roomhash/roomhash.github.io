export const APPSTORE_CATALOG_URL = './appstore/catalog.json'

const RUNTIMES = new Set(['wasm', 'standalone-web'])
const SAFE_FILE = /^[a-z0-9][a-z0-9._-]{0,127}$/i
const SAFE_PATH = /^\/appstore\/[a-z0-9][a-z0-9-]{0,63}\/$/i

function string(value, name, max = 240) {
  const result = String(value ?? '').trim()
  if (!result || result.length > max) throw new Error(`invalid AppStore ${name}`)
  return result
}

export function normalizeAppstoreEntry(input) {
  const id = string(input?.id, 'id', 160)
  const name = string(input?.name, 'name', 120)
  const runtime = string(input?.runtime, 'runtime', 32)
  const path = string(input?.path, 'path', 120)
  const manifest = string(input?.manifest, 'manifest', 128)
  const entry = string(input?.entry, 'entry', 128)
  if (!RUNTIMES.has(runtime)) throw new Error(`unsupported AppStore runtime: ${runtime}`)
  if (!SAFE_PATH.test(path) || !SAFE_FILE.test(manifest) || !SAFE_FILE.test(entry)) {
    throw new Error('unsafe AppStore artifact path')
  }

  const normalized = {
    id,
    name,
    runtime,
    path,
    manifest,
    entry,
    summary: String(input?.summary || '').trim().slice(0, 320)
  }
  if (runtime === 'wasm') {
    const magnet = string(input?.magnet, 'magnet', 4096)
    let magnetUrl
    try { magnetUrl = new URL(magnet) } catch { throw new Error('invalid AppStore magnet') }
    if (magnetUrl.protocol !== 'magnet:' || !/^urn:btih:[a-f0-9]{40}$/i.test(magnetUrl.searchParams.get('xt') || '')) {
      throw new Error('invalid AppStore magnet')
    }
    normalized.magnet = magnet
    normalized.entrySize = Number(input.entrySize || 0)
    if (!Number.isSafeInteger(normalized.entrySize) || normalized.entrySize <= 0) {
      throw new Error('invalid AppStore entry size')
    }
  } else {
    const shareUrl = string(input?.shareUrl, 'shareUrl', 2048)
    const parsed = new URL(shareUrl)
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'roomhash.github.io') {
      throw new Error('invalid AppStore share URL')
    }
    normalized.shareUrl = parsed.href
  }
  return Object.freeze(normalized)
}

export function normalizeAppstoreCatalog(input) {
  if (input?.schema !== 'roomhash.appstore/v1' || !Array.isArray(input.apps)) {
    throw new Error('invalid AppStore catalog')
  }
  const apps = input.apps.map(normalizeAppstoreEntry)
  if (new Set(apps.map((app) => app.id)).size !== apps.length) {
    throw new Error('duplicate AppStore app id')
  }
  return Object.freeze(apps)
}

export async function loadAppstoreCatalog(fetcher = globalThis.fetch) {
  if (typeof fetcher !== 'function') throw new Error('AppStore fetch is unavailable')
  const response = await fetcher(APPSTORE_CATALOG_URL, { cache: 'no-cache' })
  if (!response?.ok) throw new Error(`AppStore catalog request failed (${response?.status || 0})`)
  return normalizeAppstoreCatalog(await response.json())
}

export function appstoreArtifactUrl(app, file = app.entry, origin = globalThis.location?.origin) {
  if (!SAFE_FILE.test(String(file || ''))) throw new Error('unsafe AppStore artifact file')
  const base = new URL(app.path, origin || 'https://roomhash.github.io')
  return new URL(file, base)
}
