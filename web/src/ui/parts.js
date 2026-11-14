// The pieces every screen is built from: money, chips, buttons, fields, bars.

import { h } from './dom.js'
import { icon, ASPECT_ICONS } from './icons.js'
import { B, STATS } from './domain.js'

const aspectVar = (aspect) => `var(--aspect-${aspect})`

// ----- Money ---------------------------------------------------------------

/** "Ⓝ 0.39" in brass. `sign` is '+' or '−' for a change. */
export function nearTag(app, yocto, { digits = 2, sign = '', cls = '' } = {}) {
  return h('span.near', { class: cls }, icon('near'), h('span.near-n', `${sign}${app.near(yocto, digits)}`))
}

export function essenceTag(amount, { sign = '', cls = '' } = {}) {
  return h('span.ess', { class: cls }, icon('essence'), h('span.ess-n', `${sign}${amount}`))
}

/**
 * A number that ticks to its new value when it changes. The element keeps its
 * own text (data-morph="own"); the app animates it after each render.
 */
export function counter(key, value, text, digits = 0, flash = false) {
  return h(
    'span.count',
    {
      'data-key': key,
      'data-morph': 'own',
      'data-count': String(value),
      'data-text': text,
      'data-digits': digits,
      'data-flash': flash ? '' : null,
    },
    text,
  )
}

/** A NEAR amount as a ticking counter. */
export function nearCounter(app, key, yocto, digits = 2, flash = false) {
  const value = (Number(B(yocto) / 10n ** 18n) / 1e6).toFixed(6)
  return counter(key, value, app.near(yocto, digits), digits, flash)
}

/** "▲ 12%" when a bazaar price is above its floor. */
export function heatMark(row) {
  const floor = B(row.floor)
  const price = B(row.price)
  if (floor <= 0n || price <= floor) return null
  const pct = Number(((price - floor) * 100n) / floor)
  return h('span.heat', { 'data-tip': 'Above its floor price. It cools while nobody buys.' }, icon('up'), `${pct}%`)
}

export const paysText = (bps) => `×${(Number(bps || 0) / 10000).toFixed(2)}`

// ----- Chips and tags ------------------------------------------------------

export function aspectChip(app, aspect, cls = '') {
  return h('span.chip.chip-aspect', { class: cls, style: { '--c': aspectVar(aspect) } }, icon(ASPECT_ICONS[aspect] || 'flame'), app.aspectName(aspect))
}

/** A square tile with the aspect's glyph, in the aspect's colour. */
export function aspectTile(aspect, cls = '') {
  return h('span.atile', { class: cls, style: { '--c': aspectVar(aspect) } }, icon(ASPECT_ICONS[aspect] || 'flame'))
}

/**
 * A beast in one chip, in its aspect colour: the name its form goes by at
 * `level` (or the line's own name when no level is given), then whatever follows.
 */
export function speciesChip(app, speciesId, after = null, level = null) {
  const species = app.species(speciesId)
  const name = level == null ? species.name : app.formName(speciesId, level)
  return h(
    'span.chip.chip-species',
    { style: { '--c': aspectVar(species.aspect) }, 'data-tip': `${name} · ${app.aspectName(species.aspect)}${level == null ? '' : ` · level ${level}`}` },
    icon(ASPECT_ICONS[species.aspect] || 'flame'),
    h('span.chip-text', name),
    after,
  )
}

export function tag(text, tone = '', iconName = null) {
  return h('span.tag', { class: tone ? `tag-${tone}` : '' }, iconName ? icon(iconName) : null, text)
}

/** "LV 7". */
export function levelTag(level, cls = '') {
  return h('span.lv', { class: cls }, 'Lv ', h('b', level))
}

export function pips(count, of = 5) {
  return h(
    'span.pips',
    { role: 'img', 'aria-label': `Tier ${count} of ${of}` },
    Array.from({ length: of }, (_, i) => h('i', { class: i < count ? 'on' : '' })),
  )
}

/** A trainer: their NEAR Social name when known, and the account. */
export function who(app, accountId, cls = '') {
  const name = app.nameOf(accountId)
  const short = app.fmt.shortAccount(accountId)
  return h('span.who', { class: cls, title: accountId }, h('b.who-name', name || short), name ? h('span.who-id', short) : null)
}

/** Just the name, or the account when there is no name. The full account is in the title. */
export function whoShort(app, accountId) {
  return h('span.who', { title: accountId }, h('b.who-name', app.label(accountId)))
}

export function avatar(app, accountId, cls = '') {
  const label = app.label(accountId) || '?'
  return h('span.avatar', { class: cls, 'aria-hidden': 'true' }, label.replace(/[^a-z0-9]/gi, '').slice(0, 1).toUpperCase() || '?')
}

// ----- Buttons -------------------------------------------------------------

export function loader() {
  return h('span.loader', { 'aria-label': 'Working' }, h('i'), h('i'), h('i'))
}

/**
 * A button.
 *   kind: 'primary' (scarlet) | 'brass' | 'ghost' | 'danger' | 'link'
 *   off: a sentence saying why it cannot be used. The button stays focusable,
 *        shows the sentence on hover and focus, and says it again when pressed.
 *   busy: a transaction is in flight.
 *   act: a stable name for scripts to find the button by: [data-act="spar"].
 *        Fields have the same in data-field, and amount chips in data-amount.
 */
export function btn(app, label, o = {}) {
  const off = o.off || null
  const busy = !!o.busy
  return h(
    'button.btn.cut',
    {
      type: o.submit ? 'submit' : 'button',
      class: [o.kind ? `btn-${o.kind}` : 'btn-ghost', o.size ? `btn-${o.size}` : '', off ? 'is-off' : '', busy ? 'is-busy' : '', o.cls || ''],
      'aria-disabled': off || busy ? 'true' : null,
      'aria-busy': busy ? 'true' : null,
      'aria-label': o.aria || null,
      'aria-expanded': o.expanded == null ? null : String(o.expanded),
      'aria-pressed': o.pressed == null ? null : String(o.pressed),
      'data-tip': typeof off === 'string' ? off : o.tip || null,
      'data-sfx': o.sfx || null,
      'data-key': o.key || null,
      'data-act': o.act || null,
      'data-autofocus': o.autofocus ? '' : null,
      onclick(event) {
        if (busy) {
          event.preventDefault()
          return
        }
        if (off) {
          event.preventDefault()
          app.sfx('ui_error')
          if (typeof off === 'string') app.toast('info', off)
          return
        }
        if (o.onclick) o.onclick(event)
      },
    },
    busy ? loader() : o.icon ? icon(o.icon) : null,
    label != null && label !== '' ? h('span.btn-label', label) : null,
    o.after || null,
  )
}

export function iconBtn(app, iconName, o = {}) {
  return btn(app, null, { ...o, icon: iconName, aria: o.label, tip: o.tip || o.label, cls: `btn-icon ${o.cls || ''}`, kind: o.kind || 'ghost' })
}

/** − value + */
export function stepper(app, { value, min, max, display, onchange, label, off }) {
  const step = (delta) => () => {
    const next = Math.max(min, Math.min(max, value + delta))
    if (next !== value) onchange(next)
  }
  return h(
    'div.stepper',
    { class: off ? 'is-off' : '', role: 'group', 'aria-label': label || null },
    iconBtn(app, 'minus', { label: 'Less', cls: 'stepper-btn', act: 'less', off: off || (value <= min ? true : null), onclick: step(-1), sfx: 'ui_hover' }),
    h('span.stepper-val', display),
    iconBtn(app, 'plus', { label: 'More', cls: 'stepper-btn', act: 'more', off: off || (value >= max ? true : null), onclick: step(1), sfx: 'ui_hover' }),
  )
}

/** A row of mutually exclusive choices. options: [{ value, label }]. */
export function segmented(app, options, value, onchange, label) {
  return h(
    'div.seg',
    { role: 'radiogroup', 'aria-label': label || null },
    options.map((option) =>
      h(
        'button.seg-btn',
        {
          type: 'button',
          role: 'radio',
          'aria-checked': String(option.value === value),
          class: option.value === value ? 'is-on' : '',
          'data-act': option.act || null,
          onclick: () => onchange(option.value),
        },
        option.label,
        option.badge || null,
      ),
    ),
  )
}

// ----- Fields --------------------------------------------------------------

/**
 * A labelled text field. Its value lives in the screen's own state, so a
 * re-render never loses what was typed. `rev` forces the value when the
 * screen clears the form on purpose.
 */
export function field(app, o) {
  const input = h(o.multiline ? 'textarea.field-input' : 'input.field-input', {
    type: o.multiline ? null : 'text',
    name: o.name || null,
    'data-field': o.field || null,
    value: o.value ?? '',
    placeholder: o.placeholder || null,
    inputmode: o.inputmode || null,
    maxlength: o.maxlength || null,
    rows: o.rows || null,
    autocomplete: 'off',
    spellcheck: o.spellcheck ? 'true' : 'false',
    'aria-label': o.label || o.aria || null,
    'data-rev': o.rev == null ? null : String(o.rev),
    'data-autofocus': o.autofocus ? '' : null,
    oninput: (event) => o.oninput(event.target.value),
    onkeydown: o.onkeydown || null,
  })
  return h(
    'label.field',
    { class: [o.cls || '', o.invalid ? 'is-bad' : ''], 'data-key': o.key || null },
    o.label ? h('span.field-label', o.label) : null,
    h('span.field-box', o.prefix || null, input, o.suffix ? h('span.field-suffix', o.suffix) : null),
    o.hint ? h('span.field-hint', o.hint) : null,
  )
}

/** Keeps only what can be a NEAR amount as someone types it. */
export function cleanAmount(text) {
  let clean = String(text || '').replace(',', '.').replace(/[^\d.]/g, '')
  const dot = clean.indexOf('.')
  if (dot >= 0) clean = clean.slice(0, dot + 1) + clean.slice(dot + 1).replace(/\./g, '')
  return clean.slice(0, 12)
}

// ----- Stats, levels and forms ----------------------------------------------

/** Four bars. `ceiling` is the value that fills a bar, per stat. */
export function statBars(stats, ceiling, { labels = 'plain' } = {}) {
  return h(
    'div.bars',
    { class: labels === 'short' ? 'bars-short' : '' },
    stats.map((value, i) =>
      h(
        'div.bar',
        { 'data-key': `bar${i}` },
        h('span.bar-label', labels === 'short' ? STATS[i].short : STATS[i].plain),
        h('span.bar-track', h('i', { style: { width: `${Math.max(4, Math.min(100, Math.round((value / ceiling[i]) * 100)))}%` } })),
        h('span.bar-val', value),
      ),
    ),
  )
}

/** How far a beast is towards its next level. `from` (0..1) makes the bar grow from there when it first appears. */
export function xpBar(xp, need, { from = null, cls = '' } = {}) {
  const part = need > 0 ? Math.max(0, Math.min(1, xp / need)) : 0
  const style = { '--to': `${(part * 100).toFixed(1)}%` }
  if (from != null) style['--from'] = `${(Math.max(0, Math.min(1, from)) * 100).toFixed(1)}%`
  return h('span.xp', { class: [cls, from != null ? 'is-growing' : ''], role: 'img', 'aria-label': `${xp} of ${need} XP`, style }, h('i'))
}

/** Fights, wins and knockouts. */
export function record(beast) {
  const cell = (label, value) => h('span.rec', h('b', value), h('span', label))
  return h('span.record', cell('Fights', beast.fights || 0), cell('Wins', beast.wins || 0), cell('KOs', beast.kills || 0))
}

/**
 * The road a line of beasts grows along: its five forms as steps, with the
 * level each begins at. `at` is the form it wears now (or -1 for none lit).
 * `onlook(form)` and `onleave()` let a step show that form on the stage.
 */
export function formRoad(app, speciesId, at, { onlook = null, onleave = null, looking = null } = {}) {
  const names = app.formNames(speciesId)
  const levels = app.formLevels()
  const labels = app.formLabels()
  return h(
    'ol.road',
    { style: { '--c': aspectVar(app.species(speciesId).aspect) } },
    names.map((name, form) => {
      const state = form < at ? 'is-past' : form === at ? 'is-now' : 'is-ahead'
      const body = [h('i.road-dot'), h('b.road-name', name), h('span.road-lv', `Lv ${levels[form]}`)]
      const tip = `${name}: the ${labels[form] || ''} form, from level ${levels[form]}`
      return h(
        'li.road-step',
        { 'data-key': `form${form}`, 'data-form': form, class: [state, looking === form ? 'is-looked' : ''], 'data-tip': onlook ? null : tip },
        onlook
          ? h(
              'button.road-btn',
              {
                type: 'button',
                'aria-label': `${tip}. Point at it to see it on the stage.`,
                'data-tip': tip,
                'data-act': 'form-step',
                'data-sfx': 'none',
                onpointerenter: () => onlook(form),
                onpointerleave: () => onleave && onleave(),
                onfocus: () => onlook(form),
                onblur: () => onleave && onleave(),
              },
              body,
            )
          : h('span.road-btn', body),
      )
    }),
  )
}

// ----- Layout --------------------------------------------------------------

export function panelHead(title, meta = null, extra = null) {
  return h('header.panel-head', h('h2.panel-title', title), meta ? h('span.panel-meta', meta) : null, extra)
}

export function empty(iconName, title, text, action = null) {
  return h('div.empty', icon(iconName), h('b', title), text ? h('p', text) : null, action)
}

/**
 * The window onto the 3D stage. The frame element is left empty: the game
 * centres its camera on that rectangle. The plate sits under the beast.
 */
export function stageBlock(plate = null, over = null) {
  return h(
    'div.stage',
    h('div.stage-frame', { 'data-stage-frame': '', 'data-key': 'stage-frame' }),
    h('i.corner.tl'),
    h('i.corner.tr'),
    h('i.corner.bl'),
    h('i.corner.br'),
    over,
    plate ? h('div.plate', plate) : null,
  )
}
