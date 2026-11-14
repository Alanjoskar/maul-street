// HIRE: other trainers' champions, priced per fight, and the player's own
// hires and listings.

import { h } from './dom.js'
import { B } from './domain.js'
import { aspectChip, aspectTile, btn, empty, levelTag, nearTag, panelHead, record, segmented, stageBlock, statBars, stepper, tag, who, whoShort } from './parts.js'

const SORTS = [
  { value: 'power', label: 'Strongest', act: 'sort-power' },
  { value: 'price', label: 'Cheapest', act: 'sort-price' },
  { value: 'wins', label: 'Most wins', act: 'sort-wins' },
]

function listings(app) {
  const account = app.account()
  const sort = app.ui.hireSort || 'power'
  const list = (app.api.state.hireMarket || []).filter((beast) => beast && beast.owner !== account && beast.hire_price != null)
  const by = {
    power: (a, b) => b.power - a.power,
    price: (a, b) => (B(a.hire_price) < B(b.hire_price) ? -1 : B(a.hire_price) > B(b.hire_price) ? 1 : 0),
    wins: (a, b) => (b.wins || 0) - (a.wins || 0),
  }
  return list.sort((a, b) => by[sort](a, b) || a.id - b.id)
}

function focused(app, list) {
  const { ui } = app
  const all = [...list, ...app.hires().map((hire) => hire.beast)]
  return all.find((beast) => beast.id === ui.hireFocus) || list[0] || all[0] || null
}

function look(app, id) {
  return () => {
    if (app.ui.hireFocus === id) return
    app.ui.hireFocus = id
    app.render()
  }
}

/** "Emberjaw · Lv 7", or "Prowler · Lv 7" when the beast still goes by its form's name. */
function formLine(app, beast) {
  const form = app.formOf(beast)
  return [h('span', beast.name === form.name ? form.label : form.name), h('i.sep'), levelTag(app.levelOf(beast))]
}

function listingCard(app, beast, ceiling, focusId) {
  const { ui } = app
  const species = app.species(beast.species)
  const have = app.hires().find((hire) => hire.beast.id === beast.id)
  // The contract lets a trainer hold at most this many paid fights with one beast.
  const most = Number(app.rule('max_hire_fights', 20)) - (have ? have.fights_left : 0)
  const fights = Math.max(1, Math.min(Math.max(1, most), ui.forms.hireFights[beast.id] || 1))
  const total = B(beast.hire_price) * BigInt(fights)
  const balance = app.balance()
  let off = null
  if (most < 1) off = `You already hold ${have.fights_left} fights with ${beast.name}: the most anyone can.`
  else if (total > balance) off = `Your pit balance is ${app.near(balance)} NEAR. ${fights} fight${fights === 1 ? '' : 's'} with ${beast.name} cost ${app.near(total, 3)}.`

  return h(
    'article.listing.cut',
    {
      'data-key': `listing${beast.id}`,
      'data-beast': beast.id,
      class: beast.id === focusId ? 'is-on' : '',
      style: { '--c': `var(--aspect-${species.aspect})` },
      'data-hover': '',
      onmouseenter: look(app, beast.id),
    },
    h(
      'header.listing-head',
      aspectTile(species.aspect),
      h('div.listing-id', h('h4', beast.name), h('p', formLine(app, beast), h('i.sep'), 'owner ', whoShort(app, beast.owner))),
      h('div.listing-power', h('span.label', 'Power'), h('b', beast.power)),
    ),
    statBars(beast.stats || app.statsOf(beast).stats, ceiling, { labels: 'short' }),
    h('div.listing-rec', record(beast), have ? tag(`You have ${have.fights_left} left`, 'ember') : null),
    h(
      'div.listing-foot',
      h('div.listing-price', nearTag(app, beast.hire_price, { digits: 3 }), h('span', 'a fight')),
      stepper(app, {
        value: fights,
        min: 1,
        max: Math.max(1, most),
        label: 'How many fights',
        off: most < 1 ? true : null,
        display: h('span.stepper-n', fights, h('em', fights === 1 ? 'fight' : 'fights')),
        onchange: (next) => {
          ui.forms.hireFights[beast.id] = next
          app.render()
        },
      }),
      h('div.listing-total', h('span.label', 'Total'), nearTag(app, total, { digits: 3 })),
      btn(app, 'Hire', { kind: 'brass', size: 'sm', act: 'hire', off, busy: app.busy(`hire:${beast.id}`), onclick: () => app.act.hire(beast, fights) }),
    ),
  )
}

function myHires(app, focusId) {
  const hires = app.hires()
  return h(
    'div.panel.cut.my-hires',
    panelHead('Your hires', hires.length ? `${hires.length} with you` : null),
    hires.length
      ? h(
          'div.mini-list.scroll',
          hires.map((hire) => {
            const species = app.species(hire.beast.species)
            const slot = app.squad().indexOf(hire.beast.id)
            return h(
              'div.mini-row',
              { 'data-key': `hire${hire.beast.id}`, 'data-beast': hire.beast.id, class: hire.beast.id === focusId ? 'is-on' : '', style: { '--c': `var(--aspect-${species.aspect})` }, onmouseenter: look(app, hire.beast.id) },
              aspectTile(species.aspect, 'atile-sm'),
              h('div.mini-id', h('b', hire.beast.name), h('span', formLine(app, hire.beast), h('i.sep'), whoShort(app, hire.beast.owner))),
              h('span.mini-left', h('b', hire.fights_left), hire.fights_left === 1 ? 'fight left' : 'fights left'),
              btn(app, slot >= 0 ? `Slot ${slot + 1}` : 'To squad', {
                size: 'sm',
                kind: slot >= 0 ? 'ghost' : 'brass',
                act: 'hire-squad',
                tip: slot >= 0 ? 'In your squad. Click to take it out.' : 'Put it in the first empty squad slot',
                sfx: 'none',
                onclick: () => {
                  const what = app.quickSquad(hire.beast.id)
                  if (what === 'full') {
                    app.sfx('ui_error')
                    app.toast('info', 'Your squad is full. Swap it in from the stable.')
                  } else {
                    app.sfx(what === 'added' ? 'equip' : 'ui_back')
                  }
                },
              }),
            )
          }),
        )
      : empty('tag', 'Nobody hired', 'Hire a champion and field it in your squad for the fights you pay for.'),
  )
}

function myListings(app) {
  const player = app.player()
  const listed = app.owned().filter((beast) => beast.hire_price != null)
  return h(
    'div.panel.cut.my-listings',
    panelHead('Your listings', ['Hire income ', nearTag(app, player.hire_income || '0', { digits: 3 })]),
    listed.length
      ? h(
          'div.mini-list.scroll',
          listed.map((beast) => {
            const species = app.species(beast.species)
            return h(
              'div.mini-row',
              { 'data-key': `mine${beast.id}`, 'data-beast': beast.id, style: { '--c': `var(--aspect-${species.aspect})` } },
              aspectTile(species.aspect, 'atile-sm'),
              h('div.mini-id', h('b', beast.name), h('span.mini-price', nearTag(app, beast.hire_price, { digits: 3 }), 'a fight')),
              h('span.mini-left', nearTag(app, beast.earned, { digits: 3 }), 'earned'),
              btn(app, 'Unlist', { size: 'sm', act: 'unlist', busy: app.busy(`unlist:${beast.id}`), onclick: () => app.act.unlist(beast), sfx: 'none' }),
            )
          }),
        )
      : empty('coin', 'Nothing listed', 'List a beast from its sheet in the stable. Trainers who field it pay you per fight, and it comes home with the XP it earned.', btn(app, 'Go to the stable', { size: 'sm', kind: 'brass', onclick: () => app.go('stable') })),
  )
}

export function renderHire(app) {
  const { ui } = app
  const list = listings(app)
  const focus = focused(app, list)
  const focusId = focus ? focus.id : null
  // Bars are drawn against the strongest beast on the list, so they compare what is on offer.
  const ceiling = app.statCeiling()
  for (const beast of list) (beast.stats || []).forEach((value, i) => (ceiling[i] = Math.max(ceiling[i], value)))
  const species = focus ? app.species(focus.species) : null
  const fee = Number(app.rule('hire_fee_bps', 500)) / 100

  return h(
    'div.tabbody.three.hire',
    { 'data-key': 'tab-hire' },
    h(
      'section.col.col-left',
      h(
        'div.panel.cut.market',
        panelHead('Champions for hire', list.length ? `${list.length} listed` : null),
        h('div.market-tools', segmented(app, SORTS, ui.hireSort || 'power', (value) => ((ui.hireSort = value), app.render()), 'Sort by')),
        h(
          'div.market-list.scroll',
          list.length ? list.map((beast) => listingCard(app, beast, ceiling, focusId)) : empty('tag', 'No champions listed', 'When trainers list their beasts for hire they appear here.'),
        ),
        h('p.panel-foot', `You pay per fight. The owner is paid at once, less the house's ${fee}%. Its level and gear fight for you, and it keeps the XP it earns.`),
      ),
    ),
    h(
      'section.col.col-stage',
      focus
        ? stageBlock([
            h('div.plate-kicker', aspectChip(app, species.aspect), h('span', app.formOf(focus).label, ' form'), levelTag(app.levelOf(focus)), h('span', 'Power ', h('b', focus.power))),
            h('div.plate-name', focus.name),
            h('p.plate-note', 'Owner ', who(app, focus.owner), focus.hire_price != null ? [' · ', nearTag(app, focus.hire_price, { digits: 3 }), ' a fight'] : null),
          ])
        : stageBlock(),
    ),
    h('section.col.col-right', myHires(app, focusId), myListings(app)),
  )
}

export function hireStage(app) {
  const focus = focused(app, listings(app))
  if (focus) return { builds: [app.buildOf(focus)], opts: { layout: 'single', focus: 0, mood: 'stable' } }
  const owned = app.owned()
  return owned.length ? { builds: [app.buildOf(owned[0])], opts: { layout: 'single', focus: 0, mood: 'stable' } } : null
}
