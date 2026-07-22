export const APPSTORE_CATALOG_URL = './appstore/catalog.json'

const RUNTIMES = new Set(['wasm'])
const METADATA_LOCALES = ['en', 'zh-CN']
const METADATA_FIELDS = { name: 120, summary: 320, description: 320, notice: 480, privacy: 480 }
const SAFE_FILE = /^[a-z0-9][a-z0-9._-]{0,127}$/i
const SAFE_PATH = /^\/appstore\/[a-z0-9][a-z0-9-]{0,63}\/$/i

function string(value, name, max = 240) {
  const result = String(value ?? '').trim()
  if (!result || result.length > max) throw new Error(`invalid Roomlet ${name}`)
  return result
}

function normalizeI18n(input) {
  if (input == null) return Object.freeze({})
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('invalid Roomlet i18n metadata')
  }
  const result = {}
  for (const locale of METADATA_LOCALES) {
    const source = input[locale]
    if (source == null) continue
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw new Error(`invalid Roomlet i18n metadata for ${locale}`)
    }
    const translated = {}
    for (const [field, max] of Object.entries(METADATA_FIELDS)) {
      if (source[field] == null || source[field] === '') continue
      translated[field] = string(source[field], `${locale}.${field}`, max)
    }
    if (!translated.name) throw new Error(`invalid Roomlet i18n name for ${locale}`)
    result[locale] = Object.freeze(translated)
  }
  return Object.freeze(result)
}

export function localizeAppMetadata(metadata, language = 'en') {
  const locale = String(language).toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
  const translated = metadata?.i18n?.[locale] || metadata?.i18n?.en || {}
  const localized = {}
  for (const field of Object.keys(METADATA_FIELDS)) {
    localized[field] = String(translated[field] || metadata?.[field] || '').trim()
  }
  return Object.freeze(localized)
}

export function normalizeAppstoreEntry(input) {
  const id = string(input?.id, 'id', 160)
  const name = string(input?.name, 'name', 120)
  const runtime = string(input?.runtime, 'runtime', 32)
  const path = string(input?.path, 'path', 120)
  const manifest = string(input?.manifest, 'manifest', 128)
  const entry = string(input?.entry, 'entry', 128)
  if (!RUNTIMES.has(runtime)) throw new Error(`unsupported Roomlet runtime: ${runtime}`)
  if (!SAFE_PATH.test(path) || !SAFE_FILE.test(manifest) || !SAFE_FILE.test(entry)) {
    throw new Error('unsafe Roomlet artifact path')
  }

  const normalized = {
    id,
    name,
    runtime,
    path,
    manifest,
    entry,
    summary: String(input?.summary || '').trim().slice(0, 320),
    i18n: normalizeI18n(input?.i18n)
  }
  const magnet = string(input?.magnet, 'magnet', 4096)
  let magnetUrl
  try { magnetUrl = new URL(magnet) } catch { throw new Error('invalid Roomlet magnet') }
  if (magnetUrl.protocol !== 'magnet:' || !/^urn:btih:[a-f0-9]{40}$/i.test(magnetUrl.searchParams.get('xt') || '')) {
    throw new Error('invalid Roomlet magnet')
  }
  normalized.magnet = magnet
  normalized.entrySize = Number(input.entrySize || 0)
  if (!Number.isSafeInteger(normalized.entrySize) || normalized.entrySize <= 0) {
    throw new Error('invalid Roomlet entry size')
  }
  return Object.freeze(normalized)
}

export function normalizeAppstoreCatalog(input) {
  if (input?.schema !== 'roomhash.appstore/v1' || !Array.isArray(input.apps)) {
    throw new Error('invalid Roomlet catalog')
  }
  const apps = input.apps.map(normalizeAppstoreEntry)
  if (new Set(apps.map((app) => app.id)).size !== apps.length) {
    throw new Error('duplicate Roomlet app id')
  }
  return Object.freeze(apps)
}

export async function loadAppstoreCatalog(fetcher = globalThis.fetch) {
  if (typeof fetcher !== 'function') throw new Error('Roomlet catalog fetch is unavailable')
  const response = await fetcher(APPSTORE_CATALOG_URL, { cache: 'no-cache' })
  if (!response?.ok) throw new Error(`Roomlet catalog request failed (${response?.status || 0})`)
  return normalizeAppstoreCatalog(await response.json())
}

export function appstoreArtifactUrl(app, file = app.entry, origin = globalThis.location?.origin) {
  if (!SAFE_FILE.test(String(file || ''))) throw new Error('unsafe Roomlet artifact file')
  const base = new URL(app.path, origin || 'https://roomhash.github.io')
  return new URL(file, base)
}

export function appstoreRuntimeMagnet(app, origin = globalThis.location?.origin) {
  const magnet = new URL(app.magnet)
  if (magnet.protocol !== 'magnet:') throw new Error('invalid Roomlet magnet')
  // Resolve both the HTTP seed and exact-source torrent against the page that
  // supplied the catalog. An older remote .torrent can otherwise replace the
  // local magnet metadata and pair a development manifest with an old binary.
  magnet.searchParams.set('ws', appstoreArtifactUrl(app, app.entry, origin).href)
  const exactSource = magnet.searchParams.get('xs')
  if (exactSource) {
    const torrentFile = new URL(exactSource).pathname.split('/').pop()
    if (!SAFE_FILE.test(String(torrentFile || ''))) throw new Error('unsafe Roomlet torrent file')
    magnet.searchParams.set('xs', appstoreArtifactUrl(app, torrentFile, origin).href)
  }
  return magnet.href
}
