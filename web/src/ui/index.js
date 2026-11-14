// Maul Street menus: everything on screen outside the fight itself.
//
//   mountUi(root, { api, bridge, core, format })
//
// `api` is the facade over the contract and NEAR Social, `bridge` is the way
// to the 3D game, `core` is the rules module. They are passed in, so the menus
// can be built and tested against a mock. The menus never change `api.state`:
// they read it, call actions, and redraw when `api` says something changed.

import '@fontsource/bebas-neue/latin-400.css'
import '@fontsource/barlow/latin-400.css'
import '@fontsource/barlow/latin-500.css'
import '@fontsource/barlow/latin-600.css'
import '@fontsource/barlow-condensed/latin-500.css'
import '@fontsource/barlow-condensed/latin-600.css'
import '@fontsource/barlow-condensed/latin-700.css'
import './tokens.css'
import './style.css'

import { h, morph, focusables } from './dom.js'
import { icon } from './icons.js'
import * as localFormat from './format-fallback.js'
import { attachDomain } from './domain.js'
import { createActions } from './actions.js'
import { createTicker } from './ticker.js'
import { renderTitle, titleStage } from './title.js'
import { renderDraft, draftStage } from './draft.js'
import { renderHub, hubStage } from './hub.js'
import { renderModal } from './modals.js'

const TOAST_ICON = { ok: 'check', error: 'close', info: 'info', near: 'near' }

const quietAudio = { sfx() {}, music() {}, setMuted() {}, isMuted: () => false }
const quietBridge = {
  stage: { show() {}, frame() {}, clear() {} },
  fight: async () => ({ won: false, match: null }),
  audio: quietAudio,
}

/** Builds the menus inside `root`. Returns { app, destroy }. */
export function mountUi(root, deps = {}) {
  const host = root || document.getElementById('ui') || document.body
  try {
    return start(host, deps)
  } catch (error) {
    console.error('[maul ui] could not start', error)
    host.textContent = ''
    host.appendChild(h('div.ms-ui', h('div.ms-fatal', 'The menus did not load. Reload the page.')))
    return { app: null, destroy() {} }
  }
}

/** Stands in when the NEAR layer did not load: nobody is connected, and connecting says why it cannot. */
function offlineApi(core) {
  const gone = async () => {
    throw new Error('The connection to NEAR did not load. Reload the page to connect your wallet.')
  }
  return {
    tables: core && core.tables ? core.tables : null,
    state: {
      session: null, player: null, walletBalance: null, dens: [], market: null, hireMarket: [], challenges: [],
      ticker: [], leaderboard: [], stats: null, pending: {},
      social: { enabled: false, profile: null, following: [], followers: [], feed: [], mentions: [] },
    },
    on: () => () => {},
    connect: gone,
    disconnect: async () => {},
    refresh: async () => {},
    getMatch: async () => null,
    social: { profileOf: async () => null, url: () => null },
  }
}

function start(root, deps) {
  const core = deps.core || null
  const api = deps.api && deps.api.state ? deps.api : offlineApi(core)
  const bridge = deps.bridge || quietBridge

  const ui = {
    screen: null,
    practice: false,
    practiceNote: '',
    draft: { picks: [], focus: null },
    connect: { busy: false, text: '', error: '' },
    tab: 'stable',
    pitView: 'dens',
    feedTab: 'feed',
    selected: null, // beast id shown in the stable
    preview: null, // { beastId, level }: a form being looked at on the stage, not the beast's real one
    cheer: null, // { id, beastId }: a level-up that has just landed
    settings: false, // the settings popover is open
    equipOpen: null, // which equipment drawer is open: 0 relic, 1 aura, 2 finisher
    denWhy: {}, // den id → its reasoning is unfolded
    hover: null, // { kind, value } for the stage
    forms: {
      stake: {},
      hirePrice: {},
      hireFights: {},
      challenge: { stake: '0.10', cap: 0, invite: '', rev: 0 },
      compose: { text: '', rev: 0 },
      profile: null,
      rename: null,
    },
    modal: null,
    toasts: [],
    busy: {},
    names: {},
    squad: [null, null, null],
    squadEdited: false,
    inFight: false,
    fightEndedAt: 0,
    accepting: false,
    denMatchId: null,
    denMatch: null, // the MatchView player.den_match points at (it keeps pointing there after the fight ends)
    denMatchAt: 0,
    duelId: null,
    duelMatch: null, // the MatchView player.duel points at, as last seen
    duelBanner: null, // { match, seconds }
    duelEntered: null,
    lastDen: null,
    accountMenu: false,
    muted: false,
    welcome: false,
  }

  const app = {
    api,
    bridge,
    core,
    ui,
    fmt: { ...localFormat, ...(deps.format || {}) },
  }
  attachDomain(app)

  try {
    ui.muted = !!(bridge.audio && bridge.audio.isMuted && bridge.audio.isMuted())
  } catch {
    ui.muted = false
  }

  // ----- The page ----------------------------------------------------------

  const viewEl = h('div.ms-view')
  const tipEl = h('div.tip', { role: 'tooltip' })
  const shell = h('div.ms-ui', viewEl, tipEl)
  // The mount point lets clicks through to the 3D stage wherever there is no panel.
  root.classList.add('ms-host')
  root.appendChild(shell)

  const tickers = {
    'tape-title': createTicker('tape-title', (ts) => app.fmt.timeAgo(ts)),
    'tape-hub': createTicker('tape-hub', (ts) => app.fmt.timeAgo(ts)),
  }
  app.tape = (name) => tickers[name].placeholder()

  // ----- Sound -------------------------------------------------------------

  app.sfx = (name) => {
    try {
      if (bridge.audio && bridge.audio.sfx) bridge.audio.sfx(name)
    } catch {
      /* sound is never worth breaking a click for */
    }
  }
  app.music = (name) => {
    try {
      if (bridge.audio && bridge.audio.music) bridge.audio.music(name)
    } catch {
      /* as above */
    }
  }
  app.toggleSound = () => {
    ui.muted = !ui.muted
    try {
      if (bridge.audio && bridge.audio.setMuted) bridge.audio.setMuted(ui.muted)
    } catch {
      /* as above */
    }
    if (!ui.muted) app.sfx('ui_click')
    app.render()
  }

  // ----- Toasts ------------------------------------------------------------

  let toastId = 0
  let apiOk = 0
  let apiErrors = 0

  app.plain = (error) => {
    const text = error && error.message ? String(error.message) : String(error || '')
    return text.trim() || 'That did not go through. Try again.'
  }

  function dropToast(id) {
    const found = ui.toasts.find((toast) => toast.id === id)
    if (!found || found.leaving) return
    ui.toasts = ui.toasts.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast))
    app.render()
    setTimeout(() => {
      ui.toasts = ui.toasts.filter((toast) => toast.id !== id)
      app.render()
    }, 190)
  }

  app.toast = (kind, text) => {
    const body = String(text || '').trim()
    if (!body) return
    const now = Date.now()
    if (ui.toasts.some((toast) => toast.text === body && now - toast.at < 2500)) return
    const toast = { id: ++toastId, kind: TOAST_ICON[kind] ? kind : 'info', text: body, at: now }
    ui.toasts = [...ui.toasts, toast].slice(-4)
    if (toast.kind === 'error') app.sfx('ui_error')
    setTimeout(() => dropToast(toast.id), toast.kind === 'error' ? 7000 : 4600)
    app.render()
  }
  app.dropToast = dropToast

  // ----- Running an action ---------------------------------------------------

  /**
   * Runs one api action. Marks `key` busy while it is in flight, says what
   * went wrong in a toast when it fails, and returns { ok, value }.
   * If the api already raised its own toast for the result, ours is skipped.
   */
  app.run = async (key, fn, { ok = null, sfx = null } = {}) => {
    if (ui.busy[key]) return { ok: false }
    ui.busy = { ...ui.busy, [key]: true }
    app.render()
    const okBefore = apiOk
    const errorsBefore = apiErrors
    try {
      const value = await fn()
      if (sfx) app.sfx(sfx)
      if (ok && apiOk === okBefore) app.toast('ok', typeof ok === 'function' ? ok(value) : ok)
      return { ok: true, value }
    } catch (error) {
      if (apiErrors === errorsBefore) app.toast('error', app.plain(error))
      return { ok: false, error: app.plain(error) }
    } finally {
      const { [key]: _done, ...rest } = ui.busy
      ui.busy = rest
      app.render()
    }
  }
  app.busy = (key) => !!ui.busy[key]
  app.anyBusy = (prefix) => Object.keys(ui.busy).some((key) => key.startsWith(prefix))
  /** A transaction of this kind is in flight, whoever started it. */
  app.pending = (op) => !!(api.state.pending && api.state.pending[op])

  // ----- Getting around ------------------------------------------------------

  app.go = (tab, opts = {}) => {
    if (ui.tab !== tab) app.sfx('ui_click')
    ui.tab = tab
    if (opts.pitView) ui.pitView = opts.pitView
    if (opts.select != null) ui.selected = opts.select
    if (opts.scrollTo) ui.scrollTo = opts.scrollTo
    ui.accountMenu = false
    ui.settings = false
    ui.equipOpen = null
    ui.hover = null
    ui.preview = null
    app.render()
  }

  app.openModal = (modal) => {
    if (!ui.modal) ui.returnFocus = document.activeElement
    ui.modal = modal
    ui.modalFocus = true
    hideTip()
    app.render()
  }
  app.closeModal = (quiet = false) => {
    if (!ui.modal) return
    ui.modal = null
    if (!quiet) app.sfx('ui_back')
    app.render()
    const back = ui.returnFocus
    ui.returnFocus = null
    if (back && back.isConnected && back.focus) setTimeout(() => back.isConnected && back.focus({ preventScroll: true }), 0)
  }
  /** Changes a field of the open modal (its form state lives on the modal). */
  app.setModal = (patch) => {
    if (!ui.modal) return
    ui.modal = { ...ui.modal, ...patch }
    app.render()
  }

  // ----- The stage behind the menus -------------------------------------------

  let frameEl
  let showKey = ''
  let wasPreview = false
  let hoverTimer = 0
  const resizeWatch = typeof ResizeObserver === 'function' ? new ResizeObserver(() => reframe()) : null

  function reframe() {
    try {
      bridge.stage.frame(frameEl || null)
    } catch (error) {
      console.error('[maul ui] stage.frame failed', error)
    }
  }

  function stagePlan() {
    if (ui.screen === 'title') return titleStage(app)
    if (ui.screen === 'draft') return draftStage(app)
    if (ui.screen === 'hub') return hubStage(app)
    return null
  }

  function syncStage() {
    if (ui.inFight) return
    const found = viewEl.querySelector('[data-stage-frame]')
    const usable = found && found.offsetWidth >= 160 && found.offsetHeight >= 120 ? found : null
    if (usable !== frameEl) {
      if (resizeWatch && frameEl) resizeWatch.unobserve(frameEl)
      frameEl = usable
      if (resizeWatch && frameEl) resizeWatch.observe(frameEl)
      reframe()
    }
    const plan = stagePlan()
    const key = plan && plan.builds && plan.builds.length ? JSON.stringify(plan) : ''
    if (key === showKey) return
    showKey = key
    try {
      if (key) {
        const opts = { ...plan.opts }
        // Coming back from a preview is a swap as well, not a beast changing form.
        if (wasPreview) opts.preview = true
        wasPreview = !!plan.opts.preview
        bridge.stage.show(plan.builds, opts)
      } else {
        wasPreview = false
        bridge.stage.clear()
      }
    } catch (error) {
      console.error('[maul ui] stage.show failed', error)
    }
  }
  app.syncStage = syncStage

  /** What the pointer is over, for the stage: app.hover('species', 3), app.hover(null). */
  app.hover = (kind, value) => {
    clearTimeout(hoverTimer)
    if (kind) {
      if (ui.hover && ui.hover.kind === kind && ui.hover.value === value) return
      ui.hover = { kind, value }
      app.render()
    } else if (ui.hover) {
      // A short grace so moving between two cards does not flick back to the default.
      hoverTimer = setTimeout(() => {
        ui.hover = null
        app.render()
      }, 90)
    }
  }

  // ----- Numbers that tick ---------------------------------------------------

  const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  function flash(el) {
    if (calm || !el.animate) return
    const hostEl = el.closest('[data-flash-host]') || el
    const fx = hostEl.querySelector('.flash-fx')
    if (fx) fx.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 1100, easing: 'cubic-bezier(.2,.8,.2,1)' })
    el.animate([{ transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: 460, easing: 'cubic-bezier(.3,1.5,.5,1)' })
  }

  function tickTo(el, from, to, text, digits) {
    if (calm) {
      el.textContent = text
      el.__shown = to
      return
    }
    const token = (el.__tick = (el.__tick || 0) + 1)
    const started = performance.now()
    const duration = 620
    const step = (now) => {
      if (el.__tick !== token) return
      const t = Math.min(1, (now - started) / duration)
      const value = from + (to - from) * (1 - Math.pow(1 - t, 3))
      el.__shown = value
      if (t < 1) {
        el.textContent = value.toFixed(digits)
        requestAnimationFrame(step)
      } else {
        el.textContent = text
        el.__shown = to
        el.__ticking = false
      }
    }
    el.__ticking = true
    requestAnimationFrame(step)
  }

  function syncCounters() {
    for (const el of viewEl.querySelectorAll('[data-count]')) {
      const target = el.getAttribute('data-count')
      const text = el.getAttribute('data-text') || ''
      if (el.__count === undefined) {
        el.__count = target
        continue
      }
      if (el.__count === target) {
        if (!el.__ticking && el.textContent !== text) el.textContent = text
        continue
      }
      const from = Number(el.__shown ?? el.__count)
      const to = Number(target)
      el.__count = target
      tickTo(el, from, to, text, Number(el.getAttribute('data-digits') || 0))
      if (to > from && el.hasAttribute('data-flash')) flash(el)
    }
  }

  // ----- Tooltips ------------------------------------------------------------

  let tipFor = null
  let tipTimer = 0

  function placeTip() {
    if (!tipFor || !tipFor.isConnected) return hideTip()
    const text = tipFor.getAttribute('data-tip')
    if (!text) return hideTip()
    tipEl.textContent = text
    tipEl.classList.add('is-on')
    const target = tipFor.getBoundingClientRect()
    const size = tipEl.getBoundingClientRect()
    const x = Math.max(8, Math.min(window.innerWidth - size.width - 8, target.left + target.width / 2 - size.width / 2))
    let y = target.top - size.height - 8
    if (y < 8) y = target.bottom + 8
    tipEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
  }
  function hideTip() {
    clearTimeout(tipTimer)
    tipFor = null
    tipEl.classList.remove('is-on')
  }
  function wantTip(el, wait) {
    if (el === tipFor) return
    hideTip()
    if (!el) return
    tipFor = el
    tipTimer = setTimeout(placeTip, wait)
  }
  app.hideTip = hideTip

  shell.addEventListener('pointerover', (event) => wantTip(event.target.closest ? event.target.closest('[data-tip]') : null, 260))
  shell.addEventListener('pointerout', (event) => {
    if (tipFor && !(event.relatedTarget && tipFor.contains(event.relatedTarget))) hideTip()
  })
  shell.addEventListener('focusin', (event) => {
    const el = event.target.closest ? event.target.closest('[data-tip]') : null
    if (el && event.target.matches && event.target.matches(':focus-visible')) wantTip(el, 80)
  })
  shell.addEventListener('focusout', hideTip)
  shell.addEventListener('pointerdown', hideTip)
  shell.addEventListener('wheel', hideTip, { passive: true })

  // ----- Sounds for hovering and pressing --------------------------------------

  let lastHover = null
  shell.addEventListener('pointerover', (event) => {
    const el = event.target.closest ? event.target.closest('button, [data-hover]') : null
    if (el === lastHover) return
    lastHover = el
    if (el && el.getAttribute('aria-disabled') !== 'true') app.sfx('ui_hover')
  })
  shell.addEventListener(
    'click',
    (event) => {
      const el = event.target.closest ? event.target.closest('button') : null
      if (!el || el.getAttribute('aria-disabled') === 'true') return
      const name = el.getAttribute('data-sfx')
      if (name === 'none') return
      app.sfx(name || 'ui_click')
    },
    true,
  )

  // Clicking away closes the account menu.
  shell.addEventListener('pointerdown', (event) => {
    const inside = (selector) => event.target.closest && event.target.closest(selector)
    let changed = false
    if (ui.accountMenu && !inside('.account')) {
      ui.accountMenu = false
      changed = true
    }
    if (ui.settings && !inside('.settings')) {
      ui.settings = false
      changed = true
    }
    if (changed) app.render()
  })

  // ----- Keyboard ------------------------------------------------------------

  const TAB_KEYS = { 1: 'stable', 2: 'pit', 3: 'bazaar', 4: 'hire', 5: 'street' }

  function onKey(event) {
    if (ui.inFight) return
    if (event.key === 'Escape') {
      hideTip()
      if (ui.modal) {
        if (!ui.modal.locked) app.closeModal()
      } else if (ui.accountMenu || ui.settings) {
        ui.accountMenu = false
        ui.settings = false
        app.render()
      } else if (ui.forms.rename) {
        ui.forms.rename = null
        app.render()
      } else if (ui.forms.profile) {
        ui.forms.profile = null
        app.render()
      } else if (ui.equipOpen != null) {
        ui.equipOpen = null
        app.render()
      } else if (ui.practice && ui.screen === 'draft') {
        app.act.leavePractice()
      } else {
        return
      }
      event.preventDefault()
      return
    }
    if (event.key === 'Tab' && ui.modal) {
      const box = viewEl.querySelector('.modal')
      if (!box) return
      const items = focusables(box)
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (!box.contains(document.activeElement)) {
        first.focus()
        event.preventDefault()
      } else if (event.shiftKey && document.activeElement === first) {
        last.focus()
        event.preventDefault()
      } else if (!event.shiftKey && document.activeElement === last) {
        first.focus()
        event.preventDefault()
      }
      return
    }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement && document.activeElement.tagName) || '')
    if (!typing && !ui.modal && ui.screen === 'hub' && !event.ctrlKey && !event.metaKey && !event.altKey && TAB_KEYS[event.key]) {
      app.go(TAB_KEYS[event.key])
      event.preventDefault()
    }
  }
  document.addEventListener('keydown', onKey)

  // ----- Drawing -------------------------------------------------------------

  function screenName() {
    if (!app.tables()) return 'boot'
    if (ui.practice) return 'draft'
    if (!api.state.session) return 'title'
    if (!api.state.player) return 'opening'
    if (!api.state.player.registered) return 'draft'
    return 'hub'
  }

  function onScreen(name, was) {
    ui.screen = name
    ui.hover = null
    ui.preview = null
    ui.accountMenu = false
    ui.settings = false
    if (name === 'hub') {
      app.music('street')
      if (was === 'draft') ui.welcome = true
    }
    if (name === 'title' && was && was !== 'boot') {
      ui.modal = null
      ui.duelBanner = null
    }
  }

  function waiting(text) {
    return h('section.screen.waiting', { 'data-key': 'screen-waiting' }, h('div.waiting-box', h('span.loader.loader-lg', h('i'), h('i'), h('i')), h('p', text)))
  }

  function toasts() {
    return h(
      'div.toasts',
      { 'aria-live': 'polite' },
      ui.toasts.map((toast) =>
        h(
          'div.toast.cut',
          { 'data-key': `toast${toast.id}`, class: [`toast-${toast.kind}`, toast.leaving ? 'is-leaving' : ''], role: toast.kind === 'error' ? 'alert' : 'status' },
          h('span.toast-ic', icon(TOAST_ICON[toast.kind])),
          h('span.toast-text', toast.text),
          h('button.toast-x', { type: 'button', 'aria-label': 'Dismiss', 'data-sfx': 'none', onclick: () => dropToast(toast.id) }, icon('close')),
        ),
      ),
    )
  }

  function view() {
    const name = screenName()
    if (name !== ui.screen) onScreen(name, ui.screen)
    let screen
    if (name === 'title') screen = renderTitle(app)
    else if (name === 'draft') screen = renderDraft(app)
    else if (name === 'hub') screen = renderHub(app)
    else screen = waiting(name === 'boot' ? 'Loading the rules of the Street…' : 'Opening your stable…')
    // Nothing behind an open modal can be clicked or tabbed to.
    if (ui.modal) screen.setAttribute('inert', '')
    return h('div.ms-view', { class: [`on-${name}`, name === 'hub' && ui.duelBanner ? 'has-banner' : ''] }, screen, renderModal(app), toasts())
  }

  function afterRender() {
    // The tapes look after themselves: swap each placeholder for the real strip.
    for (const spot of viewEl.querySelectorAll('[data-widget]')) {
      const ticker = tickers[spot.getAttribute('data-widget')]
      if (!ticker) continue
      if (spot !== ticker.el) spot.replaceWith(ticker.el)
      ticker.set(api.state.ticker)
    }
    syncCounters()
    syncStage()
    if (ui.scrollTo) {
      const target = viewEl.querySelector(ui.scrollTo)
      ui.scrollTo = null
      if (target && target.scrollIntoView) target.scrollIntoView({ block: ui.scrollNear ? 'nearest' : 'start', behavior: calm ? 'auto' : 'smooth' })
      ui.scrollNear = false
    }
    if (ui.focusOn) {
      const target = viewEl.querySelector(ui.focusOn)
      ui.focusOn = null
      if (target) {
        target.focus({ preventScroll: true })
        if (target.select) target.select()
      }
    }
    if (ui.modal && ui.modalFocus) {
      ui.modalFocus = false
      const box = viewEl.querySelector('.modal')
      if (box) {
        const target = box.querySelector('[data-autofocus]') || focusables(box)[0]
        if (target) target.focus({ preventScroll: true })
      }
    }
    if (tipFor) {
      if (!tipFor.isConnected || !tipFor.hasAttribute('data-tip')) hideTip()
      else if (tipEl.classList.contains('is-on')) placeTip()
    }
  }

  let queued = false
  function draw() {
    queued = false
    let fresh
    try {
      fresh = view()
    } catch (error) {
      console.error('[maul ui] render failed', error)
      return
    }
    morph(viewEl, fresh)
    try {
      afterRender()
    } catch (error) {
      console.error('[maul ui] after-render failed', error)
    }
  }
  app.render = () => {
    if (queued) return
    queued = true
    queueMicrotask(draw)
  }
  app.renderNow = draw

  // ----- What the api tells us -------------------------------------------------

  app.act = createActions(app)

  let lastBalance = null
  let lastAccount = null

  function watchPlayer() {
    const player = app.player()
    const account = app.account()
    if (account !== lastAccount) {
      lastAccount = account
      lastBalance = null
      ui.selected = null
    }
    if (!player || !player.registered) return
    const balance = app.balance()
    if (lastBalance != null && balance > lastBalance && !ui.inFight) app.sfx('coin')
    lastBalance = balance

    // The den fight the player record points at. It is read once when the id appears, and
    // again now and then while it is unfinished, so the Pit knows whether to offer Resume.
    const denMatch = player.den_match == null ? null : player.den_match
    const stale = ui.denMatch && !ui.denMatch.over && Date.now() - ui.denMatchAt > 5000
    if (denMatch !== ui.denMatchId || (stale && !ui.inFight)) {
      if (denMatch !== ui.denMatchId) ui.denMatch = null
      ui.denMatchId = denMatch
      ui.denMatchAt = Date.now()
      if (denMatch != null && api.getMatch) {
        Promise.resolve(api.getMatch(denMatch))
          .then((match) => {
            if (ui.denMatchId !== denMatch || !match) return
            // A finished fight never starts again: an answer sent before it ended must not undo a newer one.
            if (ui.denMatch && ui.denMatch.id === match.id && ui.denMatch.over && !match.over) return
            ui.denMatch = match
            ui.denMatchAt = Date.now()
            app.render()
          })
          .catch(() => {})
      }
    }

    // The same for the duel: an id there may be a duel long finished.
    const duel = player.duel == null ? null : player.duel
    if (duel == null) {
      ui.duelId = null
      ui.duelMatch = null
      app.act.duelGone()
    } else if (duel !== ui.duelId) {
      ui.duelId = duel
      if (!ui.duelMatch || ui.duelMatch.id !== duel) ui.duelMatch = null
      if (api.getMatch) {
        Promise.resolve(api.getMatch(duel))
          .then((match) => {
            if (!match || ui.duelId !== duel) return
            if (!ui.duelMatch || ui.duelMatch.id !== duel || !ui.duelMatch.over) ui.duelMatch = match
            if (!match.over) app.act.onDuel(match)
            app.render()
          })
          .catch(() => {})
      }
    }
  }

  /** The player has a den fight that is not finished. */
  app.denLive = () => {
    const player = app.player()
    return !!(player && player.den_match != null && ui.denMatch && ui.denMatch.id === player.den_match && !ui.denMatch.over)
  }
  /** The player is in a duel that is not finished. */
  app.duelLive = () => {
    const player = app.player()
    return !!(player && player.duel != null && ui.duelMatch && ui.duelMatch.id === player.duel && !ui.duelMatch.over)
  }

  const offs = []
  const listen = (type, fn) => {
    try {
      const off = api.on(type, fn)
      if (typeof off === 'function') offs.push(off)
    } catch (error) {
      console.error('[maul ui] could not listen for', type, error)
    }
  }
  listen('change', (key) => {
    if (key === 'player' || key === 'session' || key === undefined) watchPlayer()
    app.render()
  })
  listen('toast', (toast) => {
    if (!toast) return
    if (toast.kind === 'ok') apiOk += 1
    if (toast.kind === 'error') apiErrors += 1
    // NEAR won in a fight is in the fight's result, which the toast would only cover.
    const aroundFight = ui.inFight || Date.now() - ui.fightEndedAt < 4000 || (ui.modal && ui.modal.kind === 'result')
    if (toast.kind === 'near' && aroundFight) return
    app.toast(toast.kind, toast.text)
  })
  listen('duel', (match) => app.act.onDuel(match))

  const onResize = () => {
    hideTip()
    reframe()
    app.render()
  }
  window.addEventListener('resize', onResize)

  // The rules can arrive a moment after the page: look again until they do.
  const bootTimer = setInterval(() => {
    if (app.tables()) clearInterval(bootTimer)
    if (ui.screen === 'boot') app.render()
  }, 300)
  // "2 min ago" should not stay "2 min ago".
  const clockTimer = setInterval(() => {
    if (!ui.inFight && !document.hidden) app.render()
  }, 30000)

  watchPlayer()
  draw()

  return {
    app,
    destroy() {
      clearInterval(bootTimer)
      clearInterval(clockTimer)
      offs.forEach((off) => off())
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
      if (resizeWatch) resizeWatch.disconnect()
      shell.remove()
    },
  }
}
