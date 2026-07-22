const MAX_SCENE_BYTES = 2 * 1024 * 1024
const MAX_DRAW_OPS = 4096
const MAX_PATH_POINTS = 8192
const MAX_TEXT_CHARS = 131072

const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
const clamp = (value, min, max, fallback = min) => Math.min(max, Math.max(min, number(value, fallback)))

function color(value, fallback = 'transparent') {
  const candidate = String(value || '')
  return candidate.length <= 64 && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|transparent)$/i.test(candidate) ? candidate : fallback
}

function pathRect(context, item) {
  const x = number(item.x)
  const y = number(item.y)
  const width = Math.max(0, number(item.width))
  const height = Math.max(0, number(item.height))
  const radius = Math.min(Math.max(0, number(item.radius)), width / 2, height / 2)
  context.beginPath()
  context.roundRect(x, y, width, height, radius)
}

export function validatePortableScene(scene) {
  if (!scene || typeof scene !== 'object' || JSON.stringify(scene).length > MAX_SCENE_BYTES) throw new Error('invalid portable scene')
  if (number(scene.width) < 1 || number(scene.height) < 1 || number(scene.width) > 8192 || number(scene.height) > 8192) throw new Error('invalid portable scene dimensions')
  if (!Array.isArray(scene.draw) || scene.draw.length > MAX_DRAW_OPS) throw new Error('invalid portable draw list')
  let points = 0
  let text = 0
  for (const item of scene.draw) {
    if (!item || typeof item.op !== 'string') throw new Error('invalid portable draw operation')
    if (item.op === 'line') points += Array.isArray(item.points) ? item.points.length : MAX_PATH_POINTS + 1
    if (item.op === 'text') text += String(item.text || '').length
  }
  if (points > MAX_PATH_POINTS || text > MAX_TEXT_CHARS) throw new Error('portable scene content limit exceeded')
  return scene
}

export function paintPortableScene(canvas, scene, { media = new Map(), maxDpr = 3 } = {}) {
  validatePortableScene(scene)
  const context = canvas.getContext('2d')
  const dpr = Math.min(maxDpr, canvas.ownerDocument.defaultView.devicePixelRatio || 1)
  canvas.width = Math.max(1, Math.round(scene.width * dpr))
  canvas.height = Math.max(1, Math.round(scene.height * dpr))
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.fontKerning = 'normal'
  context.textRendering = 'optimizeLegibility'
  context.clearRect(0, 0, scene.width, scene.height)
  context.fillStyle = color(scene.background, '#0b1020')
  context.fillRect(0, 0, scene.width, scene.height)
  let clips = 0
  for (const item of scene.draw) {
    if (item.op === 'rect') {
      pathRect(context, item)
      if (item.fill) { context.fillStyle = color(item.fill); context.fill() }
      if (item.stroke && number(item.lineWidth) > 0) {
        context.strokeStyle = color(item.stroke)
        context.lineWidth = clamp(item.lineWidth, 0.25, 64, 1)
        context.stroke()
      }
    } else if (item.op === 'circle') {
      context.beginPath()
      context.arc(number(item.x), number(item.y), Math.max(0, number(item.radius)), 0, Math.PI * 2)
      if (item.fill) { context.fillStyle = color(item.fill); context.fill() }
      if (item.stroke && number(item.lineWidth) > 0) { context.strokeStyle = color(item.stroke); context.lineWidth = clamp(item.lineWidth, 0.25, 64, 1); context.stroke() }
    } else if (item.op === 'line' && item.points?.length) {
      context.beginPath()
      item.points.forEach((point, index) => index ? context.lineTo(number(point?.[0]), number(point?.[1])) : context.moveTo(number(point?.[0]), number(point?.[1])))
      context.strokeStyle = color(item.stroke, '#ffffff')
      context.lineWidth = clamp(item.lineWidth, 0.25, 128, 1)
      context.lineCap = ['butt', 'round', 'square'].includes(item.cap) ? item.cap : 'round'
      context.lineJoin = ['round', 'bevel', 'miter'].includes(item.join) ? item.join : 'round'
      context.stroke()
    } else if (item.op === 'text') {
      const size = clamp(item.size, 8, 128, 16)
      context.font = `${clamp(item.weight, 100, 900, 400)} ${size}px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
      context.fillStyle = color(item.color, '#ffffff')
      context.textAlign = ['left', 'center', 'right'].includes(item.align) ? item.align : 'left'
      context.textBaseline = ['top', 'middle', 'bottom', 'alphabetic'].includes(item.baseline) ? item.baseline : 'top'
      context.fillText(String(item.text || '').slice(0, 8192), number(item.x), number(item.y), Math.max(0, number(item.maxWidth, 8192)))
    } else if (item.op === 'image') {
      const source = media.get(String(item.mediaId || ''))
      if (!source) continue
      context.save()
      pathRect(context, item)
      context.clip()
      context.drawImage(source, number(item.x), number(item.y), Math.max(0, number(item.width)), Math.max(0, number(item.height)))
      context.restore()
    } else if (item.op === 'clip-push') {
      context.save(); pathRect(context, item); context.clip(); clips += 1
    } else if (item.op === 'clip-pop' && clips > 0) {
      context.restore(); clips -= 1
    }
  }
  while (clips-- > 0) context.restore()
  canvas.style.cursor = ['default', 'pointer', 'crosshair', 'text', 'grab', 'grabbing'].includes(scene.cursor) ? scene.cursor : 'default'
}
