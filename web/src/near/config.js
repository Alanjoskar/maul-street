// Where Maul Street lives on NEAR. Testnet only.
//
// The game contract defaults to maulstreet.testnet. A page can point at another
// deployment with `?contract=some-account.testnet`, and a build can with the
// VITE_MAUL_CONTRACT environment variable. This file also loads in Node (tests),
// where there is no page and no Vite.

const ACCOUNT_ID = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/

function validAccount(value) {
  return typeof value === 'string' && value.length >= 2 && value.length <= 64 && ACCOUNT_ID.test(value) ? value : null
}

function fromPage() {
  try {
    if (typeof window === 'undefined' || !window.location) return null
    return validAccount(new URLSearchParams(window.location.search).get('contract'))
  } catch {
    return null
  }
}

function fromBuild() {
  // Vite fills in `import.meta.env`. In Node it is undefined.
  const env = import.meta.env
  const built = validAccount(env && env.VITE_MAUL_CONTRACT)
  if (built) return built
  try {
    if (typeof process !== 'undefined' && process.env) return validAccount(process.env.VITE_MAUL_CONTRACT)
  } catch {
    // No process object in a browser.
  }
  return null
}

const contract = fromPage() || fromBuild() || 'maulstreet.testnet'

export const CONFIG = {
  network: 'testnet',
  contract,
  rpc: ['https://test.rpc.fastnear.com', 'https://rpc.testnet.fastnear.com', 'https://near-testnet.drpc.org'],
  kv: 'https://kv.test.fastnear.com',
  socialReceiver: 'social',
  explorer: 'https://testnet.nearblocks.io',
  hashtag: 'maulstreet',
}

/** True for a well-formed NEAR account id (2 to 64 characters). */
export function isAccountId(value) {
  return validAccount(value) !== null
}
