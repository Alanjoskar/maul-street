# Maul Street audio

Every sound in the game is made by the code in this folder: no samples, no soundfonts, nothing downloaded. Seeds are fixed, so a rebuild gives the same audio.

## Rebuild

```
python tools/audio/build.py --out web/public/audio --ffmpeg path/to/ffmpeg
```

Needs Python with numpy and scipy, and an ffmpeg built with libmp3lame (used only to encode the music and to measure loudness). A full build takes about eleven minutes on a busy machine and under 1 GB of memory (the pieces are performed one instrument at a time to keep it there).

| Command | Does |
|---|---|
| `build.py --check` | Prints each piece's form, chords, hook and timing, and checks the written notes for clashes against the bass. Renders nothing |
| `build.py --only battle,coin,hit_light ...` | Re-renders some tracks or effects. `music` and `sfx` select a whole group |
| `build.py --verify ...` | Measures the files already on disk and rewrites the manifest. Renders nothing |
| `build.py --report file.txt ...` | Also writes the measurement report to a file |
| `build.py --film-dir folder ...` | Where the film score's lossless copy and timing map go (default `tools/audio/film`, which git ignores) |

The build fails (exit code 1) if a file is missing, clips, has DC, is the wrong format or length, if a sound does not measure like what it is meant to be (a roar's energy between 80 and 600 Hz, a hit's attack under 100 ms, a hiss between 3 and 8 kHz, and so on), or if the game's code in `web/src` asks for a sound or track that is not in the manifest.

## What is where

| File | Holds |
|---|---|
| `dsp.py` | Oscillators, noise, filters, envelopes, a plucked-string model, generated reverb, compressor, true-peak limiter, loudness meter |
| `instruments.py` | The band: oud, santur, reed, brass, strings, choir, basses, hand drums, war drums, metal |
| `music.py` | The five pieces written as notes on a sixteenth-note grid, the mixer and the master chain, the clash check, the timing map |
| `sfx.py` | The 56 effects, and the creature voice (a rough pulse train through moving formants) |
| `verify.py` | Measurements: spectrum, envelope, pitch, loudness, the loop seam |
| `build.py` | Renders, encodes, measures, writes `manifest.json` |

## The music

| Piece | What it is |
|---|---|
| `street.mp3` | The hub. 98 BPM, 32 bars, D Phrygian. Loops |
| `battle.mp3` | The fight. 140 BPM, 48 bars, D minor with the flat second and the raised seventh. Loops |
| `victory.mp3`, `defeat.mp3` | Stingers made from the battle hook. Play once |
| `film.mp3` | A 140 s score for the demo film, built from the same themes. Not used by the game |

## How the music loops

`street.mp3` and `battle.mp3` are written so the last bar leads into the first, and the reverb and echo tails of the end are wrapped onto the start. Each file holds the loop with half a second of its own end before it and half a second of its own start after it. The player loops the region `loopStart` to `loopEnd` from the manifest. Because the audio around that region is the loop itself, the join stays seamless even when a decoder shifts the file by the MP3 encoder delay. To loop a track outside the game, cut that region first:

```
ffmpeg -ss 0.5 -t <loopLength> -i street.mp3 -c:a pcm_s16le street_loop.wav
```

## The film score

`film.mp3` changes speed with its sections so that every section starts on a bar line at a round second: an opening at 0 s, the street theme at 14 s, a build at 58 s, the battle theme at 78 s with big hits at 96 s and 120 s, a fanfare at 128 s, the last chord at 132 s and silence by 140 s. The build also writes `tools/audio/film/film.wav` (24-bit) and `film_timing.json` with the tempo of each section, the time of every downbeat and the moments worth cutting to. The same timing is in `manifest.json` under `music.film.timing`, and `build.py --check` prints it.

## The mix

Effects are all normalised to a peak of -3 dBFS, so the file level says nothing about how loud a sound should be in the game. Each effect's `gain` in `sfx.py` (copied to the manifest, applied by `web/src/audio.js`) is its place in the mix: a hover tick at 0.3, a knockout blow at 1.0. An effect with a `duck` value pushes the music down by that fraction while it sounds, so a roar does not have to fight the battle theme. Music is mastered to about -16 LUFS with true peaks under -1 dBTP.

Stereo is kept for the sounds where width is the point (the crowd, the gong, weather, the knockout blow, the finishers). The rest are mono and are placed by the `pan` the game passes.

## Adding an effect

Write a function in `sfx.py` under `@sound("name", gain=..., group=...)` that returns mono or stereo audio, then run `build.py --only name`. Names ending in `_1`, `_2` ... are variants: the player picks one at random when asked for the name without the number.
