// The title screen: the wordmark, the way in, and what the Street is doing right now.

import { h } from './dom.js'
import { icon } from './icons.js'
import { btn, nearTag } from './parts.js'
import { settingsCluster } from './settings.js'

export function wordmark(size = 'big') {
  return h(`h1.wordmark.wordmark-${size}`, { 'aria-label': 'Maul Street' }, h('span.wm-a', { 'aria-hidden': 'true' }, 'MAUL'), h('span.wm-b', { 'aria-hidden': 'true' }, 'STREET'))
}

const HOW = [
  { icon: 'swords', title: 'Fight for NEAR', text: 'Send in three beasts. Read your rival, pick your move, take the pot.' },
  { icon: 'tag', title: 'Hire out your champions', text: 'Name a price per fight. Every trainer who fields your beast pays you.' },
  { icon: 'den', title: 'Back the house', text: 'Put NEAR behind a computer-run house fighter. Share what it wins, and what it loses.' },
]

/** Real numbers from the contract, or nothing at all. */
function liveStrip(app) {
  const stats = app.api.state.stats
  const lines = app.api.state.ticker || []
  const cells = []
  if (stats) {
    const add = (label, value) => {
      if (value != null && value !== '') cells.push(h('div.live-cell', h('b', value), h('span', label)))
    }
    const count = (value) => (Number(value) > 0 ? Number(value).toLocaleString('en-US') : null)
    add('Trainers', count(stats.players))
    add('Beasts', count(stats.beasts))
    add('House fights', count(stats.den_fights))
    add('Duels', count(stats.duels))
    if (stats.volume && stats.volume !== '0') add('NEAR moved', nearTag(app, stats.volume, { digits: 1 }))
  }
  if (!cells.length && !lines.length) return null
  return h(
    'footer.live',
    { 'data-key': 'live' },
    cells.length ? h('div.live-stats', h('span.live-tag', 'On the Street now'), cells) : null,
    lines.length ? h('div.live-tape', app.tape('tape-title')) : null,
  )
}

export function renderTitle(app) {
  const { ui } = app
  const connect = ui.connect
  return h(
    'section.screen.title',
    { 'data-key': 'screen-title' },
    h('div.title-shade'),
    h(
      'div.title-main',
      h('div.kicker', h('i.kicker-rule'), 'A beast-fighting pit on NEAR testnet'),
      wordmark('big'),
      h('p.title-line', 'Every fang has a price.'),
      h('p.title-sub', 'Raise your beasts from cubs. Send three into the pit. Win testnet NEAR.'),
      h(
        'div.title-actions',
        btn(app, 'Connect testnet wallet', { kind: 'primary', size: 'xl', icon: 'wallet', act: 'connect', busy: connect.busy, onclick: app.act.connect, sfx: 'ui_confirm' }),
        btn(app, 'Practice a fight', { kind: 'ghost', size: 'xl', icon: 'swords', act: 'practice', onclick: app.act.practice, off: connect.busy ? 'Finish connecting first.' : null }),
      ),
      h(
        'p.title-note',
        { class: connect.error ? 'is-bad' : connect.busy ? 'is-live' : '', role: 'status' },
        connect.error ||
          (connect.busy
            ? connect.text
            : ui.practiceNote || 'One approval in your wallet. After that every move is signed here by a key that can only call the game.'),
      ),
    ),
    h('div.title-stage', h('div.stage-frame', { 'data-stage-frame': '', 'data-key': 'stage-frame' })),
    h('div.title-corner', settingsCluster(app)),
    h(
      'div.how',
      HOW.map((step, i) =>
        h('div.how-card.cut', { 'data-key': `how${i}` }, h('span.how-n', `0${i + 1}`), h('span.how-ic', icon(step.icon)), h('div.how-text', h('h3', step.title), h('p', step.text))),
      ),
    ),
    liveStrip(app),
  )
}

/** The level the title's two beasts are shown at: their fourth form, the Dread. */
const GROWN = 25

/** Two grown beasts facing off behind the wordmark: Tide douses Ember. */
export function titleStage(app) {
  return {
    builds: [app.speciesBuild(0, GROWN), app.speciesBuild(4, GROWN)],
    opts: { layout: 'versus', focus: 0, mood: 'pit' },
  }
}
