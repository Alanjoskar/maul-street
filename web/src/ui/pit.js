// THE PIT: house fighters (the five dens) and duels against other players.

import { h } from './dom.js'
import { icon } from './icons.js'
import { B, fromHundredths, hundredths } from './domain.js'
import { avatar, btn, cleanAmount, empty, field, levelTag, nearTag, panelHead, paysText, pips, segmented, speciesChip, stageBlock, stepper, tag, who } from './parts.js'

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V']

// ----- House fighters ---------------------------------------------------------

/** The stake the stepper shows for a den, in hundredths of a NEAR, kept inside what is allowed. */
function stakeFor(app, den) {
  const most = Math.min(hundredths(den.max_stake), hundredths(app.balance()))
  const chosen = app.ui.forms.stake[den.id]
  const value = chosen == null ? Math.min(5, most) : Math.min(chosen, most)
  return { value: Math.max(most >= 1 ? 1 : 0, value), most }
}

/** The level a den's beasts fight at in a free spar, with its training on top. */
function sparLevel(den) {
  return Math.max(1, Number(den.spar_level) || 1) + (Number(den.level_bonus) || 0)
}

function lastTen(den) {
  const fights = Math.min(10, den.fights || 0)
  const wins = Math.min(fights, den.wins || 0)
  const dots = []
  for (let i = 0; i < 10; i++) dots.push(h('i', { class: i < wins ? 'won' : i < fights ? 'lost' : '' }))
  return h(
    'div.den-form',
    { 'data-tip': fights ? `Of its last ${fights} staked fights the house won ${wins} and lost ${fights - wins}.` : 'No staked fights on record yet.' },
    h('span.label', 'Last ten'),
    h('span.dots', { role: 'img', 'aria-label': `${wins} won, ${fights - wins} lost` }, dots),
    h('span.den-form-n', fights ? `${wins}–${fights - wins}` : 'none yet'),
  )
}

function denCard(app, den) {
  const { ui } = app
  const table = app.denTable(den.id)
  const closed = !den.open
  const live = app.denLive()
  const liveHere = live && ui.denMatch.den === den.id
  const why = !!ui.denWhy[den.id]
  const backing = app.backing(den.id)
  const { value: stake, most } = stakeFor(app, den)
  const stakeYocto = fromHundredths(stake)
  const pays = (B(stakeYocto) * BigInt(den.payout_bps || 0)) / 10000n
  const sparKey = `den:${den.id}:spar`
  const stakeKey = `den:${den.id}:stake`
  const starting = app.anyBusy('den:') || app.pending('startDenFight')
  const wait = live ? 'Finish the fight you have in progress first.' : null
  const bonus = Number(den.level_bonus) || 0
  const training = Number(den.training_levels) || 0
  const spar = sparLevel(den)

  let stakeOff = wait
  if (!stakeOff && most < 1) {
    stakeOff = hundredths(app.balance()) < 1 ? 'Your pit balance is under 0.01 NEAR. Deposit to stake.' : `${den.name} is not taking stakes right now.`
  }

  let actions
  if (liveHere) {
    actions = [
      h('p.den-live', icon('hourglass'), 'Your fight here is not finished.', B(ui.denMatch.stake) > 0n ? [' ', nearTag(app, ui.denMatch.stake), ' at stake.'] : null),
      btn(app, 'Resume', { kind: 'primary', cls: 'btn-wide', icon: 'swords', act: 'resume', busy: app.busy('den:resume'), onclick: app.act.resumeDen, sfx: 'ui_confirm' }),
      btn(app, 'Forfeit', { kind: 'danger', size: 'sm', cls: 'btn-wide', act: 'forfeit', onclick: app.act.forfeitDen }),
    ]
  } else {
    actions = [
      btn(app, 'Spar', {
        cls: 'btn-wide',
        after: h('span.btn-sub', 'Free · earns XP and Essence'),
        act: 'spar',
        busy: app.busy(sparKey),
        off: wait || (starting && !app.busy(sparKey) ? true : null),
        onclick: () => app.act.denFight(den, '0'),
        sfx: 'ui_confirm',
      }),
      closed
        ? h('p.den-closed', icon('lock'), h('span', h('b', 'Closed to stakes.'), ` Its bankroll is under ${app.near(app.rule('den_min_bankroll', '500000000000000000000000'))} NEAR. Back it to reopen it.`))
        : h(
            'div.den-stake',
            stepper(app, {
              value: stake,
              min: 1,
              max: Math.max(1, most),
              label: 'Stake',
              off: stakeOff ? true : null,
              display: nearTag(app, stakeYocto),
              onchange: (next) => {
                ui.forms.stake[den.id] = next
                app.render()
              },
            }),
            h('span.den-pays', stakeOff ? (live ? 'A fight is in progress' : 'No stake possible') : ['Win pays ', nearTag(app, pays, { digits: 3 })]),
            btn(app, 'Fight for NEAR', {
              kind: 'primary',
              cls: 'den-go',
              icon: 'swords',
              act: 'fight-near',
              busy: app.busy(stakeKey),
              off: stakeOff || (starting && !app.busy(stakeKey) ? true : null),
              onclick: () => app.act.stakeFight(den, stakeYocto),
            }),
          ),
      btn(app, closed ? 'Back this den to reopen it' : 'Back this den', {
        kind: closed ? 'brass' : 'ghost',
        size: closed ? '' : 'sm',
        cls: 'btn-wide',
        icon: 'coin',
        act: 'back-den',
        onclick: () => app.act.openBack(den),
      }),
    ]
  }

  return h(
    'article.den.cut',
    {
      'data-key': `den${den.id}`,
      'data-den': den.id,
      class: [closed ? 'is-closed' : '', liveHere ? 'is-live' : ''],
      onmouseenter: () => app.hover('den', den.id),
      onmouseleave: () => app.hover(null),
    },
    h('span.den-mark', { 'aria-hidden': 'true' }, ROMAN[den.tier] || ''),
    h(
      'header.den-head',
      h('span.den-tier', pips(den.tier), `Tier ${den.tier}`),
      liveHere ? tag('Fight in progress', 'scarlet', 'hourglass') : closed ? tag('Closed', 'scarlet', 'lock') : tag('Open', 'brass'),
    ),
    h('h3.den-name', den.name),
    h('p.den-title', den.title),
    h('p.den-house', icon('den'), 'House fighter · computer-run'),
    h('div.den-squad', (den.squad || []).map((id) => speciesChip(app, id, null, spar))),
    h(
      'div.den-levels',
      h(
        'p',
        { 'data-tip': bonus ? `Level ${den.spar_level} for its tier, plus ${bonus} from the training its winnings have paid for.` : 'A den spars at a fixed level set by its tier, whatever you bring.' },
        icon('shield'),
        h('span', 'Its beasts spar at ', h('b', `level ${spar}`)),
      ),
      h(
        'p',
        { 'data-tip': 'With NEAR on the fight its beasts take the average level of your squad, so the odds are about skill.' },
        icon('swords'),
        h('span', 'For a stake: ', h('b', 'matches your level'), bonus ? `, plus ${bonus}` : ''),
      ),
    ),
    // The den's book: its numbers, or the reasoning behind them. Same footprint either way.
    h(
      'div.den-book',
      { class: why ? 'is-why' : '' },
      why
        ? h('p.den-reason', { 'data-key': 'reason' }, den.reason)
        : [
            h(
              'dl.den-nums',
              { 'data-key': 'nums' },
              h('div', h('dt', 'Bankroll'), h('dd', nearTag(app, den.bankroll))),
              h('div', h('dt', 'Pays'), h('dd.pays', closed ? '–' : paysText(den.payout_bps))),
              h('div', h('dt', 'Max stake'), h('dd', closed ? '–' : nearTag(app, den.max_stake))),
              h('div', { 'data-tip': 'Every fight it has finished, staked or free: won, then lost.' }, h('dt', 'All time'), h('dd', `${den.total_wins || 0}–${den.total_losses || 0}`)),
              h(
                'div',
                { 'data-tip': `A tenth of what it wins goes on training. It has paid for ${training} level${training === 1 ? '' : 's'}. Every four put its beasts one level higher, up to four.` },
                h('dt', 'Training'),
                h('dd', bonus ? `+${bonus} lv` : '–'),
              ),
              h('div', { 'data-tip': 'What your shares in this den are worth right now.' }, h('dt', 'You hold'), h('dd', backing.shares > 0n ? nearTag(app, backing.value) : '–')),
            ),
            lastTen(den),
          ],
    ),
    h(
      'button.den-why',
      {
        type: 'button',
        'aria-expanded': String(why),
        'data-act': 'why',
        'data-tip': why ? null : den.reason,
        onclick: () => {
          ui.denWhy = { ...ui.denWhy, [den.id]: !why }
          app.render()
        },
      },
      icon('info'),
      h('span', why ? 'Back to the numbers' : 'Why these numbers'),
      icon('chevron-right'),
    ),
    h('p.den-teaches', table.teaches || ''),
    h('div.den-actions', actions),
  )
}

function unfinished(app) {
  const { ui } = app
  if (!app.denLive()) return null
  const match = ui.denMatch
  const den = (app.api.state.dens || []).find((entry) => entry.id === match.den)
  return h(
    'div.notice.cut',
    { 'data-key': 'unfinished' },
    h('span.notice-ic', icon('hourglass')),
    h('p', h('b', 'You have a fight in progress'), den ? [' against ', den.name] : null, B(match.stake) > 0n ? [', with ', nearTag(app, match.stake), ' at stake'] : null, '. It has no clock.'),
    btn(app, 'Resume', { kind: 'primary', size: 'sm', icon: 'swords', act: 'resume', busy: app.busy('den:resume'), onclick: app.act.resumeDen, sfx: 'ui_confirm' }),
    btn(app, 'Forfeit', { kind: 'danger', size: 'sm', act: 'forfeit', onclick: app.act.forfeitDen }),
  )
}

function densView(app) {
  const dens = app.api.state.dens || []
  if (!dens.length) return h('div.dens', { 'data-key': 'dens' }, empty('den', 'The dens are loading', 'House fighters appear here once the contract answers.'))
  return h(
    'div.dens',
    { 'data-key': 'dens' },
    unfinished(app),
    h('div.dens-stage', h('div.stage-frame', { 'data-stage-frame': '', 'data-key': 'stage-frame' })),
    h('div.den-row', dens.map((den) => denCard(app, den))),
  )
}

// ----- Duels --------------------------------------------------------------------

/** No cap, or one of the levels at which a beast changes form: 5, 12, 25. */
function capChoices(app) {
  const levels = app.formLevels().slice(1, 4)
  const labels = app.formLabels()
  return [{ value: 0, label: 'None', act: 'cap-0' }, ...levels.map((level) => ({ value: level, label: String(level), act: `cap-${level}`, form: labels[app.formAt(level)] }))]
}

const rakeOf = (app) => BigInt(app.rule('duel_rake_bps', '300'))
const potAfterRake = (app, stake) => {
  const pot = B(stake) * 2n
  return pot - (pot * rakeOf(app)) / 10000n
}

function challengeCard(app, challenge) {
  const account = app.account()
  const mine = challenge.creator === account
  const forMe = !!challenge.invite && challenge.invite === account
  const forOther = !!challenge.invite && !forMe && !mine
  const stake = B(challenge.stake)
  const squad = challenge.squad || []
  const power = squad.reduce((sum, beast) => sum + (beast.power || 0), 0)
  const cap = Number(challenge.level_cap) || 0

  let off = null
  if (forOther) off = `Only ${app.label(challenge.invite)} can accept this one.`
  else if (app.duelLive()) off = 'Finish the duel you are in first.'
  else if (stake > app.balance()) off = `You need ${app.near(stake)} NEAR in your pit balance to match this stake.`

  return h(
    'article.chal.cut',
    { 'data-key': `chal${challenge.id}`, 'data-challenge': challenge.id, class: [forMe ? 'is-invite' : '', mine ? 'is-mine' : '', forOther ? 'is-locked' : ''] },
    forMe ? h('div.chal-flag', icon('megaphone'), 'Called out: this one is for you') : null,
    mine ? h('div.chal-flag.is-mine', icon('hourglass'), 'Your challenge · waiting for a rival…') : null,
    h('header.chal-head', avatar(app, challenge.creator), who(app, challenge.creator), h('span.chal-age', app.fmt.timeAgo(challenge.created))),
    h(
      'div.chal-terms',
      stake > 0n
        ? h('div.chal-stake', h('span.label', 'Stake'), nearTag(app, stake), h('span.chal-take', 'Winner takes ', nearTag(app, potAfterRake(app, stake), { digits: 3 })))
        : h('div.chal-stake.is-friendly', h('span.label', 'Stake'), h('b', 'Friendly'), h('span.chal-take', 'No NEAR changes hands')),
      h('div.chal-cap', h('span.label', 'Level cap'), h('b', cap || 'None')),
      h('div.chal-cap', h('span.label', 'Power'), h('b', power)),
    ),
    h(
      'div.chal-squad',
      squad.map((beast) => {
        // Under a cap a beast fights, and looks, as it did at that level.
        const level = beast.level != null ? (cap ? Math.min(cap, beast.level) : beast.level) : null
        return speciesChip(app, beast.species, level != null ? levelTag(level) : h('em', beast.power), level)
      }),
    ),
    h(
      'div.chal-foot',
      forOther ? h('span.chal-lock', icon('lock'), `For ${app.label(challenge.invite)} only`) : null,
      mine
        ? btn(app, 'Cancel', { size: 'sm', act: 'cancel-challenge', busy: app.busy('cancelChallenge'), onclick: app.act.cancelChallenge, sfx: 'none' })
        : btn(app, 'Accept', { kind: forMe ? 'primary' : 'brass', size: 'sm', icon: 'swords', act: 'accept', off, busy: app.busy(`accept:${challenge.id}`), onclick: () => app.act.accept(challenge) }),
    ),
  )
}

function challengeList(app) {
  const account = app.account()
  const all = (app.api.state.challenges || []).slice()
  const rank = (challenge) => (challenge.invite && challenge.invite === account ? 0 : challenge.creator === account ? 1 : 2)
  all.sort((a, b) => rank(a) - rank(b) || (b.created || 0) - (a.created || 0))
  return h(
    'div.panel.cut.chals',
    panelHead('Open challenges', all.length ? `${all.length} on the table` : null),
    h(
      'div.chal-list.scroll',
      all.length ? all.map((challenge) => challengeCard(app, challenge)) : empty('swords', 'Nobody is calling', 'No open challenges right now. Post one and somebody will answer.'),
    ),
  )
}

function mySquadLine(app, cap) {
  const entries = app.squadEntries()
  if (!app.squadReady()) {
    return h('div.form-squad.is-short', h('span', 'Your squad is not full.'), btn(app, 'Set your squad', { size: 'sm', kind: 'brass', onclick: () => app.go('stable') }))
  }
  return h(
    'div.form-squad',
    entries.map((entry) => {
      const level = cap ? Math.min(cap, app.levelOf(entry.beast)) : app.levelOf(entry.beast)
      return speciesChip(app, entry.beast.species, levelTag(level), level)
    }),
    h('button.linkline', { type: 'button', onclick: () => app.go('stable') }, 'Change', icon('arrow-right')),
  )
}

function postForm(app) {
  const { ui } = app
  const form = ui.forms.challenge
  const player = app.player()
  const account = app.account()
  const mine = (app.api.state.challenges || []).find((challenge) => challenge.creator === account)

  if (player.challenge != null || mine) {
    const stake = B(mine && mine.stake)
    return h(
      'div.panel.cut.post-panel.is-up',
      { 'data-key': 'post-up' },
      panelHead('Your challenge is up'),
      h('div.waiting-rival', h('span.pulse', icon('hourglass')), h('b', 'Waiting for a rival…'), h('p', 'When someone accepts, the duel starts and you are taken straight into the pit.')),
      mine
        ? h(
            'dl.rows',
            h('div', h('dt', 'Stake'), h('dd', stake > 0n ? nearTag(app, stake) : 'Friendly')),
            h('div', h('dt', 'Level cap'), h('dd', mine.level_cap ? String(mine.level_cap) : 'None')),
            h('div', h('dt', 'Open to'), h('dd', mine.invite ? app.label(mine.invite) : 'Anyone')),
          )
        : null,
      btn(app, 'Call it out on NEAR Social', {
        kind: 'brass',
        cls: 'btn-wide',
        icon: 'megaphone',
        act: 'call-out',
        onclick: () => app.act.draftPost(calloutText(app, mine ? mine.stake : '0', mine ? mine.level_cap : 0, mine ? mine.invite : null), 'Call it out'),
      }),
      btn(app, 'Cancel challenge', { cls: 'btn-wide', size: 'sm', act: 'cancel-challenge', busy: app.busy('cancelChallenge'), onclick: app.act.cancelChallenge, sfx: 'none' }),
      stake > 0n ? h('p.sec-note', 'Cancelling returns your stake to your pit balance.') : null,
    )
  }

  const caps = capChoices(app)
  const cap = caps.some((choice) => choice.value === form.cap) ? form.cap : 0
  const capForm = caps.find((choice) => choice.value === cap)
  const stakeYocto = app.fmt.toYocto(form.stake || '0')
  const stake = B(stakeYocto)
  const least = B(app.rule('min_duel_stake', '10000000000000000000000'))
  const invite = form.invite.trim().toLowerCase()
  const rakePct = Number(rakeOf(app)) / 100
  let off = null
  if (stake > 0n && stake < least) off = `A stake is at least ${app.near(least)} NEAR. Use 0 for a friendly.`
  else if (stake > app.balance()) off = `Your pit balance is ${app.near(app.balance())} NEAR. Lower the stake or deposit.`
  else if (invite && invite === account) off = 'You cannot invite yourself.'
  else if (invite && !/^[a-z0-9._-]{2,64}$/.test(invite)) off = 'That does not look like a NEAR account.'
  const busy = app.busy('createChallenge') || app.pending('createChallenge')
  const setStake = (value) => {
    ui.forms.challenge = { ...form, stake: value, rev: form.rev + 1 }
    app.render()
  }

  return h(
    'form.panel.cut.post-panel',
    {
      'data-key': 'post-form',
      onsubmit: (event) => {
        event.preventDefault()
        if (!off && !busy) app.act.postChallenge(stakeYocto, cap, invite)
      },
    },
    panelHead('Post a challenge'),
    field(app, {
      label: 'Stake',
      field: 'stake',
      value: form.stake,
      inputmode: 'decimal',
      placeholder: '0',
      prefix: icon('near'),
      rev: form.rev,
      invalid: !!off && stake > 0n && (stake < least || stake > app.balance()),
      oninput: (value) => {
        ui.forms.challenge = { ...ui.forms.challenge, stake: cleanAmount(value) }
        app.render()
      },
      hint:
        stake > 0n
          ? ['Each side puts this in. Winner takes ', nearTag(app, potAfterRake(app, stake), { digits: 3 }), ` (the pot less the house's ${rakePct}%).`]
          : 'A friendly: no NEAR changes hands.',
    }),
    h(
      'div.quick',
      [
        ['0', 'Friendly'],
        ['0.10', '0.1'],
        ['0.25', '0.25'],
        ['0.50', '0.5'],
        ['1.00', '1'],
      ].map(([value, label]) =>
        h('button.quick-chip', { type: 'button', 'data-amount': value, class: B(app.fmt.toYocto(value)) === stake ? 'is-on' : '', onclick: () => setStake(value) }, label),
      ),
    ),
    h(
      'div.field',
      h('span.field-label', 'Level cap'),
      segmented(app, caps, cap, (value) => ((ui.forms.challenge = { ...ui.forms.challenge, cap: value }), app.render()), 'Level cap'),
      h('span.field-hint', cap ? `Every beast fights at level ${cap} at most, in its ${capForm.form} form.` : 'No cap: every level counts.'),
    ),
    field(app, {
      label: 'Invite one account (optional)',
      field: 'invite',
      value: form.invite,
      placeholder: 'rival.testnet',
      rev: form.rev,
      prefix: icon('user'),
      oninput: (value) => {
        ui.forms.challenge = { ...ui.forms.challenge, invite: value.trim().slice(0, 64) }
        app.render()
      },
      hint: invite ? 'Only this account can accept.' : 'Leave empty and anyone can accept.',
    }),
    h('div.field', h('span.field-label', cap ? `Your squad, capped at level ${cap}` : 'Your squad'), mySquadLine(app, cap)),
    btn(app, 'Post challenge', { submit: true, kind: 'primary', size: 'lg', cls: 'btn-wide', icon: 'megaphone', act: 'post-challenge', off, busy, sfx: 'none' }),
  )
}

/** The words for a callout post. */
export function calloutText(app, stake, cap, invite) {
  const amount = B(stake)
  const what = amount > 0n ? `${app.near(amount)} NEAR is on the table in the pit` : 'A friendly is open in the pit'
  const capText = cap ? `, level cap ${cap}` : ''
  const whom = invite ? `@${invite} ` : ''
  return `${whom}${what}${capText}. Three of mine against three of yours. Come and take it. #maulstreet`
}

function duelsView(app) {
  const form = app.ui.forms.challenge
  const cap = capChoices(app).some((choice) => choice.value === form.cap) ? form.cap : 0
  const ready = app.squadReady()
  return h(
    'div.tabbody.three.duels',
    { 'data-key': 'duels' },
    h('section.col.col-left', challengeList(app)),
    h(
      'section.col.col-stage',
      stageBlock(
        ready
          ? [h('div.plate-kicker', h('span', 'Your squad'), h('span', 'Power ', h('b', app.squadPower(cap))), cap ? h('span', `capped at level ${cap}`) : null), h('div.plate-name.is-small', app.squadEntries().map((entry) => entry.beast.name).join(' · '))]
          : [h('div.plate-kicker', h('span.warn', 'Your squad is not full')), btn(app, 'Set your squad', { kind: 'brass', size: 'sm', onclick: () => app.go('stable') })],
      ),
    ),
    h('section.col.col-right', postForm(app)),
  )
}

// ----- The tab ------------------------------------------------------------------------

export function renderPit(app) {
  const { ui } = app
  const account = app.account()
  const challenges = app.api.state.challenges || []
  const invites = challenges.filter((challenge) => challenge.invite && challenge.invite === account).length
  const ready = app.squadReady()
  const week = app.bridge && typeof app.bridge.week === 'function'

  return h(
    'div.pit',
    { 'data-key': 'tab-pit' },
    h(
      'div.subnav',
      segmented(
        app,
        [
          { value: 'dens', label: 'House fighters', act: 'pit-dens' },
          { value: 'duels', label: 'Duels', act: 'pit-duels', badge: invites ? h('i.seg-dot', { 'aria-label': 'You have been called out' }) : challenges.length ? h('em.seg-n', challenges.length) : null },
        ],
        ui.pitView,
        (value) => {
          ui.pitView = value
          ui.hover = null
          app.render()
        },
        'Who to fight',
      ),
      h('p.subnav-note', ui.pitView === 'dens' ? 'Five computer-run fighters, each with its own bankroll on chain. Spar for XP and Essence, or stake NEAR against the house.' : 'Three of yours against three of theirs. Both sides stake the same. The winner takes the pot.'),
      ui.pitView === 'dens' && week
        ? btn(app, 'Watch a week go by', {
            size: 'sm',
            icon: 'calendar',
            act: 'week',
            tip: 'A simulation of a week on Maul Street: how the dens, the prices and the money move.',
            onclick: () => {
              try {
                app.bridge.week()
              } catch (error) {
                app.toast('error', app.plain(error))
              }
            },
          })
        : null,
      h(
        'button.squad-pill.cut',
        { type: 'button', 'data-act': 'squad-pill', class: ready ? '' : 'is-short', 'data-tip': 'Change your squad in the stable', onclick: () => app.go('stable') },
        h('span.label', 'Your squad'),
        ready ? h('b', app.squadEntries().map((entry) => entry.beast.name).join(' · ')) : h('b', 'Not full: pick three'),
        ready ? h('span.squad-pill-pow', levelTag(app.squadLevel()), ' · Power ', app.squadPower()) : null,
      ),
    ),
    ui.pitView === 'duels' ? duelsView(app) : densView(app),
  )
}

export function pitStage(app) {
  const { ui } = app
  const dens = app.api.state.dens || []
  if (ui.pitView === 'dens' && ui.hover && ui.hover.kind === 'den') {
    const den = dens.find((entry) => entry.id === ui.hover.value)
    // The house's three, as they spar. A look, not a beast growing up: the stage swaps them in at once.
    if (den) return { builds: (den.squad || []).map((species) => app.speciesBuild(species, sparLevel(den))), opts: { layout: 'lineup', focus: 0, mood: 'pit', preview: true } }
  }
  const builds = app.squadBuilds()
  if (!builds.length) return null
  return { builds, opts: { layout: 'lineup', focus: 0, mood: 'pit' } }
}
