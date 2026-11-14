// A regression test for the signer: a move must never be sent twice.
//
//   node scripts/signer-once.mjs
//
// The network is faked. The first node takes the signed bytes and never answers (so they may
// be on their way); the second refuses them as "nonce already used" (the sign that they went
// through); and no node can be asked what became of them. The call must then be reported as
// unconfirmed, never signed again with a new nonce: a second signature is a second move.

import { CONFIG } from '../web/src/near/config.js'
import * as chain from '../web/src/near/chain.js'

const A = 'http://node-a.test'
const B = 'http://node-b.test'
CONFIG.rpc.splice(0, CONFIG.rpc.length, A, B)
chain.resetNodes()

const sent = [] // every signed payload offered to a node
let keyNonce = 100 // the access key's nonce as the fake chain knows it
const blockHash = '11111111111111111111111111111111' // 32 zero bytes in base58

globalThis.fetch = async (url, options) => {
  const { method, params } = JSON.parse(options.body)
  const reply = (body) => ({ status: 200, text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, ...body }) })
  if (method === 'query') return reply({ result: { nonce: keyNonce, permission: 'FullAccess', block_height: 1, block_hash: blockHash } })
  if (method === 'block') return reply({ result: { header: { hash: blockHash, height: 1 } } })
  if (method === 'send_tx' || method === 'broadcast_tx_commit') {
    const bytes = params.signed_tx_base64 ?? params[0]
    sent.push({ url, bytes })
    if (url === A) {
      // Took the bytes (they run, so the key's nonce moves on) and lost the answer.
      if (!sent.slice(0, -1).some((s) => s.bytes === bytes)) keyNonce += 1
      throw new TypeError('fetch failed')
    }
    return reply({
      error: {
        name: 'HANDLER_ERROR',
        code: -32000,
        message: 'Server error',
        cause: { name: 'INVALID_TRANSACTION', info: {} },
        data: { TxExecutionError: { InvalidTxError: { InvalidNonce: { tx_nonce: 101, ak_nonce: 101 } } } },
      },
    })
  }
  if (method === 'tx') throw new TypeError('fetch failed') // nobody can say what became of them
  throw new Error(`unexpected ${method}`)
}

const secret = 'ed25519:' + '3'.repeat(60) // any well-formed key: nothing real is signed
let signer
try {
  signer = new chain.Signer('someone.testnet', chain.generateKey().secretKey)
} catch {
  signer = new chain.Signer('someone.testnet', secret)
}
const outcome = await signer.call('game.testnet', 'duel_play', { action: 1 })
const distinct = new Set(sent.map((s) => s.bytes)).size

console.log(`offered ${sent.length} time(s), ${distinct} distinct signed payload(s); ok=${outcome.ok} unknown=${outcome.unknown} code=${outcome.code}`)
if (distinct !== 1) {
  console.log('FAIL: the call was signed again, so it could have happened twice')
  process.exit(1)
}
if (!outcome.unknown) {
  console.log('FAIL: the call should be reported as unconfirmed, so the game checks the chain before doing anything else')
  process.exit(1)
}
console.log('PASS: signed once, reported as unconfirmed')
