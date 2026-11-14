// The menus' icon set: small inline SVGs drawn on a 24x24 grid.
// Stroked by default, in the current text colour. `F` marks a filled shape.

const F = 'fill="currentColor" stroke="none"'

const ICONS = {
  // Money
  near: `<circle cx="12" cy="12" r="9.7" stroke-width="1.5"/><path d="M8.5 16.3V7.7l7 8.6V7.7" stroke-width="1.9" stroke-linecap="square" stroke-linejoin="miter"/>`,
  essence: `<path d="M12 2l6.5 7.6L12 22 5.5 9.6z" fill="currentColor" fill-opacity=".22" stroke-width="1.5"/><path d="M5.5 9.6h13M12 2L9.4 9.6 12 22l2.6-12.4z" stroke-width="1.1"/>`,
  coin: `<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.2" stroke-width="1.3"/>`,
  wallet: `<path d="M3.5 7.5h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2zM3.5 7.5l11-4v4"/><circle cx="16.5" cy="14" r="1.3" ${F}/>`,
  withdraw: `<path d="M12 14.5V4M7.8 8.2L12 4l4.2 4.2M4.5 13.5V20h15v-6.5"/>`,
  tag: `<path d="M3.5 11.5v-8h8l9 9-8 8z"/><circle cx="8" cy="8" r="1.5" ${F}/>`,

  // The pit
  swords: `<path d="M3 3l3.4.5 9.2 9.2-2.9 2.900-9.200-9.200zM21 3l-3.400.5-9.200 9.200 2.900 2.900 9.200-9.200z" ${F}/><path d="M13.300 18l4.700-4.700M10.700 18L6 13.300" stroke-width="2.100"/><path d="M16.200 16.200l3.800 3.800M7.800 16.200L4 20" stroke-width="2.700"/>`,
  shield: `<path d="M12 2.8l7.4 2.7v6.1c0 4.6-3 8-7.4 9.7-4.4-1.7-7.4-5.1-7.4-9.7V5.5z"/>`,
  fang: `<path d="M6.6 3c3.2 1.5 7.4 1.6 10.9.1.1 7.6-2.4 14.2-7.3 18.4C7.6 16.6 6.2 9.6 6.6 3z" ${F}/>`,
  den: `<path d="M4.5 21V11a7.5 7.5 0 0 1 15 0v10"/><path d="M9.5 21V10.5M14.5 21V10.5M4.5 15.5h15" stroke-width="1.4"/>`,
  crown: `<path d="M3.5 18.5L5 8l4.4 4.6L12 5.5l2.6 7.1L19 8l1.5 10.5z" ${F}/>`,
  megaphone: `<path d="M3.5 10v4h3l7.5 4.5v-13L6.5 10z" ${F}/><path d="M17 9a4.2 4.2 0 0 1 0 6M7.2 14.6l1.1 4.4h2.3l-1-4.3"/>`,
  hourglass: `<path d="M6.5 3.5h11M6.5 20.5h11M7.5 3.5c0 4.5 3 5.5 4.5 8.5 1.5-3 4.5-4 4.5-8.5M7.5 20.5c0-4.5 3-5.5 4.5-8.5 1.5 3 4.5 4 4.5 8.5"/>`,

  // Aspects
  flame: `<path d="M12.4 2.2c.6 3.6 5.4 6 5.4 11.6 0 4.2-2.7 7.7-5.8 7.7s-5.8-3-5.8-6.9c0-2.6 1.3-4.4 2.6-5.7.2 2 .9 3.2 2 3.8-.6-3.7.2-7.4 1.6-10.5z" ${F}/>`,
  leaf: `<path fill-rule="evenodd" d="M4.5 19.5c-.3-9 5-15 15-15 .3 9.5-5.5 15.3-15 15zM7.2 17.3l.9.9 7.7-7.9-.9-.9z" ${F}/>`,
  rock: `<path d="M4 16.5l2.3-8L12 4.2l6.3 3.3 1.9 7.6-4.4 4.7H7.6z" ${F}/><path d="M12 4.2l-1.4 7.5 5.2 8.1 4.4-4.7-1.9-7.6z" fill="#000" fill-opacity=".3" stroke="none"/>`,
  bolt: `<path d="M13.8 2L5.2 13.4h5.4L9.4 22l9.4-12.2h-5.6z" ${F}/>`,
  wave: `<path d="M2 19h20v-6c-1.5 2-4 3-6 3-3 0-4.5-2-4.5-4 0-1.7 1.3-2.8 2.7-2.8 1.1 0 1.8.7 1.8 1.6 0-2.3-1.700-4.300-4.200-4.300-4.300 0-6.800 4-9.800 7z" ${F}/>`,

  // Looking ahead
  eye: `<path d="M2.5 12c2.6-4.200 5.900-6.300 9.500-6.300s6.900 2.100 9.500 6.300c-2.600 4.200-5.900 6.300-9.500 6.300S5.100 16.200 2.500 12z"/><path d="M12 8.200c1 1.200 1.500 2.400 1.500 3.800s-.5 2.600-1.500 3.800c-1-1.200-1.500-2.400-1.500-3.800s.5-2.600 1.500-3.800z" ${F}/>`,

  // Controls
  plus: `<path d="M12 5v14M5 12h14" stroke-width="2.2"/>`,
  minus: `<path d="M5 12h14" stroke-width="2.2"/>`,
  close: `<path d="M6 6l12 12M18 6L6 18" stroke-width="2"/>`,
  check: `<path d="M5 12.500l4.500 4.500L19 7.500" stroke-width="2.200"/>`,
  lock: `<rect x="5" y="10.500" width="14" height="10.500" rx="1.200" ${F}/><path d="M8 10.500V7.600a4 4 0 0 1 8 0v2.900"/>`,
  pencil: `<path d="M4.500 19.500l.9-4.100L16.200 4.600l3.200 3.200L8.600 18.600zM14 6.800l3.200 3.200"/>`,
  info: `<circle cx="12" cy="12" r="9"/><path d="M12 11v5.500M12 7.500v.3" stroke-width="2"/>`,
  up: `<path d="M12 5.500l7 11.500H5z" ${F}/>`,
  'chevron-down': `<path d="M6 9.500l6 6 6-6" stroke-width="2"/>`,
  'chevron-right': `<path d="M9.500 6l6 6-6 6" stroke-width="2"/>`,
  'chevron-left': `<path d="M14.500 6l-6 6 6 6" stroke-width="2"/>`,
  'arrow-right': `<path d="M5 12h14M13 6l6 6-6 6" stroke-width="2"/>`,
  external: `<path d="M14 4.500h5.500V10M19.500 4.500l-8.200 8.200M17 13.500v6H4.500V7h6"/>`,
  'sound-on': `<path d="M3.500 9.500h3.200L11.500 5v14l-4.800-4.500H3.500z" ${F}/><path d="M15 9.200a4 4 0 0 1 0 5.600M17.600 6.600a7.600 7.600 0 0 1 0 10.800"/>`,
  'sound-off': `<path d="M3.500 9.500h3.200L11.500 5v14l-4.800-4.500H3.500z" ${F}/><path d="M15.500 9.500l5 5M20.500 9.500l-5 5"/>`,
  logout: `<path d="M14 4.500h5.500v15H14M10 8l-4 4 4 4M6 12h10"/>`,
  send: `<path d="M3.500 11.500l17-8-6.500 17-2.600-7.400zM11.400 13.100l9.100-9.600"/>`,

  gear: `<circle cx="12" cy="12" r="3.200"/><path d="M12 2.800v2.400M12 18.800v2.400M21.200 12h-2.400M5.200 12H2.800M18.500 5.500l-1.700 1.700M7.200 16.800l-1.700 1.700M18.500 18.500l-1.700-1.700M7.200 7.200L5.500 5.500" stroke-width="2.200"/><circle cx="12" cy="12" r="6.400"/>`,
  star: `<path d="M12 2.600l2.800 6 6.600.800-4.900 4.500 1.300 6.500L12 17.200l-5.800 3.200 1.300-6.500-4.900-4.500 6.600-.800z" ${F}/>`,
  'arrow-up': `<path d="M12 19V5M6 11l6-6 6 6" stroke-width="2.200"/>`,
  calendar: `<rect x="3.500" y="5" width="17" height="15.500" rx="1.200"/><path d="M3.500 10h17M8 3v4M16 3v4"/>`,

  // People and things
  user: `<circle cx="12" cy="8" r="4" ${F}/><path d="M4 20.500c.6-4.200 3.800-6.500 8-6.500s7.400 2.300 8 6.500z" ${F}/>`,
  spark: `<path d="M12 2.500l2.100 7.400 7.400 2.100-7.400 2.100L12 21.500l-2.100-7.400-7.400-2.100 7.400-2.100z" ${F}/>`,
}

/** The icon for each aspect (0 Ember .. 4 Tide). */
export const ASPECT_ICONS = ['flame', 'leaf', 'rock', 'bolt', 'wave']

const cache = new Map()

/** A fresh <svg> for the named icon. `extra` adds classes. */
export function icon(name, extra = '') {
  let template = cache.get(name)
  if (!template) {
    const holder = document.createElement('template')
    holder.innerHTML = `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`
    template = holder.content.firstChild
    cache.set(name, template)
  }
  const el = template.cloneNode(true)
  el.setAttribute('class', `ic ic-${name}${extra ? ` ${extra}` : ''}`)
  return el
}

export function hasIcon(name) {
  return name in ICONS
}
