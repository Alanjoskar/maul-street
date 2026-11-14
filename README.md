# Maul Street

A 3D beast-fighting game on NEAR testnet. You raise a stable of beasts from cubs, send three into the pit, and fight another player's three for testnet NEAR. One beast each in the pit at a time. Every beast has one of five aspects in a ring (water puts out fire, lightning shocks water, and so on): it hits the aspect it beats for double damage and the one that beats it for half, and any turn you can swap in another of your three instead of a move. After a knockout the winner's beast stays in, hurt, and the loser picks who goes next. The contract referees every move, holds the stakes, awards the XP and pays the winner.

Beasts level up without limit, by fighting or with testnet NEAR, and change form as they grow: ten lines, five forms each, fifty beasts to grow into.

Built for the NEAR HACKATHON, track **Games With Real Economies** (`games`).

- Play it in the browser: [alanjoskar.github.io/maul-street](https://alanjoskar.github.io/maul-street/) (a practice fight needs no wallet; everything else uses a testnet account)
- Demo film (2:20, 1920×1080, real play on testnet): [docs/maul-street-demo.mp4](docs/maul-street-demo.mp4)
- Contract: [`maulstreet.testnet`](https://testnet.nearblocks.io/address/maulstreet.testnet)
- Game design on one page: [GAME_LOOP.md](GAME_LOOP.md)
- Contract interface: [docs/CONTRACT.md](docs/CONTRACT.md)

## The problem

A fighting game played for money needs a referee neither player controls, and it has to stay a game: a wallet popup before every punch kills it. Renting out a strong character, or backing a house fighter, also needs someone to hold the money and split it by rules nobody can change afterwards.

## What it does

| Do this | See this |
|---|---|
| Open the game and press **Practice a fight** | Pick three of five beasts and fight a house fighter at once. Nothing is on chain. Four moves: Strike beats Break, Break beats Guard, Guard beats Strike. A full Rage bar unlocks the beast's Special, shown in slow motion. Aspects decide a lot: each beats the next round the ring (Ember, Thorn, Stone, Storm, Tide) for double damage and takes half from it, so any turn you can swap in a better beast instead of a move. The tray says which of yours has the edge. There is no blood: a beast running low on health looks tired, and a knocked-out beast faints and sees stars |
| Press **Connect testnet wallet** and approve once | The wallet adds a key to your account that can only call this game. From here on, moves, purchases and stakes are signed in the browser with no popups |
| Draft three cubs | Three level-1 beasts are minted to your account as NEP-245 tokens, with 100 Essence |
| Press **+** on your balance and deposit testnet NEAR | The one step that opens the wallet. The NEAR is now your balance inside the contract |
| **The Pit → House fighters → Spar** | A free fight against a computer-run den. The den's move is picked on chain with NEAR's random seed in the same transaction as yours. Every beast in your squad earns XP, win or lose, and you earn Essence |
| Keep fighting, or open the **Stable** and buy a level with NEAR or Essence | The beast levels up: 3% more health, attack, defence and speed per level, with no top level. At levels 5, 12, 25 and 50 it changes form: a new body and a new name (Cinderpup, Emberjaw, Cindermaw, Blazemaw, Solarmaw) |
| **The Pit → Fight for NEAR** against a den | Your stake is held. Win and the den's bankroll pays you 1.5× to 2×. Lose and the stake joins its bankroll |
| **Back this den** | You own a share of that den's bankroll, and of everything it wins and loses |
| **Bazaar**: buy a relic, aura or finisher | The price rises 4% of its floor with every purchase and cools every ten quiet minutes. The reason is written under the price |
| **Stable**: list a beast for hire at your price | Another player can pay you per fight to field it. You keep 95% |
| **The Pit → Duels**: post a challenge with a stake, or accept one | Both stakes are held. Each move is sealed as a hash, then opened, so nobody can wait and copy. The winner gets the pot less 3%. A player who stops answering loses on the clock |
| **The Street**: turn on NEAR Social | One approval adds a key for NEAR Social's data. Set your trainer name, follow rivals, call someone out, read the feed of fights |
| **The Pit → Watch a week go by** | A labelled simulation runs the contract's own rules file in the browser: a week of fights, payouts, den closures and backers in about a minute |

## How NEAR is used

| NEAR feature | What it does here |
|---|---|
| Function-call access keys | One wallet approval, then every move is signed silently by a key that can only call `maulstreet.testnet`. A second key is limited to NEAR Social's `__fastdata_kv` method |
| A contract as referee | The fight engine runs on chain. The browser sends a move; the contract plays the step and returns what happened |
| `env::random_seed` | The den's move is rolled inside the same transaction as the player's, so neither can see the other's first |
| Commit and reveal | In a duel each move is a SHA-256 hash first and the plain move second. The seed mixes both players' salts with the chain's random seed |
| NEP-245 | Beasts, items, Essence and den shares are multi tokens in the one contract (`mt_transfer`, `mt_batch_transfer`, balances and events) |
| Named accounts | Players are their NEAR account names everywhere: challenges, hire listings, the leaderboard |
| NEAR Social (`social-kv/1`) | Profiles, follows and posts are written with near.social's standard as `__fastdata_kv` calls to `social`, on testnet, and read back from FastData KV. The same code points at near.social's mainnet indexer by changing two settings |
| Fast finality | A move confirms in a second or two, which the fight hides behind the wind-up of the exchange |

## The economy

- **Computer-run fighters with their own money.** Each of the five dens has an on-chain bankroll. It never risks more than 5% of it on a fight, pays between 1.5× and 2× depending on how its last ten staked fights went, spends a tenth of its winnings on training, and closes below 0.5 NEAR until someone backs it. Its reasoning is shown in the game as a sentence.
- **Markets the players own.** Hire prices are set by owners. Den shares are bought and cashed out at the bankroll's current value. Challenges are posted at any stake.
- **Prices that move without a patch.** Bazaar prices heat and cool with demand. Each level costs 10% more than the last. Den payouts and stake limits follow their bankroll and their recent record.
- **One readable rules file.** Every price and payout is in [`crates/core/src/rules.rs`](crates/core/src/rules.rs). The contract calls it to charge and pay, and the browser calls the same code (compiled to WebAssembly) to show the number and the reason.

Where NEAR moves: between duellists (pot to the winner), from hirer to owner, between challengers and a den's bankroll, from a bankroll to its backers, and to the house for bought levels, items and new beasts. Fighting a den without a stake never pays NEAR. It pays XP and Essence.

In a free spar each den's beasts have a fixed level (1, 5, 9, 13, 17), so levelling a squad is how a trainer climbs to the tougher dens. In a staked fight the den matches the challenger's level, so the odds are about skill, not spending. A hired beast keeps the XP it earns while away.

## What is in the repository

| Path | What it is |
|---|---|
| `crates/core` | The rules, with no chain code: the fight engine (`battle.rs`), how the dens choose moves (`npc.rs`), every price and payout (`rules.rs`), and the cast (`data.rs`) |
| `crates/contract` | The NEAR contract: balances, NEP-245 tokens, the bazaar, hiring, dens and backing, duels |
| `crates/browser` | `crates/core` compiled for the browser: practice fights, stat previews, price and den reasoning, the week simulation |
| `web/src/game` | The 3D game (three.js): beasts grown from code, the pit, particles and light, the fight director and its heads-up display |
| `web/src/near` | RPC, the silent signer, wallet connect (NEAR Connect), NEAR Social, and the `api` the menus use |
| `web/src/ui` | The menus: title, draft, stable, pit, bazaar, hire, the Street |
| `tools/audio` | The music and every sound effect, synthesized in Python. No samples |
| `scripts` | End-to-end and smoke tests against testnet |

Every beast, texture, animation, sound and piece of music is generated by code in this repository. There are no downloaded models, images or audio files.

## Run it

Needs Node 20 or newer.

```bash
cd web
npm install
npm run dev
```

Open the address Vite prints. The game talks to the deployed contract `maulstreet.testnet`. To use another deployment, add `?contract=your-contract.testnet` to the address.

Useful links while testing:

- `/?fight=practice&squad=0,2,3&den=1&level=12` goes straight into a practice fight with level-12 beasts.
- `/?quality=low` (or `medium`, `high`) fixes the graphics level. Without it the game starts at medium and steps down by itself if frames come too slowly.
- `/?view=line&id=0` shows the five forms of one line side by side. `/?view=beast&id=7&level=25` shows one beast.
- `/?week` opens the week simulation.

## Build and test

Needs Rust 1.96 with the `wasm32-unknown-unknown` target (pinned in `rust-toolchain.toml`) and `cargo-near`.

```bash
# The rules: fight engine, den behaviour, prices
cargo test -p maul-core

# The contract's unit tests (on Windows from a long folder path, set a short CARGO_TARGET_DIR first: see scripts/README.md)
cargo test -p maul-contract

# The transaction signer never sends a move twice (no network needed)
node scripts/signer-once.mjs

# The rules module for the browser
cargo build -p maul-browser --target wasm32-unknown-unknown --release
cp target/wasm32-unknown-unknown/release/maul_browser.wasm web/public/maul_core.wasm

# The contract
cd crates/contract && cargo near build non-reproducible-wasm --no-abi
```

Deployment and the end-to-end run against testnet are described in [scripts/README.md](scripts/README.md).

## Honest limits

- **Testnet only.** Nothing here has been deployed to mainnet or audited.
- **Wallet approval needs a person.** The connect flow is written against NEAR Connect and the silent key path is tested end to end, but the wallet's own approval popup cannot be clicked by a script. In the demo film the page is handed the player's game key at that point, as the wallet would have added it; everything after it is real play on testnet between two accounts made for the film, `maul-rhea.testnet` and `maul-kito.testnet`.
- **NEAR Social on testnet has no indexer.** near.social's own site and API cover mainnet, so on testnet the game reads the raw FastData KV store and builds the feed itself. Posts made here do not appear on near.social.
- **Two players can collude** to move NEAR between themselves through a duel. They could also just send it. Ratings gained this way are not prevented.
- **The contract pays for storage** from its own balance, which is fine on testnet and would need a storage deposit on mainnet.
- **Graphics scale with the machine.** On integrated graphics the game steps down to its low level, which drops bloom and some lights.

## Libraries, tools and AI use

- [three.js](https://threejs.org) for rendering.
- [@hot-labs/near-connect](https://github.com/hot-dao/near-connect) for wallet connection.
- [@noble/ed25519](https://github.com/paulmillr/noble-ed25519) and [@noble/hashes](https://github.com/paulmillr/noble-hashes) for signing.
- [near-sdk-rs](https://github.com/near/near-sdk-rs) for the contract.
- Fonts: Bebas Neue, Barlow and Barlow Condensed (SIL Open Font License), through Fontsource.
- [Vite](https://vite.dev) to build, [Playwright](https://playwright.dev) for browser tests.
- The code, art, sound and this document were written with Claude Code (an AI coding agent) under the direction of the entrant. All of it was written during the hackathon window.
- The demo film was captured frame by frame from the running game with Playwright. Its narration is synthesized with [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache-2.0) and checked with [faster-whisper](https://github.com/SYSTRAN/faster-whisper). The film's tools are not part of the game.

## License

[MIT](LICENSE)
