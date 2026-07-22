function text(value, max = 5000) {
  return String(value ?? '').slice(0, max)
}

function safeMediaUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
      ? url.href
      : ''
  } catch {
    return ''
  }
}

function appendHeading(doc, parent, value) {
  if (!value) return
  const heading = doc.createElement('h3')
  heading.textContent = text(value, 180)
  parent.appendChild(heading)
}

function createField(doc, field) {
  const label = doc.createElement('label')
  label.className = 'wasm-form-field'
  const caption = doc.createElement('span')
  caption.textContent = text(field.label || field.name, 120)
  let input
  if (field.type === 'textarea') {
    input = doc.createElement('textarea')
    input.rows = Math.max(2, Math.min(8, Number(field.rows) || 3))
  } else if (field.type === 'select') {
    input = doc.createElement('select')
    for (const option of Array.isArray(field.options) ? field.options.slice(0, 64) : []) {
      const node = doc.createElement('option')
      node.value = text(option.value, 160)
      node.textContent = text(option.label, 160)
      input.appendChild(node)
    }
  } else {
    input = doc.createElement('input')
    input.type = ['text', 'number', 'file', 'checkbox', 'hidden'].includes(field.type) ? field.type : 'text'
  }
  input.name = text(field.name, 80)
  if (field.placeholder) input.placeholder = text(field.placeholder, 240)
  if (field.required) input.required = true
  if (field.type === 'file') {
    input.accept = text(field.accept || 'image/*,video/*', 160)
    input.multiple = field.multiple !== false
  } else if (field.type === 'checkbox') {
    input.checked = Boolean(field.value)
  } else if (field.value != null) {
    input.value = text(field.value, 5000)
  }
  if (field.type === 'hidden') {
    label.hidden = true
    label.appendChild(input)
  } else if (field.type === 'checkbox') {
    label.classList.add('wasm-form-checkbox')
    label.append(input, caption)
  } else {
    label.append(caption, input)
  }
  return { label, input }
}

function createForm(doc, spec, onAction) {
  const form = doc.createElement('form')
  form.className = 'wasm-structured-form'
  appendHeading(doc, form, spec.title)
  if (spec.help) {
    const help = doc.createElement('p')
    help.className = 'wasm-form-help'
    help.textContent = text(spec.help)
    form.appendChild(help)
  }
  const controls = []
  for (const field of Array.isArray(spec.fields) ? spec.fields.slice(0, 40) : []) {
    const control = createField(doc, field)
    controls.push(control.input)
    form.appendChild(control.label)
  }
  const submit = doc.createElement('button')
  submit.type = 'submit'
  submit.className = 'wasm-form-submit'
  submit.textContent = text(spec.submit || 'Submit', 80)
  form.appendChild(submit)
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    submit.disabled = true
    const values = {}
    for (const input of controls) {
      if (!input.name) continue
      if (input.type === 'file') values[input.name] = [...input.files]
      else if (input.type === 'checkbox') values[input.name] = input.checked
      else values[input.name] = input.value
    }
    try {
      await onAction(text(spec.action || spec.id, 100), values)
      for (const input of controls) {
        if (input.type === 'file') input.value = ''
      }
    } finally {
      submit.disabled = false
    }
  })
  return form
}

function createTable(doc, section) {
  const wrap = doc.createElement('section')
  wrap.className = 'wasm-table-section'
  appendHeading(doc, wrap, section.title)
  const scroller = doc.createElement('div')
  scroller.className = 'wasm-table-scroll'
  const table = doc.createElement('table')
  const columns = Array.isArray(section.columns) ? section.columns.slice(0, 12) : []
  const head = doc.createElement('thead')
  const headRow = doc.createElement('tr')
  for (const column of columns) {
    const cell = doc.createElement('th')
    cell.textContent = text(column, 100)
    headRow.appendChild(cell)
  }
  head.appendChild(headRow)
  const body = doc.createElement('tbody')
  for (const row of Array.isArray(section.rows) ? section.rows.slice(0, 500) : []) {
    const tr = doc.createElement('tr')
    for (const value of Array.isArray(row) ? row.slice(0, columns.length) : []) {
      const cell = doc.createElement('td')
      cell.textContent = text(value, 1000)
      tr.appendChild(cell)
    }
    body.appendChild(tr)
  }
  table.append(head, body)
  scroller.appendChild(table)
  wrap.appendChild(scroller)
  return wrap
}

function createCards(doc, section, onAction, onMedia) {
  const wrap = doc.createElement('section')
  wrap.className = 'wasm-cards-section'
  appendHeading(doc, wrap, section.title)
  const grid = doc.createElement('div')
  grid.className = 'wasm-structured-cards'
  for (const item of Array.isArray(section.items) ? section.items.slice(0, 100) : []) {
    const card = doc.createElement('article')
    card.className = 'wasm-structured-card'
    const title = doc.createElement('strong')
    title.textContent = text(item.title, 180)
    card.appendChild(title)
    if (item.subtitle) {
      const subtitle = doc.createElement('small')
      subtitle.textContent = text(item.subtitle, 300)
      card.appendChild(subtitle)
    }
    if (item.body) {
      const body = doc.createElement('p')
      body.textContent = text(item.body)
      card.appendChild(body)
    }
    if (Array.isArray(item.media) && item.media.length) {
      const media = doc.createElement('div')
      media.className = 'wasm-card-media'
      for (const descriptor of item.media.slice(0, 10)) {
        const url = safeMediaUrl(descriptor.url || descriptor.webSeed)
        if (url) {
          const node = descriptor.kind === 'video' ? doc.createElement('video') : doc.createElement('img')
          node.src = url
          if (node.tagName === 'VIDEO') node.controls = true
          else node.alt = text(descriptor.name || item.title, 180)
          media.appendChild(node)
        } else if (descriptor.magnet && onMedia) {
          const load = doc.createElement('button')
          load.type = 'button'
          load.className = 'wasm-media-load'
          load.textContent = `Load ${text(descriptor.name || descriptor.kind || 'media', 100)}`
          load.addEventListener('click', async () => {
            load.disabled = true
            try {
              const objectUrl = await onMedia(descriptor)
              const node = descriptor.kind === 'video' ? doc.createElement('video') : doc.createElement('img')
              node.src = objectUrl
              if (node.tagName === 'VIDEO') node.controls = true
              else node.alt = text(descriptor.name || item.title, 180)
              load.replaceWith(node)
            } catch {
              load.disabled = false
            }
          })
          media.appendChild(load)
        }
      }
      if (media.children.length) card.appendChild(media)
    }
    if (Array.isArray(item.meta)) {
      const meta = doc.createElement('dl')
      for (const entry of item.meta.slice(0, 16)) {
        const term = doc.createElement('dt')
        term.textContent = text(entry.label, 100)
        const detail = doc.createElement('dd')
        detail.textContent = text(entry.value, 1000)
        meta.append(term, detail)
      }
      card.appendChild(meta)
    }
    if (item.form) card.appendChild(createForm(doc, item.form, onAction))
    grid.appendChild(card)
  }
  wrap.appendChild(grid)
  return wrap
}

export function renderWasmFormView(doc, mount, input, onAction, onMedia) {
  const view = input && typeof input === 'object' ? input : {}
  const root = doc.createElement('div')
  root.className = 'wasm-structured-view'
  if (view.title) {
    const title = doc.createElement('h2')
    title.textContent = text(view.title, 180)
    root.appendChild(title)
  }
  if (view.notice) {
    const notice = doc.createElement('p')
    notice.className = 'wasm-structured-notice'
    notice.textContent = text(view.notice)
    root.appendChild(notice)
  }
  for (const section of Array.isArray(view.sections) ? view.sections.slice(0, 40) : []) {
    if (section.type === 'form') root.appendChild(createForm(doc, section, onAction))
    else if (section.type === 'table') root.appendChild(createTable(doc, section))
    else if (section.type === 'cards') root.appendChild(createCards(doc, section, onAction, onMedia))
    else if (section.type === 'notice') {
      const notice = doc.createElement('p')
      notice.className = `wasm-structured-notice ${text(section.tone, 20)}`
      notice.textContent = text(section.text)
      root.appendChild(notice)
    } else if (section.type === 'stats') {
      const stats = doc.createElement('div')
      stats.className = 'wasm-structured-stats'
      for (const item of Array.isArray(section.items) ? section.items.slice(0, 24) : []) {
        const card = doc.createElement('div')
        const value = doc.createElement('strong')
        value.textContent = text(item.value, 100)
        const label = doc.createElement('span')
        label.textContent = text(item.label, 120)
        card.append(value, label)
        stats.appendChild(card)
      }
      root.appendChild(stats)
    }
  }
  mount.replaceChildren(root)
}
