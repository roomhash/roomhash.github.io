const REQUIRED_PIXEL_EXPORTS = [
  'memory', 'rh_abi_version', 'rh_width', 'rh_height', 'rh_framebuffer_ptr',
  'rh_framebuffer_len', 'rh_init', 'rh_input', 'rh_apply_event',
  'rh_cell_count', 'rh_cell_actor', 'rh_cell_flower', 'rh_cell_clock'
]
const REQUIRED_FORM_EXPORTS = [
  'memory', 'rh_abi_version', 'rh_alloc', 'rh_dealloc', 'rh_init', 'rh_dispatch',
  'rh_output_ptr', 'rh_output_len'
]
const REQUIRED_SURFACE_EXPORTS = REQUIRED_FORM_EXPORTS
const MAX_MEMORY_BYTES = 64 * 1024 * 1024
const MAX_JSON_BYTES = 2 * 1024 * 1024

let api = null
let clock = 0
let abi = 0
const strokePoints = new Map()
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function checkMemory() {
  if (!(api.memory instanceof WebAssembly.Memory)) throw new Error('missing exported memory')
  if (api.memory.buffer.byteLength > MAX_MEMORY_BYTES) throw new Error('WASM memory limit exceeded')
}

function render() {
  checkMemory()
  const width = Number(api.rh_width())
  const height = Number(api.rh_height())
  const pointer = Number(api.rh_framebuffer_ptr())
  const length = Number(api.rh_framebuffer_len())
  if (width < 1 || height < 1 || width > 1024 || height > 1024 || length !== width * height * 4) {
    throw new Error('invalid framebuffer')
  }
  const pixels = new Uint8Array(api.memory.buffer, pointer, length).slice().buffer
  postMessage({ type: 'frame', width, height, pixels }, [pixels])
}

function callJson(name, value) {
  const bytes = encoder.encode(JSON.stringify(value ?? {}))
  if (bytes.byteLength > MAX_JSON_BYTES) throw new Error('WASM JSON input is too large')
  const pointer = Number(api.rh_alloc(bytes.byteLength))
  checkMemory()
  if (pointer < 0 || pointer + bytes.byteLength > api.memory.buffer.byteLength) throw new Error('invalid WASM allocation')
  new Uint8Array(api.memory.buffer, pointer, bytes.byteLength).set(bytes)
  try {
    api[name](pointer, bytes.byteLength)
  } finally {
    api.rh_dealloc(pointer, bytes.byteLength)
  }
  checkMemory()
  const outputPointer = Number(api.rh_output_ptr())
  const outputLength = Number(api.rh_output_len())
  if (outputLength < 0 || outputLength > MAX_JSON_BYTES || outputPointer < 0 || outputPointer + outputLength > api.memory.buffer.byteLength) {
    throw new Error('invalid WASM JSON output')
  }
  if (!outputLength) return {}
  return JSON.parse(decoder.decode(new Uint8Array(api.memory.buffer, outputPointer, outputLength)))
}

function postFormResult(result) {
  if (!result || typeof result !== 'object') return
  if (result.error) {
    postMessage({ type: 'form-error', message: String(result.error) })
    return
  }
  if (result.view && typeof result.view === 'object') postMessage({ type: 'view', view: result.view })
  for (const event of Array.isArray(result.events) ? result.events.slice(0, 256) : []) {
    postMessage({ type: 'event', event })
  }
  if (result.snapshot && typeof result.snapshot === 'object') postMessage({ type: 'form-snapshot', state: result.snapshot })
  if (result.persist && typeof result.persist === 'object') postMessage({ type: 'persist', state: result.persist })
}

function postSurfaceResult(result) {
  if (!result || typeof result !== 'object') return
  if (result.error) {
    postMessage({ type: 'surface-error', message: String(result.error) })
    return
  }
  if (result.scene && typeof result.scene === 'object') postMessage({ type: 'surface-scene', scene: result.scene })
  for (const effect of Array.isArray(result.effects) ? result.effects.slice(0, 32) : []) {
    postMessage({ type: 'surface-effect', effect })
  }
  for (const event of Array.isArray(result.events) ? result.events.slice(0, 256) : []) {
    postMessage({ type: 'event', event })
  }
  if (result.snapshot && typeof result.snapshot === 'object') postMessage({ type: 'surface-snapshot', state: result.snapshot })
  if (result.persist && typeof result.persist === 'object') postMessage({ type: 'persist', state: result.persist })
}

onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      const module = await WebAssembly.compile(data.bytes)
      if (WebAssembly.Module.imports(module).length) throw new Error('WASM imports are not allowed by this ABI')
      const instance = await WebAssembly.instantiate(module, {})
      api = instance.exports
      abi = Number(api.rh_abi_version?.())
      const required = abi === 3 ? REQUIRED_SURFACE_EXPORTS : abi === 2 ? REQUIRED_FORM_EXPORTS : REQUIRED_PIXEL_EXPORTS
      for (const name of required) if (!(name in api)) throw new Error(`missing ABI export: ${name}`)
      if (abi !== 1 && abi !== 2 && abi !== 3) throw new Error('unsupported ABI version')
      checkMemory()
      if (abi === 3) {
        postSurfaceResult(callJson('rh_init', data.context || {}))
        postMessage({ type: 'ready', abi })
      } else if (abi === 2) {
        postFormResult(callJson('rh_init', data.context || {}))
        postMessage({ type: 'ready', abi })
      } else {
        api.rh_init()
        postMessage({ type: 'ready', abi, width: Number(api.rh_width()), height: Number(api.rh_height()) })
        render()
      }
      return
    }
    if (!api) return
    if (abi === 3 && data.type === 'surface-input') {
      postSurfaceResult(callJson('rh_dispatch', data.input || {}))
    } else if (abi === 2 && data.type === 'form-action') {
      postFormResult(callJson('rh_dispatch', { kind: 'action', action: data.action, values: data.values, random: data.random }))
    } else if (abi === 2 && data.type === 'form-remote') {
      postFormResult(callJson('rh_dispatch', { kind: 'remote', event: data.event }))
    } else if (abi === 2 && data.type === 'snapshot-request') {
      postFormResult(callJson('rh_dispatch', { kind: 'state-request' }))
    } else if (abi === 2 && data.type === 'form-snapshot') {
      postFormResult(callJson('rh_dispatch', { kind: 'snapshot', state: data.state }))
    } else if (data.type === 'end-stroke') {
      api.rh_end_stroke?.(Number(data.actor))
      strokePoints.delete(Number(data.actor))
    } else if (data.type === 'input') {
      const gridWidth = Number(api.rh_grid_width?.() || 32)
      const gridHeight = Number(api.rh_grid_height?.() || 32)
      const cellX = Math.max(0, Math.min(gridWidth - 1, Math.floor(Number(data.x) * gridWidth / Number(api.rh_width()))))
      const cellY = Math.max(0, Math.min(gridHeight - 1, Math.floor(Number(data.y) * gridHeight / Number(api.rh_height()))))
      const actor = Number(data.actor)
      const previous = data.phase === 'start' ? null : strokePoints.get(actor)
      clock = (clock + 1) >>> 0
      if (data.phase === 'start') api.rh_begin_stroke?.(actor)
      api.rh_input(cellX, cellY, Number(data.flower), actor, clock)
      strokePoints.set(actor, [cellX, cellY])
      if (data.phase === 'end') api.rh_end_stroke?.(actor)
      render()
      postMessage({ type: 'event', event: {
        kind: 'plant', x: cellX, y: cellY,
        fromX: previous?.[0] ?? cellX, fromY: previous?.[1] ?? cellY,
        flower: Number(data.flower), actor, clock, start: data.phase === 'start'
      } })
    } else if (data.type === 'remote') {
      const event = data.event
      clock = Math.max(clock, Number(event.clock) >>> 0)
      if (api.rh_apply_stroke && Number.isFinite(Number(event.fromX)) && Number.isFinite(Number(event.fromY))) {
        api.rh_apply_stroke(Number(event.fromX), Number(event.fromY), Number(event.x), Number(event.y), Number(event.flower), Number(event.actor), Number(event.clock))
      } else {
        if (event.start) api.rh_begin_stroke?.(Number(event.actor))
        api.rh_apply_event(Number(event.x), Number(event.y), Number(event.flower), Number(event.actor), Number(event.clock))
      }
      render()
    } else if (data.type === 'snapshot-request') {
      const cells = []
      const count = Math.min(Number(api.rh_cell_count()), 65536)
      for (let index = 0; index < count; index += 1) {
        const flower = Number(api.rh_cell_flower(index))
        const cellClock = Number(api.rh_cell_clock(index))
        if (cellClock) cells.push([index, flower, Number(api.rh_cell_actor(index)), cellClock])
      }
      postMessage({ type: 'snapshot', cells })
    } else if (data.type === 'snapshot') {
      const gridWidth = Number(api.rh_grid_width?.() || 32)
      for (const cell of data.cells.slice(0, 65536)) {
        const index = Number(cell[0])
        api.rh_apply_event(index % gridWidth, Math.floor(index / gridWidth), Number(cell[1]), Number(cell[2]), Number(cell[3]))
        clock = Math.max(clock, Number(cell[3]) >>> 0)
      }
      render()
    } else if (data.type === 'ping') {
      checkMemory()
      postMessage({ type: 'pong' })
    }
  } catch (error) {
    postMessage({ type: 'error', message: error?.message || String(error) })
  }
}
