import { VotingNode } from './protocol.js'

/**
 * Adapter boundary for a future RoomHash voting host.
 *
 * transport.send(frame, { excludePeerId? }) broadcasts to directly connected
 * peers. transport.subscribe(handler) calls handler(frame, sourcePeerId) for
 * inbound messages. Both methods carry plain structured-cloneable objects.
 * transport.onPeerConnected is optional and triggers targeted anti-entropy.
 */
export function createVotingRuntime({ nodeId, poll, transport, now, persist }) {
  if (!transport || typeof transport.send !== 'function' || typeof transport.subscribe !== 'function') {
    throw new Error('transport.send and transport.subscribe are required')
  }

  const node = new VotingNode({
    nodeId,
    poll,
    now,
    persist,
    send: (frame, options) => transport.send(frame, options)
  })
  const unsubscribe = transport.subscribe((frame, sourcePeerId) => {
    node.receive(frame, sourcePeerId).catch(() => {})
  })
  const unsubscribePeer = transport.onPeerConnected?.((peerId) => {
    node.sync(peerId).catch(() => {})
  })

  return {
    node,
    close() {
      unsubscribe?.()
      unsubscribePeer?.()
    }
  }
}
