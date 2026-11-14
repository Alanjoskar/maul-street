// STABLE: the player's beasts, the squad of three, and one beast's sheet:
// its name, its level and the forms it grows through, what it wears, its record.

import { h } from './dom.js'
import { icon } from './icons.js'
import { B, KINDS, MARKS, STATS } from './domain.js'
import { aspectChip, aspectTile, btn, cleanAmount, counter, empty, essenceTag, field, formRoad, iconBtn, levelTag, nearTag, panelHead, stageBlock, tag, whoShort, xpBar } from './parts.js'

function selectedEntry(app) {
  const { ui } = app
  const roster = app.roster()
  let entry = roster.find((item) => item.beast.id === ui.selected) || null
  if (!entry && roster.length) {
    entry = roster[0]
    ui.selected = entry.beast.id
  }
  return entry
}

function select(app, id) {
  const { ui } = app
  if (ui.selected === id) return
  ui.selected = id
  ui.equipOpen = null
  ui.preview = null
  ui.forms.rename = null
  app.render()
}

/** Shows a form of this beast's line on the stage for as long as it is looked at. */
function look(app, beast, level) {
  const { ui } = app
  if (ui.preview && ui.preview.beastId === beast.id && ui.preview.level === level) return
  ui.preview = { beastId: beast.id, level }
  app.render()
}

function lookAway(app) {
  if (!app.ui.preview) return
  app.ui.preview = null
  app.render()
}

// ----- Left: the roster and the squad ----------------------------------------

function beastRow(app, entry, selectedId) {
  const { beast, hired, fightsLeft } = entry
  const species = app.species(beast.species)
  const form = app.formOf(beast)
  const level = app.levelOf(beast)
  const slot = app.squad().indexOf(beast.id)
  const part = beast.xp_next > 0 ? Math.min(1, (beast.xp || 0) / beast.xp_next) : 0
  const quick = () => {
    const what = app.quickSquad(beast.id)
    if (what === 'full') {
      app.sfx('ui_error')
      app.ui.selected = beast.id
      app.toast('info', `Your squad is full. Click a slot to swap ${beast.name} in.`)
    } else {
      app.sfx(what === 'added' ? 'equip' : 'ui_back')
    }
  }
  return h(
    'div.brow.cut',
    { 'data-key': `b${beast.id}`, 'data-beast': beast.id, class: [beast.id === selectedId ? 'is-on' : '', hired ? 'is-hired' : ''], style: { '--c': `var(--aspect-${species.aspect})` } },
    h(
      'button.brow-hit',
      { type: 'button', 'data-act': 'beast', 'aria-pressed': String(beast.id === selectedId), onclick: () => select(app, beast.id) },
      aspectTile(species.aspect),
      h(
        'span.brow-id',
        h('b.brow-name', beast.name),
        h('span.brow-sub', beast.name === form.name ? form.label : form.name, h('i.sep'), levelTag(level)),
        hired
          ? h('span.brow-note.is-hired', `Hired · ${fightsLeft} fight${fightsLeft === 1 ? '' : 's'} left`)
          : beast.hire_price != null
            ? h('span.brow-note.is-listed', icon('tag'), 'For hire at ', nearTag(app, beast.hire_price, { digits: 3 }))
            : null,
      ),
    ),
    h('i.brow-xp', { style: { width: `${(part * 100).toFixed(1)}%` }, 'aria-hidden': 'true' }),
    h(
      'button.brow-squad',
      {
        type: 'button',
        class: slot >= 0 ? 'is-in' : '',
        'aria-label': slot >= 0 ? `Take ${beast.name} out of the squad` : `Send ${beast.name} to the squad`,
        'data-tip': slot >= 0 ? 'In your squad. Click to take it out.' : 'Send to the squad',
        'data-act': 'squad-toggle',
        'data-sfx': 'none',
        onclick: quick,
      },
      slot >= 0 ? [h('b', slot + 1), h('span', 'In squad')] : [icon('plus'), h('span', 'Squad')],
    ),
  )
}

function squadPanel(app, selected) {
  const entries = app.squadEntries()
  const ready = app.squadReady()
  const selectedIn = selected ? app.squad().indexOf(selected.beast.id) : -1
  let hint = 'Ready for the pit.'
  if (selected && selectedIn < 0) hint = `Click a slot to send ${selected.beast.name} in.`
  else if (!ready) hint = 'A fight needs all three slots filled.'

  return h(
    'div.panel.cut.squad',
    { class: ready ? '' : 'is-short' },
    panelHead('Squad', ready ? ['Power ', h('b', app.squadPower())] : h('span.warn', 'Not ready')),
    h(
      'div.squad-slots',
      entries.map((entry, i) => {
        const species = entry ? app.species(entry.beast.species) : null
        const target = selected && selectedIn !== i
        return h(
          'button.slot.cut',
          {
            type: 'button',
            'data-key': `slot${i}`,
            'data-act': 'slot',
            'data-slot': i,
            class: [entry ? 'is-full' : '', target && selectedIn < 0 ? 'is-target' : ''],
            style: species ? { '--c': `var(--aspect-${species.aspect})` } : null,
            'aria-label': entry ? `Slot ${i + 1}: ${entry.beast.name}` : `Slot ${i + 1}: empty`,
            'data-tip': selected ? (selectedIn === i ? `Take ${selected.beast.name} out` : `Put ${selected.beast.name} here`) : null,
            'data-sfx': 'none',
            onclick: () => {
              if (!selected) return
              app.sfx(selectedIn === i ? 'ui_back' : 'equip')
              app.assignSlot(i, selected.beast.id)
            },
          },
          h('span.slot-n', i + 1),
          entry
            ? [aspectTile(species.aspect, 'atile-sm'), h('b.slot-name', entry.beast.name), h('span.slot-sub', entry.hired ? 'Hired · ' : '', levelTag(app.levelOf(entry.beast)))]
            : [h('span.slot-plus', icon('plus')), h('span.slot-sub', 'Empty')],
        )
      }),
    ),
    h('p.squad-hint', { class: ready ? '' : 'is-warn' }, hint),
  )
}

// ----- Right: the beast sheet --------------------------------------------------

function sheetHead(app, entry) {
  const { ui } = app
  const { beast, hired, fightsLeft } = entry
  const species = app.species(beast.species)
  const form = app.formOf(beast)
  const renaming = ui.forms.rename && ui.forms.rename.id === beast.id
  const busy = app.busy('rename')

  const name = renaming
    ? h(
        'form.rename',
        {
          onsubmit: (event) => {
            event.preventDefault()
            app.act.rename()
          },
        },
        field(app, {
          aria: 'New name',
          field: 'beast-name',
          value: ui.forms.rename.value,
          maxlength: 24,
          cls: 'rename-field',
          oninput: (value) => {
            ui.forms.rename = { id: beast.id, value: value.replace(/[^\x20-\x7e]/g, '').slice(0, 24) }
            app.render()
          },
        }),
        btn(app, 'Save', { submit: true, kind: 'brass', size: 'sm', act: 'rename-save', busy, off: ui.forms.rename.value.trim() ? null : 'A name needs at least one character.' }),
        btn(app, 'Cancel', { size: 'sm', act: 'rename-cancel', onclick: () => ((ui.forms.rename = null), app.render()), sfx: 'ui_back' }),
      )
    : h(
        'div.sheet-name',
        h('h2', beast.name),
        hired
          ? null
          : iconBtn(app, 'pencil', {
              label: 'Give it a name',
              cls: 'rename-btn',
              act: 'rename',
              onclick: () => {
                ui.forms.rename = { id: beast.id, value: beast.name }
                ui.focusOn = '.rename input'
                app.render()
              },
            }),
      )

  const rate = beast.fights ? `${Math.round(((beast.wins || 0) / beast.fights) * 100)}%` : '–'
  const stat = (label, value) => h('span.rec', h('b', value), h('span', label))

  return h(
    'header.sheet-head',
    { style: { '--c': `var(--aspect-${species.aspect})` } },
    h(
      'div.sheet-top',
      aspectTile(species.aspect, 'atile-lg'),
      h(
        'div.sheet-id',
        name,
        h('div.sheet-sub', beast.name === form.name ? null : h('span', form.name), aspectChip(app, species.aspect), h('span.sheet-token', `No. ${beast.id}`)),
        hired ? h('div.sheet-hired', tag(`Hired · ${fightsLeft} fight${fightsLeft === 1 ? '' : 's'} left`, 'ember'), h('span', 'from'), whoShort(app, beast.owner)) : null,
      ),
      h('div.sheet-power', h('span.label', 'Power'), counter(`power${beast.id}`, beast.power, String(beast.power))),
    ),
    h('div.sheet-record', { 'aria-label': 'Record' }, stat('Fights', beast.fights || 0), stat('Wins', beast.wins || 0), stat('KOs', beast.kills || 0), stat('Win rate', rate)),
  )
}

/** The level, the XP towards the next one, what the next one brings, and the two ways to buy it. */
function levelPanel(app, beast, owned) {
  const { ui } = app
  const species = app.species(beast.species)
  const level = app.levelOf(beast)
  const form = app.formOf(beast)
  const info = app.levelInfo(level)
  const xp = Number(beast.xp || 0)
  const need = Number(beast.xp_next || (info && info.xp) || 0)
  const missing = Math.max(0, need - xp)
  const now = Array.isArray(beast.stats) ? beast.stats : app.statsOf(beast).stats
  const next = app.stats(beast.species, level + 1, beast.relic || 0).stats
  const balance = app.balance()
  const essence = app.essence()
  const keyNear = `level:${beast.id}:n`
  const keyEssence = `level:${beast.id}:e`
  const anyBusy = app.anyBusy('level:') || app.pending('levelUp')
  const cheer = ui.cheer && ui.cheer.beastId === beast.id ? ui.cheer : null

  let buttons = null
  if (owned && info) {
    const nearOff = B(info.near) > balance ? `Your pit balance is ${app.near(balance)} NEAR. Level ${level + 1} costs ${app.near(info.near, 3)}.` : null
    const essenceOff = missing > essence ? `You have ${essence} Essence. Level ${level + 1} takes ${missing}. Every fight earns more.` : null
    buttons = h(
      'div.level-buy',
      btn(app, `Level ${level + 1}`, {
        kind: 'brass',
        cls: 'buy-near',
        aria: `Buy level ${level + 1} for ${app.near(info.near, 3)} NEAR`,
        tip: `Buy level ${level + 1} with NEAR. ${beast.name} keeps the XP it has.`,
        off: nearOff || (anyBusy && !app.busy(keyNear) ? true : null),
        busy: app.busy(keyNear),
        sfx: 'none',
        act: 'level-near',
        after: nearTag(app, info.near, { digits: 3 }),
        onclick: () => app.act.levelUp(beast, false, info),
      }),
      btn(app, 'Feed Essence', {
        cls: 'buy-ess',
        aria: `Feed ${missing} Essence to reach level ${level + 1}`,
        tip: `Essence stands in for the ${missing} XP ${beast.name} still needs.`,
        off: essenceOff || (anyBusy && !app.busy(keyEssence) ? true : null),
        busy: app.busy(keyEssence),
        sfx: 'none',
        act: 'level-essence',
        after: essenceTag(missing),
        onclick: () => app.act.levelUp(beast, true, info),
      }),
    )
  }

  return h(
    'section.sheet-sec.level-sec',
    { style: { '--c': `var(--aspect-${species.aspect})` } },
    h(
      'h3.sec-title',
      'Level',
      // A level that has just landed takes the place of the note, where it covers nothing.
      cheer
        ? h('span.level-up', { 'data-key': `up${cheer.id}`, role: 'status' }, icon('arrow-up'), 'Level up!')
        : h('span.sec-meta', owned ? 'Earns XP in every fight' : 'Earns XP with you, and goes home stronger'),
    ),
    h(
      'div.level-row',
      h(
        'div.level-box.cut',
        cheer ? h('i.level-burst', { 'data-key': `burst${cheer.id}`, 'aria-hidden': 'true' }) : null,
        counter(`lv${beast.id}`, level, String(level)),
        h('span.label', 'Level'),
      ),
      h(
        'div.level-main',
        h('div.level-form', h('b', form.name), tag(form.label, 'form')),
        h('div.level-xp', xpBar(xp, need), h('span.level-xp-n', h('b', xp), ` / ${need} XP`)),
      ),
    ),
    h(
      'div.stat-row',
      now.map((value, i) =>
        h(
          'div.stat-cell',
          { 'data-key': `stat${i}`, 'data-tip': `${STATS[i].plain} ${value} now, ${next[i]} at level ${level + 1}.` },
          h('span.label', STATS[i].plain),
          counter(`stat${beast.id}-${i}`, value, String(value)),
          h('span.stat-next', icon('arrow-right'), next[i]),
        ),
      ),
    ),
    buttons,
  )
}

/** The five forms of the line, where this beast stands, and a look at what comes next. */
function roadPanel(app, beast) {
  const { ui } = app
  const level = app.levelOf(beast)
  const form = app.formOf(beast)
  const names = app.formNames(beast.species)
  const levels = app.formLevels()
  const labels = app.formLabels()
  const nextForm = form.index + 1 < names.length ? form.index + 1 : null
  const looking = ui.preview && ui.preview.beastId === beast.id ? app.formAt(ui.preview.level) : null
  const hold = (formIndex) => ({
    onpointerdown: () => look(app, beast, levels[formIndex]),
    onpointerup: () => lookAway(app),
    onpointerleave: () => lookAway(app),
    onpointercancel: () => lookAway(app),
    onblur: () => lookAway(app),
    onkeydown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        look(app, beast, levels[formIndex])
      }
    },
    onkeyup: () => lookAway(app),
  })

  return h(
    'section.sheet-sec.road-sec',
    { style: { '--c': `var(--aspect-${app.species(beast.species).aspect})` } },
    h('h3.sec-title', 'The road ahead', h('span.sec-meta', 'Point at a form to see it on the stage')),
    formRoad(app, beast.species, form.index, {
      looking,
      onlook: (index) => look(app, beast, Math.max(levels[index], index === form.index ? level : levels[index])),
      onleave: () => lookAway(app),
    }),
    nextForm != null
      ? h(
          'div.road-next',
          h('p', 'Becomes ', h('b', names[nextForm]), ` at level ${levels[nextForm]}`, h('span', ` · ${levels[nextForm] - level} to go`)),
          h(
            'button.btn.cut.btn-ghost.btn-sm.preview-btn',
            {
              type: 'button',
              class: looking === nextForm ? 'is-held' : '',
              'aria-pressed': String(looking === nextForm),
              'data-tip': `Hold to see ${names[nextForm]} on the stage`,
              'data-act': 'preview',
              'data-sfx': 'ui_hover',
              ...hold(nextForm),
            },
            icon('eye'),
            h('span.btn-label', 'Preview'),
          ),
        )
      : h('div.road-next', h('p', h('b', form.name), ` is the ${labels[form.index]} form: the last of its line. It can still grow without limit.`)),
  )
}

function drawer(app, beast, kindIndex) {
  const { ui } = app
  const kind = KINDS[kindIndex]
  const owned = app.itemsOwned()
  const current = beast[kind.key] ? app.item(beast[kind.key]) : null
  const options = app.tables().items.filter((item) => item.kind === kindIndex && (owned.get(item.id) || 0) > 0)
  return h(
    'div.drawer.cut',
    { 'data-key': `drawer${kindIndex}` },
    h('div.drawer-head', h('b', `${kind.plural} you own`), iconBtn(app, 'close', { label: 'Close', cls: 'drawer-x', onclick: () => ((ui.equipOpen = null), app.render()), sfx: 'ui_back' })),
    options.map((item) =>
      h(
        'div.drawer-row',
        { 'data-key': `opt${item.id}` },
        h('div.drawer-what', h('b', item.name), h('span', item.text)),
        h('span.drawer-count', `×${owned.get(item.id)}`),
        btn(app, 'Equip', { kind: 'brass', size: 'sm', act: 'equip', busy: app.busy(`equip:${item.id}`), onclick: () => app.act.equip(beast, item.id), sfx: 'none' }),
      ),
    ),
    !options.length ? h('p.drawer-empty', current ? `No other ${kind.plural.toLowerCase()} in your inventory.` : `No ${kind.plural.toLowerCase()} in your inventory yet.`) : null,
    current
      ? h(
          'div.drawer-row',
          { 'data-key': 'off' },
          h('div.drawer-what', h('b', `Take off ${current.name}`), h('span', 'It goes back to your inventory.')),
          btn(app, 'Unequip', { size: 'sm', act: 'unequip', busy: app.busy(`unequip:${kindIndex}`), onclick: () => app.act.unequip(beast, kindIndex), sfx: 'none' }),
        )
      : null,
    h(
      'button.linkline',
      { type: 'button', onclick: () => app.go('bazaar', { scrollTo: `[data-shelf="${kindIndex}"]` }) },
      `Browse ${kind.plural.toLowerCase()} in the bazaar`,
      icon('arrow-right'),
    ),
  )
}

function equipment(app, beast, owned) {
  const { ui } = app
  return h(
    'section.sheet-sec',
    h('h3.sec-title', 'Equipment'),
    h(
      'div.equip-row',
      KINDS.map((kind, k) => {
        const def = beast[kind.key] ? app.item(beast[kind.key]) : null
        const open = owned && ui.equipOpen === k
        return h(
          'button.equip.cut',
          {
            type: 'button',
            'data-key': `equip${k}`,
            'data-act': 'equip-slot',
            'data-kind': kind.key,
            class: [def ? 'is-full' : '', open ? 'is-open' : '', owned ? '' : 'is-fixed'],
            'aria-expanded': owned ? String(open) : null,
            'data-tip': def ? `${def.name}: ${def.text}` : owned ? `${kind.does}. Click to choose one.` : kind.does,
            onclick: () => {
              if (!owned) return
              ui.equipOpen = open ? null : k
              if (!open) {
                ui.scrollTo = '.drawer'
                ui.scrollNear = true
              }
              app.render()
            },
          },
          h('span.equip-kind', icon(kind.icon), kind.label),
          h('b.equip-name', def ? def.name : 'Empty'),
          h('span.equip-text', def ? def.text : owned ? 'Choose one' : 'Nothing worn'),
        )
      }),
    ),
    owned && ui.equipOpen != null ? drawer(app, beast, ui.equipOpen) : null,
  )
}

function hireControl(app, beast) {
  const { ui } = app
  const listed = beast.hire_price != null
  const text = ui.forms.hirePrice[beast.id] ?? ''
  const yocto = app.fmt.toYocto(text || '0')
  const lowest = 10n ** 21n
  const fee = Number(app.rule('hire_fee_bps', 500)) / 100
  let off = null
  if (text === '') off = 'Enter a price per fight.'
  else if (B(yocto) < lowest) off = 'The lowest price is 0.001 NEAR a fight.'
  const busy = app.busy(`list:${beast.id}`)

  return h(
    'section.sheet-sec.hire-box',
    h('h3.sec-title', 'Hire out', h('span.sec-meta', 'Earned so far ', nearTag(app, beast.earned, { digits: 3 }))),
    listed
      ? h(
          'div.hire-live',
          tag('Listed', 'brass', 'tag'),
          nearTag(app, beast.hire_price, { digits: 3 }),
          h('span.hire-per', 'a fight'),
          btn(app, 'Unlist', { size: 'sm', act: 'unlist', busy: app.busy(`unlist:${beast.id}`), onclick: () => app.act.unlist(beast), sfx: 'none' }),
        )
      : null,
    h(
      'form.hire-form',
      {
        onsubmit: (event) => {
          event.preventDefault()
          if (!off && !busy) app.act.list(beast, yocto)
        },
      },
      field(app, {
        aria: listed ? 'New price per fight, in NEAR' : 'Price per fight, in NEAR',
        field: 'hire-price',
        value: text,
        placeholder: listed ? 'New price' : 'Price per fight',
        inputmode: 'decimal',
        prefix: icon('near'),
        rev: ui.forms.hireRev || 0,
        oninput: (value) => {
          ui.forms.hirePrice[beast.id] = cleanAmount(value)
          app.render()
        },
      }),
      btn(app, listed ? 'Change price' : 'List for hire', { submit: true, kind: 'brass', size: 'sm', act: 'list-hire', off, busy, sfx: 'none' }),
    ),
    h('p.sec-note', `Trainers who hire ${beast.name} pay you for every fight, and it comes home with the XP it earned. The house keeps ${fee}%.`),
  )
}

function sheet(app, entry) {
  const { beast, hired } = entry
  const species = app.species(beast.species)
  const owned = !hired

  return h(
    'div.panel.cut.sheet',
    { 'data-key': `sheet${beast.id}` },
    sheetHead(app, entry),
    h(
      'div.sheet-body.scroll',
      h(
        'div.facts',
        h('div.fact', h('span.label', 'Strong against'), aspectChip(app, (species.aspect + 1) % 5)),
        h('div.fact', h('span.label', 'Weak against'), aspectChip(app, (species.aspect + 4) % 5)),
        h('div.fact', h('span.label', 'Special'), h('span.fact-special', h('b', species.special), MARKS[species.aspect] ? h('em', `leaves ${MARKS[species.aspect]}`) : null)),
      ),
      levelPanel(app, beast, owned),
      roadPanel(app, beast),
      equipment(app, beast, owned),
      owned
        ? hireControl(app, beast)
        : h(
            'section.sheet-sec',
            h('h3.sec-title', 'Hired beast'),
            h('p.sec-note', `${beast.name} uses up one hired fight each time a fight starts with it in your squad.`),
            btn(app, 'Hire more fights', { kind: 'brass', size: 'sm', icon: 'tag', onclick: () => app.go('hire') }),
          ),
    ),
  )
}

// ----- The tab ----------------------------------------------------------------------

export function renderStable(app) {
  const { ui } = app
  const roster = app.roster()
  const owned = roster.filter((entry) => !entry.hired)
  const hired = roster.filter((entry) => entry.hired)
  const selected = selectedEntry(app)
  const selectedId = selected ? selected.beast.id : null
  const species = selected ? app.species(selected.beast.species) : null
  const step = (delta) => () => {
    const at = roster.findIndex((entry) => entry.beast.id === selectedId)
    const next = roster[(at + delta + roster.length) % roster.length]
    if (next) select(app, next.beast.id)
  }

  let plate = null
  if (selected) {
    const beast = selected.beast
    const form = app.formOf(beast)
    const preview = ui.preview && ui.preview.beastId === beast.id ? ui.preview : null
    if (preview) {
      const index = app.formAt(preview.level)
      plate = [
        h('div.plate-kicker', tag('Preview', 'brass', 'eye'), h('span', app.formLabels()[index], ' form'), levelTag(preview.level)),
        h('div.plate-row', h('div.plate-name', app.formName(beast.species, preview.level))),
        h('p.plate-note', index === form.index ? `${beast.name} as it is now.` : index > form.index ? `What ${beast.name} grows into at level ${app.formLevels()[index]}.` : `What ${beast.name} used to be.`),
      ]
    } else {
      plate = [
        h('div.plate-kicker', aspectChip(app, species.aspect), h('span', form.label, ' form'), levelTag(app.levelOf(beast)), h('span', 'Power ', h('b', beast.power))),
        h(
          'div.plate-row',
          roster.length > 1 ? iconBtn(app, 'chevron-left', { label: 'Previous beast', cls: 'plate-step', act: 'prev-beast', onclick: step(-1) }) : null,
          h('div.plate-name', beast.name),
          roster.length > 1 ? iconBtn(app, 'chevron-right', { label: 'Next beast', cls: 'plate-step', act: 'next-beast', onclick: step(1) }) : null,
        ),
        h('p.plate-note', species.lore),
      ]
    }
  }

  return h(
    'div.tabbody.three',
    { 'data-key': 'tab-stable' },
    h(
      'section.col.col-left',
      h(
        'div.panel.cut.roster',
        panelHead('Your stable', `${owned.length} owned${hired.length ? ` · ${hired.length} hired` : ''}`),
        h(
          'div.roster-list.scroll',
          owned.map((entry) => beastRow(app, entry, selectedId)),
          hired.length ? h('div.roster-sep', { 'data-key': 'sep' }, 'Hired champions') : null,
          hired.map((entry) => beastRow(app, entry, selectedId)),
          h(
            'button.linkline.roster-more',
            { type: 'button', 'data-key': 'more', onclick: () => app.go('bazaar', { scrollTo: '[data-shelf="beasts"]' }) },
            'Bring home another cub from the bazaar',
            icon('arrow-right'),
          ),
        ),
      ),
      squadPanel(app, selected),
    ),
    h('section.col.col-stage', selected ? stageBlock(plate) : stageBlock()),
    h('section.col.col-right', selected ? sheet(app, selected) : h('div.panel.cut', empty('fang', 'No beasts yet', 'Bring one home from the bazaar.'))),
  )
}

export function stableStage(app) {
  const selected = selectedEntry(app)
  if (!selected) return null
  const preview = app.ui.preview && app.ui.preview.beastId === selected.beast.id ? app.ui.preview : null
  // A preview swaps the body at once. A real change of level is left to the stage, which plays the change of form itself.
  const opts = { layout: 'single', focus: 0, mood: 'stable' }
  if (preview) opts.preview = true
  return { builds: [app.buildOf(selected.beast, preview ? { level: preview.level } : null)], opts }
}
