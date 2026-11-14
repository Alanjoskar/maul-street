// People-facing numbers and names.
//
// NEAR amounts travel as whole numbers of yoctoNEAR (1 NEAR = 10^24) in decimal
// strings. Everything here is exact BigInt arithmetic: money never touches a float.

const DECIMALS = 24

function toBig(value) {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') return Number.isFinite(value) ? BigInt(Math.trunc(value)) : 0n
  if (typeof value === 'string') {
    const text = value.trim()
    if (/^-?\d+$/.test(text)) return BigInt(text)
  }
  return 0n
}

function places(digits) {
  const n = Math.trunc(Number(digits))
  if (!Number.isFinite(n) || n < 0) return 0
  return n > DECIMALS ? DECIMALS : n
}

/**
 * yoctoNEAR → NEAR as text with `digits` decimals, rounded down.
 * near("390000000000000000000000") → "0.39". An amount too small to show is "<0.01".
 */
export function near(yocto, digits = 2) {
  let value = toBig(yocto)
  const sign = value < 0n ? '-' : ''
  if (value < 0n) value = -value
  const d = places(digits)
  const shown = value / 10n ** BigInt(DECIMALS - d)
  if (shown === 0n && value > 0n) {
    return `${sign}<${d === 0 ? '1' : `0.${'0'.repeat(d - 1)}1`}`
  }
  if (d === 0) return sign + shown.toString()
  const scale = 10n ** BigInt(d)
  return `${sign}${shown / scale}.${(shown % scale).toString().padStart(d, '0')}`
}

/** Writes a JavaScript number out in full, without an exponent. */
function plainNumber(n) {
  const text = String(n)
  const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/i.exec(text)
  if (!match) return text
  const [, sign, whole, fraction = '', exponent] = match
  const digits = whole + fraction
  const point = whole.length + Number(exponent)
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`
  if (point >= digits.length) return sign + digits + '0'.repeat(point - digits.length)
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`
}

/**
 * NEAR as typed by a person → yoctoNEAR string. toYocto("0.39") → "390000000000000000000000".
 * Never throws, so it is safe on a half-typed field: text that is not an amount gives "0".
 * Digits past the 24th are dropped.
 */
export function toYocto(amount) {
  let text
  if (typeof amount === 'number') text = Number.isFinite(amount) ? plainNumber(amount) : ''
  else text = String(amount ?? '')
  text = text.replace(/[\s_]/g, '')
  // One comma is read as a decimal comma, for people who type "0,5".
  if (!text.includes('.') && text.split(',').length === 2) text = text.replace(',', '.')
  const match = /^(\d*)(?:\.(\d*))?$/.exec(text)
  if (!match || (match[1] === '' && (match[2] ?? '') === '')) return '0'
  const whole = match[1] || '0'
  const fraction = (match[2] ?? '').slice(0, DECIMALS).padEnd(DECIMALS, '0')
  return BigInt(whole + fraction).toString()
}

/** "someone-very-long.testnet" → "someone-very…testnet". Short names are left alone. */
export function shortAccount(accountId, max = 20) {
  const id = String(accountId ?? '')
  const limit = Math.max(12, Math.trunc(Number(max)) || 20)
  if (id.length <= limit) return id
  return `${id.slice(0, limit - 8)}…${id.slice(-7)}`
}

/**
 * Unix seconds → "2 min ago". Under 45 seconds is "just now"; then minutes, hours ("3 h ago")
 * and days ("2 d ago"). A missing time gives ''.
 */
export function timeAgo(tsSeconds, nowMs = Date.now()) {
  const ts = Number(tsSeconds)
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const seconds = Math.max(0, Math.floor(nowMs / 1000 - ts))
  if (seconds < 45) return 'just now'
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}
