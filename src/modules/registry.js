/** Registry for data-only chat message modules shipped by this client. */
export class MessageModuleRegistry {
  constructor() {
    this.modules = new Map()
  }

  register(definition) {
    const id = String(definition?.id || '')
    if (!id || typeof definition.render !== 'function') {
      throw new Error('message module requires id and render')
    }
    if (this.modules.has(id)) throw new Error(`message module already registered: ${id}`)
    this.modules.set(id, definition)
    return this
  }

  get(id) {
    return this.modules.get(id)
  }

  canRender(message) {
    const definition = this.get(message?.module)
    return Boolean(
      definition &&
        Number(message?.moduleVersion || 1) <= Number(definition.version || 1)
    )
  }

  render(message, context) {
    if (!this.canRender(message)) return null
    return this.get(message.module).render(message, context)
  }
}
