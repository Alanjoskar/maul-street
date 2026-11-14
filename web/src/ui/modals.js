// Modals: moving NEAR in and out, confirming a spend, backing a den, the
// result of a fight, and posts to NEAR Social.

import { h } from './dom.js'
import { icon } from './icons.js'
import { B } from './domain.js'
import { aspectTile, btn, cleanAmount, essenceTag, field, iconBtn, levelTag, nearTag, paysText, tag, xpBar } from './parts.js'
import { calloutText } from './pit.js'

function head(app, title, sub = null) {
  return h('header.modal-head', h('div', h('h2', title), sub ? h('p.modal-sub', sub) : null), iconBtn(app, 'close', { label: 'Close', cls: 'modal-x', act: 'modal-close', onclick: () => app.closeModal(), sfx: 'none' }))
}

const row = (label, value, cls = '') => h('div', { class: cls }, h('dt', label), h('dd', value))

function amountChips(app, values, current, pick) {
  return h(
    'div.quick',
    values.map(([value, label]) => h('button.quick-chip', { type: 'button', 'data-amount': value, class: current !== '' && B(app.fmt.toYocto(current)) === B(app.fmt.toYocto(value)) ? 'is-on' : '', onclick: () => pick(value) }, label)),
  )
}

// ----- Deposit and withdraw ------------------------------------------------------

function deposit(app, modal) {
  const wallet = app.api.state.walletBalance
  const yocto = app.fmt.toYocto(modal.amount || '0')
  const amount = B(yocto)
  const busy = app.busy('deposit') || app.pending('deposit')
  let off = null
  if (amount <= 0n) off = 'Enter how much NEAR to move in.'
  else if (wallet != null && amount > B(wallet)) off = `Your wallet holds ${app.near(wallet)} NEAR.`
  const set = (value) => app.setModal({ amount: value, rev: (modal.rev || 0) + 1 })

  return [
    head(app, 'Deposit NEAR'),
    h('p.modal-text', 'Move testnet NEAR from your wallet into your pit balance. Stakes, prices and new levels are paid from it, and everything you win lands in it.'),
    h(
      'form.modal-form',
      {
        onsubmit: (event) => {
          event.preventDefault()
          if (!off && !busy) app.act.deposit(yocto)
        },
      },
      field(app, {
        label: 'Amount',
        field: 'amount',
        value: modal.amount,
        inputmode: 'decimal',
        placeholder: '0.00',
        prefix: icon('near'),
        suffix: 'NEAR',
        cls: 'field-big',
        autofocus: true,
        rev: modal.rev || 0,
        oninput: (value) => app.setModal({ amount: cleanAmount(value) }),
      }),
      amountChips(app, [['0.5', '0.5'], ['1', '1'], ['2', '2'], ['5', '5']], modal.amount, set),
      h(
        'dl.rows',
        wallet != null ? row('In your wallet', nearTag(app, wallet)) : null,
        row('Pit balance now', nearTag(app, app.balance())),
        amount > 0n ? row('Pit balance after', nearTag(app, app.balance() + amount), 'is-strong') : null,
      ),
      h('p.modal-flag', icon('wallet'), 'This is the only step that opens your wallet.'),
      h(
        'div.modal-actions',
        btn(app, 'Cancel', { act: 'cancel', onclick: () => app.closeModal(), sfx: 'none' }),
        btn(app, busy ? 'Waiting for your wallet' : 'Deposit', { submit: true, kind: 'primary', act: 'deposit', off, busy, sfx: 'none', after: !busy && amount > 0n && !off ? nearTag(app, amount, { digits: 3 }) : null }),
      ),
    ),
  ]
}

function withdraw(app, modal) {
  const balance = app.balance()
  const yocto = app.fmt.toYocto(modal.amount || '0')
  const amount = B(yocto)
  const busy = app.busy('withdraw') || app.pending('withdraw')
  let off = null
  if (amount <= 0n) off = 'Enter how much NEAR to take out.'
  else if (amount > balance) off = `Your pit balance is ${app.near(balance)} NEAR.`
  const set = (value) => app.setModal({ amount: value, rev: (modal.rev || 0) + 1 })
  // The whole balance, to the last yocto, written so toYocto reads it back exactly.
  const all = () => {
    const text = balance.toString().padStart(25, '0')
    return `${text.slice(0, -24)}.${text.slice(-24)}`.replace(/\.?0+$/, '')
  }

  return [
    head(app, 'Withdraw NEAR'),
    h('p.modal-text', `Send NEAR from your pit balance back to your own account, ${app.account()}.`),
    h(
      'form.modal-form',
      {
        onsubmit: (event) => {
          event.preventDefault()
          if (!off && !busy) app.act.withdraw(yocto)
        },
      },
      field(app, {
        label: 'Amount',
        field: 'amount',
        value: modal.amount,
        inputmode: 'decimal',
        placeholder: '0.00',
        prefix: icon('near'),
        suffix: 'NEAR',
        cls: 'field-big',
        autofocus: true,
        rev: modal.rev || 0,
        oninput: (value) => app.setModal({ amount: cleanAmount(value).slice(0, 30) }),
      }),
      h(
        'div.quick',
        h('button.quick-chip', { type: 'button', 'data-act': 'all', onclick: () => set(all()) }, 'Everything'),
        h('button.quick-chip', { type: 'button', 'data-act': 'half', onclick: () => set(app.near(balance / 2n, 2).replace('<', '')) }, 'Half'),
      ),
      h('dl.rows', row('Pit balance now', nearTag(app, balance)), amount > 0n && amount <= balance ? row('Pit balance after', nearTag(app, balance - amount), 'is-strong') : null),
      h(
        'div.modal-actions',
        btn(app, 'Cancel', { act: 'cancel', onclick: () => app.closeModal(), sfx: 'none' }),
        btn(app, 'Withdraw', { submit: true, kind: 'primary', act: 'withdraw', off, busy, sfx: 'none', after: !busy && amount > 0n && !off ? nearTag(app, amount, { digits: 3 }) : null }),
      ),
    ),
  ]
}

// ----- Confirming a spend -----------------------------------------------------------

function confirmRows(app, modal) {
  const price = B(modal.price)
  const balance = app.balance()
  const after = balance >= price ? nearTag(app, balance - price) : h('span.warn', 'Not enough')
  if (modal.rows === 'buy') {
    return [row('Price now', nearTag(app, price, { digits: 3 }), 'is-strong'), row('You pay at most', nearTag(app, modal.max, { digits: 3 })), row('Pit balance after', after)]
  }
  if (modal.rows === 'spend') {
    return [row('Cost', nearTag(app, price, { digits: 3 }), 'is-strong'), row('Pit balance after', after)]
  }
  if (modal.rows === 'stake') {
    return [row('Your stake', nearTag(app, price), 'is-strong'), row('A win pays', nearTag(app, modal.pays, { digits: 3 })), row('A loss costs', nearTag(app, price)), row('Pit balance after staking', after)]
  }
  if (modal.rows === 'duel') {
    const pot = price * 2n
    const rake = BigInt(app.rule('duel_rake_bps', '300'))
    return [
      row('Your stake', nearTag(app, price), 'is-strong'),
      row('The pot', nearTag(app, pot)),
      row(`Winner takes (less ${Number(rake) / 100}%)`, nearTag(app, pot - (pot * rake) / 10000n, { digits: 3 })),
      row('Pit balance after staking', after),
    ]
  }
  return null
}

function confirm(app, modal) {
  const busy = modal.busyKey ? app.busy(modal.busyKey) : false
  const rows = confirmRows(app, modal)
  const price = modal.price != null ? B(modal.price) : null
  const off = price != null && price > app.balance() ? `Your pit balance is ${app.near(app.balance())} NEAR. Deposit to go on.` : null
  const go = async () => {
    const ok = await modal.run()
    if (ok && app.ui.modal === modal) app.closeModal(true)
  }
  return [
    head(app, modal.title),
    modal.text ? h('p.modal-text', modal.text) : null,
    rows ? h('dl.rows', rows) : null,
    modal.note ? h('p.modal-note', modal.note) : null,
    h(
      'div.modal-actions',
      btn(app, 'Cancel', { act: 'cancel', onclick: () => app.closeModal(), sfx: 'none' }),
      off ? btn(app, 'Deposit NEAR', { kind: 'brass', icon: 'plus', act: 'deposit-open', onclick: app.act.openDeposit }) : null,
      btn(app, modal.confirm || 'Confirm', {
        kind: modal.tone === 'danger' ? 'danger' : 'primary',
        act: 'confirm',
        autofocus: true,
        busy,
        off,
        onclick: go,
        sfx: modal.tone === 'danger' ? 'none' : 'ui_confirm',
        after: price != null && price > 0n && !busy ? nearTag(app, price, { digits: 3 }) : null,
      }),
    ),
  ]
}

// ----- Backing a den ----------------------------------------------------------------

function back(app, modal) {
  const den = (app.api.state.dens || []).find((entry) => entry.id === modal.den)
  if (!den) return [head(app, 'Back a den'), h('p.modal-text', 'That den is not on the list right now.')]
  const mine = app.backing(den.id)
  const total = B(den.shares)
  const share = total > 0n ? Number((mine.shares * 10000n) / total) / 100 : 0
  const yocto = app.fmt.toYocto(modal.amount || '0')
  const amount = B(yocto)
  const balance = app.balance()
  const least = B(app.rule('den_min_bankroll', '500000000000000000000000'))
  const short = least - B(den.bankroll)
  const busy = app.busy('backDen') || app.pending('backDen')
  const cashing = app.busy('unbackDen') || app.pending('unbackDen')
  let off = null
  if (amount <= 0n) off = 'Enter how much NEAR to put behind it.'
  else if (amount > balance) off = `Your pit balance is ${app.near(balance)} NEAR.`
  const set = (value) => app.setModal({ amount: value, rev: (modal.rev || 0) + 1 })

  return [
    head(app, `Back ${den.name}`, [icon('den'), 'House fighter · computer-run']),
    h(
      'p.modal-text',
      'Your NEAR joins this den’s bankroll and buys you a share of it. ',
      h('br'),
      'When challengers lose, the bankroll grows and your share is worth more. When they win, it shrinks.',
    ),
    h(
      'dl.rows.rows-3',
      row('Bankroll', nearTag(app, den.bankroll)),
      row('Pays on a win', den.open ? paysText(den.payout_bps) : 'Closed'),
      row('All-time record', `${den.total_wins || 0}–${den.total_losses || 0}`),
    ),
    !den.open && short > 0n ? h('p.modal-flag.is-warn', icon('lock'), 'Closed to stakes. ', nearTag(app, short, { digits: 3 }), ' more reopens it.') : null,
    h(
      'form.modal-form',
      {
        onsubmit: (event) => {
          event.preventDefault()
          if (!off && !busy) app.act.backDen(den, yocto)
        },
      },
      field(app, {
        label: 'Put behind it',
        field: 'amount',
        value: modal.amount,
        inputmode: 'decimal',
        placeholder: '0.00',
        prefix: icon('near'),
        suffix: 'NEAR',
        cls: 'field-big',
        autofocus: true,
        rev: modal.rev || 0,
        oninput: (value) => app.setModal({ amount: cleanAmount(value) }),
        hint: ['Pit balance ', nearTag(app, balance)],
      }),
      amountChips(app, [['0.1', '0.1'], ['0.25', '0.25'], ['0.5', '0.5'], ['1', '1']], modal.amount, set),
      btn(app, 'Back this den', { submit: true, kind: 'primary', cls: 'btn-wide', act: 'back-den-submit', off, busy, sfx: 'none', after: !busy && amount > 0n && !off ? nearTag(app, amount, { digits: 3 }) : null }),
    ),
    h(
      'div.yours.cut',
      { class: mine.shares > 0n ? 'has' : '' },
      h('div.yours-nums', h('div', h('span.label', 'Your share of this den'), h('b', mine.shares > 0n ? `${share < 0.01 ? '<0.01' : share.toFixed(2)}%` : 'None yet')), h('div', h('span.label', 'Worth now'), nearTag(app, mine.value, { digits: 3 }))),
      mine.shares > 0n
        ? h(
            'div.yours-actions',
            btn(app, 'Cash out half', { size: 'sm', act: 'cash-out-half', off: cashing ? true : null, onclick: () => app.act.unbackDen(den, mine.shares / 2n), sfx: 'none' }),
            btn(app, 'Cash out all', { size: 'sm', kind: 'brass', act: 'cash-out-all', busy: cashing, onclick: () => app.act.unbackDen(den, mine.shares), sfx: 'none' }),
          )
        : h('p.yours-note', 'Cash out any time at the bankroll’s value that moment.'),
    ),
  ]
}

// ----- The result of a fight ------------------------------------------------------------

/** One of the player's three after a fight: the XP it earned, and the level or form it gained. */
function gainRow(app, gain, slot) {
  const species = app.species(gain.species)
  const now = app.anyBeast(gain.id)
  const levelBefore = gain.levelBefore
  let landed = null
  if (levelBefore != null) {
    try {
      landed = app.core.addXp(levelBefore, gain.xpBefore || 0, gain.earned)
    } catch {
      landed = null
    }
  }
  const levelAfter = gain.levelAfter != null ? gain.levelAfter : landed ? landed.level : now ? app.levelOf(now.beast) : levelBefore
  const grew = levelBefore != null && levelAfter != null && levelAfter > levelBefore
  const newForm = grew && app.formAt(levelAfter) > app.formAt(levelBefore)
  const formName = levelAfter != null ? app.formName(gain.species, levelAfter) : species.name

  // Where the XP bar starts and ends. After a level-up it fills from empty.
  const needAfter = levelAfter != null ? app.levelInfo(levelAfter) : null
  const needBefore = levelBefore != null ? app.levelInfo(levelBefore) : null
  let to = null
  if (landed && landed.level === levelAfter && needAfter && needAfter.xp) to = landed.xp / needAfter.xp
  else if (now && now.beast.xp_next) to = Number(now.beast.xp || 0) / Number(now.beast.xp_next)
  const from = grew || !needBefore || !needBefore.xp ? 0 : (gain.xpBefore || 0) / needBefore.xp

  return h(
    'li.gain',
    { 'data-key': `gain${slot}`, class: [grew ? 'is-up' : '', newForm ? 'is-form' : ''], style: { '--c': `var(--aspect-${species.aspect})`, '--i': slot } },
    aspectTile(species.aspect, 'atile-sm'),
    h(
      'div.gain-id',
      h('b', gain.name, gain.hired ? h('span.gain-hired', 'hired') : null),
      h(
        'span.gain-line',
        gain.name === formName ? null : [formName, h('i.sep')],
        grew
          ? h('span.gain-lv', { 'aria-label': `Level ${levelBefore} to ${levelAfter}` }, h('span', 'Level'), h('b', levelBefore), icon('arrow-right'), h('b.gain-new', levelAfter))
          : levelAfter != null
            ? levelTag(levelAfter)
            : null,
      ),
    ),
    h('div.gain-bar', to != null ? xpBar(Math.round(to * 1000), 1000, { from }) : null),
    h('div.gain-xp', h('b', `+${gain.earned}`), ' XP'),
    newForm ? tag(`Now ${formName}`, 'rare', 'star') : grew ? tag('Level up', 'brass', 'arrow-up') : h('span.gain-none'),
  )
}

function gains(app, modal) {
  if (!Array.isArray(modal.gains) || !modal.gains.length) return null
  return h('div.gains', h('span.label', 'Your three, and what they learned'), h('ol.gain-list', modal.gains.map((gain, slot) => gainRow(app, gain, slot))))
}

function result(app, modal) {
  const { outcome, mode } = modal
  const stake = B(modal.stake)
  const payout = B(modal.payout)
  const den = modal.den != null ? app.denTable(modal.den) : null
  const word = outcome === 'won' ? 'Won' : outcome === 'lost' ? 'Lost' : 'No contest'
  const kicker = mode === 'practice' ? 'Practice fight' : mode === 'den' ? (stake > 0n ? 'Staked fight · house fighter' : 'Spar · house fighter') : stake > 0n ? 'Duel' : 'Friendly duel'
  const rivalName = mode === 'practice' ? 'Old Grist' : den && den.name ? den.name : modal.rival ? app.label(modal.rival) : 'your rival'

  let money
  if (mode === 'practice') {
    money = row('NEAR', h('span.result-plain', 'Practice: nothing was staked, and no XP is earned.'))
  } else if (outcome === 'void') {
    money = row('NEAR', stake > 0n ? h('span.result-plain', 'Both stakes returned: ', nearTag(app, stake), ' is back in your pit balance.') : h('span.result-plain', 'Nothing was staked.'))
  } else if (stake === 0n) {
    money = row('NEAR', h('span.result-plain', mode === 'den' ? 'A spar. No NEAR at stake.' : 'A friendly. No NEAR changed hands.'))
  } else if (outcome === 'won') {
    const profit = payout > stake ? payout - stake : 0n
    money = row(
      'NEAR won',
      [nearTag(app, profit, { digits: 3, sign: '+', cls: 'near-xl' }), h('span.result-sub', nearTag(app, payout, { digits: 3 }), mode === 'den' ? ' paid into your pit balance: your stake and the house’s money.' : ' paid into your pit balance: the pot, less the house cut.')],
      'is-win',
    )
  } else {
    money = row('NEAR lost', [nearTag(app, stake, { digits: 3, sign: '−', cls: 'near-xl' }), h('span.result-sub', mode === 'den' ? `Your stake joins ${rivalName}’s bankroll.` : `Your stake goes to ${rivalName}.`)], 'is-loss')
  }

  const bragText =
    stake > 0n
      ? `Just took ${app.near(payout)} NEAR off @${modal.rival} in the pit. Who is next? #maulstreet`
      : `Beat @${modal.rival} in a friendly in the pit. Put NEAR on it next time. #maulstreet`

  return [
    h(
      'div.result-top',
      { class: `is-${outcome}` },
      h('span.result-kicker', kicker),
      h('h2.result-word', word),
      h('p.result-vs', modal.forfeited ? 'You forfeited to ' : 'against ', h('b', rivalName), den && den.name ? h('span', ' · house fighter, computer-run') : null),
    ),
    h('dl.rows.result-rows', money, modal.essence > 0 ? row('Essence earned', essenceTag(modal.essence, { sign: '+', cls: 'ess-xl' }), 'is-ess') : null),
    gains(app, modal),
    h(
      'div.modal-actions.result-actions',
      btn(app, mode === 'duel' ? 'Find another duel' : 'Fight again', { kind: 'primary', icon: 'swords', act: 'fight-again', autofocus: true, onclick: () => app.act.fightAgain(modal), sfx: 'ui_confirm' }),
      mode === 'duel' && outcome === 'won' && modal.rival ? btn(app, 'Brag on NEAR Social', { kind: 'brass', icon: 'megaphone', act: 'brag', onclick: () => app.act.draftPost(bragText, 'Brag about it') }) : null,
      btn(app, mode === 'practice' ? 'Back to the title' : 'Back to the Street', {
        act: 'result-close',
        onclick: () => {
          app.closeModal()
          if (mode === 'practice') app.act.leavePractice()
        },
        sfx: 'none',
      }),
    ),
  ]
}

// ----- A challenge was posted --------------------------------------------------------------

function posted(app, modal) {
  const stake = B(modal.stake)
  return [
    head(app, 'Your challenge is up'),
    h(
      'p.modal-text',
      stake > 0n ? [nearTag(app, stake), ' is held from your pit balance until someone accepts or you cancel. '] : 'A friendly: nothing is held. ',
      'When a rival accepts, you are taken straight into the pit.',
    ),
    h('dl.rows', row('Stake', stake > 0n ? nearTag(app, stake) : 'Friendly'), row('Level cap', modal.cap ? String(modal.cap) : 'None'), row('Open to', modal.invite ? app.label(modal.invite) : 'Anyone')),
    h(
      'div.modal-actions',
      btn(app, 'Done', { act: 'done', onclick: () => app.closeModal(), sfx: 'none' }),
      btn(app, 'Call it out on NEAR Social', { kind: 'primary', icon: 'megaphone', act: 'call-out', autofocus: true, onclick: () => app.act.draftPost(calloutText(app, modal.stake, modal.cap, modal.invite), 'Call it out') }),
    ),
  ]
}

// ----- A post to NEAR Social -----------------------------------------------------------------

function post(app, modal) {
  const social = app.api.state.social || {}
  const text = modal.text || ''
  const busy = app.busy('social.post')
  const off = !social.enabled ? 'Turn on NEAR Social first.' : text.trim() ? null : 'Write something first.'
  const send = async () => {
    if (off || busy) return
    if (await app.act.post(text.trim())) app.closeModal(true)
  }
  return [
    head(app, modal.title || 'Post to NEAR Social'),
    !social.enabled
      ? h(
          'div.enable.cut',
          h('b', icon('megaphone'), 'NEAR Social is off on this device'),
          h('p', 'Your wallet asks once. After that, posts and follows are signed here without a popup.'),
          btn(app, 'Turn on NEAR Social', { kind: 'brass', size: 'sm', act: 'social-enable', busy: app.busy('social.enable'), onclick: app.act.socialEnable, sfx: 'none' }),
        )
      : null,
    h(
      'form.modal-form',
      {
        onsubmit: (event) => {
          event.preventDefault()
          send()
        },
      },
      field(app, {
        aria: 'Your post',
        field: 'post',
        value: text,
        multiline: true,
        rows: 4,
        maxlength: 500,
        spellcheck: true,
        autofocus: true,
        rev: modal.rev || 0,
        oninput: (value) => app.setModal({ text: value.slice(0, 500) }),
        onkeydown: (event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            send()
          }
        },
      }),
      h('p.modal-note', `Goes out on NEAR Social as ${app.account()}, for anyone to read. Change the words if you like.`),
      h('div.modal-actions', btn(app, 'Not now', { act: 'not-now', onclick: () => app.closeModal(), sfx: 'none' }), btn(app, 'Post', { submit: true, kind: 'primary', icon: 'send', act: 'post', off, busy, sfx: 'none' })),
    ),
  ]
}

const KINDS = { deposit, withdraw, confirm, back, result, posted, post }

export function renderModal(app) {
  const modal = app.ui.modal
  if (!modal || !KINDS[modal.kind]) return null
  return h(
    'div.modal-layer',
    {
      'data-key': 'modal-layer',
      onmousedown: (event) => {
        if (event.target === event.currentTarget && !modal.locked) app.closeModal()
      },
    },
    h(`div.modal.cut.modal-${modal.kind}`, { 'data-key': `modal-${modal.kind}`, role: 'dialog', 'aria-modal': 'true' }, KINDS[modal.kind](app, modal)),
  )
}
