# RoomHash public voting protocol v1

## Semantics

Every collector maintains its own materialized view, keyed by `voterHash`.
There is no coordinator, quorum, global counter, or claim of a complete global
result. A tally is always accompanied by `collectorId` and `collectedBallots`.
Two collectors may legitimately show different totals while partitioned.

A ballot contains:

```json
{
  "schema": "roomhash.vote/ballot-v1",
  "pollId": "lunch-v1",
  "voterHash": "sha256-or-host-user-hash",
  "nick": "Alice",
  "optionId": "rice",
  "revision": 2,
  "updatedAt": 1784700000000,
  "eventId": "sha256(canonical ballot fields)"
}
```

`eventId` is SHA-256 over a canonical JSON array containing the schema and all
fields except `eventId`. It detects corruption and deduplicates the same event;
it is not an author signature. All accepted ballots are retained for audit and
anti-entropy, while only the winning ballot per `voterHash` is counted.

The winner is the maximum tuple `(revision, eventId)`. Revision is primary.
The event ID is a deterministic tie-break when buggy or competing clients emit
different ballots at the same revision. `updatedAt` is public metadata included
in the event hash, not a trusted wall-clock ordering source.

## Frames and forwarding

Application frames use `roomhash.vote/frame-v1` and carry `frameId`, `originId`,
optional `destinationId`, `hops`, `maxHops`, `type`, and `payload`. A collector:

1. validates the frame and drops a previously seen `frameId`;
2. processes broadcast frames or frames addressed to its `nodeId`;
3. forwards the first valid copy to connected peers except the ingress peer,
   unless this node is the addressed destination;
4. stops forwarding at 16 hops.

This flood-and-deduplicate rule carries ballots through A-B-C when A and C
cannot establish a direct NAT traversal path. `frameId` suppression prevents an
A-B-C-A loop from echoing and recounting a ballot. Relay rate limits and frame
size limits remain the transport host's responsibility.

## Anti-entropy

`sync()` sends an `inventory` of the current `(voterHash,eventId,revision)`
view. The receiver requests differing event IDs using `want`, returns complete
records in `ballots`, and sends its own inventory once when requested. Responses
may be destination-addressed and still traverse relays. When a repair response
changes the destination's materialized view, that node re-gossips only the newly
winning ballots so its adjacent collectors also repair. A host should call
`sync(peerId)` on every peer connection and periodically while connected.

The reference v1 implementation limits one inventory/request/batch to 2,000
entries. A production host serving larger polls should paginate by a stable
voter-hash prefix or Merkle tree. Persistence uses `exportState()` and
`importState()`; without durable storage, a collector can forget ballots after
all peers carrying them disappear.

## Required RoomHash host adapter

The current RoomHash WASM ABI is `roomhash-pixel-grid-v1`: fixed canvas,
coordinate input, and four numeric values. It cannot represent nick/hash form
fields, arbitrary options, public ballot rows, or this message protocol.
Therefore this package is intentionally not marked WASM-compatible.

`src/host-adapter.js` documents the required future boundary:

```js
transport.send(frame, { excludePeerId })
transport.subscribe((frame, sourcePeerId) => {})
transport.onPeerConnected?.((peerId) => {})
```

The host must additionally provide the poll definition, stable local `nodeId`,
stable user hash, durable state storage, and UI surfaces for casting, tallying,
the local-view warning, and raw public-ballot audit. RoomHash should carry these
objects as a dedicated module, for example `vote.public.v1`, over its existing
Mesh envelope rather than granting arbitrary network access to a WASM module.

## Trust and privacy limits

- The vote and raw ballot list are public by design; nick and user hash are
  visible to every collector and relay that processes the application payload.
- Hashing a guessable identity does not make it anonymous.
- **`userHash` and `eventId` are deduplication/integrity identifiers, not
  cryptographic identity signatures.** A bare user hash does not prove
  authorship. Without a host signature binding ballot content to the RoomHash
  identity, a malicious peer can forge another user's hash or publish an
  artificially high revision that wins LWW. Signed ballots and revision policy
  are the required next step for adversarial or high-stakes voting.
- Mesh delivery is eventually consistent and best effort. No local tally can
  prove that it has received every ballot in existence.
