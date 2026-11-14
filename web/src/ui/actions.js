// What the buttons do: each flow calls the api, hands a fight to the 3D game
// through the bridge when there is one, and says what happened.

import { B } from './domain.js'

export function createActions(app) {
  const { api, ui } = app
  const act = {}

  // ----- Getting in ----------------------------------------------------------

  act.connect = async () => {
    if (ui.connect.busy) return
    ui.connect = { busy: true, text: 'Opening the wallet chooser…', error: '' }
    app.render()
    try {
      await api.connect((text) => {
        ui.connect = { ...ui.connect, text: String(text || '') }
        app.render()
      })
      ui.connect = { busy: false, text: '', error: '' }
      app.sfx('ui_confirm')
    } catch (error) {
      ui.connect = { busy: false, text: '', error: app.plain(error) }
      app.sfx('ui_error')
    }
    app.render()
  }

  act.disconnect = async () => {
    ui.accountMenu = false
    await app.run('disconnect', () => api.disconnect())
  }

  act.practice = () => {
    ui.practice = true
    ui.practiceNote = ''
    ui.draft = { picks: [], focus: null }
    app.render()
  }

  act.leavePractice = () => {
    ui.practice = false
    ui.draft = { picks: [], focus: null }
    app.sfx('ui_back')
    app.render()
  }

  act.togglePick = (speciesId) => {
    const picks = ui.draft.picks.slice()
    const at = picks.indexOf(speciesId)
    if (at >= 0) {
      picks.splice(at, 1)
      app.sfx('ui_back')
    } else if (picks.length >= 3) {
      app.sfx('ui_error')
      app.toast('info', 'You can take three. Drop one first.')
      return
    } else {
      picks.push(speciesId)
      app.sfx('ui_confirm')
    }
    ui.draft = { picks, focus: speciesId }
    app.render()
  }

  act.claim = async () => {
    const picks = ui.draft.picks.slice()
    if (picks.length !== 3) return
    if (ui.practice) {
      // Practice squads are level-1 cubs, built the way the rules module reads a squad.
      const squad = picks.map((id) => ({ ...app.speciesBuild(id), relic: 0 }))
      const result = await runFight({ mode: 'practice', squad, den: 0 })
      app.openModal(resultModal('practice', null, result, { squad }))
      return
    }
    const done = await app.run('register', () => api.register(picks), { sfx: 'ui_confirm' })
    if (done.ok) {
      ui.squadEdited = false
      ui.squad = [null, null, null]
      ui.tab = 'stable'
      ui.draft = { picks: [], focus: null }
      app.render()
    }
  }

  // ----- Money ---------------------------------------------------------------

  act.openDeposit = () => app.openModal({ kind: 'deposit', amount: '' })
  act.openWithdraw = () => app.openModal({ kind: 'withdraw', amount: '' })

  act.deposit = async (yocto) => {
    const done = await app.run('deposit', () => api.deposit(yocto), { sfx: 'ui_confirm' })
    if (done.ok) app.closeModal(true)
  }

  act.withdraw = async (yocto) => {
    const done = await app.run('withdraw', () => api.withdraw(yocto), {
      sfx: 'ui_confirm',
      ok: `${app.near(yocto, 3)} NEAR is on its way to your wallet.`,
    })
    if (done.ok) app.closeModal(true)
  }

  // ----- The stable ------------------------------------------------------------

  // A level is one click while it is cheap. From a tenth of a NEAR up, it asks first.
  const ASK_FROM = 10n ** 23n
  let cheers = 0
  let cheerTimer = 0

  /** A level has just landed: tick the number, and say so if the beast changed form with it. */
  function celebrate(before, after) {
    const levelBefore = app.levelOf(before)
    const levelAfter = app.levelOf(after)
    if (levelAfter <= levelBefore) return
    app.sfx('upgrade')
    const was = app.formOf(before)
    const now = app.formOf(after)
    clearTimeout(cheerTimer)
    ui.cheer = { id: ++cheers, beastId: after.id, level: levelAfter }
    cheerTimer = setTimeout(() => {
      ui.cheer = null
      app.render()
    }, 1800)
    // The stage plays the change of form itself when the beast is shown again at its new level.
    if (now.index > was.index) {
      const article = /^[aeiou]/i.test(now.name) ? 'an' : 'a'
      app.toast('ok', `${before.name || was.name} has grown into ${article} ${now.name}: the ${now.label} form.`)
    }
    app.render()
  }

  /** Buys a beast its next level: with NEAR from the pit balance, or by feeding it the Essence it still lacks. */
  act.levelUp = (beast, withEssence, info = null) => {
    const key = `level:${beast.id}:${withEssence ? 'e' : 'n'}`
    const next = app.levelOf(beast) + 1
    const buy = async () => {
      const done = await app.run(key, () => api.levelUp(beast.id, withEssence))
      if (done.ok) celebrate(beast, done.value && done.value.level != null ? done.value : { ...beast, level: next, form: undefined, form_name: undefined })
      return done
    }
    if (withEssence || !info || B(info.near) < ASK_FROM) return buy()
    app.openModal({
      kind: 'confirm',
      title: `Level ${next} for ${beast.name}`,
      text: `${beast.name} goes up a level and keeps the XP it has. It stays that strong for anyone who hires it too.`,
      rows: 'spend',
      price: info.near,
      confirm: 'Buy the level',
      busyKey: key,
      run: async () => (await buy()).ok,
    })
    return null
  }

  act.rename = async () => {
    const form = ui.forms.rename
    if (!form) return
    const name = form.value.trim()
    const done = await app.run('rename', () => api.renameBeast(form.id, name), { sfx: 'ui_confirm' })
    if (done.ok) {
      ui.forms.rename = null
      app.render()
    }
  }

  act.equip = async (beast, itemId) => {
    const done = await app.run(`equip:${itemId}`, () => api.equip(beast.id, itemId), { sfx: 'equip' })
    if (done.ok) {
      ui.equipOpen = null
      app.render()
    }
  }

  act.unequip = async (beast, kind) => {
    const done = await app.run(`unequip:${kind}`, () => api.unequip(beast.id, kind), { sfx: 'equip' })
    if (done.ok) {
      ui.equipOpen = null
      app.render()
    }
  }

  act.list = async (beast, priceYocto) => {
    const done = await app.run(`list:${beast.id}`, () => api.listForHire(beast.id, priceYocto), {
      sfx: 'ui_confirm',
      ok: `${beast.name} is listed at ${app.near(priceYocto, 3)} NEAR a fight.`,
    })
    if (done.ok) {
      delete ui.forms.hirePrice[beast.id]
      ui.forms.hireRev = (ui.forms.hireRev || 0) + 1
      app.render()
    }
  }

  act.unlist = (beast) => app.run(`unlist:${beast.id}`, () => api.unlist(beast.id), { sfx: 'ui_back', ok: `${beast.name} is off the hire market.` })

  // ----- The bazaar and the hire market ---------------------------------------

  const ceiling = (price) => (B(price) * 105n) / 100n

  act.buyItem = (row) => {
    const def = app.item(row.id)
    if (!def) return
    app.openModal({
      kind: 'confirm',
      title: `Buy ${def.name}`,
      text: def.text,
      rows: 'buy',
      price: row.price,
      max: ceiling(row.price).toString(),
      note: 'If someone buys first the price can rise. You never pay more than the limit.',
      confirm: 'Buy',
      busyKey: `buyItem:${row.id}`,
      run: async () => {
        const done = await app.run(`buyItem:${row.id}`, () => api.buyItem(row.id, ceiling(row.price).toString()), {
          sfx: 'purchase',
          ok: (paid) => `${def.name} bought for ${app.near(paid || row.price, 3)} NEAR. It is in your inventory.`,
        })
        return done.ok
      },
    })
  }

  act.buyBeast = (row) => {
    const species = app.species(row.id)
    app.openModal({
      kind: 'confirm',
      title: `Buy a ${species.name}`,
      text: species.lore,
      rows: 'buy',
      price: row.price,
      max: ceiling(row.price).toString(),
      note: 'If someone buys first the price can rise. You never pay more than the limit.',
      confirm: 'Buy',
      busyKey: `buyBeast:${row.id}`,
      run: async () => {
        const done = await app.run(`buyBeast:${row.id}`, () => api.buyBeast(row.id, ceiling(row.price).toString()), {
          sfx: 'purchase',
          ok: `A new ${species.name} is in your stable.`,
        })
        if (done.ok && done.value && done.value.id != null) ui.selected = done.value.id
        return done.ok
      },
    })
  }

  act.hire = (beast, fights) => {
    const total = B(beast.hire_price) * BigInt(fights)
    app.openModal({
      kind: 'confirm',
      title: `Hire ${beast.name}`,
      text: `${fights} fight${fights === 1 ? '' : 's'} at ${app.near(beast.hire_price, 3)} NEAR each. One is used each time a fight starts with ${beast.name} in your squad.`,
      rows: 'spend',
      price: total.toString(),
      confirm: 'Hire',
      busyKey: `hire:${beast.id}`,
      run: async () => {
        const done = await app.run(`hire:${beast.id}`, () => api.hire(beast.id, fights), {
          sfx: 'purchase',
          ok: `${beast.name} is yours for ${fights} fight${fights === 1 ? '' : 's'}.`,
        })
        return done.ok
      },
    })
  }

  // ----- Fights ----------------------------------------------------------------

  /** The player's three as they stand before a fight: [{ id, name, species, level, xp, form }] by slot. */
  function squadBefore(match) {
    const side = match && Array.isArray(match.players) ? match.players.indexOf(app.account()) : -1
    const team = side >= 0 && match.battle && Array.isArray(match.battle.teams) ? match.battle.teams[side] : null
    if (!team) return null
    return team.map((fighter) => {
      const entry = app.anyBeast(fighter.token)
      const beast = entry ? entry.beast : null
      return beast
        ? { id: beast.id, name: beast.name, species: beast.species, level: app.levelOf(beast), xp: Number(beast.xp || 0), form: app.formOf(beast).index, hired: entry.hired }
        : { id: fighter.token, name: app.formName(fighter.species, fighter.level || 1), species: fighter.species, level: null, xp: 0, form: null, hired: false }
    })
  }

  /** Hands the screen to the 3D game until the fight is over. */
  async function runFight(opts) {
    if (ui.inFight) return { won: false, match: null }
    ui.inFight = true
    ui.modal = null
    ui.accountMenu = false
    ui.settings = false
    ui.preview = null
    if (opts.match && !(ui.before && ui.before.matchId === opts.match.id)) {
      ui.before = { matchId: opts.match.id, squad: squadBefore(opts.match) }
    }
    app.hideTip()
    app.render()
    let result = null
    try {
      result = await app.bridge.fight(opts)
    } catch (error) {
      app.toast('error', app.plain(error))
    }
    ui.inFight = false
    ui.fightEndedAt = Date.now()
    if (ui.screen === 'hub') app.music('street')
    app.render()
    return result || { won: false, match: null }
  }

  /** Every fight needs three. If the squad is short, say so and go to the stable. */
  act.needSquad = () => {
    if (app.squadReady()) return true
    app.toast('info', 'Every fight needs a full squad of three. Pick yours in the stable.')
    app.go('stable')
    return false
  }

  function resultModal(mode, match, result, extra = {}) {
    const account = app.account()
    const side = match && Array.isArray(match.players) ? Math.max(0, match.players.indexOf(account)) : 0
    const isVoid = !!(match && match.void)
    const won = !isVoid && (match && match.winner != null ? match.winner === side : !!(result && result.won))
    return {
      kind: 'result',
      mode,
      outcome: isVoid ? 'void' : won ? 'won' : 'lost',
      stake: String((match && match.stake) || '0'),
      payout: String((match && match.payout) || '0'),
      essence: match && Array.isArray(match.essence) ? Number(match.essence[side] || 0) : 0,
      rival: match && Array.isArray(match.players) ? match.players[1 - side] : null,
      den: match && match.den != null ? match.den : null,
      forfeited: !!extra.forfeited,
      squad: extra.squad || null,
      gains: gainsOf(match, side),
    }
  }

  /** What each of the player's three took from a fight: XP, and the level it left at. */
  function gainsOf(match, side) {
    if (!match || !match.over || match.void) return null
    const team = match.battle && Array.isArray(match.battle.teams) ? match.battle.teams[side] : null
    const xp = Array.isArray(match.xp) ? match.xp[side] : null
    const levels = Array.isArray(match.levels) ? match.levels[side] : null
    if (!team || !xp) return null
    const before = ui.before && ui.before.matchId === match.id ? ui.before.squad : null
    return team.map((fighter, slot) => {
      const was = before && before[slot] && before[slot].id === fighter.token ? before[slot] : null
      const now = app.anyBeast(fighter.token)
      const levelAfter = levels && levels[slot] ? Number(levels[slot]) : now ? app.levelOf(now.beast) : null
      return {
        id: fighter.token,
        species: fighter.species,
        name: was ? was.name : now ? now.beast.name : app.formName(fighter.species, fighter.level || 1),
        hired: was ? was.hired : now ? now.hired : false,
        earned: Number(xp[slot] || 0),
        levelBefore: was ? was.level : null,
        xpBefore: was ? was.xp : null,
        levelAfter,
      }
    })
  }

  async function afterFight(mode, started, result) {
    let match = result && result.match
    if (!match || !match.over) {
      try {
        match = (await api.getMatch(started.id)) || match
      } catch {
        /* keep what the game gave us */
      }
    }
    Promise.resolve(api.refresh ? api.refresh('player', 'dens', 'challenges', 'leaderboard', 'ticker') : null).catch(() => {})
    if (!match || !match.over) {
      // Remember the unfinished fight, so the Pit offers Resume straight away.
      if (match && mode === 'den') {
        ui.denMatch = match
        ui.denMatchId = match.id
        ui.denMatchAt = Date.now()
      }
      app.toast('info', mode === 'den' ? 'That fight is not finished. Resume it from the Pit.' : 'Your duel is still on.')
      ui.tab = 'pit'
      ui.pitView = mode === 'den' ? 'dens' : 'duels'
      // A duel left part-way: the banner offers the way back in, with no countdown this time.
      if (match && mode === 'duel') act.onDuel(match)
      app.render()
      return
    }
    if (mode === 'duel') {
      ui.resultShown = match.id
      ui.duelMatch = match
    } else {
      ui.denMatch = match
      ui.denMatchAt = Date.now()
    }
    app.openModal(resultModal(mode, match, result))
  }

  /**
   * A duel the player knew about has ended while they were in the menus (the
   * rival ran out of clock or conceded, say). Tell them how it went, once.
   */
  async function settleSeenDuel(matchId, known = null) {
    if (matchId == null || ui.resultShown === matchId || ui.inFight) return
    let match = known
    if (!match || !match.over) {
      try {
        match = await api.getMatch(matchId)
      } catch {
        match = null
      }
    }
    if (!match || !match.over || ui.resultShown === matchId || ui.inFight) return
    ui.resultShown = matchId
    ui.duelMatch = match
    app.openModal(resultModal('duel', match, null))
  }

  /** The contract says the player is in no duel any more. */
  act.duelGone = () => {
    const banner = ui.duelBanner
    if (!banner || ui.inFight) return
    act.clearDuelBanner()
    settleSeenDuel(banner.match.id)
  }

  act.denFight = async (den, stakeYocto) => {
    if (!act.needSquad()) return false
    const stake = String(stakeYocto || '0')
    const started = await app.run(`den:${den.id}:${stake === '0' ? 'spar' : 'stake'}`, () => api.startDenFight(den.id, app.squadIds(), stake))
    if (!started.ok || !started.value) return false
    ui.lastDen = { id: den.id, stake }
    const result = await runFight({ mode: 'den', match: started.value })
    await afterFight('den', started.value, result)
    return true
  }

  act.stakeFight = (den, stakeYocto) => {
    if (!act.needSquad()) return
    const pays = (B(stakeYocto) * BigInt(den.payout_bps || 0)) / 10000n
    app.openModal({
      kind: 'confirm',
      title: `Stake against ${den.name}`,
      text: `${den.name} is a house fighter, run by the contract. Win and it pays you from its bankroll. Lose and your stake joins it.`,
      rows: 'stake',
      price: String(stakeYocto),
      pays: pays.toString(),
      confirm: 'Fight',
      tone: 'primary',
      busyKey: `den:${den.id}:stake`,
      run: () => act.denFight(den, stakeYocto),
    })
  }

  act.resumeDen = async () => {
    const id = app.player() && app.player().den_match
    if (id == null) return
    const found = await app.run('den:resume', () => api.getMatch(id))
    if (!found.ok || !found.value) return
    if (found.value.over) {
      // It ended somewhere else. There is nothing to resume.
      ui.denMatch = found.value
      app.render()
      return
    }
    const result = await runFight({ mode: 'den', match: found.value })
    await afterFight('den', found.value, result)
  }

  act.forfeitDen = () => {
    const match = ui.denMatch
    const stake = B(match && match.stake)
    app.openModal({
      kind: 'confirm',
      title: 'Forfeit this fight?',
      text: stake > 0n ? `Giving up counts as a loss. Your stake of ${app.near(stake)} NEAR goes to the house fighter.` : 'Giving up counts as a loss. Nothing was staked.',
      confirm: 'Forfeit',
      tone: 'danger',
      busyKey: 'forfeitDen',
      run: async () => {
        const done = await app.run('forfeitDen', () => api.forfeitDen(), { sfx: 'ui_back' })
        if (done.ok && done.value && done.value.over) {
          ui.denMatch = done.value
          setTimeout(() => app.openModal(resultModal('den', done.value, null, { forfeited: true })), 0)
        }
        return done.ok
      },
    })
  }

  act.fightAgain = (modal) => {
    app.closeModal(true)
    if (modal.mode === 'practice' && modal.squad) {
      runFight({ mode: 'practice', squad: modal.squad, den: 0 }).then((result) => app.openModal(resultModal('practice', null, result, { squad: modal.squad })))
      return
    }
    if (modal.mode === 'den' && modal.den != null) {
      const den = (api.state.dens || []).find((entry) => entry.id === modal.den)
      const stake = ui.lastDen && ui.lastDen.id === modal.den ? ui.lastDen.stake : '0'
      if (den) {
        if (stake !== '0' && (!den.open || B(stake) > B(den.max_stake) || B(stake) > app.balance())) {
          app.toast('info', `That stake is not on offer from ${den.name} right now. Pick a new one.`)
          app.go('pit', { pitView: 'dens' })
        } else {
          act.denFight(den, stake)
        }
        return
      }
    }
    app.go('pit', { pitView: modal.mode === 'duel' ? 'duels' : 'dens' })
  }

  // ----- Backing a den ---------------------------------------------------------

  act.openBack = (den) => app.openModal({ kind: 'back', den: den.id, amount: '' })

  act.backDen = async (den, yocto) => {
    const done = await app.run('backDen', () => api.backDen(den.id, yocto), {
      sfx: 'purchase',
      ok: `${app.near(yocto)} NEAR is behind ${den.name}.`,
    })
    if (done.ok) app.setModal({ amount: '', rev: ((ui.modal && ui.modal.rev) || 0) + 1 })
  }

  act.unbackDen = (den, shares) => app.run('unbackDen', () => api.unbackDen(den.id, shares.toString()), { sfx: 'ui_confirm', ok: (paid) => `${app.near(paid, 3)} NEAR cashed out of ${den.name}.` })

  // ----- Duels -------------------------------------------------------------------

  let countdown = 0

  act.clearDuelBanner = () => {
    clearInterval(countdown)
    countdown = 0
    if (ui.duelBanner) {
      ui.duelBanner = null
      app.render()
    }
  }

  act.enterDuel = async (match) => {
    if (ui.inFight) return
    act.clearDuelBanner()
    ui.duelEntered = match.id
    const result = await runFight({ mode: 'duel', match })
    await afterFight('duel', match, result)
  }

  /** The player's duel started or changed. An unfinished one pulls them into the pit. */
  act.onDuel = (match) => {
    if (!match || match.id == null) return
    const mine = app.player() && app.player().duel
    if (mine == null || mine === match.id || !ui.duelMatch || ui.duelMatch.id === match.id) ui.duelMatch = match
    if (match.over) {
      const seen = (ui.duelBanner && ui.duelBanner.match.id === match.id) || ui.duelEntered === match.id
      act.clearDuelBanner()
      if (seen) settleSeenDuel(match.id, match)
      else app.render()
      return
    }
    if (ui.inFight || ui.accepting) return
    if (ui.duelBanner && ui.duelBanner.match.id === match.id) {
      ui.duelBanner = { ...ui.duelBanner, match }
      app.render()
      return
    }
    clearInterval(countdown)
    countdown = 0
    if (ui.duelEntered === match.id) {
      // They have been in and come back out: no more automatic jumps, just the way back in.
      ui.duelBanner = { match, seconds: null }
      app.render()
      return
    }
    ui.duelBanner = { match, seconds: 3 }
    ui.modal = null
    app.sfx('challenge')
    app.render()
    countdown = setInterval(() => {
      const banner = ui.duelBanner
      if (!banner || banner.seconds == null) {
        clearInterval(countdown)
        return
      }
      if (banner.seconds <= 1) {
        act.enterDuel(banner.match)
      } else {
        ui.duelBanner = { ...banner, seconds: banner.seconds - 1 }
        app.render()
      }
    }, 1000)
  }

  act.accept = (challenge) => {
    if (!act.needSquad()) return
    const go = async () => {
      ui.accepting = true
      const done = await app.run(`accept:${challenge.id}`, () => api.acceptChallenge(challenge.id, app.squadIds()), { sfx: 'challenge' })
      ui.accepting = false
      if (done.ok && done.value) {
        ui.duelMatch = done.value
        app.closeModal(true)
        act.enterDuel(done.value)
      }
      return done.ok
    }
    if (B(challenge.stake) === 0n) {
      go()
      return
    }
    app.openModal({
      kind: 'confirm',
      title: `Fight ${app.label(challenge.creator)}`,
      text: 'You match the stake. The winner takes the pot, less the house cut.',
      rows: 'duel',
      price: challenge.stake,
      confirm: 'Accept and fight',
      tone: 'primary',
      busyKey: `accept:${challenge.id}`,
      keepOpen: true,
      run: go,
    })
  }

  act.postChallenge = async (stakeYocto, cap, invite) => {
    if (!act.needSquad()) return
    const done = await app.run('createChallenge', () => api.createChallenge(app.squadIds(), stakeYocto, cap, invite || null), { sfx: 'challenge' })
    if (done.ok) {
      ui.forms.challenge = { ...ui.forms.challenge, invite: '', rev: ui.forms.challenge.rev + 1 }
      app.openModal({ kind: 'posted', stake: stakeYocto, cap, invite: invite || null })
    }
  }

  act.cancelChallenge = () =>
    app.run('cancelChallenge', () => api.cancelChallenge(), { sfx: 'ui_back', ok: 'Your challenge is down. Any stake is back in your pit balance.' })

  /** Opens the duel form with this account in the invite field. */
  act.challenge = (accountId) => {
    ui.forms.challenge = { ...ui.forms.challenge, invite: accountId, rev: ui.forms.challenge.rev + 1 }
    app.go('pit', { pitView: 'duels' })
    app.toast('info', `Set your stake and post. Only ${app.label(accountId)} will be able to accept.`)
  }

  // ----- NEAR Social ---------------------------------------------------------------

  act.socialEnable = () =>
    app.run('social.enable', () => api.social.enable(), { sfx: 'ui_confirm', ok: 'NEAR Social is on. Posts and follows are silent from here.' })

  /** Opens a post, already written, for the player to send or change. */
  act.draftPost = (text, title = 'Post to NEAR Social') => app.openModal({ kind: 'post', title, text, rev: 0 })

  act.post = async (text) => {
    const done = await app.run('social.post', () => api.social.post(text), { sfx: 'ui_confirm', ok: 'Posted to NEAR Social.' })
    return done.ok
  }

  act.follow = (accountId) => app.run(`follow:${accountId}`, () => api.social.follow(accountId), { sfx: 'ui_confirm' })
  act.unfollow = (accountId) => app.run(`follow:${accountId}`, () => api.social.unfollow(accountId), { sfx: 'ui_back' })

  act.saveProfile = async () => {
    const form = ui.forms.profile
    if (!form) return
    const done = await app.run('social.profile', () => api.social.setProfile({ name: form.name.trim(), about: form.about.trim() }), {
      sfx: 'ui_confirm',
      ok: 'Your trainer card is updated.',
    })
    if (done.ok) {
      ui.forms.profile = null
      app.render()
    }
  }

  return act
}
