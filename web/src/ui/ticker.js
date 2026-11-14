// The tape: a stock-ticker strip of what the contract says just happened.
//
// It looks after its own element (the renderer leaves it alone), so the strip
// keeps moving at one speed when new lines arrive instead of jumping back to
// the start.

import { h } from './dom.js'

const SPEED = 46 // pixels a second

/** Splits a line so NEAR amounts can be shown in brass. */
function parts(text) {
  const out = []
  const pattern = /(\d+(?:\.\d+)?\s*NEAR)/g
  let last = 0
  let found
  while ((found = pattern.exec(text))) {
    if (found.index > last) out.push(text.slice(last, found.index))
    out.push(h('b.tape-near', found[1]))
    last = found.index + found[1].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function createTicker(name, timeAgo) {
  const track = h('div.tape-track')
  const el = h('div.tape-run', { 'data-key': name, 'data-widget': name, 'data-morph': 'skip' }, track)
  let key = ''
  let offset = 0
  let half = 0
  let last = 0
  let paused = false
  let running = false

  el.addEventListener('mouseenter', () => (paused = true))
  el.addEventListener('mouseleave', () => (paused = false))

  function group(lines) {
    return h(
      'div.tape-group',
      lines.map((line) => h('span.tape-item', h('i.tape-dot'), h('span.tape-time', timeAgo(line.ts)), h('span.tape-text', parts(String(line.text || ''))))),
    )
  }

  function measure() {
    const first = track.firstElementChild
    half = first ? first.getBoundingClientRect().width : 0
    if (half > 0) offset %= half
  }

  function frame(time) {
    if (!el.isConnected) {
      running = false
      return
    }
    const delta = Math.min(64, time - (last || time))
    last = time
    const hidden = document.hidden || document.body.classList.contains('in-fight')
    if (!paused && !hidden && half > 0) {
      offset = (offset + (SPEED * delta) / 1000) % half
      track.style.transform = `translate3d(${-offset.toFixed(2)}px,0,0)`
    }
    requestAnimationFrame(frame)
  }

  return {
    el,
    /** Shows these lines (newest first). Call it on every render: it only rebuilds when the lines change. */
    set(lines) {
      const list = Array.isArray(lines) ? lines.slice(0, 30) : []
      const next = list.map((line) => `${line.ts}:${line.text}`).join('|') + `|${Math.floor(Date.now() / 30000)}`
      if (next !== key) {
        key = next
        // Two copies side by side, so the strip can loop without a seam.
        track.replaceChildren(...(list.length ? [group(list), group(list)] : []))
        half = 0
      }
      if (el.isConnected) {
        if (!half) measure()
        if (!running) {
          running = true
          last = 0
          requestAnimationFrame(frame)
        }
      }
    },
    /** What the renderer puts in the tree: the real element swaps in after each render. */
    placeholder() {
      return h('div.tape-run', { 'data-key': name, 'data-widget': name, 'data-morph': 'skip' })
    },
  }
}
