/** App-wide constants shared by UI and P2P session. */

export const APP_ID = 'roomhash-github-io-v1'

/**
 * Canonical tracker shown in the UI and used as the default URL sentinel.
 * The session uses Trystero's redundant default tracker pool until the user
 * supplies a custom tracker; non-default values are embedded in share URLs.
 */
export const DEFAULT_TRACKER = 'wss://tracker.openwebtorrent.com'

/** Public WebTorrent trackers used for browser-to-browser content swarms. */
export const DEFAULT_TORRENT_TRACKERS = [
  'wss://tracker.webtorrent.dev',
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz'
]

export const STORAGE_PREFIX = 'roomhash:'
