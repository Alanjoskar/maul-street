// The hub: the top bar with the money in it, the tape, and the five tabs.

import { h } from './dom.js'
import { icon } from './icons.js'
import { B } from './domain.js'
import { avatar, btn, counter, iconBtn, nearCounter, nearTag } from './parts.js'
import { settingsCluster } from './settings.js'
import { wordmark } from './title.js'
import { renderStable, stableStage } from './stable.js'
import { renderPit, pitStage } from './pit.js'
import { renderBazaar, bazaarStage } from './bazaar.js'
import { renderHire, hireStage } from './hire.js'
import { renderStreet } from './street.js'

const TABS = [
  { id: 'stable', label: 'Stable' },
  { id: 'pit', label: 'The Pit' },
  { id: 'bazaar', label: 'Bazaar' },
  { id: 'hire', label: 'Hire' },
  { id: 'street', label: 'The Street' },
]

function pitNeedsYou(app) {
  const player = app.player()
  const account = app.account()
  // The record keeps pointing at the last den fight and the last duel after they end: only a live one counts.
  if (app.denLive() || app.duelLive()) return true
  return (app.api.state.challenges || []).some((challenge) => challenge.invite && challenge.invite === account)
}

function topbar(app) {
  const { ui } = app
  const player = app.player()
  const account = app.account()
  const empty = app.balance() === 0n
  const wallet = app.api.state.walletBalance

  return h(
    'header.topbar',
    wordmark('small'),
    h(
      'nav.tabs',
      { 'aria-label': 'Sections' },
      TABS.map((tab, i) =>
        h(
          'button.tab',
          {
            type: 'button',
            'data-key': `tab-${tab.id}`,
            'data-act': `tab-${tab.id}`,
            class: ui.tab === tab.id ? 'is-on' : '',
            'aria-current': ui.tab === tab.id ? 'page' : null,
            'data-sfx': 'none',
            onclick: () => app.go(tab.id),
          },
          h('span.tab-n', `0${i + 1}`),
          h('span.tab-label', tab.label),
          tab.id === 'pit' && pitNeedsYou(app) ? h('i.tab-dot', { 'aria-label': 'Something here needs you' }) : null,
        ),
      ),
    ),
    h(
      'div.purse',
      h(
        'div.purse-cell.purse-ess',
        { 'data-tip': 'Essence. Won in every fight. Feed it to a beast to help it reach its next level. It is never NEAR.' },
        icon('essence'),
        h('span.purse-num', counter('essence', player.essence, String(player.essence), 0, true)),
        h('span.purse-label', 'Essence'),
      ),
      h(
        'div.purse-cell.purse-near.cut',
        { 'data-flash-host': '', class: empty ? 'is-empty' : '' },
        h('i.flash-fx'),
        icon('near'),
        h('span.purse-num', nearCounter(app, 'balance', player.balance, 2, true)),
        h('span.purse-label', 'Pit balance'),
        iconBtn(app, 'plus', { label: 'Deposit NEAR', kind: 'brass', cls: `purse-btn ${empty ? 'is-calling' : ''}`, act: 'deposit-open', onclick: app.act.openDeposit }),
        iconBtn(app, 'withdraw', {
          label: 'Withdraw NEAR to your wallet',
          cls: 'purse-btn',
          act: 'withdraw-open',
          onclick: app.act.openWithdraw,
          off: empty ? 'Your pit balance is empty. There is nothing to withdraw.' : null,
        }),
      ),
      h(
        'div.account',
        h(
          'button.account-chip.cut',
          { type: 'button', 'data-act': 'account', 'aria-expanded': String(ui.accountMenu), 'aria-haspopup': 'true', onclick: () => ((ui.accountMenu = !ui.accountMenu), (ui.settings = false), app.render()) },
          avatar(app, account),
          h('span.account-name', app.label(account)),
          icon('chevron-down'),
        ),
        ui.accountMenu
          ? h(
              'div.account-menu.cut',
              h('div.account-row', h('span.label', 'Account'), h('b', { title: account }, account)),
              wallet != null ? h('div.account-row', h('span.label', 'In your wallet'), nearTag(app, wallet)) : null,
              h('div.account-row', h('span.label', 'In the pit'), nearTag(app, player.balance)),
              btn(app, 'Disconnect', { kind: 'ghost', size: 'sm', cls: 'btn-wide', icon: 'logout', act: 'disconnect', busy: app.busy('disconnect'), onclick: app.act.disconnect }),
            )
          : null,
      ),
      settingsCluster(app),
    ),
    // A transaction is on its way to the chain.
    h('i.busy-line', { class: Object.keys(app.api.state.pending || {}).length ? 'is-on' : '', 'aria-hidden': 'true' }),
  )
}

function tapeBar(app) {
  const lines = app.api.state.ticker || []
  return h(
    'div.tapebar',
    h('span.tape-tag', 'The tape'),
    lines.length ? app.tape('tape-hub') : h('span.tape-empty', 'Nothing has happened on the Street yet. Be the first.'),
  )
}

function duelBanner(app) {
  const banner = app.ui.duelBanner
  if (!banner) return null
  const { match, seconds } = banner
  const account = app.account()
  const rival = (match.players || []).find((id) => id !== account)
  const stake = B(match.stake)
  return h(
    'div.duel-banner',
    { 'data-key': 'duel-banner', role: 'alert' },
    h('span.duel-banner-ic', icon('swords')),
    h(
      'div.duel-banner-text',
      h('b', 'Your duel is on'),
      h('span', rival ? ['against ', h('em', app.label(rival))] : null, stake > 0n ? [' · ', nearTag(app, stake), ' each'] : ' · a friendly'),
    ),
    seconds != null ? h('span.duel-banner-count', `Into the pit in ${seconds}`) : null,
    btn(app, seconds != null ? 'Enter now' : 'Return to the duel', { kind: 'primary', size: 'lg', icon: 'chevron-right', act: 'duel-enter', onclick: () => app.act.enterDuel(match), sfx: 'ui_confirm' }),
  )
}

/** One line for a trainer who has just arrived. */
function welcome(app) {
  const { ui } = app
  if (!ui.welcome) return null
  return h(
    'div.welcome.cut',
    { 'data-key': 'welcome' },
    h('span.welcome-ic', icon('fang')),
    h('p', h('b', 'They are yours. '), 'A spar with a house fighter is free and earns them XP. Deposit NEAR when you want to fight for the pot.'),
    btn(app, 'Go to the pit', { kind: 'primary', size: 'sm', act: 'welcome-pit', onclick: () => ((ui.welcome = false), app.go('pit', { pitView: 'dens' })) }),
    btn(app, 'Deposit NEAR', { kind: 'brass', size: 'sm', icon: 'plus', act: 'welcome-deposit', onclick: () => ((ui.welcome = false), app.act.openDeposit()) }),
    iconBtn(app, 'close', { label: 'Dismiss', cls: 'welcome-x', act: 'welcome-close', onclick: () => ((ui.welcome = false), app.render()), sfx: 'ui_back' }),
  )
}

export function renderHub(app) {
  const { ui } = app
  let body
  if (ui.tab === 'pit') body = renderPit(app)
  else if (ui.tab === 'bazaar') body = renderBazaar(app)
  else if (ui.tab === 'hire') body = renderHire(app)
  else if (ui.tab === 'street') body = renderStreet(app)
  else body = renderStable(app)

  return h(
    'section.screen.hub',
    { 'data-key': 'screen-hub', class: `tab-${ui.tab}${ui.tab === 'pit' ? ` pit-${ui.pitView}` : ''}` },
    h('div.hub-shade'),
    topbar(app),
    tapeBar(app),
    duelBanner(app),
    welcome(app),
    h('main.tabview', body),
  )
}

export function hubStage(app) {
  const { ui } = app
  if (ui.tab === 'pit') return pitStage(app)
  if (ui.tab === 'bazaar') return bazaarStage(app)
  if (ui.tab === 'hire') return hireStage(app)
  if (ui.tab === 'street') return stableStage(app)
  return stableStage(app)
}
