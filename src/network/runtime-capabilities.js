function isPublicAddress(address) {
  if (typeof address !== 'string') return false
  const value = address.replace(/^\[|\]$/g, '')
  if (/^(10\.|127\.|169\.254\.|192\.168\.)/.test(value)) return false
  const match = /^172\.(\d+)\./.exec(value)
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return false
  if (/^(0\.|224\.|255\.)/.test(value)) return false
  if (/^(::1|fc|fd|fe80)/i.test(value)) return false
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(value) || value.includes(':')
}

export class RuntimeCapabilities {
  constructor(adapter = globalThis.roomHashHost?.network || null) {
    this.adapter = adapter
    this.publicStatus = {
      public: false,
      state: adapter ? 'checking' : 'browser-limited',
      method: adapter ? 'host-probe' : 'ice-observation',
      detail: adapter
        ? 'Waiting for host reachability probe.'
        : 'Browser sandbox cannot open or externally probe a raw port.'
    }
    this.mapping = null
  }

  get upnpSupported() {
    return typeof this.adapter?.openUpnpPort === 'function'
  }

  async enableUpnp({ leaseSeconds = 1800 } = {}) {
    if (!this.upnpSupported) throw new Error('UPnP requires a desktop or headless host adapter')
    this.mapping = await this.adapter.openUpnpPort({ leaseSeconds })
    return this.detectPublicNode([])
  }

  async disableUpnp() {
    if (this.mapping && typeof this.adapter?.closeUpnpPort === 'function') {
      await this.adapter.closeUpnpPort(this.mapping)
    }
    this.mapping = null
  }

  async detectPublicNode(peerConnections = []) {
    if (typeof this.adapter?.probePublicReachability === 'function') {
      const result = await this.adapter.probePublicReachability(this.mapping)
      this.publicStatus = {
        public: Boolean(result?.public),
        state: result?.public ? 'public' : 'private',
        method: 'host-probe',
        detail: String(result?.detail || (result?.public ? 'Externally reachable.' : 'External probe failed.'))
      }
      return this.publicStatus
    }

    for (const connection of peerConnections) {
      if (typeof connection?.getStats !== 'function') continue
      try {
        const stats = await connection.getStats()
        for (const report of stats.values()) {
          if (report.type !== 'local-candidate' || report.candidateType !== 'host') continue
          const address = report.address || report.ip
          if (!isPublicAddress(address)) continue
          this.publicStatus = {
            public: true,
            state: 'public',
            method: 'ice-host-candidate',
            detail: `Public ICE host candidate observed: ${address}`
          }
          return this.publicStatus
        }
      } catch {
        // Safari and privacy-hardened browsers may not expose candidate addresses.
      }
    }
    return this.publicStatus
  }
}

/**
 * Desktop/headless hosts may expose globalThis.roomHashHost.network with:
 * openUpnpPort({leaseSeconds}), closeUpnpPort(mapping), and
 * probePublicReachability(mapping). Browser builds intentionally provide none.
 */
export const UPNP_CAPABILITY_ID = 'network.upnp'
