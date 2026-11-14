// The draft: a new trainer picks three of the five common cubs.
// Practice mode uses the same screen and never touches the chain.

import { h, svg } from './dom.js'
import { icon, ASPECT_ICONS } from './icons.js'
import { aspectChip, aspectTile, btn, formRoad, levelTag, stageBlock, statBars, tag } from './parts.js'
import { settingsCluster } from './settings.js'
import { wordmark } from './title.js'

const beats = (aspect) => (aspect + 1) % 5
const losesTo = (aspect) => (aspect + 4) % 5

function focusOf(app) {
  const { draft } = app.ui
  if (draft.focus != null) return draft.focus
  if (draft.picks.length) return draft.picks[draft.picks.length - 1]
  return 0
}

/** The ring of five aspects. Each beats the next one clockwise. */
export function aspectRing(app, { lit = [], focus = null } = {}) {
  const width = 300
  const size = 240
  const cx = width / 2
  const cy = size / 2 + 2
  const radius = 80
  const node = 22
  const at = (i, r = radius) => {
    const angle = ((-90 + i * 72) * Math.PI) / 180
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]
  }
  const shapes = []
  for (let i = 0; i < 5; i++) {
    const [x1, y1] = at(i)
    const [x2, y2] = at(beats(i))
    const length = Math.hypot(x2 - x1, y2 - y1)
    const ux = (x2 - x1) / length
    const uy = (y2 - y1) / length
    const sx = x1 + ux * (node + 5)
    const sy = y1 + uy * (node + 5)
    const ex = x2 - ux * (node + 9)
    const ey = y2 - uy * (node + 9)
    const hot = focus === i || focus === beats(i)
    shapes.push(
      svg(
        'g.ring-arrow',
        { class: hot ? 'is-hot' : '', style: { '--c': `var(--aspect-${i})` } },
        svg('line', { x1: sx.toFixed(1), y1: sy.toFixed(1), x2: ex.toFixed(1), y2: ey.toFixed(1) }),
        svg('path', {
          d: `M${(ex + ux * 7).toFixed(1)} ${(ey + uy * 7).toFixed(1)} L${(ex - uy * 4.6).toFixed(1)} ${(ey + ux * 4.6).toFixed(1)} L${(ex + uy * 4.6).toFixed(1)} ${(ey - ux * 4.6).toFixed(1)} Z`,
        }),
      ),
    )
  }
  for (let i = 0; i < 5; i++) {
    const [x, y] = at(i)
    const [lx, ly] = at(i, radius + node + 15)
    const glyph = icon(ASPECT_ICONS[i])
    glyph.setAttribute('x', (x - 11).toFixed(1))
    glyph.setAttribute('y', (y - 11).toFixed(1))
    glyph.setAttribute('width', '22')
    glyph.setAttribute('height', '22')
    shapes.push(
      svg(
        'g.ring-node',
        { class: [lit.includes(i) ? 'is-lit' : '', focus === i ? 'is-focus' : ''], style: { '--c': `var(--aspect-${i})` } },
        svg('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: node }),
        glyph,
        svg('text', { x: lx.toFixed(1), y: (ly + 4).toFixed(1), 'text-anchor': 'middle' }, app.aspectName(i)),
      ),
    )
  }
  return svg('svg.ring', { viewBox: `0 0 ${width} ${size}`, role: 'img', 'aria-label': 'Ember beats Thorn, Thorn beats Stone, Stone beats Storm, Storm beats Tide, Tide beats Ember.' }, shapes)
}

function pickCard(app, species, ceiling) {
  const { draft } = app.ui
  const names = app.formNames(species.id)
  const picked = draft.picks.indexOf(species.id) >= 0
  const look = () => {
    if (app.ui.draft.focus === species.id) return
    app.ui.draft = { ...app.ui.draft, focus: species.id, form: null }
    app.sfx('ui_hover')
    app.render()
  }
  return h(
    'button.pick.cut',
    {
      type: 'button',
      'data-key': `pick${species.id}`,
      'data-act': 'pick',
      'data-species': species.id,
      class: [picked ? 'is-picked' : '', focusOf(app) === species.id ? 'is-focus' : ''],
      style: { '--c': `var(--aspect-${species.aspect})` },
      'aria-pressed': String(picked),
      'data-sfx': 'none',
      onclick: () => app.act.togglePick(species.id),
      onmouseenter: look,
      onfocus: look,
    },
    h('span.pick-mark', picked ? icon('check') : null),
    h(
      'span.pick-head',
      aspectTile(species.aspect),
      h('span.pick-id', h('b.pick-name', names[0]), h('span.pick-special', 'Special · ', h('em', species.special))),
      aspectChip(app, species.aspect),
    ),
    statBars([species.hp, species.atk, species.def, species.spd], ceiling),
    h('span.pick-grows', h('span.label', 'Grows into'), h('span.pick-line', names.slice(1).join(' · '))),
    h('span.pick-lore', species.lore),
  )
}

export function renderDraft(app) {
  const { ui } = app
  const tables = app.tables()
  const practice = ui.practice
  const commons = tables.species.filter((species) => !species.rare).slice(0, 5)
  const picks = ui.draft.picks
  const focus = app.species(focusOf(app))
  const names = app.formNames(focus.id)
  const levels = app.formLevels()
  const labels = app.formLabels()
  const looked = ui.draft.form != null && ui.draft.form > 0 ? ui.draft.form : 0
  const ceiling = app.statCeiling()
  const left = 3 - picks.length
  const busy = app.busy('register') || app.pending('register')
  const account = app.account()
  const lookAt = (form) => {
    if ((ui.draft.form || 0) === form) return
    ui.draft = { ...ui.draft, form }
    app.render()
  }

  const slots = [0, 1, 2].map((i) => {
    const species = picks[i] != null ? app.species(picks[i]) : null
    return h(
      'div.draft-slot.cut',
      { 'data-key': `slot${i}`, class: species ? 'is-full' : '', style: species ? { '--c': `var(--aspect-${species.aspect})` } : null },
      h('span.draft-slot-n', i + 1),
      species ? [aspectTile(species.aspect, 'atile-sm'), h('b', app.formNames(species.id)[0])] : h('span.draft-slot-empty', 'Empty'),
      species
        ? h('button.draft-slot-x', { type: 'button', 'data-act': 'unpick', 'aria-label': `Put ${app.formNames(species.id)[0]} back`, 'data-sfx': 'none', onclick: () => app.act.togglePick(species.id) }, icon('close'))
        : null,
    )
  })

  return h(
    'section.screen.draft',
    { 'data-key': 'screen-draft' },
    h(
      'header.draft-bar',
      wordmark('small'),
      h(
        'div.draft-bar-mid',
        h('h2', practice ? 'Practice: pick three' : 'Choose your first three'),
        h('p', practice ? 'An offline fight against Old Grist, a computer-run house fighter. Nothing is staked.' : 'Five cubs, one for each aspect. Take three home. They are yours to raise.'),
      ),
      practice
        ? btn(app, 'Back', { kind: 'ghost', icon: 'chevron-left', act: 'draft-back', onclick: app.act.leavePractice, sfx: 'none' })
        : h('div.draft-who', h('span', app.label(account)), btn(app, 'Disconnect', { kind: 'link', act: 'disconnect', onclick: app.act.disconnect })),
      settingsCluster(app),
    ),
    h(
      'div.draft-grid',
      h('div.draft-list', commons.map((species) => pickCard(app, species, ceiling))),
      h(
        'div.draft-mid',
        stageBlock([
          h(
            'div.plate-kicker',
            looked ? tag('Later on', 'brass', 'eye') : aspectChip(app, focus.aspect),
            h('span', labels[looked], ' form'),
            levelTag(levels[looked]),
            h('span', 'Special · ', h('b', focus.special)),
          ),
          h('div.plate-name', names[looked]),
          h('p.plate-note', looked ? `What ${names[0]} grows into at level ${levels[looked]}.` : focus.lore),
          formRoad(app, focus.id, 0, { looking: looked, onlook: lookAt, onleave: () => lookAt(0) }),
          h(
            'div.plate-sub',
            h('span.matchup.is-up', icon('up'), 'Strong against ', h('b', { style: { color: `var(--aspect-${beats(focus.aspect)})` } }, app.aspectName(beats(focus.aspect)))),
            h('span.matchup.is-down', icon('up'), 'Weak against ', h('b', { style: { color: `var(--aspect-${losesTo(focus.aspect)})` } }, app.aspectName(losesTo(focus.aspect)))),
          ),
        ]),
      ),
      h(
        'div.draft-side',
        h(
          'div.panel.cut.ring-panel',
          h('header.panel-head', h('h2.panel-title', 'The ring')),
          aspectRing(app, { lit: picks.map((id) => app.species(id).aspect), focus: focus.aspect }),
          h('p.ring-note', 'Each aspect beats the next one round the ring and hits it for double damage. Against the one that beats it, it does half. In a fight you can swap beasts any turn, so pick a squad that covers each other.'),
        ),
        h(
          'div.panel.cut.claim-panel',
          h('header.panel-head', h('h2.panel-title', practice ? 'Your practice squad' : 'Your three'), h('span.panel-meta', `${picks.length} of 3`)),
          h('div.draft-slots', slots),
          btn(app, practice ? 'Fight with these three' : 'Claim these three', {
            kind: 'primary',
            size: 'lg',
            cls: 'btn-wide',
            icon: practice ? 'swords' : 'check',
            act: 'claim',
            busy,
            off: left > 0 ? `Pick ${left} more.` : null,
            onclick: app.act.claim,
            sfx: 'ui_confirm',
          }),
          h(
            'p.claim-note',
            left > 0
              ? `Pick ${left} more.`
              : practice
                ? 'Practice is offline: nothing is staked and nothing is won.'
                : `They start at level 1, with ${app.rule('starting_essence', 100)} Essence to feed them.`,
          ),
        ),
      ),
    ),
  )
}

export function draftStage(app) {
  const form = app.ui.draft.form || 0
  const opts = { layout: 'single', focus: 0, mood: 'stable' }
  // Looking ahead at a later form is a swap, not a beast growing up.
  if (form > 0) opts.preview = true
  return { builds: [app.speciesBuild(focusOf(app), app.formLevels()[form] || 1)], opts }
}
