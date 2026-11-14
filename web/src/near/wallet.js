// Connecting a player's own NEAR testnet wallet, through NEAR Connect.
//
// Connecting asks the wallet, once, to add a key to the player's account that can
// only call the game contract and can never move NEAR. That key is kept on this
// device, so every move after it is signed here with no popup. The wallet is asked
// again for two things only: a deposit (it attaches NEAR) and the NEAR Social key.

import { CONFIG, isAccountId } from './config.js'
import { accessKey, accountExists, generateKey, hasKey, keyAllows, publicKeyOf, readOutcome } from './chain.js'
import { store } from './storage.js'

const SESSION = 'maul-session'
const SOCIAL_KEY = 'maul-social-key'
const CONNECTOR_PREFIX = 'maul-nc:'

/** Gas the game key may spend from the player's own NEAR over its lifetime: 1 NEAR. */
const GAME_ALLOWANCE = '1000000000000000000000000'
/** Gas the NEAR Social key may spend: 0.25 NEAR. */
const SOCIAL_ALLOWANCE = '250000000000000000000000'
const DEPOSIT_GAS = '30000000000000'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ----- What is kept on this device -------------------------------------------------------------------

function readKeys(name) {
  const saved = store.getJson(name)
  if (!saved || typeof saved !== 'object') return null
  const { accountId, publicKey, secretKey } = saved
  if (!isAccountId(accountId) || typeof publicKey !== 'string' || typeof secretKey !== 'string') return null
  try {
    if (publicKeyOf(secretKey) !== publicKey) return null
  } catch {
    return null
  }
  const keys = { accountId, publicKey, secretKey }
  // Set by the test hook api._useSession: this key was handed in, and no wallet stands behind it.
  if (saved.local === true) keys.local = true
  return keys
}

/** The session saved on this device: { accountId, publicKey, secretKey }, or null. */
export function savedSession() {
  return readKeys(SESSION)
}

export function saveSession({ accountId, publicKey, secretKey, local }) {
  store.setJson(SESSION, local === true ? { accountId, publicKey, secretKey, local: true } : { accountId, publicKey, secretKey })
}

/** Forgets the game key on this device. The wallet stays signed in. */
export function forgetSession() {
  store.remove(SESSION)
}

/** The NEAR Social key saved on this device: { accountId, publicKey, secretKey }, or null. */
export function savedSocialKey() {
  return readKeys(SOCIAL_KEY)
}

export function saveSocialKey({ accountId, publicKey, secretKey }) {
  store.setJson(SOCIAL_KEY, { accountId, publicKey, secretKey })
}

export function forgetSocialKey() {
  store.remove(SOCIAL_KEY)
}

// ----- NEAR Connect ------------------------------------------------------------------------------------

/** NEAR Connect's own notes, kept under a prefix so nothing else on this origin clashes with them. */
const connectorStorage = {
  async get(key) {
    return store.get(CONNECTOR_PREFIX + key)
  },
  async set(key, value) {
    store.set(CONNECTOR_PREFIX + key, value)
  },
  async remove(key) {
    store.remove(CONNECTOR_PREFIX + key)
  },
}

let loading = null

/** NEAR Connect is loaded the first time a player asks for their wallet. */
function connector() {
  if (!loading) {
    loading = import('@hot-labs/near-connect').then(async (module) => {
      const NearConnector = module.NearConnector || (module.default && module.default.NearConnector)
      if (!NearConnector) throw new Error('NEAR Connect did not load.')
      const made = new NearConnector({
        network: CONFIG.network,
        features: { signAndSendTransaction: true, testnet: true },
        storage: connectorStorage,
      })
      await made.whenManifestLoaded
      return made
    })
    loading.catch(() => {
      loading = null
    })
  }
  return loading
}

async function loadConnector() {
  if (typeof window === 'undefined') throw new Error('A wallet can only be connected in a browser.')
  try {
    return await connector()
  } catch {
    throw new Error('The wallet chooser could not load. Check your connection and try again.')
  }
}

/** What a wallet said when it refused, as a plain sentence. */
function walletSentence(error, doing) {
  const text = typeof error === 'string' ? error : (error && (error.message || error.error)) || ''
  if (/reject|cancel|closed|denied|declin|abort|dismiss/i.test(text)) return `${doing} was cancelled.`
  if (/wallet not found|no wallet/i.test(text)) return 'That wallet is not available here. Choose another one.'
  if (/no accounts? found|not signed in|failed to sign in/i.test(text)) return 'Your wallet did not share an account. Try again.'
  if (/popup|pop-up|blocked/i.test(text)) return 'Your browser blocked the wallet window. Allow pop-ups for this page and try again.'
  const plain = String(text).trim()
  return plain && plain.length <= 160 ? `${doing} did not go through: ${plain.replace(/[.\s]+$/, '')}.` : `${doing} did not go through. Try again.`
}

async function waitForKey(accountId, publicKey, tries) {
  for (let i = 0; i < tries; i++) {
    try {
      if (await hasKey(accountId, publicKey)) return true
    } catch {
      // The network blinked. Keep looking.
    }
    await sleep(700)
  }
  return false
}

async function firstAccount(wallet) {
  const accounts = await wallet.getAccounts({ network: CONFIG.network })
  return (accounts && accounts[0] && accounts[0].accountId) || null
}

/** The wallet the player connected with, signed in again if it has let go. */
async function connectedWallet(accountId) {
  const made = await loadConnector()
  let wallet = null
  try {
    wallet = await made.wallet()
  } catch {
    // The wallet is not signed in on this device any more.
  }
  if (!wallet) {
    try {
      wallet = await made.connect()
    } catch (error) {
      throw new Error(walletSentence(error, 'The wallet connection'))
    }
  }
  let current = null
  try {
    current = await firstAccount(wallet)
  } catch {
    current = null
  }
  if (!current) throw new Error('Your wallet did not share an account. Try again.')
  if (current !== accountId) {
    throw new Error(`Your wallet is signed in as ${current}, but the game is connected as ${accountId}. Switch accounts in your wallet, or disconnect and connect again.`)
  }
  return wallet
}

/**
 * Signs in with the player's wallet and makes sure the game key is on their account.
 * `onProgress(text)` is told what is happening. Resolves with { accountId, publicKey, secretKey }.
 * Throws an Error with a plain sentence when the player cancels or the wallet fails.
 */
export async function connectWallet(onProgress) {
  const say = (text) => {
    try {
      if (typeof onProgress === 'function') onProgress(text)
    } catch {
      // The caller's own display failed. Carry on.
    }
  }

  const saved = savedSession()
  if (saved) {
    say(`Checking ${saved.accountId}…`)
    // A network failure throws here: without the chain there is nothing to connect to.
    const key = await accessKey(saved.accountId, saved.publicKey)
    if (keyAllows(key, CONFIG.contract)) return saved
    store.remove(SESSION)
  }

  say('Opening the wallet chooser…')
  const made = await loadConnector()
  const key = generateKey()

  say('Choose your wallet and approve the connection…')
  let wallet
  try {
    wallet = await made.connect({
      addFunctionCallKey: {
        contractId: CONFIG.contract,
        publicKey: key.publicKey,
        allowMethods: { anyMethod: true },
        gasAllowance: { kind: 'limited', amount: GAME_ALLOWANCE },
      },
    })
  } catch (error) {
    throw new Error(walletSentence(error, 'The wallet connection'))
  }

  let accountId = null
  try {
    accountId = await firstAccount(wallet)
  } catch {
    accountId = null
  }
  if (!accountId) throw new Error('Your wallet did not share an account. Try again.')
  if (accountId === CONFIG.contract) throw new Error("That is the game's own account. Connect a player's account instead.")
  if (!(await accountExists(accountId))) {
    throw new Error(`${accountId} is not a ${CONFIG.network} account. Switch your wallet to ${CONFIG.network} and try again.`)
  }

  say('Adding the game key to your account…')
  if (!(await waitForKey(accountId, key.publicKey, 10))) {
    // Some wallets sign in without adding the key. Ask for it on its own.
    say('Approve the game key in your wallet…')
    let refused = null
    try {
      await wallet.signAndSendTransaction({
        receiverId: accountId,
        actions: [
          {
            type: 'AddKey',
            params: {
              publicKey: key.publicKey,
              accessKey: { permission: { receiverId: CONFIG.contract, methodNames: [], allowance: GAME_ALLOWANCE } },
            },
          },
        ],
      })
    } catch (error) {
      refused = error
    }
    say('Waiting for the game key…')
    if (!(await waitForKey(accountId, key.publicKey, refused ? 4 : 25))) {
      if (refused) throw new Error(walletSentence(refused, 'Adding the game key'))
      throw new Error('Your wallet did not add the game key. Try again, or choose another wallet.')
    }
  }

  const session = { accountId, publicKey: key.publicKey, secretKey: key.secretKey }
  saveSession(session)
  return session
}

/**
 * A wallet-signed `deposit` on the game contract with `yocto` yoctoNEAR attached.
 * Resolves with the call's outcome: { ok, value, error, hash, … } as chain.js reports it.
 * Throws an Error with a plain sentence when the wallet or the contract refuses.
 */
export async function walletDeposit(yocto) {
  const session = savedSession()
  if (!session) throw new Error('Connect your wallet first.')
  const amount = BigInt(yocto)
  if (amount <= 0n) throw new Error('Enter an amount of NEAR to deposit.')
  const wallet = await connectedWallet(session.accountId)
  let outcome
  try {
    outcome = await wallet.signAndSendTransaction({
      signerId: session.accountId,
      receiverId: CONFIG.contract,
      actions: [{ type: 'FunctionCall', params: { methodName: 'deposit', args: {}, gas: DEPOSIT_GAS, deposit: amount.toString() } }],
    })
  } catch (error) {
    throw new Error(walletSentence(error, 'The deposit'))
  }
  const result = readOutcome(outcome)
  if (!result.ok && result.included) throw new Error(result.error)
  return result
}

/**
 * Asks the wallet to add a key that can only call `__fastdata_kv` on `social`:
 * posting and following without a popup. Resolves once the key is on the account.
 */
export async function walletAddSocialKey(publicKey) {
  const session = savedSession()
  if (!session) throw new Error('Connect your wallet first.')
  const wallet = await connectedWallet(session.accountId)
  let refused = null
  try {
    await wallet.signAndSendTransaction({
      signerId: session.accountId,
      receiverId: session.accountId,
      actions: [
        {
          type: 'AddKey',
          params: {
            publicKey,
            accessKey: { permission: { receiverId: CONFIG.socialReceiver, methodNames: ['__fastdata_kv'], allowance: SOCIAL_ALLOWANCE } },
          },
        },
      ],
    })
  } catch (error) {
    refused = error
  }
  if (!(await waitForKey(session.accountId, publicKey, refused ? 4 : 25))) {
    if (refused) throw new Error(walletSentence(refused, 'Turning on NEAR Social'))
    throw new Error('Your wallet did not add the NEAR Social key. Try again.')
  }
}

/**
 * Forgets the wallet on this device and signs out of it. The keys that were added to
 * the account stay there: they can only call the game and NEAR Social, never move NEAR.
 */
export async function disconnectWallet() {
  store.remove(SESSION)
  store.remove(SOCIAL_KEY)
  // Only wake NEAR Connect up if it was used: it remembers the chosen wallet under its prefix.
  if (typeof window === 'undefined' || (!loading && !store.get(`${CONNECTOR_PREFIX}selected-wallet`))) return
  try {
    const made = await connector()
    await made.disconnect()
  } catch {
    // No wallet was signed in.
  }
  store.remove(`${CONNECTOR_PREFIX}selected-wallet`)
}
