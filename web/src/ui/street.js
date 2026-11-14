// THE STREET: the player's trainer card, the #maulstreet feed, rivals and the
// leaderboard. All of it lives on NEAR Social.

import { h } from './dom.js'
import { icon } from './icons.js'
import { avatar, btn, empty, field, iconBtn, nearTag, panelHead, segmented, who } from './parts.js'

const POST_MAX = 500

/** Post text with #tags and @accounts picked out. */
function rich(text) {
  const out = []
  const pattern = /(#[A-Za-z0-9_]+|@[a-z0-9._-]+)/g
  const body = String(text || '')
  let last = 0
  let found
  while ((found = pattern.exec(body))) {
    if (found.index > last) out.push(body.slice(last, found.index))
    out.push(h(found[1][0] === '#' ? 'span.hash' : 'span.mention', found[1]))
    last = found.index + found[1].length
  }
  if (last < body.length) out.push(body.slice(last))
  return out
}

function socialOff(app) {
  return app.api.state.social && app.api.state.social.enabled ? null : 'Turn on NEAR Social first.'
}

function enableBox(app) {
  return h(
    'div.enable.cut',
    h('b', icon('megaphone'), 'NEAR Social is off on this device'),
    h('p', 'Your wallet asks once. After that, posts and follows are signed here without a popup.'),
    btn(app, 'Turn on NEAR Social', { kind: 'primary', cls: 'btn-wide', act: 'social-enable', busy: app.busy('social.enable'), onclick: app.act.socialEnable, sfx: 'none' }),
  )
}

function trainerCard(app) {
  const { ui } = app
  const social = app.api.state.social || {}
  const player = app.player()
  const account = app.account()
  const profile = social.profile || { accountId: account, name: '', about: '' }
  const form = ui.forms.profile
  const cell = (label, value) => h('div.rec-cell', h('b', value), h('span', label))

  return h(
    'div.panel.cut.trainer',
    h(
      'div.trainer-top',
      avatar(app, account, 'avatar-lg'),
      h('div.trainer-id', h('h2', profile.name || app.fmt.shortAccount(account)), h('span.who-id', { title: account }, account)),
      !form && social.enabled
        ? iconBtn(app, 'pencil', {
            label: 'Edit your trainer card',
            act: 'profile-edit',
            onclick: () => {
              ui.forms.profile = { name: profile.name || '', about: profile.about || '' }
              ui.focusOn = '.trainer-form input'
              app.render()
            },
          })
        : null,
    ),
    form
      ? h(
          'form.trainer-form',
          {
            onsubmit: (event) => {
              event.preventDefault()
              app.act.saveProfile()
            },
          },
          field(app, { label: 'Name', field: 'profile-name', value: form.name, maxlength: 40, placeholder: 'What the Street calls you', oninput: (value) => ((ui.forms.profile = { ...ui.forms.profile, name: value.slice(0, 40) }), app.render()) }),
          field(app, {
            label: 'About',
            field: 'profile-about',
            value: form.about,
            maxlength: 160,
            multiline: true,
            rows: 2,
            placeholder: 'One line about how you fight',
            oninput: (value) => ((ui.forms.profile = { ...ui.forms.profile, about: value.slice(0, 160) }), app.render()),
          }),
          h(
            'div.form-actions',
            btn(app, 'Cancel', { size: 'sm', act: 'profile-cancel', onclick: () => ((ui.forms.profile = null), app.render()), sfx: 'ui_back' }),
            btn(app, 'Save card', { submit: true, kind: 'brass', size: 'sm', act: 'profile-save', busy: app.busy('social.profile'), sfx: 'none' }),
          ),
        )
      : h('p.trainer-about', profile.about || (social.enabled ? 'No words yet. Tell the Street how you fight.' : 'Your name and a line about you live on NEAR Social.')),
    h(
      'div.recs',
      cell('Rating', player.rating),
      cell('Duels', `${player.wins}–${player.losses}`),
      cell('Vs the house', `${player.den_wins}–${player.den_losses}`),
      cell('NEAR won', nearTag(app, player.won || '0')),
    ),
    social.enabled ? h('p.trainer-follow', h('b', (social.following || []).length), ' rivals followed', h('i.sep'), h('b', (social.followers || []).length), ' following you') : enableBox(app),
  )
}

function rivals(app) {
  const social = app.api.state.social || {}
  const list = social.following || []
  return h(
    'div.panel.cut.rivals',
    panelHead('Rivals', list.length ? `${list.length} followed` : null),
    list.length
      ? h(
          'div.mini-list.scroll',
          list.map((accountId) =>
            h(
              'div.mini-row',
              { 'data-key': `rival-${accountId}`, 'data-account': accountId },
              avatar(app, accountId),
              h('div.mini-id', who(app, accountId, 'who-stack')),
              btn(app, 'Challenge', { size: 'sm', kind: 'brass', icon: 'swords', act: 'challenge', onclick: () => app.act.challenge(accountId) }),
              iconBtn(app, 'close', { label: `Unfollow ${app.label(accountId)}`, cls: 'btn-sm', act: 'unfollow', busy: app.busy(`follow:${accountId}`), off: socialOff(app), onclick: () => app.act.unfollow(accountId), sfx: 'none' }),
            ),
          ),
        )
      : empty('user', 'No rivals yet', 'Follow a trainer from the feed and they are kept here, one click from a challenge.'),
  )
}

function compose(app) {
  const { ui } = app
  const form = ui.forms.compose
  const text = form.text
  const busy = app.busy('social.post')
  const off = socialOff(app) || (text.trim() ? null : 'Write something first.')
  const send = async () => {
    if (off || busy) return
    if (await app.act.post(text.trim())) {
      ui.forms.compose = { text: '', rev: ui.forms.compose.rev + 1 }
      app.render()
    }
  }
  return h(
    'form.panel.cut.compose',
    {
      onsubmit: (event) => {
        event.preventDefault()
        send()
      },
    },
    field(app, {
      aria: 'Write a post',
      field: 'compose',
      value: text,
      multiline: true,
      rows: 2,
      maxlength: POST_MAX,
      spellcheck: true,
      placeholder: 'Call someone out. Brag. Offer a hire.',
      rev: form.rev,
      oninput: (value) => {
        ui.forms.compose = { ...ui.forms.compose, text: value.slice(0, POST_MAX) }
        app.render()
      },
      onkeydown: (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          send()
        }
      },
    }),
    h(
      'div.compose-foot',
      h('span.compose-note', icon('info'), 'Posts are public and permanent. #maulstreet is added for you.'),
      h('span.compose-count', `${text.length}/${POST_MAX}`),
      btn(app, 'Post', { submit: true, kind: 'primary', size: 'sm', icon: 'send', act: 'social-post', off, busy, sfx: 'none' }),
    ),
  )
}

function postCard(app, post) {
  const account = app.account()
  const social = app.api.state.social || {}
  const mine = post.author === account
  const follows = (social.following || []).includes(post.author)
  const name = post.name || app.nameOf(post.author)
  const short = app.fmt.shortAccount(post.author)
  let link = null
  try {
    link = app.api.social.url ? app.api.social.url(post.author, post.id) : null
  } catch {
    link = null
  }
  return h(
    'article.post',
    { 'data-key': `post-${post.author}-${post.id}`, 'data-author': post.author, class: mine ? 'is-mine' : '' },
    avatar(app, post.author),
    h(
      'div.post-body',
      h(
        'header.post-head',
        h('b', name || short),
        name ? h('span.who-id', short) : null,
        mine ? h('span.post-you', 'You') : null,
        h('span.post-time', app.fmt.timeAgo(post.ts)),
        link ? h('a.post-link', { href: link, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Open on NEAR Social' }, icon('external')) : null,
      ),
      h('p.post-text', rich(post.text)),
      mine
        ? null
        : h(
            'div.post-actions',
            btn(app, follows ? 'Unfollow' : 'Follow', {
              size: 'sm',
              kind: follows ? 'ghost' : 'brass',
              icon: follows ? 'check' : 'plus',
              act: follows ? 'unfollow' : 'follow',
              off: socialOff(app),
              busy: app.busy(`follow:${post.author}`),
              onclick: () => (follows ? app.act.unfollow(post.author) : app.act.follow(post.author)),
              sfx: 'none',
            }),
            btn(app, 'Challenge', { size: 'sm', icon: 'swords', act: 'challenge', onclick: () => app.act.challenge(post.author) }),
          ),
    ),
  )
}

function feed(app) {
  const { ui } = app
  const social = app.api.state.social || {}
  const mentions = social.mentions || []
  const posts = ui.feedTab === 'mentions' ? mentions : social.feed || []
  return h(
    'div.panel.cut.feed',
    h(
      'header.panel-head',
      segmented(
        app,
        [
          { value: 'feed', label: '#maulstreet', act: 'feed-all' },
          { value: 'mentions', label: 'Mentions', act: 'feed-mentions', badge: mentions.length ? h('em.seg-n', mentions.length) : null },
        ],
        ui.feedTab,
        (value) => ((ui.feedTab = value), app.render()),
        'Which posts',
      ),
      h('span.panel-meta', 'From NEAR Social'),
    ),
    h(
      'div.feed-list.scroll',
      { 'data-key': `feed-${ui.feedTab}` },
      posts.length
        ? posts.map((post) => postCard(app, post))
        : ui.feedTab === 'mentions'
          ? empty('megaphone', 'Nobody has called you out', 'Posts that mention your account show up here.')
          : empty('megaphone', 'The Street is quiet', 'No #maulstreet posts yet. Say the first word.'),
    ),
  )
}

function board(app) {
  const account = app.account()
  const player = app.player()
  const rows = (app.api.state.leaderboard || []).slice()
  const listed = rows.some((row) => row.account_id === account)
  const line = (row, place) =>
    h(
      'div.board-row',
      { 'data-key': `lb-${row.account_id}`, 'data-account': row.account_id, class: row.account_id === account ? 'is-me' : '' },
      h('span.board-rank', { class: place <= 3 ? `top top-${place}` : '' }, place || '–'),
      who(app, row.account_id, 'who-stack'),
      h('b.board-rating', row.rating),
      h('span.board-wl', `${row.wins}–${row.losses}`),
      nearTag(app, row.won || '0'),
    )
  return h(
    'div.panel.cut.board',
    panelHead('Leaderboard', 'By pit rating'),
    h('div.board-cols', h('span', '#'), h('span', 'Trainer'), h('span', 'Rating'), h('span', 'W–L'), h('span', 'Won')),
    rows.length
      ? h(
          'div.board-list.scroll',
          rows.map((row, i) => line(row, i + 1)),
          !listed ? line({ account_id: account, rating: player.rating, wins: player.wins, losses: player.losses, won: player.won }, 0) : null,
        )
      : empty('crown', 'No duels settled yet', 'Win a duel and your name goes up here.'),
  )
}

export function renderStreet(app) {
  return h(
    'div.tabbody.street',
    { 'data-key': 'tab-street' },
    h('section.col.street-left', trainerCard(app), rivals(app)),
    h('section.col.street-mid', compose(app), feed(app)),
    h('section.col.street-right', board(app)),
  )
}
