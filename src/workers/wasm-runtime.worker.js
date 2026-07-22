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
let numericGrid = null
const encoder = new TextEncoder()
const decoder = new TextDecoder()

const NUMERIC_GRID_EXPORT_KEYS = [
  'width', 'height', 'framebufferPointer', 'framebufferLength', 'initialize',
  'write', 'merge', 'recordCount', 'recordActor', 'recordValue', 'recordClock'
]

function loadNumericGridContract(contract) {
  if (contract?.schema !== 'roomhash.numeric-grid/v1') throw new Error('missing numeric-grid contract')
  if (!Number.isInteger(contract.columns) || contract.columns < 1 || contract.columns > 256) throw new Error('invalid numeric-grid columns')
  if (!Number.isInteger(contract.rows) || contract.rows < 1 || contract.rows > 256) throw new Error('invalid numeric-grid rows')
  const bindings = {}
  for (const key of NUMERIC_GRID_EXPORT_KEYS) {
    const name = contract.exports?.[key]
    if (!/^rh_[a-z0-9_]{1,63}$/.test(name || '') || typeof api[name] !== 'function') {
      throw new Error(`invalid numeric-grid export: ${key}`)
    }
    bindings[key] = api[name]
  }
  return { columns: contract.columns, rows: contract.rows, bindings }
}

function gridCall(name, ...values) {
  if (!numericGrid?.bindings[name]) throw new Error(`numeric-grid operation unavailable: ${name}`)
  return numericGrid.bindings[name](...values)
}

function checkMemory() {
  if (!(api.memory instanceof WebAssembly.Memory)) throw new Error('missing exported memory')
  if (api.memory.buffer.byteLength > MAX_MEMORY_BYTES) throw new Error('WASM memory limit exceeded')
}

function renderNumericGrid() {
  checkMemory()
  const width = Number(gridCall('width'))
  const height = Number(gridCall('height'))
  const pointer = Number(gridCall('framebufferPointer'))
  const length = Number(gridCall('framebufferLength'))
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
      if (abi !== 1 && abi !== 2 && abi !== 3) throw new Error('unsupported ABI version')
      const required = abi === 3 ? REQUIRED_SURFACE_EXPORTS : abi === 2 ? REQUIRED_FORM_EXPORTS : ['memory', 'rh_abi_version']
      for (const name of required) if (!(name in api)) throw new Error(`missing ABI export: ${name}`)
      checkMemory()
      if (abi === 3) {
        postSurfaceResult(callJson('rh_init', data.context || {}))
        postMessage({ type: 'ready', abi })
      } else if (abi === 2) {
        postFormResult(callJson('rh_init', data.context || {}))
        postMessage({ type: 'ready', abi })
      } else {
        numericGrid = loadNumericGridContract(data.legacyNumericGrid)
        gridCall('initialize')
        postMessage({ type: 'ready', abi, width: Number(gridCall('width')), height: Number(gridCall('height')) })
        renderNumericGrid()
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
    } else if (abi === 1 && data.type === 'legacy-input') {
      const pointX = Math.max(0, Math.min(numericGrid.columns - 1, Math.floor(Number(data.x) * numericGrid.columns / Number(gridCall('width')))))
      const pointY = Math.max(0, Math.min(numericGrid.rows - 1, Math.floor(Number(data.y) * numericGrid.rows / Number(gridCall('height')))))
      const actor = Number(data.actor)
      const value = Math.max(0, Math.min(255, Number(data.value) || 0))
      clock = (clock + 1) >>> 0
      gridCall('write', pointX, pointY, value, actor, clock)
      renderNumericGrid()
      postMessage({ type: 'event', event: {
        kind: 'legacy-operation', values: [pointX, pointY, value, actor, clock]
      } })
    } else if (abi === 1 && data.type === 'legacy-remote') {
      const values = Array.isArray(data.values) ? data.values.slice(0, 5).map(Number) : []
      if (values.length !== 5 || values.some((value) => !Number.isFinite(value))) throw new Error('invalid legacy operation')
      const [pointX, pointY, value, actor, remoteClock] = values
      if (pointX < 0 || pointX >= numericGrid.columns || pointY < 0 || pointY >= numericGrid.rows) throw new Error('legacy operation outside bounds')
      clock = Math.max(clock, remoteClock >>> 0)
      gridCall('merge', pointX, pointY, value, actor, remoteClock)
      renderNumericGrid()
    } else if (abi === 1 && data.type === 'snapshot-request') {
      const records = []
      const count = Math.min(Number(gridCall('recordCount')), numericGrid.columns * numericGrid.rows)
      for (let index = 0; index < count; index += 1) {
        const recordClock = Number(gridCall('recordClock', index))
        if (recordClock) records.push([index, Number(gridCall('recordValue', index)), Number(gridCall('recordActor', index)), recordClock])
      }
      postMessage({ type: 'snapshot', records })
    } else if (abi === 1 && data.type === 'legacy-snapshot') {
      for (const record of data.records.slice(0, numericGrid.columns * numericGrid.rows)) {
        if (!Array.isArray(record) || record.length !== 4) continue
        const index = Number(record[0])
        if (!Number.isInteger(index) || index < 0 || index >= numericGrid.columns * numericGrid.rows) continue
        gridCall('merge', index % numericGrid.columns, Math.floor(index / numericGrid.columns), Number(record[1]), Number(record[2]), Number(record[3]))
        clock = Math.max(clock, Number(record[3]) >>> 0)
      }
      renderNumericGrid()
    } else if (data.type === 'ping') {
      checkMemory()
      postMessage({ type: 'pong' })
    }
  } catch (error) {
    postMessage({ type: 'error', message: error?.message || String(error) })
  }
}
