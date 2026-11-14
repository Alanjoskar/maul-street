// A very small way to build DOM and to update it without rebuilding it.
//
// Every screen is a plain function that returns a fresh tree. `morph` then
// changes the tree already on the page to match it, keeping the elements that
// are there. That is what protects the player: an input keeps its focus, its
// caret and what was typed, a scrolled list stays scrolled, and a running
// animation keeps running, whenever polled data changes underneath.

const SVG_NS = 'http://www.w3.org/2000/svg'

function dispatch(event) {
  const handlers = event.currentTarget.__h
  const fn = handlers && handlers[event.type]
  if (fn) return fn.call(event.currentTarget, event)
}

function setProps(el, props) {
  if (!props) return
  for (const key in props) {
    const value = props[key]
    if (value == null || value === false) continue
    if (key[0] === 'o' && key[1] === 'n' && typeof value === 'function') {
      const type = key.slice(2).toLowerCase()
      if (!el.__h) el.__h = {}
      el.__h[type] = value
      el.addEventListener(type, dispatch)
    } else if (key === 'class') {
      const text = Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value)
      if (text) el.setAttribute('class', text)
    } else if (key === 'style' && typeof value === 'object') {
      for (const name in value) {
        if (value[name] == null) continue
        if (name.startsWith('--')) el.style.setProperty(name, value[name])
        else el.style[name] = value[name]
      }
    } else if (key === 'value') {
      el.setAttribute('value', value)
      el.value = value
    } else if (key === 'checked') {
      el.setAttribute('checked', '')
      el.checked = true
    } else if (value === true) {
      el.setAttribute(key, '')
    } else {
      el.setAttribute(key, String(value))
    }
  }
}

function append(el, kids) {
  for (const kid of kids) {
    if (kid == null || kid === false || kid === true) continue
    if (Array.isArray(kid)) append(el, kid)
    else if (kid.nodeType) el.appendChild(kid)
    else el.appendChild(document.createTextNode(String(kid)))
  }
}

function create(ns, selector, props, kids) {
  const parts = selector.split('.')
  const tag = parts[0] || 'div'
  const el = ns ? document.createElementNS(ns, tag) : document.createElement(tag)
  if (parts.length > 1) el.setAttribute('class', parts.slice(1).join(' '))
  // The second argument may be the first child instead of a props object.
  if (props != null && props !== false && (typeof props !== 'object' || props.nodeType || Array.isArray(props))) {
    kids = [props, ...kids]
    props = null
  }
  if (props && props.class && parts.length > 1) {
    const extra = Array.isArray(props.class) ? props.class.filter(Boolean).join(' ') : String(props.class || '')
    const { class: _drop, ...rest } = props
    setProps(el, rest)
    if (extra) el.setAttribute('class', `${parts.slice(1).join(' ')} ${extra}`)
  } else {
    setProps(el, props)
  }
  append(el, kids)
  return el
}

/** h('div.panel.cut', { onclick }, child, 'text', [more]) → an element. */
export function h(selector, props, ...kids) {
  return create(null, selector, props, kids)
}

/** The same, for SVG elements. */
export function svg(selector, props, ...kids) {
  return create(SVG_NS, selector, props, kids)
}

// ---------------------------------------------------------------------------

function keyOf(node) {
  return node.nodeType === 1 ? node.getAttribute('data-key') : null
}

function same(a, b) {
  if (a.nodeType !== b.nodeType) return false
  if (a.nodeType !== 1) return true
  return a.tagName === b.tagName && a.namespaceURI === b.namespaceURI && keyOf(a) === keyOf(b)
}

function syncAttributes(old, fresh) {
  const had = old.attributes
  for (let i = had.length - 1; i >= 0; i--) {
    const name = had[i].name
    if (!fresh.hasAttribute(name)) old.removeAttribute(name)
  }
  const want = fresh.attributes
  for (let i = 0; i < want.length; i++) {
    const { name, value } = want[i]
    if (old.getAttribute(name) !== value) old.setAttribute(name, value)
  }
}

function syncHandlers(old, fresh) {
  const next = fresh.__h
  if (next) {
    const prev = old.__h || {}
    for (const type in next) if (!(type in prev)) old.addEventListener(type, dispatch)
  }
  old.__h = next || null
}

/**
 * Makes `old` look like `fresh`, in place. Returns the node now on the page.
 *
 * - `data-key` gives a child an identity, so list items keep their element when the list reorders.
 * - `data-morph="skip"` leaves an element exactly as it is (a widget that looks after itself).
 * - `data-morph="own"` updates the element's attributes but leaves its children alone.
 * - An input that has the focus keeps its value, unless `data-rev` changed
 *   (the screen bumps it when it clears a form on purpose).
 */
export function morph(old, fresh) {
  if (!same(old, fresh)) {
    old.replaceWith(fresh)
    return fresh
  }
  if (old.nodeType === 3 || old.nodeType === 8) {
    if (old.nodeValue !== fresh.nodeValue) old.nodeValue = fresh.nodeValue
    return old
  }
  if (old.nodeType !== 1) return old
  const mode = old.getAttribute('data-morph')
  if (mode === 'skip') return old

  const tag = old.tagName
  const isField = tag === 'INPUT' || tag === 'TEXTAREA'
  const forced = isField && old.getAttribute('data-rev') !== fresh.getAttribute('data-rev')

  syncAttributes(old, fresh)
  syncHandlers(old, fresh)

  if (isField) {
    if (old.type === 'checkbox' || old.type === 'radio') {
      if (old.checked !== fresh.checked) old.checked = fresh.checked
    } else if (old.value !== fresh.value && (forced || document.activeElement !== old)) {
      old.value = fresh.value
    }
    if (tag === 'INPUT') return old
  }
  if (mode === 'own') return old
  morphChildren(old, fresh)
  return old
}

function morphChildren(old, fresh) {
  const incoming = Array.from(fresh.childNodes)
  let keyed = null
  let freshKeys = null
  for (const node of incoming) {
    const key = keyOf(node)
    if (key != null) (freshKeys || (freshKeys = new Set())).add(key)
  }
  for (let node = old.firstChild; node; node = node.nextSibling) {
    const key = keyOf(node)
    if (key != null) (keyed || (keyed = new Map())).set(key, node)
  }

  let cursor = old.firstChild
  for (const node of incoming) {
    // Old keyed children that are gone must not block the ones behind them.
    while (cursor && keyOf(cursor) != null && !(freshKeys && freshKeys.has(keyOf(cursor)))) {
      const gone = cursor
      cursor = cursor.nextSibling
      old.removeChild(gone)
    }
    const key = keyOf(node)
    let match = null
    if (key != null) {
      const found = keyed && keyed.get(key)
      if (found && same(found, node)) match = found
    } else if (cursor && keyOf(cursor) == null && same(cursor, node)) {
      match = cursor
    }
    if (match) {
      if (match === cursor) cursor = cursor.nextSibling
      else old.insertBefore(match, cursor)
      morph(match, node)
    } else {
      old.insertBefore(node, cursor)
    }
  }
  while (cursor) {
    const gone = cursor
    cursor = cursor.nextSibling
    old.removeChild(gone)
  }
}

/** The elements inside `root` that can take the focus, in order. */
export function focusables(root) {
  return Array.from(
    root.querySelectorAll('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'),
  ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)
}
