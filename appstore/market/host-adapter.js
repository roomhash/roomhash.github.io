import { MarketNode } from './protocol.js'

/**
 * The only transport contract required by the market protocol:
 *   send(frame, { excludePeerId? })
 *   subscribe((frame, sourcePeerId) => {}) -> unsubscribe
 *   onPeerConnected?((peerId) => {}) -> unsubscribe
 *
 * A RoomHash host should map these calls to its torrent.media data channel.
 * Frames are structured-cloneable JSON values. The core handles multi-hop
 * forwarding, frame/event de-duplication and anti-entropy; the adapter must not
 * rewrite frameId, originId, destinationId or hops.
 */
export function createMarketRuntime({ nodeId, roomId, transport, now, persist, initialState }) {
  if (!transport || typeof transport.send !== 'function' || typeof transport.subscribe !== 'function') {
    throw new Error('transport.send and transport.subscribe are required')
  }
  const node = new MarketNode({
    nodeId,
    roomId,
    now,
    persist,
    send: (frame, options) => transport.send(frame, options)
  })
  const ready = initialState ? node.importState(initialState) : Promise.resolve(0)
  const unsubscribe = transport.subscribe((frame, sourcePeerId) => {
    node.receive(frame, sourcePeerId).catch(() => {})
  })
  const unsubscribePeer = transport.onPeerConnected?.((peerId) => {
    node.sync(peerId).catch(() => {})
  })
  return {
    node,
    ready,
    close() {
      unsubscribe?.()
      unsubscribePeer?.()
    }
  }
}

/** Browser-only demo transport. Every same-origin tab in the room is a peer. */
export function createBroadcastChannelTransport(roomId, nodeId) {
  const channel = new BroadcastChannel(`roomhash-market:${roomId}`)
  const listeners = new Set()
  channel.onmessage = ({ data }) => {
    if (!data || data.sender === nodeId) return
    for (const listener of listeners) listener(data.frame, data.sender)
  }
  return {
    async send(frame, { excludePeerId = null } = {}) {
      // BroadcastChannel cannot address/exclude a physical peer. Protocol-level
      // frame destination and echo de-duplication still preserve correctness.
      channel.postMessage({ sender: nodeId, excludePeerId, frame })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close() { channel.close() }
  }
}

/**
 * Media bytes are deliberately outside gossip. A host implements this hook by
 * seeding a File/Blob through torrent.media and returns content-addressed
 * metadata. Local objectUrl is for preview only and must never enter a frame.
 */
export async function publishMediaWithHost(file, mediaHost) {
  if (!mediaHost || typeof mediaHost.publish !== 'function') {
    throw new Error('RoomHash mediaHost.publish(file) is unavailable')
  }
  const descriptor = await mediaHost.publish(file)
  return { ...descriptor, name: file.name, mime: file.type, size: file.size }
}
