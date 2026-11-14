# The Maul Street contract

One contract (`crates/contract`) holds every beast, item, Essence and den share, keeps the players' NEAR, referees every fight and pays out. The fight rules and every price live in `crates/core` and are called from here. On testnet the contract is `maulstreet.testnet`.

Conventions:

- NEAR amounts are decimal strings of yoctoNEAR (`U128`). Times are Unix seconds.
- Beast, match and challenge ids are JSON numbers. They count up from 1.
- Every change method works with a function-call access key and no deposit, except `deposit`, `new` and the NEP-245 transfers.
- A failed call panics with a plain-English sentence the game can show as it is. Apart from `new` and `house_back_den`, a change call from an account that has not registered always fails.

## Money

Each player has a balance inside the contract. `deposit` is the only call that needs the wallet. Everything else spends from the balance, so a key in the browser can pay stakes, fees and prices with no popup. `withdraw` sends NEAR back to the player's own account.

| Call | Does |
|---|---|
| `deposit()` payable → `U128` | Adds the attached NEAR to the caller's balance. The caller must be registered. Returns the new balance |
| `withdraw(amount)` | Takes `amount` off the balance and transfers it to the caller |

The house treasury collects prices (levels, bazaar items, new beasts), fees and den training money. It also pays for the contract's storage.

Every yoctoNEAR the contract holds is in a player's balance, a den's bankroll, the treasury, or in escrow (the stakes of open challenges and unfinished fights). `get_ledger` shows the four sums next to what has been paid in and out. They always match.

## Players and beasts

| Call | Does |
|---|---|
| `register(picks: [u8; 3])` → `PlayerView` | Once per account. `picks` are three different common species (0 to 4). Mints the three beasts at level 1 and gives 100 Essence |
| `level_up(beast_id, with_essence)` → `BeastView` | Takes a beast up one level without waiting for the XP. With NEAR (`with_essence: false`) it costs `rules::level_cost_near(level)` from the balance, and the beast keeps the XP it has. With Essence it costs the XP the beast still lacks, `xp_next - xp`, and its XP starts again from 0. Owner only. There is no top level |
| `rename_beast(beast_id, name)` → `BeastView` | 1 to 24 printable ASCII characters. Owner only |
| `buy_item(item_id, max_price)` → `U128` | Buys one bazaar item at the current price (see below). Fails if the price is above `max_price`. Returns the price paid |
| `buy_beast(species, max_price)` → `BeastView` | Mints a new beast of any species (0 to 9) at its current price |
| `equip(beast_id, item_id)` → `BeastView` | Moves one item from the owner's inventory into the beast's slot for that kind (relic, aura or finisher). Whatever was in the slot goes back to the inventory |
| `unequip(beast_id, kind)` → `BeastView` | Empties a slot (0 relic, 1 aura, 2 finisher) back into the inventory |

### Levels, XP and forms

Every beast has a `level` (it starts at 1 and there is no top) and `xp`, its progress towards the next level, which takes `rules::xp_for_level(level)` XP (`xp_next`). Each level adds 3% of the species' base health, attack, defence and speed (`rules::stat_at_level`). A player who is short of what `level_up` costs is told `Your balance is too low.` or `You don't have enough Essence. This level takes {n}.`, with the number filled in.

A beast earns XP in every fight that ends with a winner: den fights, free or staked, and duels, friendlies included, also when they end by a forfeit or on the clock. A void duel teaches nothing. Each beast of a squad gets `rules::beast_xp(fight_xp, entered, kills)`: all of the fight's XP if it went into the pit, half if it stayed on the bench, and `KILL_XP` more for each beast it knocked out (the `kills` count). `fight_xp` is `rules::den_xp(tier, won, staked)` or `rules::duel_xp(won)`. The XP is added with `rules::add_xp`, which takes the beast up as many levels as it pays for. A hired beast learns like any other: the XP is the beast's, so it goes back to its owner stronger.

As it grows a beast changes form. `form` is `rules::form_of(level)`: 0 to 4, from levels 1, 5, 12, 25 and 50. `form_name` is what its line is called in that form (`data::SPECIES[species].forms[form]`: a Cindermaw starts out as a Cinderpup). Until its owner renames it, a beast's `name` is its `form_name`, so it changes as the beast grows. After `rename_beast` it keeps the name its owner gave it. That name is whatever the owner typed, so escape it before putting it into a page.

Bazaar prices: each item and each species has `heat`, `last_buy` and `sold`. The price is `rules::heated_price(floor, rules::cooled_heat(heat, last_buy, now))`. A purchase sets `heat = rules::heat_after_buy(cooled)` and `last_buy = now`.

## Hiring

| Call | Does |
|---|---|
| `list_for_hire(beast_id, price)` | The owner offers the beast at `price` per fight (at least 0.001 NEAR). Calling it again changes the price |
| `unlist(beast_id)` | Takes the offer down. Fights already paid for stay valid |
| `hire(beast_id, fights)` → `PlayerView` | Pays `price × fights` (1 to 20 fights). 5% goes to the house, the rest to the owner's balance. The hirer may then field the beast in that many fights |

A squad is three different beasts, each owned by the player or hired with at least one fight left. A hired beast loses one fight each time a fight it is fielded in starts. It fights as it is at that moment, so the levels and equipment its owner gives it apply to hirers too, and what it learns in a hirer's fights is its own.

A player can't hire their own beast, and can hold at most 20 paid fights with one beast at a time.

## Fighting a den (the computer)

A player may have one unfinished den fight at a time. Den fights have no clock.

| Call | Does |
|---|---|
| `start_den_fight(den_id, squad: [id; 3], stake)` → `MatchView` | `stake` is `"0"` for a free spar. Otherwise it is a multiple of 0.01 NEAR, at most the den's `max_stake`, and is taken from the balance. The den must be open for a staked fight |
| `den_act(action)` → `MatchView` | The player's action: 0 Strike, 1 Guard, 2 Break, 3 Special, 10/11/12 to send in slot 0/1/2 when it is time to pick, or 20/21/22 to swap the beast in the pit for slot 0/1/2 instead of a move (the beast coming in takes the den's move; no swapping from the 20th turn of a round, when sudden death starts). The contract picks the den's action from `npc::npc_action` with `env::random_seed()` in the same call, plays the step, and keeps stepping while only the den has to act |
| `forfeit_den()` → `MatchView` | Gives up. Counts as a loss |

An action that is not legal right now (a Special without a full Rage bar, a beast that is already down, a swap to the beast already in the pit or during sudden death) fails the call and changes nothing. After `den_act` the fight is either over or waiting for the player: the den never keeps it waiting.

The den's beasts are its fixed species, all three at one level. In a staked fight they match the challenger: the average level of the challenger's three beasts (rounded down). In a free spar they have `rules::den_spar_level(tier)` instead: levels 1, 5, 9, 13 and 17 for tiers 1 to 5, whatever the challenger brings. Either way `rules::den_level_bonus(rules::den_training_levels(training_spent))` is added: one level for every four levels the den's training money has bought, at most four. They carry no relics.

Settlement:

- **Player wins.** Essence `rules::den_essence(tier, true)`. With a stake, the player gets `rules::den_payout(stake, payout_bps)`, where `payout_bps` was fixed when the fight started. The profit comes out of the den's bankroll (never more than the bankroll holds).
- **Player loses.** Essence `rules::den_essence(tier, false)`. With a stake, 10% (`DEN_TRAINING_BPS`) goes to the house as the den's training spend and the rest joins the den's bankroll.
- A staked result is added to the den's ten-fight memory, which sets its next `payout_bps`.
- Every fielded beast gets `fights + 1`, its knockouts (`kills`), `wins + 1` on a win, and its XP (`rules::den_xp(tier, won, staked)`: see Levels, XP and forms).

## Backing a den

Each den has a `bankroll` and a number of `shares`. A share is worth `bankroll / shares`.

| Call | Does |
|---|---|
| `back_den(den_id, amount)` → `U128` | Moves `amount` from the balance into the bankroll and mints shares at the current share value (1 share per yoctoNEAR if there are none). Returns the shares minted |
| `unback_den(den_id, shares)` → `U128` | Burns shares and pays `shares × bankroll / total_shares` to the balance. Returns the amount |
| `house_back_den(den_id, amount)` | Owner only: backs a den from the treasury |

`new` splits its attached deposit evenly across the five dens. The house holds those first shares. (What does not split evenly, at most 4 yoctoNEAR, goes to the treasury.)

Both sums round down, so a backer who cashes out straight away can be a few yoctoNEAR short. A den whose bankroll has been emptied completely while shares are still out can't be backed.

## Duels (player against player)

A player may have one open challenge and one unfinished duel at a time, alongside a den fight.

| Call | Does |
|---|---|
| `create_challenge(squad, stake, level_cap, invite)` → `ChallengeView` | `stake` is `"0"` (a friendly) or at least 0.01 NEAR, taken from the balance and held. `level_cap` of 0 means none: otherwise every beast fights at that level at most (a level 20 beast under a cap of 5 fights as a level 5 one, in its level 5 form). `invite` limits who may accept |
| `cancel_challenge()` | Takes the caller's open challenge down and returns the stake |
| `accept_challenge(id, squad)` → `MatchView` | Takes the same stake from the acceptor and starts the duel. The creator is side 0. The opening clock is 180 seconds |
| `duel_commit(hash)` → `MatchView` | Seals a move. `hash` is the lowercase hex SHA-256 of `"{action}:{salt}"` |
| `duel_reveal(action, salt)` → `MatchView` | Opens the sealed move. Fails until the other side has sealed or opened its move (or has nothing to do this step), so a move is never shown while it can still be countered. An action that is not legal is replaced by Strike (or by the first living beast, when picking) |
| `duel_play(action)` → `MatchView` | An open move with no seal. Allowed when the caller is the only side that has to act, or when the other side has already sealed or opened its move |
| `claim_timeout()` → `MatchView` | After the deadline. See below |
| `forfeit_duel()` → `MatchView` | Concedes. The other side wins |

A challenge names its squad when it is posted, but the fight starts on `accept_challenge`: that is when both squads are checked again, each beast's stats are read, and hired beasts use up a fight. `accept_challenge` fails if the creator can no longer field the squad, or is in the middle of another duel. A creator can post a challenge while still in a duel.

`action` in the hash is the number as plain digits, for example `"2:9f3a61c0"`, `"10:9f3a61c0"` or, for a swap, `"21:9f3a61c0"`. A salt is at most 128 characters. A reveal that comes too early fails with "Wait for the other side to lock in before you open your move." An open move (`duel_play`) has to be legal, or the call fails.

A step plays as soon as every side that has to act has an open move. The seed is the SHA-256 of both salts and `env::random_seed()`. The next deadline is then `now + rules::MOVE_CLOCK_SECS`. A sealed or opened move that does not yet play the step pushes the deadline out to at least `now + rules::MOVE_CLOCK_SECS`, so the other side always has a full clock to answer it. (Without this, a side could seal in the last second and claim the clock before the other had time to open.)

When the clock runs out, a side is stalling if it has to act and has done nothing, or has sealed a move and not opened it although the other side has sealed or opened theirs (or the other side has nothing to do this step). Either duellist may call `claim_timeout`:

- before the opening picks have played: the duel is void and both stakes are returned;
- exactly one side stalling: the other side wins;
- both stalling: void, both stakes returned.

Settlement: the pot is both stakes. The house keeps 3% (`DUEL_RAKE_BPS`) and the winner's balance gets the rest. Ratings move by `rules::ratings_after`. Essence is `rules::duel_essence`. Beasts get fights, knockouts, wins and XP (`rules::duel_xp(won)`) as in den fights. A friendly is settled the same way, with an empty pot. A void duel changes no rating, Essence, XP or beast record.

## Views

| View | Returns |
|---|---|
| `get_player(account_id)` | `PlayerView` (with `registered: false` and empty lists for a stranger) |
| `get_beast(beast_id)` / `get_beasts(ids)` | `BeastView` (null if there is no such beast) / list, in the order asked, leaving out ids that don't exist |
| `get_dens()` | `[DenView; 5]` |
| `get_market()` | `MarketView` |
| `get_hire_market(from_index, limit)` | `[BeastView]`, every beast listed for hire |
| `get_challenges(from_index, limit)` | `[ChallengeView]`, open challenges, newest first |
| `get_match(match_id)` | `MatchView` or null |
| `get_ticker()` | The last 30 things that happened: `[{ts, text}]`, newest first |
| `get_leaderboard(limit)` | `[{account_id, rating, wins, losses, won}]` by rating |
| `get_stats()` | `{players, beasts, den_fights, duels, volume, treasury}` |
| `get_ledger()` | `{balances, bankrolls, escrow, treasury, deposited, withdrawn}`, all `U128`. `balances + bankrolls + escrow + treasury` always equals `deposited - withdrawn`. It reads every player, so it is for audits, not for every frame |

`from_index` and `limit` are numbers and may be left out. A page is at most 100 rows. The leaderboard lists every player, highest rating first (then most duel wins, then account id), 100 rows unless `limit` asks for fewer.

In `get_stats`, `den_fights` and `duels` count fights started, and `volume` is all the NEAR that has changed hands: settled den stakes and duel pots, hire fees, bazaar prices and levels bought with NEAR.

```jsonc
// BeastView
{ "id": 12, "species": 0, "name": "Cinderpup", "owner": "ava.testnet",
  "level": 1, "xp": 0, "xp_next": 100,   // XP towards the next level, and what that level takes
  "form": 0, "form_name": "Cinderpup",   // 0 to 4. `name` is `form_name` until the owner renames the beast
  "relic": 0, "aura": 0, "finisher": 0,
  "stats": [410, 78, 48, 62], "power": 270,   // health, attack, defence, speed at its level, with its relic. No level cap
  "kills": 0, "fights": 0, "wins": 0,
  "hire_price": null,            // or a U128 when listed
  "earned": "0" }                // lifetime hire income, after the house's cut

// PlayerView
{ "account_id": "ava.testnet", "registered": true,
  "balance": "0", "essence": 100, "rating": 1000,
  "wins": 0, "losses": 0, "den_wins": 0, "den_losses": 0,
  "won": "0",                    // lifetime total of the payouts of fights won (duels and staked den fights)
  "hire_income": "0",            // after the house's cut
  "beasts": [ /* BeastView */ ],
  "items": [[1, 2], [20, 1]],    // [item id, count], not counting what the beasts wear
  "hires": [{ "beast": { /* BeastView */ }, "fights_left": 3 }],
  "den_match": null, "duel": null, "challenge": null,   // ids
  "backing": [{ "den": 0, "shares": "0", "value": "0" }] }   // only the dens the player holds shares in

// DenView
{ "id": 0, "name": "Old Grist", "title": "The Brawler", "style": 0, "tier": 1, "squad": [2, 0, 1],
  "bankroll": "0", "shares": "0", "open": true, "max_stake": "0", "payout_bps": 18000,
  "wins": 0, "fights": 0,        // of its last ten staked fights
  "total_wins": 0, "total_losses": 0,   // every fight it has finished, staked or free
  "training_spent": "0",
  "training_levels": 0,          // levels its training money has bought (rules::den_training_levels)
  "level_bonus": 0,              // levels that puts its beasts up (rules::den_level_bonus)
  "spar_level": 1,               // its beasts' level in a free spar, before the bonus
  "reason": "…" }

// MarketView
{ "items":   [{ "id": 1, "price": "0", "floor": "0", "heat": 0, "sold": 0, "reason": "…" }],
  "species": [{ "id": 0, "price": "0", "floor": "0", "heat": 0, "sold": 0, "reason": "…" }] }

// ChallengeView
{ "id": 3, "creator": "ava.testnet", "stake": "0", "level_cap": 0, "invite": null,
  "squad": [{ "token": 12, "species": 0, "level": 1, "power": 270 }],   // level and power as it would fight, under the level cap
  "created": 1794300000 }

// MatchView
{ "id": 7, "kind": "den",        // or "duel"
  "players": ["ava.testnet", "den:0"],
  "den": 0,                      // null in a duel
  "stake": "0", "level_cap": 0,
  "payout_bps": 18000,           // the den's payout when the fight started (also in a free spar); 0 in a duel
  "battle": { /* maul_core::battle::Battle as JSON */ },
  "need": [true, true],
  "sealed": [false, false],      // duel: this side has a sealed move waiting to be opened
  "open": [false, false],        // duel: this side's move is already open
  "deadline": 0,                 // 0 in a den fight
  "steps": [                     // the last 4 played steps, oldest first
    { "turn": 1, "events": [ /* maul_core::battle::Event */ ] } ],
  "last_events": [ /* maul_core::battle::Event */ ],   // everything the latest call made happen
  "over": false, "winner": null, // 0 or 1; stays null for a void duel
  "void": false,
  "payout": "0",                 // what the winner was paid, once over
  "essence": [0, 0],             // Essence each side earned, once over
  "xp": [[0, 0, 0], [0, 0, 0]],  // XP each beast earned, by side and slot, once over (zeros for a den's beasts)
  "levels": [[0, 0, 0], [0, 0, 0]] }   // each beast's level with that XP counted (0 until then, and for a den's beasts)
```

In `battle`, each fighter has `level`, the level it fights at in this match (under a duel's level cap), and `entered`, whether it has been in the pit yet. `levels` is each beast's real level once the fight's XP is in. A client that knows the level a beast had before the fight can show a level-up, and a change of form when `rules::form_of` of the two differs.

`den_match` and `duel` in `PlayerView` keep pointing at the player's last fight after it ends, so its result can still be read. A finished den fight is deleted when its player starts the next one. A finished duel is deleted once both duellists have started new duels. After that `get_match` returns null for it.

`steps` lets a client that polls replay what it missed. `turn` is `battle.turn` after that step. One `den_act` that also plays the den's next pick adds two entries. `last_events` is all the events of the latest call: the events of the steps it played, or just `[{"e":"over","winner":n}]` after a forfeit or a win on the clock, or `[]` after a duel is voided. A forfeit or a timeout is not a step and adds nothing to `steps`.

`payout`: in a duel, the pot less the house's 3%. After a staked den fight the player won, the stake plus the profit. After one the den won, the part of the stake that joined its bankroll (the stake less the training tenth).

## The ticker

`get_ticker` lines are plain sentences. NEAR is written with up to 2 decimals, or 3 for an amount under 0.005:

- `ava.testnet won 0.09 NEAR from Old Grist` / `Old Grist took 0.05 NEAR from ava.testnet` (staked den fights; the win shows the whole payout)
- `ava.testnet won 0.39 NEAR from theo.testnet` / `theo.testnet beat ava.testnet in a friendly duel` / `The duel between ava.testnet and theo.testnet was called off`
- `ava.testnet is looking for a fight for 0.1 NEAR` / `… for a friendly duel` / `ava.testnet called out theo.testnet for 0.1 NEAR`
- `theo.testnet hired ava.testnet's Cinderpup for 3 fights (0.03 NEAR)` (the beast's `name`)
- `Old Grist has closed its doors` / `Old Grist is open for stakes again`
- `ava.testnet bought a rare Ashwyrm for 1.2 NEAR` (the species' name, though the new beast is a level 1 Sparkwyrm)

## NEP-245

Token ids: `beast:{id}` (one each), `item:{id}`, `essence` and `den:{id}` (den shares).

Implemented: `mt_transfer`, `mt_batch_transfer` (1 yoctoNEAR attached, as the standard requires), `mt_balance_of`, `mt_batch_balance_of`, `mt_supply`, `mt_token`, `mt_tokens_for_owner`, and the `mt_mint`, `mt_burn` and `mt_transfer` events. Approvals and `mt_transfer_call` are not implemented: a transfer that names an approval fails.

Transferring a beast takes down its hire offer. Fights already paid for stay valid.

- The receiver of a transfer must be a registered player.
- A beast changes hands with whatever it wears.
- An item a beast wears is part of the beast, not of its owner's `item:{id}` balance or of the supply. `equip` logs an `mt_burn` for it and `unequip` an `mt_mint`.
- The house's den shares are held under the contract's own account id.
- Essence won and spent in play is not logged as events. Only an Essence transfer is. Read Essence with `mt_balance_of` or `get_player`.
- `mt_tokens_for_owner(account_id, from_index, limit)` lists a player's beasts, then items, Essence and den shares. `owner_id` is set for beasts and null for the rest. For the contract's own account it lists the den shares the house holds.
