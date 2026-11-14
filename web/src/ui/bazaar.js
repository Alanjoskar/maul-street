// BAZAAR: four shelves. Relics, auras and finishers on the left, beasts on the
// right, and whatever the pointer is over standing on the stage between them.

import { h } from './dom.js'
import { icon } from './icons.js'
import { B, KINDS, STATS } from './domain.js'
import { aspectChip, aspectTile, btn, empty, formRoad, heatMark, levelTag, nearTag, panelHead, stageBlock, tag } from './parts.js'

function cannotAfford(app, price) {
  const balance = app.balance()
  return B(price) > balance ? `Your pit balance is ${app.near(balance)} NEAR. This costs ${app.near(price, 3)}.` : null
}

function itemCard(app, row, def, owned) {
  const hot = B(row.price) > B(row.floor)
  return h(
    'article.good.cut',
    {
      'data-key': `item${row.id}`,
      'data-item': row.id,
      class: hot ? 'is-hot' : '',
      'data-hover': '',
      onmouseenter: () => app.hover('item', row.id),
      onmouseleave: () => app.hover(null),
    },
    h(
      'div.good-top',
      h('span.good-ic', icon(KINDS[def.kind].icon)),
      h('div.good-id', h('h4', def.name), h('p', def.text)),
      h('div.good-price', nearTag(app, row.price, { digits: 3 }), heatMark(row)),
    ),
    h(
      'div.good-bottom',
      h('div.good-words', h('p.good-why', row.reason), h('span.good-own', { class: owned ? 'has' : '' }, owned ? `You own ${owned}` : 'You own none')),
      btn(app, 'Buy', { kind: 'brass', size: 'sm', act: 'buy', off: cannotAfford(app, row.price), busy: app.busy(`buyItem:${row.id}`), onclick: () => app.act.buyItem(row) }),
    ),
  )
}

/** A new beast is a level-1 cub. The card shows the cub, and the four names it grows into. */
function beastCard(app, row, owned) {
  const species = app.species(row.id)
  const names = app.formNames(row.id)
  const hot = B(row.price) > B(row.floor)
  const values = [species.hp, species.atk, species.def, species.spd]
  return h(
    'article.good.good-beast.cut',
    {
      'data-key': `species${row.id}`,
      'data-species': row.id,
      class: [hot ? 'is-hot' : '', species.rare ? 'is-rare' : ''],
      style: { '--c': `var(--aspect-${species.aspect})` },
      'data-hover': '',
      onmouseenter: () => app.hover('species', row.id),
      onmouseleave: () => app.hover(null),
    },
    h(
      'div.good-top',
      aspectTile(species.aspect),
      h('div.good-id', h('h4', names[0], species.rare ? tag('Rare', 'rare', 'spark') : null), h('p', app.aspectName(species.aspect), ' cub · Special: ', species.special)),
      h('div.good-price', nearTag(app, row.price, { digits: 3 }), heatMark(row)),
    ),
    h('p.good-grows', h('span.label', 'Grows into'), names.slice(1).join(' · ')),
    h('div.mini-stats', values.map((value, i) => h('span', h('em', STATS[i].short), value))),
    h(
      'div.good-bottom',
      h('div.good-words', h('p.good-why', row.reason), h('span.good-own', { class: owned ? 'has' : '' }, owned ? `You have ${owned} of this line` : 'You have none of this line')),
      btn(app, 'Buy', { kind: 'brass', size: 'sm', act: 'buy', off: cannotAfford(app, row.price), busy: app.busy(`buyBeast:${row.id}`), onclick: () => app.act.buyBeast(row) }),
    ),
  )
}

/** What the stage is showing, in words, for the plate under it. */
function plate(app) {
  const { ui } = app
  const hover = ui.hover
  if (hover && hover.kind === 'species') {
    const species = app.species(hover.value)
    return [
      h('div.plate-kicker', aspectChip(app, species.aspect), species.rare ? tag('Rare', 'rare', 'spark') : h('span', 'Common'), levelTag(1), h('span', 'Special · ', h('b', species.special))),
      h('div.plate-name', app.formNames(species.id)[0]),
      h('p.plate-note', species.lore),
      formRoad(app, species.id, 0),
    ]
  }
  if (hover && hover.kind === 'item') {
    const def = app.item(hover.value)
    const wearer = wearerOf(app)
    if (def) {
      return [
        h('div.plate-kicker', h('span', KINDS[def.kind].label), wearer ? h('span', 'Shown on ', h('b', wearer.name)) : null),
        h('div.plate-name', def.name),
        h('p.plate-note', def.text),
      ]
    }
  }
  return [
    h('div.plate-kicker', h('span', 'The bazaar')),
    h('div.plate-name.is-small', 'Every price moves'),
    h('p.plate-note', 'Prices rise when people buy and cool when they do not. Point at anything to see it on the stage.'),
  ]
}

function wearerOf(app) {
  const owned = app.owned()
  return owned.find((beast) => beast.id === app.ui.selected) || owned[0] || null
}

export function renderBazaar(app) {
  const market = app.api.state.market
  const tables = app.tables()
  if (!market) {
    return h('div.tabbody.three', { 'data-key': 'tab-bazaar' }, h('section.col.col-left', h('div.panel.cut', empty('coin', 'The bazaar is opening', 'Prices appear once the contract answers.'))), h('section.col.col-stage', stageBlock()), h('section.col.col-right'))
  }
  const owned = app.itemsOwned()
  const ownedSpecies = new Map()
  for (const beast of app.owned()) ownedSpecies.set(beast.species, (ownedSpecies.get(beast.species) || 0) + 1)
  const rows = new Map(market.items.map((row) => [row.id, row]))
  const jump = (target) => () => {
    app.ui.scrollTo = target
    app.render()
  }

  const shelves = KINDS.map((kind, k) => {
    const defs = tables.items.filter((item) => item.kind === k && rows.has(item.id))
    return h(
      'section.shelf',
      { 'data-key': `shelf${k}`, 'data-shelf': String(k) },
      h('header.shelf-head', h('span.shelf-ic', icon(kind.icon)), h('h3', kind.plural), h('span', kind.does)),
      defs.map((def) => itemCard(app, rows.get(def.id), def, owned.get(def.id) || 0)),
    )
  })

  const species = market.species.slice().sort((a, b) => Number(app.species(a.id).rare) - Number(app.species(b.id).rare) || a.id - b.id)
  const firstRare = species.findIndex((row) => app.species(row.id).rare)
  const commons = firstRare < 0 ? species.length : firstRare
  const beastCards = []
  species.forEach((row, i) => {
    if (i === firstRare) beastCards.push(h('div.shelf-sep', { 'data-key': 'rare-sep' }, icon('spark'), h('b', 'Rare lines'), h('span', 'Never among the first three. Found here only.')))
    beastCards.push(beastCard(app, row, ownedSpecies.get(row.id) || 0))
  })

  return h(
    'div.tabbody.three.bazaar',
    { 'data-key': 'tab-bazaar' },
    h(
      'section.col.col-left',
      h(
        'div.panel.cut.shelves',
        panelHead(
          'Gear',
          null,
          h(
            'div.shelf-jump',
            KINDS.map((kind, k) => h('button.quick-chip', { type: 'button', 'data-act': `shelf-${kind.key}`, onclick: jump(`[data-shelf="${k}"]`) }, kind.plural)),
          ),
        ),
        h('div.shelf-list.scroll', shelves),
      ),
    ),
    h('section.col.col-stage', stageBlock(plate(app))),
    h(
      'section.col.col-right',
      h(
        'div.panel.cut.shelves',
        { 'data-shelf': 'beasts' },
        panelHead('Cubs', `${commons} common · ${species.length - commons} rare`),
        h('div.shelf-list.scroll', beastCards),
      ),
    ),
  )
}

export function bazaarStage(app) {
  const hover = app.ui.hover
  const opts = { layout: 'single', focus: 0, mood: 'bazaar' }
  if (hover && hover.kind === 'species') return { builds: [app.speciesBuild(hover.value)], opts }
  const wearer = wearerOf(app)
  if (hover && hover.kind === 'item') {
    const def = app.item(hover.value)
    // Auras and finishers show on the body. A relic changes how it fights, not how it looks.
    if (def && wearer) return { builds: [app.buildOf(wearer, def.kind === 0 ? null : { [KINDS[def.kind].key]: def.id })], opts }
  }
  if (wearer) return { builds: [app.buildOf(wearer)], opts }
  return { builds: [app.speciesBuild(5)], opts }
}
