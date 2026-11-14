# Maul Street: the game on paper

Written before any code, as the track brief asks, and kept true as the build changed. If the build and this page disagree, the page is wrong and gets fixed.

## The game in one breath

Maul Street is a 3D beast-fighting pit where every fang has a price. You raise a stable of beasts from cubs, send three into the pit, and fight another player's three for testnet NEAR. One beast each in the pit at a time, and every beast has an aspect: hit the aspect yours beats and it does double damage, hit the one that beats it and it does half. Any turn you can swap in another of your three instead of moving. When a beast is knocked out, the winner's beast stays in, hurt, and the loser picks who goes next. Lose all three and you lose the pot.

NEAR is the real money of the Street. A connected testnet wallet pays stakes and collects pots, hire fees and den dividends. After one approval, every move in the game is signed silently by a key in the browser that can only call the game, so there are no popups in normal play.

## Who it is for

Anyone who has enjoyed raising a creature or winning a fight, at any age. The first fight takes thirty seconds to understand: three moves, each beating another, and a ring of five aspects where water puts out fire and lightning shocks water. A child can love a cub and watch it grow up. People who like markets get a second game on top: hiring out champions, backing house fighters and timing the bazaar. There is no blood: a beast that is losing looks tired (head down, panting, sweating), and a knocked-out beast faints and sees stars.

## The beasts

Ten lines of beasts, two for each of the five aspects. Every beast starts as a cub at level 1 and never stops growing. As it levels it changes form, body and name:

| Form | From level | What changes |
|---|---|---|
| Cub | 1 | Small, big-eyed, its features only buds |
| Prowler | 5 | Longer legs, features half grown |
| Alpha | 12 | The full-grown beast |
| Dread | 25 | Heavier, armoured, glowing harder |
| Mythic | 50 | Crowned. The reward for a long road |

So the ten lines are fifty beasts to grow into: Cinderpup becomes Emberjaw, Cindermaw, Blazemaw and at last Solarmaw. There is no top level. Each level adds 3% of the line's base health, attack, defence and speed.

A beast levels up three ways:

- **By fighting.** Every beast in a squad earns XP whenever a fight ends, against the house or against a player, win or lose. Winning, tougher dens, NEAR on the line and knockouts all earn more. It levels up by itself.
- **By feeding it Essence.** Every fight also pays the trainer Essence, which can be fed to any beast in place of the XP it still needs.
- **With testnet NEAR.** The next level can be bought outright. Each costs 10% more than the last.

## The fight

Both players choose at the same moment. Nobody sees the other's choice until both are locked.

| Move | What it does | Beats | Loses to |
|---|---|---|---|
| **Strike** | Fast hit | Break (interrupts it) | Guard (blocked and countered) |
| **Guard** | Brace and counter. Halves a Special | Strike | Break (guard crushed) |
| **Break** | Slow, heavy hit that crushes a guard | Guard | Strike |
| **Special** | The beast's signature attack. Needs a full Rage bar. Leaves a lasting effect | Trades up against everything | Guard halves it and stops the effect |

- **Rage** fills as a beast deals and takes damage. A full bar unlocks the Special, shown in slow motion.
- **Aspects** form a ring: Ember burns Thorn, Thorn splits Stone, Stone grounds Storm, Storm shocks Tide, Tide douses Ember. Hitting the aspect you beat does double damage; hitting the one that beats you does half. So the right beast in the pit matters as much as the right move.
- **Swap** instead of a move: call your beast back and send in another of your living three. The one coming in takes your rival's move this turn (a Guard against a swap does nothing). Both moves are sealed at once, so a swap is a read too: swap in your counter just as they Strike, and it takes a Strike it shrugs off. From the 20th turn of a round (sudden death: every hit doubles) nobody may swap, so a round always ends.
- **Specials** leave a mark by aspect: Burn (Ember), Leech (Thorn), Sunder (Stone), Shock (Storm), Soak (Tide).
- **Critical hits** leave the target winded: it loses a little health for two turns.
- **Winner stays.** After a knockout the winner's beast gets a second wind (15% health back) and keeps part of its Rage. The loser sees it and picks a counter.

## The three loops

### Every 30 seconds: read and strike

| The player does | They get |
|---|---|
| Picks one of four moves, or swaps in a better match-up, while the opponent picks theirs | The exchange plays out at once: hits, blocks, a counter, a beast running in to take the blow |
| Watches the opponent's Rage bar and habits | A read: "they always guard when my Rage is full, so I'll Break" |
| Fires a Special or lands the finishing blow | A slow-motion finisher, and the round |

### Every 5 minutes: decide

| Moment | The decision |
|---|---|
| A beast falls | Who goes in next? The winner's beast is hurt and you know its aspect: send in the one that beats it |
| The match-up turns bad | Stay and fight, or spend a turn to swap in a beast that beats theirs |
| A fight ends | XP lands on the squad, and sometimes a beast levels up or changes form. Take the pot to your wallet, or spend it: a level for a beast, a relic, a hired champion |
| Looking for the next fight | A tougher house fighter for more XP, or a real player for NEAR? At what stake? |
| A den is winning | Back it and share its winnings, or go and take its money |

### Every session: raise a stable that pays

- **Grow them.** Carry a favourite from cub to mythic, or spread the XP across a squad that covers the aspect ring.
- **Hire and be hired.** List a beast at your own price per fight. Whoever hires it pays you, and it keeps the XP it earns while away. A higher-level beast earns a higher fee, so levels are an investment.
- **Collect.** Relics change how a beast fights. Auras and finishers change how it looks, and a finisher how a knockout sounds (thunder, golden bells, a red moon). Bazaar prices rise when people buy and cool when they don't.
- **Back a den.** Each house fighter has its own bankroll. Put NEAR behind one and you own a share of everything it wins, and loses.
- **Meet people.** Your trainer card, your rivals and your callouts live on NEAR Social. Follow someone, see their stable, call them out, and settle it in the pit.

## Where NEAR moves

| From | To | When |
|---|---|---|
| Both players | The winner | A duel ends. Each staked the same amount; the winner takes the pot less a 3% house cut |
| A hirer | The beast's owner | A beast is hired, per fight. The house keeps 5% |
| A challenger | A den's bankroll | The challenger loses a staked den fight |
| A den's bankroll | A challenger | The challenger wins a staked den fight |
| A den's bankroll | Its backers | A backer cashes out shares at the bankroll's current value |
| A player | The house | Bought levels, bazaar purchases and new beasts |

Fighting a den without a stake never pays NEAR. It pays XP and Essence.

## The house fighters (computer-run, and labelled so)

Five dens, each run by the contract with its own on-chain bankroll and its own way of fighting:

| Den | Style | Spars at level | What it teaches |
|---|---|---|---|
| Old Grist | Brawler: swings first | 1 | Guard and counter |
| Mother Thorne | Wall: guards and counters | 5 | Break a guard |
| Coin-Eyed Vesh | Gambler: loves the heavy hit | 9 | Interrupt with Strike |
| The Auditor | Reader: counters the move you use most | 13 | Mix it up |
| Madam Ruin | Closer: plays the odds | 17 | Everything at once |

In a free spar a den's beasts have the fixed level of its tier, so levelling a squad is how a trainer climbs to the tougher dens, which pay more. In a staked fight the den matches the challenger's level instead, so the odds are about skill, not spending.

A den's rules live in one readable file (`crates/core/src/rules.rs`), and the game shows the reasoning:

- It never risks more than 5% of its bankroll on one fight.
- It pays between 1.5× and 2× on a staked win. A den that has been winning raises its payout to tempt challengers. A den that has been losing cuts it.
- A tenth of what it wins is spent on training. Every four levels of training put its beasts one level above their challenger, up to four.
- Below 0.5 NEAR it closes until someone backs it.

Nobody patches these numbers. They move because players win, lose, back and cash out. "Watch a week go by" in the game runs the same file in the browser to show it.

## What is on chain

Everything that matters. One contract holds every beast, relic, Essence and den share as NEP-245 tokens. It also holds the stakes, runs every fight from the moves it is sent, awards the XP and pays out.

- **Against a den**, the contract picks the den's move with NEAR's random seed in the same transaction as the player's move, so neither side can see the other's first.
- **Against a player**, each move is committed as a hash and then revealed, so nobody can wait and copy.
- A player who stops answering loses on the clock.

The same Rust rules file is compiled twice: into the contract, and into a small WebAssembly module the browser uses for practice fights and for explaining prices. The two can't drift apart.
