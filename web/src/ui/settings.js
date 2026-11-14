// Sound and graphics: the few things about how the game looks and sounds
// that the menus can change. The 3D game and the audio module keep the choices.

import { h } from './dom.js'
import { iconBtn, segmented } from './parts.js'

const QUALITY = [
  { value: 'low', label: 'Low', act: 'quality-low' },
  { value: 'medium', label: 'Medium', act: 'quality-medium' },
  { value: 'high', label: 'High', act: 'quality-high' },
]

const VOLUMES = [
  { key: 'master', label: 'Volume' },
  { key: 'music', label: 'Music' },
  { key: 'sfx', label: 'Effects' },
]

/** Asks the 3D game for one of its settings, if it has it. */
function ask(app, name, fallback = null) {
  try {
    const fn = app.bridge && app.bridge[name]
    return typeof fn === 'function' ? fn.call(app.bridge) : fallback
  } catch {
    return fallback
  }
}

function tell(app, name, value) {
  try {
    const fn = app.bridge && app.bridge[name]
    if (typeof fn === 'function') fn.call(app.bridge, value)
  } catch (error) {
    app.toast('error', app.plain(error))
  }
  app.render()
}

/** { master, music, sfx } from the audio module, each 0 to 1, or null when it has no volumes. */
function volumesOf(app) {
  try {
    const audio = app.bridge && app.bridge.audio
    const now = audio && typeof audio.getVolumes === 'function' && typeof audio.setVolumes === 'function' ? audio.getVolumes() : null
    return now && typeof now === 'object' ? now : null
  } catch {
    return null
  }
}

function volumeRow(app, volumes, { key, label }) {
  const percent = Math.round(Math.max(0, Math.min(1, Number(volumes[key]) || 0)) * 100)
  return h(
    'label.volume',
    { 'data-key': `volume-${key}` },
    h('span.label', label),
    h('input.volume-range', {
      type: 'range',
      min: 0,
      max: 100,
      step: 5,
      value: String(percent),
      'aria-label': `${label}, ${percent} percent`,
      'data-set': `volume-${key}`,
      style: { '--v': `${percent}%` },
      oninput: (event) => {
        try {
          app.bridge.audio.setVolumes({ [key]: Number(event.target.value) / 100 })
        } catch (error) {
          app.toast('error', app.plain(error))
        }
        app.render()
      },
      onchange: () => app.sfx('ui_click'),
    }),
    h('span.volume-n', `${percent}%`),
  )
}

/** The sound toggle and, next to it, a small popover for how the game sounds and looks. */
export function settingsCluster(app) {
  const { ui } = app
  const quality = ask(app, 'quality')
  const volumes = volumesOf(app)
  const hasQuality = quality != null && typeof app.bridge.setQuality === 'function'
  return h(
    'div.settings',
    iconBtn(app, ui.muted ? 'sound-off' : 'sound-on', { label: ui.muted ? 'Turn sound on' : 'Turn sound off', cls: 'sound-btn', act: 'sound', onclick: app.toggleSound, sfx: 'none' }),
    hasQuality || volumes
      ? iconBtn(app, 'gear', {
          label: 'Settings',
          cls: 'sound-btn',
          act: 'settings',
          expanded: ui.settings,
          onclick: () => {
            ui.settings = !ui.settings
            ui.accountMenu = false
            app.render()
          },
        })
      : null,
    ui.settings
      ? h(
          'div.settings-menu.cut',
          { role: 'dialog', 'aria-label': 'Settings' },
          h('h3.sec-title', 'Settings'),
          volumes ? h('div.setting', { class: ui.muted ? 'is-muted' : '' }, VOLUMES.map((row) => volumeRow(app, volumes, row)), ui.muted ? h('p', 'Sound is off. Turn it on with the speaker button.') : null) : null,
          hasQuality
            ? h(
                'div.setting',
                { 'data-set': 'quality' },
                h('span.label', 'Graphics'),
                segmented(app, QUALITY, quality, (value) => tell(app, 'setQuality', value), 'Graphics'),
                h('p', 'Lower it if fights stutter on this device.'),
              )
            : null,
        )
      : null,
  )
}
