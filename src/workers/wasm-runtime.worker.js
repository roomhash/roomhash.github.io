const REQUIRED_EXPORTS = [
  'memory', 'rh_abi_version', 'rh_width', 'rh_height', 'rh_framebuffer_ptr',
  'rh_framebuffer_len', 'rh_init', 'rh_input', 'rh_apply_event',
  'rh_cell_count', 'rh_cell_actor', 'rh_cell_flower', 'rh_cell_clock'
]
const MAX_MEMORY_BYTES = 64 * 1024 * 1024

let api = null
let clock = 0

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

onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      const module = await WebAssembly.compile(data.bytes)
      if (WebAssembly.Module.imports(module).length) throw new Error('WASM imports are not allowed by this ABI')
      const instance = await WebAssembly.instantiate(module, {})
      api = instance.exports
      for (const name of REQUIRED_EXPORTS) if (!(name in api)) throw new Error(`missing ABI export: ${name}`)
      if (Number(api.rh_abi_version()) !== 1) throw new Error('unsupported ABI version')
      checkMemory()
      api.rh_init()
      postMessage({ type: 'ready', width: Number(api.rh_width()), height: Number(api.rh_height()) })
      render()
      return
    }
    if (!api) return
    if (data.type === 'input') {
      const cellX = Math.floor(Number(data.x) * 32 / Number(api.rh_width()))
      const cellY = Math.floor(Number(data.y) * 32 / Number(api.rh_height()))
      clock = (clock + 1) >>> 0
      api.rh_input(cellX, cellY, Number(data.flower), Number(data.actor), clock)
      render()
      postMessage({ type: 'event', event: { kind: 'plant', x: cellX, y: cellY, flower: Number(data.flower), actor: Number(data.actor), clock } })
    } else if (data.type === 'remote') {
      const event = data.event
      clock = Math.max(clock, Number(event.clock) >>> 0)
      api.rh_apply_event(Number(event.x), Number(event.y), Number(event.flower), Number(event.actor), Number(event.clock))
      render()
    } else if (data.type === 'snapshot-request') {
      const cells = []
      const count = Math.min(Number(api.rh_cell_count()), 4096)
      for (let index = 0; index < count; index += 1) {
        const flower = Number(api.rh_cell_flower(index))
        if (flower) cells.push([index, flower, Number(api.rh_cell_actor(index)), Number(api.rh_cell_clock(index))])
      }
      postMessage({ type: 'snapshot', cells })
    } else if (data.type === 'snapshot') {
      for (const cell of data.cells.slice(0, 4096)) {
        const index = Number(cell[0])
        api.rh_apply_event(index % 32, Math.floor(index / 32), Number(cell[1]), Number(cell[2]), Number(cell[3]))
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
