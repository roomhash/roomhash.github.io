const MAX_ENTRIES = 500
const MAX_MESSAGE_LENGTH = 4000

const nativeConsole = typeof console !== 'undefined'
  ? {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console)
    }
  : null

function stringify(value) {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'

  try {
    const seen = new WeakSet()
    return JSON.stringify(value, (_key, current) => {
      if (typeof current === 'bigint') return `${current}n`
      if (typeof current === 'object' && current !== null) {
        if (seen.has(current)) return '[Circular]'
        seen.add(current)
      }
      return current
    })
  } catch {
    return String(value)
  }
}

function normalizeLevel(level) {
  if (level === 'error') return 'error'
  if (level === 'warn') return 'warn'
  return 'info'
}

class ClientLogStore {
  constructor() {
    this.entries = []
    this.listeners = new Set()
    this.nextId = 1
    this.captureRuntime()
    this.write('info', 'app', 'Client log started')
  }

  write(level, source, ...values) {
    const message = values.map(stringify).join(' ').slice(0, MAX_MESSAGE_LENGTH)
    this.entries.push({
      id: this.nextId++,
      ts: Date.now(),
      level: normalizeLevel(level),
      source: source || 'app',
      message
    })
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES)
    }
    this.emit()
  }

  info(source, ...values) {
    this.write('info', source, ...values)
  }

  warn(source, ...values) {
    this.write('warn', source, ...values)
  }

  error(source, ...values) {
    this.write('error', source, ...values)
  }

  clear() {
    this.entries = []
    this.emit()
  }

  subscribe(listener) {
    this.listeners.add(listener)
    listener([...this.entries])
    return () => this.listeners.delete(listener)
  }

  emit() {
    const snapshot = [...this.entries]
    this.listeners.forEach((listener) => listener(snapshot))
  }

  captureRuntime() {
    if (!nativeConsole || typeof window === 'undefined') return

    ;['log', 'info', 'warn', 'error'].forEach((method) => {
      console[method] = (...values) => {
        nativeConsole[method](...values)
        this.write(method, 'console', ...values)
      }
    })

    window.addEventListener('error', (event) => {
      this.error('window', event.error || event.message)
    })
    window.addEventListener('unhandledrejection', (event) => {
      this.error('promise', event.reason || 'Unhandled promise rejection')
    })
    window.addEventListener('online', () => this.info('network', 'Browser is online'))
    window.addEventListener('offline', () => this.warn('network', 'Browser is offline'))
  }
}

export const clientLog = new ClientLogStore()
