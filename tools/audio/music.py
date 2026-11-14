"""
music.py -- the Maul Street score.

Five pieces, all in D so they can cross-fade into each other and sit with the
tuned effects (gong, bell, horn call, UI chimes):

  street   the hub: 98 BPM, lightly swung, D Phrygian with a harmonic-minor V
  battle   the pit: 140 BPM, D minor with the flat second and the raised seventh
  victory  a stinger made from the head and the cadence of the battle hook
  defeat   the head of the hook turned upside down, falling into bare fifths
  film     a 140-second score for the demo film, built from the same themes,
           with every section change on a bar line at a round second

Each piece is written as notes on a sixteenth-note grid (bar, position), so the
same data can be printed and checked (`build.py --check`) or performed. A
rhythm of three, three and two (the "tresillo") runs through both hooks, the
bass lines, the drums and the stingers: it is the game's rhythmic signature.
"""
from __future__ import annotations

import numpy as np

import instruments as I
from dsp import (F, SR, balance, compress, convolve, db, duck_env, eq, highpass, limit, lowpass, lufs, make_ir, midi,
                 note_name, nsamp, pan, periodic, place, rng, sat, to_db, widen)

STRONG = (0, 8)          # beats 1 and 3, in sixteenths


class Song:
    """One piece: its grid, the notes written on it, and (when performed) its stems.

    `only` chooses what is actually synthesised: None renders every stem, () renders
    nothing (the score is still written, for the checks), ('lead',) renders one stem.
    A piece is performed one stem at a time to keep the memory small; the random
    draws are made in the same order every time, so each pass is the same performance.

    `tempo` is for a piece that changes speed: [(first bar, BPM, swing), ...]."""

    def __init__(self, name, title, bpm, bars, key, loop=True, swing=0.5, tail=0.0, only=None, tempo=None):
        self.name, self.title, self.bpm, self.bars, self.key = name, title, bpm, bars, key
        self.loop, self.swing = loop, swing
        self.only = None if only is None else tuple(only)
        self.tempo = list(tempo) if tempo else [(1, bpm, swing)]
        self._len = np.zeros(bars + 2)
        self._swing = np.zeros(bars + 2)
        for i, (first, speed, swung) in enumerate(self.tempo):
            last = self.tempo[i + 1][0] - 1 if i + 1 < len(self.tempo) else bars
            self._len[first:last + 1] = 240.0 / speed
            self._swing[first:last + 1] = swung
        self._start = np.concatenate([[0.0], np.cumsum(self._len[1:bars + 1])])     # _start[k]: seconds at the start of bar k + 1
        self.seconds = float(self._start[bars])
        exact = self.seconds * SR
        self.loop_n = int(round(exact))
        if loop and abs(exact - self.loop_n) > 1e-6:
            raise ValueError(f"{name}: a bar is not a whole number of samples at {bpm} BPM")
        self.n = self.loop_n + (0 if loop else nsamp(tail))
        self.stems: dict = {}
        self.stem_names: list = []   # every stem the piece uses, in order of first use
        self.notes: list = []        # (part, start in 16ths from bar 1, length in 16ths, midi pitch)
        self.lines: dict = {}        # phrase-rendered parts: stem -> [(seconds, seconds, midi, velocity)]
        self.chart: dict = {}        # bar -> [(position, chord symbol)]
        self.sections: list = []     # (name, first bar, last bar, what happens)
        self.kicks: list = []        # seconds of the hits the pads duck under
        self.hook: list = []         # lines of text describing the hook
        self.allowed: list = []      # (bar, position, reason) dissonances that are meant
        self.events: list = []       # (bar, position, what): moments worth cutting pictures to
        self.R = rng("song", name)

    # --- time -----------------------------------------------------------
    def bar_len(self, bar):
        return float(self._len[min(max(int(bar), 1), self.bars)])

    def bar_start(self, bar):
        bar = int(bar)
        if bar < 1:
            return (bar - 1) * float(self._len[1])
        if bar > self.bars:
            return self.seconds + (bar - self.bars - 1) * float(self._len[self.bars])
        return float(self._start[bar - 1])

    def t(self, bar, pos=0.0):
        """Seconds at (bar, position in sixteenths). Odd sixteenths are swung late.
        Positions of 16 and more run on into the following bars."""
        bar = int(bar) + int(pos // 16)
        pos = pos % 16
        swing = float(self._swing[min(max(bar, 1), self.bars)])
        off = (2.0 * swing - 1.0) * (1.0 - abs((pos % 2.0) - 1.0))
        return self.bar_start(bar) + (pos + off) * self.bar_len(bar) / 16.0

    def d(self, sixteenths, bar=1):
        """Length in seconds of some sixteenths at the speed of `bar`."""
        return sixteenths * self.bar_len(bar) / 16.0

    # --- writing ----------------------------------------------------------
    def section(self, name, first, last, what):
        self.sections.append((name, first, last, what))

    def chords(self, bar, *symbols):
        """One symbol for the bar, or two for its halves, or explicit (position, symbol) pairs."""
        if symbols and isinstance(symbols[0], tuple):
            self.chart[bar] = list(symbols)
        elif len(symbols) == 1:
            self.chart[bar] = [(0, symbols[0])]
        else:
            self.chart[bar] = [(0, symbols[0]), (8, symbols[1])]

    def chord_at(self, bar, pos):
        return [name for p, name in self.chart[bar] if p <= pos][-1]

    def mark(self, part, bar, pos, length, pitch):
        self.notes.append((part, (bar - 1) * 16.0 + pos, float(length), midi(pitch)))

    def wants(self, stem):
        """Registers the stem and says whether this pass is rendering it."""
        if stem not in self.stem_names:
            self.stem_names.append(stem)
        return self.only is None or stem in self.only

    def put(self, stem, sig, when, gain=1.0, where=0.0):
        buf = self.stems.get(stem)
        if buf is None:
            buf = self.stems[stem] = np.zeros((self.n, 2), dtype=np.float32)
        sig = np.asarray(sig, dtype=F)
        sig = pan(sig, where) if sig.ndim == 1 else balance(sig, where)
        place(buf, sig, int(round(when * SR)), gain, loop=self.loop)

    def jit(self, sigma):
        return float(self.R.normal(0.0, sigma)) if sigma else 0.0

    def vel(self, v, spread=0.06):
        return float(np.clip(v * (1.0 + self.R.normal(0.0, spread)), 0.05, 1.0))


# ---------------------------------------------------------------------------
# performing helpers
#
# Each helper makes its random draws (velocity, take, timing) whether or not the
# stem is being rendered in this pass, so that every pass plays identically.
# ---------------------------------------------------------------------------

def notes(song, stem, fn, bar, items, part=None, gain=1.0, where=0.0, human=0.004, hold=0.92, **kw):
    """Pitched single notes. items = [(position, length in 16ths, pitch, velocity)]."""
    active = song.wants(stem)
    for pos, length, pitch, v in items:
        song.mark(part or stem, bar, pos, length, pitch)
        vv, take, late = I.bucket(song.vel(v), 16), int(song.R.integers(3)), song.jit(human)
        if active:
            sig = fn(midi(pitch), I.bucket(song.d(length, bar) * hold, 40), vv, take, **kw)
            song.put(stem, sig, song.t(bar, pos) + late, gain, where)


def shots(song, stem, fn, bar, items, part=None, gain=1.0, where=0.0, human=0.003, mark=True, **kw):
    """Pitched one-shots with no length argument (stabs, bow strokes). items = [(position, pitch, velocity)]."""
    active = song.wants(stem)
    for pos, pitch, v in items:
        if mark:
            song.mark(part or stem, bar, pos, 1.0, pitch)
        vv, take, late = I.bucket(song.vel(v), 16), int(song.R.integers(3)), song.jit(human)
        if active:
            song.put(stem, fn(midi(pitch), vv, take, **kw), song.t(bar, pos) + late, gain, where)


def hits(song, stem, fn, bar, items, gain=1.0, where=0.0, human=0.004, kick=False, **kw):
    """Unpitched hits. items = [(position, velocity)]."""
    active = song.wants(stem)
    for pos, v in items:
        vv, take, late = I.bucket(song.vel(v), 16), int(song.R.integers(4)), song.jit(human)
        when = song.t(bar, pos) + late
        if kick:
            song.kicks.append(when)
        if active:
            song.put(stem, fn(vv, take, **kw), when, gain, where)


def line(song, stem, bar, items, part=None):
    """Queue notes for a phrase-rendered lead. items = [(position, length, pitch, velocity)]."""
    song.wants(stem)
    for pos, length, pitch, v in items:
        song.mark(part or stem, bar, pos, length, pitch)
        song.lines.setdefault(stem, []).append((song.t(bar, pos), song.d(length, bar), midi(pitch), v))


def flush_lines(song, renderers):
    """Render every queued lead, one phrase (notes closer than 0.35 s) at a time."""
    for stem, queued in song.lines.items():
        if not song.wants(stem):
            continue
        fn, kw = renderers[stem]
        queued = sorted(queued)
        phrase = []
        for item in queued + [None]:
            if item is not None and (not phrase or item[0] - (phrase[-1][0] + phrase[-1][1]) < 0.35):
                phrase.append(item)
                continue
            start = phrase[0][0] - 0.02
            length = phrase[-1][0] + phrase[-1][1] - start + 0.6
            local = [(s - start, dd, p, v) for s, dd, p, v in phrase]
            song.put(stem, fn(local, nsamp(length), seed=(song.name, stem, round(start, 3)), **kw), start)
            phrase = [item] if item is not None else []


def chord(song, stem, fn, bar, pos, length, pitches, v, part=None, gain=1.0, hold=1.0, **kw):
    """A held chord on a sustained instrument."""
    active = song.wants(stem)
    for k, pitch in enumerate(pitches):
        song.mark(part or stem, bar, pos, length, pitch)
        if active:
            sig = fn(midi(pitch), I.bucket(song.d(length, bar) * hold, 20), I.bucket(v, 16), k % 3, **kw)
            song.put(stem, sig, song.t(bar, pos), gain)


def swell_into(song, stem, bar, sixteenths, v):
    """A reversed cymbal that ends exactly on the downbeat of `bar`."""
    if song.wants(stem):
        length = song.d(sixteenths, bar - 1)
        song.put(stem, I.swell(I.bucket(length, 20), bar % 3), song.t(bar, 0) - length, v)


# ---------------------------------------------------------------------------
# mixing and mastering
# ---------------------------------------------------------------------------

def _echoes(x, delay_s, feedback, count, cutoff, loop):
    """Ping-pong echoes: each repeat is quieter, darker and on the other side."""
    n = x.shape[0]
    mono = x.mean(axis=1)
    out = np.zeros_like(x)
    shift = int(round(delay_s * SR))
    cur = mono
    for k in range(1, count + 1):
        cur = lowpass(cur, cutoff, 1) * feedback
        rolled = np.roll(cur, k * shift)
        if not loop:
            rolled[: min(n, k * shift)] = 0.0
        out[:, k % 2] += rolled
        out[:, (k + 1) % 2] += 0.35 * rolled
    return out


def produce(name, report=None):
    """Perform, mix and master one piece. Returns (the written song, stereo audio).

    The piece is performed one stem at a time. Each stem is brought to its loudness
    target (so the balance is set by ear-like units, not by how hot an instrument
    happens to be), ducked under the big drum hits if asked, and sent to the room
    and the echo. The sum then goes through the master chain."""
    compose, setup = TRACKS[name]
    plan = compose(only=())
    mix = setup["mix"]
    n = plan.n
    total = np.zeros((n, 2))
    rev_in = np.zeros((n, 2), dtype=np.float32)
    echo_in = np.zeros((n, 2), dtype=np.float32) if setup.get("echo") else None
    wrap = (lambda fn, x: periodic(fn, x, 1.5)) if plan.loop else (lambda fn, x: fn(x))
    rows = []
    for stem in plan.stem_names:
        if stem not in mix:
            raise KeyError(f"{name}: stem {stem!r} has no place in the mix")
        song = compose(only=(stem,))
        buf = song.stems.pop(stem, None)
        I.clear_cache()
        if buf is None:
            continue
        spec = mix[stem]
        if spec.get("eq"):
            buf = wrap(lambda x, bands=spec["eq"]: eq(x, bands), buf)
        measured = lufs(buf)
        buf *= db(spec["lufs"] - measured)
        if spec.get("duck"):
            buf *= duck_env(n, plan.kicks, depth=spec["duck"], release=0.14, loop=plan.loop)[:, None]
        total += buf
        if spec.get("send"):
            rev_in += buf * spec["send"]
        if spec.get("echo") and echo_in is not None:
            echo_in += buf * spec["echo"]
        rows.append((stem, spec["lufs"], measured, to_db(np.max(np.abs(buf)))))
        if report is not None and report.get("tap"):
            report["tap"](stem, buf)             # for diagnostics: the balanced stem
        del buf, song
    room = make_ir(**setup["room"])
    total += convolve(rev_in, room, loop=plan.loop)[:n]
    del rev_in
    if echo_in is not None:
        e = setup["echo"]
        total += _echoes(echo_in, plan.d(e["sixteenths"], e.get("bar", 1)), e.get("feedback", 0.4), e.get("count", 4),
                         e.get("cutoff", 2400.0), plan.loop)
        del echo_in
    if setup.get("width"):
        total = widen(total, setup["width"])     # a little more side signal; the bass stays in the middle
    if setup.get("tilt"):
        total = wrap(lambda x: eq(x, setup["tilt"]), total)
    if report is not None:
        report["stems"] = rows
        report["premaster_lufs"] = lufs(total)
    box = [total]
    del total                                    # hand the only reference to the master, so it can let go of it
    out = master(box.pop(), plan.loop, setup["target"], setup["ceiling"], setup["comp"], setup["drive"])
    if setup.get("ends"):
        out = _stinger_ends(out, *setup["ends"])
    return plan, out


def master(x, loop, target=-16.0, ceiling=-2.0, comp=(-12.0, 1.8), drive=0.6):
    """Rumble filter, gentle bus compression, a touch of saturation, then make-up
    gain into a true-peak limiter until the loudness target is met."""
    wrap = (lambda fn, y: periodic(fn, y, 2.0, 0.5)) if loop else (lambda fn, y: fn(y))
    x = wrap(lambda y: highpass(y, 28.0, 2), x)
    x *= db(-14.0 - lufs(x))
    x = wrap(lambda y: compress(y, threshold=comp[0], ratio=comp[1], attack=0.03, release=0.25, knee=8.0), x)
    if drive:
        step = 1 << 18
        for i in range(0, x.shape[0], step):     # in place, a slice at a time: no second copy of a long piece
            x[i:i + step] = sat(x[i:i + step] * 1.6, drive) / 1.6
    x *= db(target - lufs(x))
    out = x
    for _ in range(6):
        out = wrap(lambda y: limit(y, ceiling), x)
        off = target - lufs(out)
        if abs(off) < 0.04:
            break
        del out
        x *= db(off)
    return out


def _stinger_ends(x, seconds, fade_s):
    """Cut a piece that ends to its length with a long, eased fade so the room dies naturally."""
    n = min(x.shape[0], nsamp(seconds))
    out = x[:n].copy()
    k = nsamp(fade_s)
    ramp = 0.5 + 0.5 * np.cos(np.pi * np.arange(k) / k)
    out[-k:] *= (ramp ** 1.5)[:, None]
    lead = nsamp(0.003)
    out[:lead] *= np.linspace(0.0, 1.0, lead)[:, None]
    return out


# ---------------------------------------------------------------------------
# STREET -- the hub: the notes
# ---------------------------------------------------------------------------

STREET_HOOK = {
    "a": [(0, 3, "D4"), (3, 3, "F4"), (6, 2, "G4"), (8, 2, "A4"), (10, 1, "G4"), (11, 3, "F4"), (14, 2, "G4"), (16, 6, "A4")],
    "a'": [(0, 3, "D4"), (3, 3, "F4"), (6, 2, "G4"), (8, 2, "A4"), (10, 1, "G4"), (11, 3, "F4"), (14, 2, "Eb4"), (16, 6, "D4")],
    "a''": [(0, 3, "A4"), (3, 3, "C5"), (6, 2, "D5"), (8, 2, "Eb5"), (10, 1, "D5"), (11, 3, "C5"), (14, 2, "Bb4"), (16, 6, "A4")],
    "b": [(0, 3, "D5"), (3, 3, "C5"), (6, 2, "Bb4"), (8, 2, "A4"), (10, 1, "G4"), (11, 3, "F4"), (14, 2, "Eb4"), (16, 8, "D4")],
}
STREET_PICKUPS = {"to_a": [(28, 2, "A3"), (30, 2, "C4")], "to_a''": [(28, 2, "F4"), (30, 2, "G4")], "to_b": [(28, 2, "A4"), (30, 2, "C#5")]}

STREET_PAD = {
    "Dm": ["D3", "A3", "D4", "F4"], "Eb": ["Eb3", "Bb3", "Eb4", "G4"], "A": ["E3", "A3", "C#4", "E4"],
    "Gm": ["D3", "Bb3", "D4", "G4"], "Bb": ["D3", "Bb3", "D4", "F4"], "A7": ["E3", "A3", "C#4", "G4"],
}
STREET_SANTUR = {
    "Dm": ["D5", "A4", "F5"], "Eb": ["Eb5", "Bb4", "G4"], "A": ["E5", "A4", "C#5"], "Gm": ["D5", "G4", "Bb4"],
    "Bb": ["D5", "F4", "Bb4"], "A7": ["E5", "A4", "C#5"],
}
STREET_BASS = {
    "dm": ([(0, 3, "D2", .9), (3, 3, "D2", .7), (6, 2, "D2", .75), (8, 3, "D2", .88), (12, 2, "F2", .75), (14, 2, "Eb2", .8)],
           [(0, 3, "D2", .9), (3, 1, "D3", .6), (6, 2, "A2", .72), (8, 2, "C3", .78), (10, 2, "D3", .8), (12, 2, "A2", .75), (14, 2, "C3", .8)]),
    "up": ([(0, 3, "D2", .9), (3, 3, "D2", .7), (6, 2, "D2", .75), (8, 3, "Eb2", .88), (12, 2, "Eb2", .75), (14, 2, "Bb2", .8)],
           [(0, 3, "A2", .9), (3, 1, "A3", .6), (6, 2, "E3", .72), (8, 2, "A3", .8), (10, 2, "G3", .76), (12, 2, "A1", .78), (14, 2, "C#2", .82)]),
}
STREET_B_BASS = {
    17: [(0, 3, "G2", .9), (3, 3, "G2", .7), (6, 2, "G2", .75), (8, 3, "G2", .88), (12, 2, "Bb2", .75), (14, 2, "A2", .8)],
    18: [(0, 3, "G2", .9), (3, 1, "G3", .6), (6, 2, "D3", .72), (8, 2, "F3", .78), (10, 2, "G3", .8), (12, 2, "Bb2", .75), (14, 2, "C3", .8)],
    19: [(0, 3, "D2", .9), (3, 3, "D2", .7), (6, 2, "D2", .75), (8, 3, "D2", .88), (12, 2, "F2", .75), (14, 2, "Eb2", .8)],
    20: [(0, 3, "D2", .9), (3, 1, "D3", .6), (6, 2, "F2", .72), (8, 3, "D2", .85), (12, 2, "C3", .75), (14, 2, "A2", .8)],
    21: [(0, 3, "Bb2", .9), (3, 3, "Bb2", .7), (6, 2, "Bb2", .75), (8, 3, "Bb2", .88), (12, 2, "D3", .75), (14, 2, "F3", .8)],
    22: [(0, 3, "Eb2", .9), (3, 3, "Eb2", .7), (6, 2, "Eb2", .75), (8, 3, "Eb2", .88), (12, 2, "G2", .75), (14, 2, "Bb2", .8)],
    23: [(0, 3, "A2", .9), (3, 3, "A2", .7), (8, 3, "A2", .88), (12, 2, "E3", .75), (14, 2, "C#3", .8)],
    24: [(0, 3, "A2", .9), (3, 1, "A3", .6), (6, 2, "E3", .72), (8, 2, "A3", .8), (10, 2, "G3", .76), (12, 2, "A1", .8), (14, 2, "C#2", .85)],
}
STREET_B_OUD = {
    17: [(0, 3, "G3"), (3, 3, "D4"), (6, 2, "G4"), (10, 2, "Bb4"), (12, 2, "G4"), (14, 2, "D4")],
    18: [(0, 3, "G3"), (3, 3, "D4"), (6, 2, "G4"), (10, 2, "Bb4"), (12, 2, "G4"), (14, 2, "D4")],
    19: [(0, 3, "D3"), (3, 3, "A3"), (6, 2, "D4"), (10, 2, "F4"), (12, 2, "D4"), (14, 2, "A3")],
    20: [(0, 3, "D3"), (3, 3, "A3"), (6, 2, "F3"), (10, 2, "F4"), (12, 2, "D4"), (14, 2, "A3")],
    21: [(0, 3, "Bb3"), (3, 3, "F3"), (6, 2, "Bb3"), (10, 2, "D4"), (12, 2, "F4"), (14, 2, "D4")],
    22: [(0, 3, "Eb3"), (3, 3, "Bb3"), (6, 2, "Eb4"), (10, 2, "G4"), (12, 2, "Eb4"), (14, 2, "Bb3")],
    23: [(0, 3, "A2"), (3, 3, "E3"), (8, 2, "A3"), (10, 2, "C#4"), (12, 2, "E4"), (14, 2, "G4")],
    24: [(0, 3, "A3"), (3, 3, "C#4"), (6, 2, "E4"), (12, 2, "E4"), (14, 2, "G4")],
}
STREET_B_REED = {
    17: [(0, 6, "Bb4", .8), (6, 2, "A4", .7), (8, 4, "G4", .78), (12, 2, "Bb4", .72), (14, 2, "A4", .72)],
    18: [(0, 8, "G4", .8), (10, 2, "D4", .65), (12, 2, "F4", .7), (14, 2, "G4", .75)],
    19: [(0, 6, "A4", .82), (6, 2, "G4", .7), (8, 4, "F4", .78), (12, 2, "A4", .72), (14, 2, "G4", .72)],
    20: [(0, 6, "F4", .8), (6, 2, "Eb4", .7), (8, 4, "D4", .78), (12, 2, "A4", .74), (14, 2, "C5", .8)],
    21: [(0, 6, "D5", .9), (6, 2, "C5", .78), (8, 4, "Bb4", .82), (12, 2, "D5", .8), (14, 2, "C5", .78)],
    22: [(0, 4, "Bb4", .82), (4, 2, "G4", .72), (6, 2, "Bb4", .8), (8, 8, "Eb5", .95)],
    23: [(0, 6, "C#5", .92), (6, 2, "Bb4", .8), (8, 8, "A4", .85)],
    24: [(2, 2, "E4", .68), (4, 2, "G4", .74), (6, 6, "A4", .82)],
}
# What the reed answers in the second bar of each hook unit (a, a', a'', b)
STREET_ANSWERS = [
    [(4, 2, "D4", .68), (6, 2, "F4", .74), (8, 2, "D4", .72), (10, 2, "A3", .66)],
    [(4, 2, "A4", .72), (6, 2, "C5", .78), (8, 4, "A4", .74)],
    [(4, 2, "E4", .7), (6, 2, "C#4", .7), (8, 2, "E4", .74), (10, 2, "G4", .78)],
    [(4, 4, "F4", .74), (8, 4, "D4", .7)],
]


# --- the street band: what each player does in a bar ---------------------------

def street_hook_chords(s, first):
    """Harmony under the 8-bar hook: i for four bars, i - bII, V, i (bII on the last beat), i."""
    for k in range(4):
        s.chords(first + k, "Dm")
    s.chords(first + 4, "Dm", "Eb")
    s.chords(first + 5, "A")
    s.chords(first + 6, (0, "Dm"), (12, "Eb"))
    s.chords(first + 7, "Dm")


def street_bass_unit(s, first, kind, level=1.0):
    """Two bars of the bass ostinato: 'dm' on the tonic, 'up' for the i - bII - V bars."""
    for k, items in enumerate(STREET_BASS[kind]):
        notes(s, "bass", I.bass_round, first + k, [(p, l, n, v * level) for p, l, n, v in items], hold=0.8, human=0.003)


def street_hook(s, first, name, pickup, ornament=False, level=1.0, with_reed=False):
    """One two-bar unit of the hook on the oud, with its pickup into the next unit."""
    for pos, length, pitch in STREET_HOOK[name]:
        accent = 0.9 if pos in (0, 8, 16) else 0.76
        long_note = length >= 6
        if ornament and long_note:
            # tremolo: the plectrum keeps the long note alive in thirty-second notes
            notes(s, "oud", I.oud, first, [(pos, 2, pitch, accent * level)], where=-0.12, part="oud")
            reps = int((length - 2) * 2)
            trem = [(pos + 2 + 0.5 * k, 0.5, pitch, (0.42 + 0.3 * k / max(reps - 1, 1)) * level) for k in range(reps)]
            for tp, tl, tpitch, tv in trem:
                vv, take, late = I.bucket(s.vel(tv), 16), int(s.R.integers(3)), s.jit(0.003)
                if s.wants("oud"):
                    s.put("oud", I.oud(midi(tpitch), I.bucket(s.d(tl, first) * 1.6, 40), vv, take), s.t(first, tp) + late, 1.0, -0.12)
            s.mark("oud", first, pos + 2, length - 2, pitch)
        else:
            notes(s, "oud", I.oud, first, [(pos, length, pitch, accent * level)], where=-0.12, hold=1.0)
        if with_reed:
            line(s, "reed", first, [(pos, length, pitch, 0.8 if pos in (0, 8, 16) else 0.7)])
    if ornament:
        notes(s, "oud", I.oud, first, [(0, 3, note_name(midi(STREET_HOOK[name][0][2]) - 12), 0.6 * level)], where=-0.12, part="oud low")
    if pickup:
        notes(s, "oud", I.oud, first, [(p, l, n, 0.7 * level) for p, l, n in STREET_PICKUPS[pickup]], where=-0.12)


def street_pad(s, bar, v, bright=1.0):
    entries = s.chart[bar]
    for i, (pos, sym) in enumerate(entries):
        end = entries[i + 1][0] if i + 1 < len(entries) else 16
        chord(s, "pad", I.pad, bar, pos, end - pos, STREET_PAD[sym], v, bright=bright, attack=0.35 if pos else 0.5, release=0.6)


def street_santur(s, bar, v):
    """A three-against-four shimmer on chord tones."""
    for k, pos in enumerate((0, 3, 6, 9, 12, 15)):
        sym = s.chord_at(bar, pos)
        top, mid, low = STREET_SANTUR[sym]
        pitch = (top, mid, top, low, top, mid)[k]
        if pos == 15:
            ahead = (s.chart.get(bar + 1) or s.chart[1])[0][1]
            if ahead != sym:
                continue             # the harmony is about to move: leave the last note out rather than ring across it
            if sym == "Dm":
                pitch = "G4"         # the bass passes through Eb or C here: G sits well over both
        notes(s, "santur", I.santur, bar, [(pos, 2, pitch, v * (1.0 if k % 2 == 0 else 0.8))], where=0.55, human=0.005)


def maqsum(s, bar, level=1.0, ghosts=True, boom=False):
    """The hand-drum groove of the hook sections: dum tek . tek dum . tek ."""
    hits(s, "dum", I.dum, bar, [(0, .95 * level), (8, .85 * level)], kick=True, human=0.003)
    hits(s, "tek", I.tek, bar, [(2, .7 * level), (6, .8 * level), (12, .85 * level)], where=0.2)
    hits(s, "tek", I.tek, bar, [(4, .42 * level), (10, .46 * level), (14, .5 * level)], where=-0.25, soft=True)
    if ghosts:
        extra = [(15, .3 * level)] if bar % 2 == 0 else [(7, .28 * level)]
        hits(s, "tek", I.tek, bar, extra, where=-0.25, soft=True)
    if boom:
        hits(s, "boom", I.frame_boom, bar, [(0, .8 * level), (8, .5 * level)], human=0.002)


def saidi(s, bar, level=1.0):
    """The heavier groove under the reed melody: dum tek . dum dum . tek ."""
    hits(s, "dum", I.dum, bar, [(0, .95 * level), (6, .7 * level), (8, .85 * level)], kick=True, human=0.003)
    hits(s, "tek", I.tek, bar, [(2, .75 * level), (12, .85 * level)], where=0.2)
    hits(s, "tek", I.tek, bar, [(4, .45 * level), (10, .45 * level), (14, .48 * level), (15, .3 * level)], where=-0.25, soft=True)
    hits(s, "boom", I.frame_boom, bar, [(0, .8 * level)], human=0.002)


def shake(s, bar, level):
    pattern = (0.55, 0.28, 0.75, 0.32)
    hits(s, "shaker", I.shaker, bar, [(p, pattern[p % 4] * level) for p in range(16)], where=-0.5, human=0.005)


def riq(s, bar, level):
    hits(s, "riq", I.jingle, bar, [(4, .62 * level), (12, .66 * level)], where=0.5)
    hits(s, "riq", I.jingle, bar, [(2, .34 * level), (6, .36 * level), (10, .34 * level), (14, .38 * level)], where=0.5)


def street(only=None):
    s = Song("street", "Maul Street (hub)", 98, 32, "D Phrygian, harmonic-minor dominant", loop=True, swing=0.57, only=only)
    s.section("A1 hook", 1, 8, "the hook on oud over the bass ostinato, hand drums, shaker and pad")
    s.section("A2 hook + answers", 9, 16, "hook again with tremolo; a reed answers each phrase; santur, tambourine, snaps join")
    s.section("B reed melody", 17, 24, "the reed sings a sequence over iv - i - bVI - bII - V; the oud turns to tresillo arpeggios")
    s.section("A3 climax", 25, 28, "second half of the hook, oud and reed in unison, claps")
    s.section("vamp", 29, 32, "drums and bass alone, oud echoes, pickup into bar 1")
    s.hook = ["2-bar motif on the oud, rhythm 3+3+2 then 'da, da-da, da | daaa':",
              "  a   | D4 . . F4 . . G4 . A4 . G4 F4 . . G4 . | A4 (held)          pickup A3 C4",
              "  a'  | D4 . . F4 . . G4 . A4 . G4 F4 . . Eb4 . | D4 (held)          pickup F4 G4",
              "  a'' | A4 . . C5 . . D5 . Eb5 . D5 C5 . . Bb4 . | A4 (held)         pickup A4 C#5",
              "  b   | D5 . . C5 . . Bb4 . A4 . G4 F4 . . Eb4 . | D4 (held)",
              "the flat second (Eb) always falls to D; the raised seventh (C#) appears only on the V chord"]

    for first in (1, 9):
        street_hook_chords(s, first)
    for bar, sym in zip(range(17, 25), ("Gm", "Gm", "Dm", "Dm", "Bb", "Eb", "A7", "A7")):
        s.chords(bar, sym)
    s.chords(25, "Dm", "Eb")
    s.chords(26, "A")
    s.chords(27, (0, "Dm"), (12, "Eb"))
    for bar in (28, 29, 30, 31, 32):
        s.chords(bar, "Dm")

    # ----- bass ostinato
    for first in (1, 3, 7, 9, 11, 15, 27, 29, 31):
        street_bass_unit(s, first, "dm")
    for first in (5, 13, 25):
        street_bass_unit(s, first, "up")
    for bar, items in STREET_B_BASS.items():
        notes(s, "bass", I.bass_round, bar, items, hold=0.8, human=0.003)

    # ----- the hook on the oud
    for base, ornament in ((1, False), (9, True)):
        street_hook(s, base, "a", "to_a", ornament)
        street_hook(s, base + 2, "a'", "to_a''", ornament)
        street_hook(s, base + 4, "a''", "to_b", ornament)
        street_hook(s, base + 6, "b", "to_a" if base == 1 else None, ornament)
    street_hook(s, 25, "a''", "to_b", True, 1.0, with_reed=True)
    street_hook(s, 27, "b", None, True, 1.0, with_reed=True)

    # ----- B: oud comping, reed melody; A2: the reed answers each phrase
    for bar, items in STREET_B_OUD.items():
        notes(s, "oud", I.oud, bar, [(p, l, n, 0.56 if p not in (0,) else 0.66) for p, l, n in items], where=-0.12, part="oud comp")
    for bar, items in STREET_B_REED.items():
        line(s, "reed", bar, items)
    for bar, items in zip((10, 12, 14, 16), STREET_ANSWERS):
        line(s, "reed", bar, items)

    # ----- vamp: the oud remembers the hook an octave down, then picks up into bar 1
    notes(s, "oud", I.oud, 30, [(0, 3, "D3", .6), (3, 3, "F3", .58), (6, 2, "G3", .6), (8, 4, "A3", .66)], where=-0.12, part="oud echo")
    notes(s, "oud", I.oud, 32, [(0, 3, "A3", .58), (3, 3, "G3", .56), (6, 2, "F3", .58), (8, 4, "D3", .62),
                                (12, 2, "A3", .72), (14, 2, "C4", .78)], where=-0.12, part="oud echo")

    # ----- pad
    for bar in range(1, 33):
        v = 0.45 if bar <= 8 else 0.5 if bar <= 16 else 0.6 if bar <= 24 else 0.66 if bar <= 28 else 0.45 + 0.05 * (bar - 29)
        street_pad(s, bar, v, 1.0 if bar <= 16 else 1.25)

    # ----- santur
    for bar in range(9, 17):
        street_santur(s, bar, 0.6)
    for bar in range(17, 25):
        street_santur(s, bar, 0.45)
    for bar in range(25, 29):
        street_santur(s, bar, 0.7)

    # ----- hand drums
    for bar in range(1, 33):
        if bar <= 8:
            maqsum(s, bar, 0.9, ghosts=bar > 2)
            shake(s, bar, 0.75)
        elif bar <= 16:
            maqsum(s, bar, 1.0, boom=True)
            shake(s, bar, 0.9)
            riq(s, bar, 0.9)
            hits(s, "snap", I.snap, bar, [(4, .6), (12, .66)], where=0.1)
        elif bar <= 24:
            saidi(s, bar, 0.95)
            shake(s, bar, 0.85)
            riq(s, bar, 0.75)
            hits(s, "snap", I.snap, bar, [(12, .6)], where=0.1)
        elif bar <= 28:
            maqsum(s, bar, 1.0, boom=True)
            shake(s, bar, 1.0)
            riq(s, bar, 1.0)
            hits(s, "clap", I.clap, bar, [(4, .72), (12, .78)])
            hits(s, "tek", I.tek, bar, [(3, .28), (11, .3)], where=-0.25, soft=True)
        else:
            maqsum(s, bar, 0.85, ghosts=bar >= 31)
            shake(s, bar, 0.7)
    # fills at the ends of phrases
    hits(s, "tek", I.tek, 8, [(13, .5), (15, .66)], where=0.2)
    hits(s, "tek", I.tek, 16, [(13, .55), (15, .7)], where=0.2)
    hits(s, "dum", I.dum, 16, [(14, .7)], kick=True)
    hits(s, "tek", I.tek, 24, [(9, .45), (11, .55), (13, .65), (14, .75), (15, .9)], where=0.2)
    hits(s, "dum", I.dum, 24, [(12, .7), (14, .8)], kick=True)
    hits(s, "tek", I.tek, 28, [(13, .6), (15, .75)], where=0.2)
    hits(s, "dum", I.dum, 28, [(14, .75)], kick=True)
    hits(s, "tek", I.tek, 32, [(9, .45), (10, .55), (11, .5), (13, .7), (15, .9)], where=0.2)
    hits(s, "dum", I.dum, 32, [(12, .8), (14, .7)], kick=True)

    # ----- colour: finger cymbals, deep hits and swells at the section turns
    for bar, v in ((1, .5), (9, .5), (17, .6), (25, .65)):
        hits(s, "zill", I.zill, bar, [(0, v)], where=-0.6, human=0.0)
    for bar, v in ((1, .6), (17, .5), (25, .7)):
        hits(s, "sub", I.sub_boom, bar, [(0, v)], human=0.0)
    for bar, v in ((17, .8), (25, 1.0), (33, .6)):
        swell_into(s, "swell", bar, 6, v)

    flush_lines(s, {"reed": (I.reed_line, dict(breath=0.05))})
    return s


STREET_MIX = {
    "bass": dict(lufs=-20.5, eq=[("hp", 36.0, 0.7, 0.0)]),
    "dum": dict(lufs=-22.5, send=0.1),
    "tek": dict(lufs=-29.5, send=0.14),
    "boom": dict(lufs=-26.0),
    "shaker": dict(lufs=-36.0, send=0.08),
    "riq": dict(lufs=-35.0, send=0.12),
    "snap": dict(lufs=-33.0, send=0.25),
    "clap": dict(lufs=-29.0, send=0.25),
    "oud": dict(lufs=-20.0, send=0.2, echo=0.22),
    "reed": dict(lufs=-21.5, send=0.3, duck=0.1),
    "pad": dict(lufs=-27.5, send=0.2, duck=0.28),
    "santur": dict(lufs=-32.0, send=0.25, echo=0.3, duck=0.15),
    "zill": dict(lufs=-37.0, send=0.3),
    "sub": dict(lufs=-29.0),
    "swell": dict(lufs=-36.0, send=0.2),
}

STREET_SETUP = dict(
    mix=STREET_MIX, target=-16.0, ceiling=-2.2, comp=(-12.0, 1.7), drive=0.5, width=1.25,
    room=dict(seconds=1.3, predelay=0.012, low=1.1, high=0.4, hp=180.0, lp=6000.0, early=12, early_span=0.05, early_gain=0.5, seed="court"),
    echo=dict(sixteenths=3, feedback=0.42, count=4, cutoff=2400.0),
)


# ---------------------------------------------------------------------------
# BATTLE -- the pit: the notes
# ---------------------------------------------------------------------------

BATTLE_HOOK = [
    [(0, 6, "D4"), (6, 6, "F4"), (12, 4, "A4")],
    [(0, 8, "D5"), (8, 4, "C5"), (12, 4, "A4")],
    [(0, 6, "Bb4"), (6, 6, "A4"), (12, 4, "G4")],
    [(0, 12, "A4")],
    [(0, 6, "D4"), (6, 6, "F4"), (12, 4, "A4")],
    [(0, 8, "D5"), (8, 4, "Eb5"), (12, 4, "F5")],
    [(0, 6, "Eb5"), (6, 6, "D5"), (12, 4, "C#5")],
    [(0, 14, "D5")],
]
BATTLE_HOOK_CHORDS = [("Dm",), ("Dm",), ("Gm",), ("A",), ("Dm",), ("Dm", "Eb"), ((0, "Eb"), (8, "Asus4"), (12, "A")), ("Dm",)]
BATTLE_LIFT = [
    [(0, 8, "D5"), (8, 4, "Bb4"), (12, 4, "D5")],
    [(0, 8, "E5"), (8, 4, "C5"), (12, 4, "E5")],
    [(0, 8, "F5"), (8, 4, "D5"), (12, 4, "F5")],
    [(0, 14, "A5")],
    [(0, 8, "F5"), (8, 4, "D5"), (12, 4, "Bb4")],
    [(0, 8, "G5"), (8, 4, "E5"), (12, 4, "C5")],
    [(0, 6, "A5"), (6, 6, "G5"), (12, 4, "E5")],
    [(0, 12, "C#5")],
]
BATTLE_LIFT_CHORDS = ["Bb", "C", "Dm", "Dm", "Bb", "C", "A", "A"]
BATTLE_LIFT_ROOTS = ["Bb1", "C2", "D2", "D2", "Bb1", "C2", "A1", "A1"]
BATTLE_LIFT_BRASS = [("Bb2", "F3"), ("C3", "G3"), ("D3", "A3"), ("D3", "A3"), ("Bb2", "F3"), ("C3", "G3"), ("A2", "E3"), ("A2", "E3")]

STAB = {
    "Dm": ["D3", "A3", "D4"], "Dm+": ["D3", "A3", "D4", "F4"], "Gm": ["G3", "D4", "G4"], "A": ["A3", "C#4", "E4"],
    "Eb": ["Eb3", "Bb3", "Eb4"], "Asus4": ["A3", "D4", "E4"], "Bb": ["Bb3", "F4", "Bb4"], "C": ["C4", "G4", "C5"],
}
CHOIR = {
    "Dm": ["A3", "D4", "F4"], "Gm": ["G3", "D4", "G4"], "A": ["A3", "C#4", "E4"], "Eb": ["Bb3", "Eb4", "G4"],
    "Asus4": ["A3", "D4", "E4"], "Bb": ["Bb3", "D4", "F4"], "C": ["C4", "E4", "G4"],
}
# ostinato cells: (accent note, filler, turn note)
OST = {
    "Dm": ("D4", "A3", "F4"), "Gm": ("D4", "G3", "Bb3"), "A": ("E4", "A3", "C#4"), "Eb": ("Eb4", "Bb3", "G3"),
    "Asus4": ("E4", "A3", "D4"), "Bb": ("D4", "Bb3", "F4"), "C": ("E4", "C4", "G4"),
}
ACC = (1.0, .35, .45, .6, .35, .45, .9, .35, .5, .6, .35, .45, .9, .4, .7, .5)   # how hard each sixteenth of the drive is hit
TAIKO_ODD = [(0, 1.0), (6, .75), (12, .85)]
TAIKO_EVEN = [(0, 1.0), (6, .75), (10, .6), (12, .85), (14, .7)]


def _riff(root, tail):
    """One bar of the growling bass: accents on the tresillo, ghost notes between."""
    r = root
    return [(0, 2, r, .95), (3, 1, r, .6), (4, 2, r, .72), (6, 2, r, .9), (9, 1, r, .6), (10, 2, r, .72), (12, 2, r, .92)] + tail


def _half(root, start, tail=None):
    r = root
    out = [(start, 2, r, .95), (start + 3, 1, r, .62), (start + 4, 2, r, .75)]
    return out + (tail if tail else [(start + 6, 2, r, .85)])


BATTLE_BASS_HOOK = [
    _riff("D2", [(14, 1, "F2", .75), (15, 1, "Eb2", .8)]),
    _riff("D2", [(14, 1, "F2", .75), (15, 1, "F#2", .8)]),
    _riff("G2", [(14, 1, "G2", .75), (15, 1, "G#2", .8)]),
    _riff("A1", [(14, 1, "C2", .75), (15, 1, "C#2", .82)]),
    _riff("D2", [(14, 1, "F2", .75), (15, 1, "Eb2", .8)]),
    _half("D2", 0) + _half("Eb2", 8),
    _half("Eb2", 0) + _half("A1", 8, [(14, 2, "C#2", .88)]),
    [(0, 2, "D2", .95), (3, 1, "D2", .6), (4, 2, "D2", .72), (6, 2, "D2", .9), (9, 1, "D2", .6), (10, 2, "D2", .72),
     (12, 1, "D3", .85), (13, 1, "C3", .78), (14, 1, "A2", .8), (15, 1, "C3", .85)],
]


# --- the pit band: what each player does in a bar -------------------------------

def battle_hook_chords(s, first, which=range(8)):
    for i, k in enumerate(which):
        s.chords(first + i, *BATTLE_HOOK_CHORDS[k])


def battle_bass(s, bar, items, stem="bass"):
    notes(s, stem, I.bass_growl, bar, items, hold=0.85, human=0.002, part="bass")


def battle_gallop(s, bar, root, stem="bass", cut=False):
    """The lift's bass: an eighth and two sixteenths on every beat, the octave on beat three."""
    gallop = []
    for beat in range(4):
        top = note_name(midi(root) + 12)
        gallop += [(4 * beat, 2, top if beat == 2 else root, .92), (4 * beat + 2, 1, root, .62), (4 * beat + 3, 1, root, .68)]
    if cut:
        gallop = [g for g in gallop if g[0] < 12] + [(12, 2, root, 1.0)]
    battle_bass(s, bar, gallop, stem)


def battle_pulse(s, bar, root, v0, v1, until=16, stem="bass"):
    """Muted eighths that swell: the bass under a build."""
    count = max(until // 2 - 1, 1)
    notes(s, stem, I.bass_growl, bar, [(p, 1, root, v0 + (v1 - v0) * (p // 2) / count) for p in range(0, until, 2)],
          hold=0.9, human=0.002, part="bass")


def battle_lead(s, first, which=range(8), v=0.92):
    """The hook on the brass, a phrase or all of it; tresillo notes are tongued apart."""
    for i, k in enumerate(which):
        line(s, "lead", first + i, [(p, l * (0.86 if l == 6 else 0.94), n, v if p == 0 else v * 0.92) for p, l, n in BATTLE_HOOK[k]])


def battle_strings(s, first, which=range(8), v=0.72):
    """Strings an octave above the hook."""
    for i, k in enumerate(which):
        notes(s, "strings", I.strings_long, first + i, [(p, l, note_name(midi(n) + 12), v) for p, l, n in BATTLE_HOOK[k]], hold=0.9, part="strings hi")


def battle_lift(s, first, v=0.97):
    """The lift melody on brass and strings together."""
    for k, bar_notes in enumerate(BATTLE_LIFT):
        line(s, "lead", first + k, [(p, l * 0.95, n, v) for p, l, n in bar_notes])
        notes(s, "strings", I.strings_long, first + k, [(p, l, n, 0.78) for p, l, n in bar_notes], hold=0.92, part="strings hi")


def stab(s, bar, pos, sym, v):
    """One chord hit, brass and strings together."""
    for pitch in STAB[sym]:
        shots(s, "stabs", I.brass_hit, bar, [(pos, pitch, v)], part="stabs")
        shots(s, "stabs", I.strings_short, bar, [(pos, pitch, v * 0.9)], part="stabs", mark=False, length=0.14)


def hook_stabs(s, first, full, which=range(8)):
    tonic = "Dm+" if full else "Dm"
    plan = [
        [(0, tonic, .9)] + ([(6, tonic, .7), (12, tonic, .75)] if full else []),
        [(0, tonic, .85)] + ([(8, "Dm", .7), (12, "Dm", .72)] if full else []),
        [(0, "Gm", .88)] + ([(6, "Gm", .7), (12, "Gm", .75)] if full else []),
        [(0, "A", .9), (6, "A", .7), (12, "A", .78)],
        [(0, tonic, .9)] + ([(6, tonic, .7), (12, tonic, .75)] if full else []),
        [(0, tonic, .85), (8, "Eb", .85)] + ([(12, "Eb", .75)] if full else []),
        [(0, "Eb", .9), (8, "Asus4", .82), (12, "A", .88)],
        [(0, tonic, .95)] + ([(6, "Dm", .7), (12, "Dm", .78)] if full else []),
    ]
    for i, k in enumerate(which):
        for pos, sym, v in plan[k]:
            stab(s, first + i, pos, sym, v)


def ost_sixteenths(s, bar, v, until=16):
    """The string ostinato at full speed: a tresillo (3+3+2) in each half bar."""
    items = []
    for half in (0, 8):
        for cell_start, size in ((0, 3), (3, 3), (6, 2)):
            pos = half + cell_start
            acc, fill, turn = OST[s.chord_at(bar, pos)]
            items.append((pos, turn if (half == 8 and cell_start == 6) else acc, v))
            items += [(pos + j, fill, v * 0.6) for j in range(1, size)]
    shots(s, "ost", I.strings_short, bar, [item for item in items if item[0] < until], part="ostinato", human=0.002)


def ost_eighths(s, bar, v, until=16):
    items = []
    for k, pos in enumerate(range(0, 16, 2)):
        acc, fill, turn = OST[s.chord_at(bar, pos)]
        items.append((pos, acc if k in (0, 3, 6) else fill, v if k in (0, 3, 6) else v * 0.62))
    shots(s, "ost", I.strings_short, bar, [item for item in items if item[0] < until], part="ostinato", human=0.002)


def ost_arps(s, bar, v):
    sym = s.chord_at(bar, 0)
    root = {"Bb": "Bb3", "C": "C4", "Dm": "D4", "A": "A3"}[sym]
    r = midi(root)
    cell = [r, r + 7, r + 12, r + 7]
    shots(s, "ost", I.strings_short, bar, [(p, cell[p % 4], v if p % 4 == 0 else v * 0.7) for p in range(16)], part="ostinato", human=0.002)


def choir_bar(s, bar, v, until=16):
    entries = s.chart[bar]
    for i, (pos, sym) in enumerate(entries):
        end = min(entries[i + 1][0] if i + 1 < len(entries) else 16, until)
        if end > pos:
            chord(s, "choir", I.choir, bar, pos, end - pos, CHOIR[sym], v, hold=0.95)


def big(s, bar, items, level=1.0):
    """The big drum."""
    hits(s, "taiko", I.taiko, bar, [(p, v * level) for p, v in items], kick=True, human=0.002, size=1.0)


def mids(s, bar, positions, level=1.0, accents=ACC):
    """Two mid drums, left and right hand by turns."""
    left = [(p, accents[int(p) % 16] * level) for p in positions if int(p * 2) % 4 == 0]
    right = [(p, accents[int(p) % 16] * level) for p in positions if int(p * 2) % 4 != 0]
    hits(s, "mids", I.taiko, bar, left, where=-0.4, size=2.1)
    hits(s, "mids", I.taiko, bar, right, where=0.4, size=2.5)


def groove(s, bar, level=1.0, anvil=0.0, shime=False):
    """The fight groove: big drum on the tresillo, sixteenths on the mid drums, rim clicks off the beat."""
    big(s, bar, TAIKO_ODD if bar % 2 else TAIKO_EVEN, level)
    mids(s, bar, range(16), 0.8 * level)
    hits(s, "rim", I.rim, bar, [(2, .5), (6, .45), (10, .5), (14, .55)], where=0.5)
    if shime:
        hits(s, "shime", I.shime, bar, [(4, .7), (12, .75)], where=-0.3)
    if anvil:
        hits(s, "anvil", I.anvil, bar, [(4, anvil), (12, anvil)], where=0.45)


def lift_drums(s, bar, cut=False):
    """The lift: the big drum on every beat and a gallop on the mid drums."""
    big(s, bar, [(0, .95), (4, .75), (8, .9)] + ([] if cut else [(12, .75)]) + ([(14, .6)] if bar % 2 == 0 and not cut else []))
    gallop = [p for p in range(16) if p % 4 != 1 and (not cut or p < 12)]
    mids(s, bar, gallop, 0.85, accents=(.9, 0, .55, .6) * 4)
    hits(s, "anvil", I.anvil, bar, [(4, .7)] + ([] if cut else [(12, .7)]), where=0.45)
    hits(s, "rim", I.rim, bar, [(2, .5), (6, .5), (10, .5)] + ([] if cut else [(14, .55)]), where=0.5)


def roll(s, bar, start, end, v0, v1):
    """A thirty-second-note roll on the mid drums that swells."""
    count = int(round((end - start) * 2))
    for k in range(count):
        v = v0 + (v1 - v0) * k / max(count - 1, 1)
        hits(s, "mids", I.taiko, bar, [(start + 0.5 * k, v)], where=-0.4 if k % 2 == 0 else 0.4, size=2.1 if k % 2 == 0 else 2.5, human=0.002)


def snare_roll(s, bar, until=16, v0=0.3, v1=0.62, fast=False):
    """The rope drum under a build: sixteenths, or thirty-seconds when `fast`."""
    step = 0.5 if fast else 1.0
    count = int(until / step)
    hits(s, "snare", I.field_snare, bar, [(k * step, v0 + (v1 - v0) * k / max(count - 1, 1)) for k in range(count)], where=-0.15, human=0.002)


def battle(only=None):
    s = Song("battle", "Thunder on the Sand (fight)", 140, 48, "D minor with flat 2nd and raised 7th (Neapolitan minor)", loop=True, only=only)
    s.section("I drums + bass", 1, 8, "war drums and the growling bass riff; low strings and stabs join for the last four bars")
    s.section("II hook", 9, 16, "the 8-bar hook on brass over drums, bass, string ostinato and stabs")
    s.section("III hook, fuller", 17, 24, "hook again with strings an octave above, anvil backbeat, sixteenth ostinato, brass answers")
    s.section("IV lift", 25, 32, "bVI - bVII - i: the hook's second bar climbs in sequence to A5 over a gallop, choir and low brass")
    s.section("V breakdown", 33, 40, "drums thin to single hits; the head returns in fragments; a roll and the cadence Eb - D - C# build")
    s.section("VI return", 41, 48, "the hook with everything, then a fill that drops into bar 1")
    s.hook = ["8-bar hook on brass; bars 1, 3, 5, 7 are a tresillo (3+3+2 eighths), bars 2 and 6 are long-short-short:",
              "  | D4 . . F4 . . A4 . | D5 . . . C5 . A4 . | Bb4 . . A4 . . G4 . | A4 (held)        |",
              "  | D4 . . F4 . . A4 . | D5 . . . Eb5 . F5 . | Eb5 . . D5 . . C#5 . | D5 (held)       |",
              "harmony: Dm | Dm | Gm | A || Dm | Dm Eb | Eb Asus4-A | Dm",
              "the cadence Eb5 - D5 - C#5 - D5 circles the tonic from both sides; the D over A is a 4-3 suspension"]
    s.allowed = [(39, 12, "D4 over Eb in the bass: the breakdown's slow version of the cadence Eb - D - C#, passing to C# on the next bar")]

    hook_starts = (9, 17, 41)
    for first in hook_starts:
        battle_hook_chords(s, first)
    for bar in range(1, 8):
        s.chords(bar, "Dm")
    s.chords(8, "Eb", "A")
    for k, sym in enumerate(BATTLE_LIFT_CHORDS):
        s.chords(25 + k, sym)
    for bar in range(33, 39):
        s.chords(bar, "Dm")
    s.chords(39, "Eb")
    s.chords(40, "A")

    # ----- bass
    for bar in range(1, 8):
        tail = [(14, 1, "D3", .78), (15, 1, "C3", .8)] if bar in (2, 6) else [(14, 1, "A1", .78), (15, 1, "C2", .8)] if bar == 4 \
            else [(14, 1, "F2", .75), (15, 1, "Eb2", .8)]
        battle_bass(s, bar, _riff("D2", tail))
    battle_bass(s, 8, _half("Eb2", 0) + _half("A1", 8, [(14, 2, "C#2", .9)]))
    for first in hook_starts:
        for k, items in enumerate(BATTLE_BASS_HOOK):
            battle_bass(s, first + k, items)
    for k, root in enumerate(BATTLE_LIFT_ROOTS):
        battle_gallop(s, 25 + k, root, cut=(k == 7))
    battle_pulse(s, 37, "D2", 0.4, 0.68)
    battle_pulse(s, 38, "D2", 0.55, 0.83)
    battle_pulse(s, 39, "Eb2", 0.7, 0.84)
    battle_pulse(s, 40, "A1", 0.85, 0.97, until=12)

    # ----- the hook
    for first in hook_starts:
        battle_lead(s, first, v=0.9 if first == 9 else 0.96)
    battle_lift(s, 25)
    for first in (17, 41):
        battle_strings(s, first)
    # breakdown: the head in fragments, then the cadence in slow motion
    shots(s, "ost", I.strings_short, 34, [(0, "D3", .5), (6, "F3", .5), (12, "A3", .55)], part="fragment", length=0.2)
    shots(s, "ost", I.strings_short, 36, [(0, "D3", .6), (6, "F3", .6), (12, "A3", .65), (0, "D4", .42), (6, "F4", .42), (12, "A4", .46)],
          part="fragment", length=0.2)
    line(s, "lead", 38, [(0, 7.5, "D4", .55), (8, 3.8, "C4", .5), (12, 3.8, "A3", .52)])
    line(s, "lead", 39, [(0, 11.5, "Eb4", .68), (12, 3.8, "D4", .7)])
    line(s, "lead", 40, [(0, 10, "C#4", .86)])

    # ----- stabs (brass and strings together)
    hook_stabs(s, 9, False)
    hook_stabs(s, 17, True)
    hook_stabs(s, 41, True)
    for pos, v in ((0, .7), (6, .72), (12, .78)):
        stab(s, 7, pos, "Dm", v)
    for pos, sym, v in ((0, "Eb", .8), (6, "Eb", .8), (8, "A", .85), (12, "A", .92)):
        stab(s, 8, pos, sym, v)
    for k, sym in enumerate(BATTLE_LIFT_CHORDS):
        stab(s, 25 + k, 0, sym, .9)
    stab(s, 32, 12, "A", 1.0)

    # ----- string ostinato
    for bar in range(5, 9):
        ost_eighths(s, bar, 0.45 + 0.07 * (bar - 5))
    for bar in range(9, 17):
        ost_eighths(s, bar, 0.75)
    for bar in list(range(17, 25)) + list(range(41, 49)):
        ost_sixteenths(s, bar, 0.8)
    for bar in range(25, 33):
        ost_arps(s, bar, 0.82)
    for bar in range(35, 41):
        ost_eighths(s, bar, 0.3 + 0.09 * (bar - 35))

    # ----- choir and low brass
    for bar in range(25, 33):
        choir_bar(s, bar, 0.7)
    for bar in range(41, 49):
        choir_bar(s, bar, 0.66)
    for k, (low, high) in enumerate(BATTLE_LIFT_BRASS):
        length = 12 if k == 7 else 16
        notes(s, "lowbrass", I.low_horn, 25 + k, [(0, length, low, .8), (0, length, high, .7)], hold=0.95, human=0.0)
    for first in (9, 17, 41):
        if first != 9:
            notes(s, "lowbrass", I.low_horn, first + 3, [(4, 4, "A3", .72), (8, 4, "C#4", .76), (12, 4, "E4", .8)], hold=0.9, part="brass answer")
        notes(s, "lowbrass", I.low_horn, first + 7, [(0, 6, "D3", .8), (6, 6, "F3", .8), (12, 4, "A3", .84)], hold=0.86, part="brass answer")
    notes(s, "lowbrass", I.low_horn, 33, [(0, 60, "D2", .55), (0, 60, "A2", .45)], hold=1.0, human=0.0, part="drone")
    notes(s, "lowbrass", I.low_horn, 39, [(0, 16, "Eb2", .7), (0, 16, "Bb2", .6)], hold=0.97, human=0.0, part="drone")
    notes(s, "lowbrass", I.low_horn, 40, [(0, 11, "A1", .82), (0, 11, "E2", .72), (0, 11, "A2", .7)], hold=0.97, human=0.0, part="drone")

    # ----- drums
    for bar in range(1, 5):
        big(s, bar, TAIKO_ODD if bar % 2 else TAIKO_EVEN)
        mids(s, bar, range(0, 16, 2), 0.7)
    for bar in range(5, 9):
        groove(s, bar, 1.0)
    for bar in range(9, 17):
        groove(s, bar, 1.0, shime=True)
        hits(s, "anvil", I.anvil, bar, [(12, .6)], where=0.45)
    for bar in list(range(17, 25)) + list(range(41, 49)):
        groove(s, bar, 1.0, anvil=0.8, shime=True)
    for bar in range(25, 33):
        lift_drums(s, bar, cut=(bar == 32))
    big(s, 32, [(12, 1.0)])
    mids(s, 32, [12], 1.2)
    # breakdown
    big(s, 33, [(0, 1.0)])
    big(s, 34, [(0, .8), (12, .5), (14, .6)])
    big(s, 35, [(0, .9), (6, .5)])
    big(s, 36, [(0, .85), (10, .5), (12, .6), (14, .7)])
    for bar in (37, 38):
        big(s, bar, [(0, .9), (6, .7), (12, .8)] if bar % 2 else [(0, .9), (6, .7), (10, .55), (12, .8), (14, .65)], 0.9)
        mids(s, bar, range(16), 0.45 + 0.15 * (bar - 37))
    big(s, 39, [(0, .9), (4, .75), (8, .85), (12, .8)])
    mids(s, 39, range(16), 0.75)
    big(s, 40, [(p, 0.7 + 0.03 * p) for p in range(0, 12, 2)])
    mids(s, 40, range(0, 12), 0.9, accents=(.8, .7, .85, .75) * 4)
    snare_roll(s, 39, 16, 0.3, 0.6)
    snare_roll(s, 40, 12, 0.6, 1.0, fast=True)
    # fills that swell into the next section
    roll(s, 8, 12, 16, .5, .95)
    big(s, 8, [(13, .6), (15, .8)])
    big(s, 16, [(13, .65), (14, .75), (15, .9)])
    roll(s, 24, 8, 16, .4, 1.0)
    big(s, 24, [(8, .7), (13, .7), (15, .85)])
    roll(s, 48, 12, 16, .55, 1.0)
    big(s, 48, [(9, .6), (11, .7), (13, .8), (15, .95)])

    # ----- cymbals, deep hits, swells
    for bar, v in ((1, .8), (9, .9), (17, .9), (25, 1.0), (29, .6), (41, 1.0), (45, .7)):
        hits(s, "crash", I.crash, bar, [(0, v)], human=0.0, dark=0.0)
    hits(s, "tam", I.tam, 33, [(0, .9)], human=0.0)
    for bar, v in ((1, .8), (9, .7), (25, .9), (33, 1.0), (41, 1.0)):
        hits(s, "sub", I.sub_boom, bar, [(0, v)], human=0.0)
    for bar, sixteenths, v in ((9, 8, .8), (17, 8, .8), (25, 12, 1.0), (41, 28, 1.0)):
        swell_into(s, "swell", bar, sixteenths, v)

    flush_lines(s, {"lead": (I.brass_line, dict(bright=1.0))})
    return s


BATTLE_MIX = {
    "taiko": dict(lufs=-19.5, send=0.22),
    "mids": dict(lufs=-22.5, send=0.14),
    "rim": dict(lufs=-31.0, send=0.15),
    "shime": dict(lufs=-31.0, send=0.2),
    "anvil": dict(lufs=-27.0, send=0.25),
    "snare": dict(lufs=-24.5, send=0.25),
    "crash": dict(lufs=-26.5, send=0.2),
    "tam": dict(lufs=-27.0, send=0.25),
    "sub": dict(lufs=-25.0),
    "swell": dict(lufs=-30.0, send=0.15),
    "bass": dict(lufs=-20.5, eq=[("hp", 38.0, 0.7, 0.0)], duck=0.18),
    "lead": dict(lufs=-17.5, send=0.25),
    "strings": dict(lufs=-22.5, send=0.3),
    "stabs": dict(lufs=-22.0, send=0.25),
    "ost": dict(lufs=-25.0, send=0.2),
    "choir": dict(lufs=-25.0, send=0.35, duck=0.15),
    "lowbrass": dict(lufs=-23.5, send=0.2, duck=0.12),
}

HALL = dict(seconds=1.9, predelay=0.018, low=1.1, high=0.4, hp=170.0, lp=6500.0, early=14, early_span=0.07, early_gain=0.45, seed="hall")

BATTLE_SETUP = dict(
    mix=BATTLE_MIX, target=-16.0, ceiling=-2.2, comp=(-11.0, 2.0), drive=0.7, width=1.15, tilt=[("hs", 7000.0, 0.7, 1.5)], room=HALL,
)


# ---------------------------------------------------------------------------
# VICTORY and DEFEAT -- stingers
# ---------------------------------------------------------------------------

FANFARE = [  # (bar offset, position, length, brass chord, bass): the head of the hook, its cadence, D major
    (0, 0, 6, ["D3", "A3", "D4"], ["D2"]), (0, 6, 6, ["Bb2", "F3", "Bb3", "D4"], ["Bb1"]), (0, 12, 4, ["F3", "A3", "C4", "F4"], ["F2"]),
    (1, 0, 6, ["Eb3", "G3", "Bb3", "Eb4"], ["Eb2"]), (1, 6, 6, ["A2", "E3", "A3", "D4"], ["A1"]), (1, 12, 4, ["A2", "E3", "A3", "C#4"], ["A1"]),
]


def fanfare(s, first, hold, bass_stem="bass"):
    """The victory music: D4 F4 A4 | Eb5 D5 C#5 | D major held for `hold` sixteenths.
    Used as the victory stinger and as the close of the film score."""
    line(s, "lead", first, [(0, 5.4, "D4", .95), (6, 5.4, "F4", .95), (12, 3.8, "A4", .97)])
    line(s, "lead", first + 1, [(0, 5.4, "Eb5", 1.0), (6, 5.6, "D5", .97), (12, 3.9, "C#5", 1.0)])
    line(s, "lead", first + 2, [(0, hold, "D5", 1.0)])
    line(s, "lead2", first + 2, [(0, hold, "F#5", .9)])
    for offset, pos, length, upper, low in FANFARE + [(2, 0, hold, ["D3", "A3", "D4", "F#4", "A4"], ["D2"])]:
        bar = first + offset
        notes(s, "lowbrass", I.low_horn, bar, [(pos, length, p, .85) for p in upper], hold=0.94, human=0.0)
        notes(s, bass_stem, I.bass_growl, bar, [(pos, length, p, .9) for p in low], hold=0.9, human=0.0, part="bass")
        chord(s, "choir", I.choir, bar, pos, length, upper[-3:], 0.7, hold=0.95)
        hits(s, "taiko", I.taiko, bar, [(pos, 1.0)], human=0.0, size=1.0)
        hits(s, "mids", I.taiko, bar, [(pos, .9)], human=0.0, size=2.1, where=-0.3)
    notes(s, "strings", I.strings_long, first + 2, [(0, hold, p, .8) for p in ("D4", "A4", "D5", "F#5", "A5")], hold=0.95, human=0.0)
    snare_roll(s, first + 1, 16, 0.35, 0.97, fast=True)
    hits(s, "mids", I.taiko, first + 1, [(13, .7), (14, .8), (15, .9)], size=2.5, where=0.3)
    hits(s, "crash", I.crash, first, [(0, .8)], human=0.0)
    hits(s, "crash", I.crash, first + 2, [(0, 1.0)], human=0.0)
    hits(s, "tam", I.tam, first + 2, [(0, 1.0)], human=0.0)
    hits(s, "sub", I.sub_boom, first + 2, [(0, 1.0)], human=0.0)
    hits(s, "anvil", I.anvil, first + 2, [(0, .9)], human=0.0, where=0.3)


def victory(only=None):
    s = Song("victory", "The Pit Is Yours (stinger)", 132, 4, "D minor ending on a D major chord", loop=False, tail=0.0, only=only)
    s.section("head", 1, 1, "the head of the battle hook, D4 F4 A4, in full brass with a chord under every note")
    s.section("cadence", 2, 2, "the hook's cadence Eb5 - D5 - C#5 over bII, Vsus4, V")
    s.section("arrival", 3, 4, "D major, held: the minor theme resolves bright")
    s.hook = ["| D4 . . F4 . . A4 . | Eb5 . . D5 . . C#5 . | D5 + F#5 (D major, held) |",
              "bass: D - Bb - F | Eb - A - A | D"]
    s.chords(1, (0, "Dm"), (6, "Bb"), (12, "F"))
    s.chords(2, (0, "Eb"), (6, "Asus4"), (12, "A"))
    s.chords(3, "D")
    s.chords(4, "D")
    fanfare(s, 1, 20)
    flush_lines(s, {"lead": (I.brass_line, dict(bright=1.1)), "lead2": (I.brass_line, dict(bright=1.0, low_octave=0.0))})
    return s


VICTORY_MIX = {
    "lead": dict(lufs=-16.5, send=0.3), "lead2": dict(lufs=-21.0, send=0.3), "lowbrass": dict(lufs=-19.5, send=0.25),
    "bass": dict(lufs=-22.0), "choir": dict(lufs=-23.0, send=0.35), "strings": dict(lufs=-21.0, send=0.3),
    "taiko": dict(lufs=-19.0, send=0.25), "mids": dict(lufs=-23.0, send=0.2), "snare": dict(lufs=-25.0, send=0.25),
    "crash": dict(lufs=-25.0, send=0.25), "tam": dict(lufs=-25.0, send=0.3), "sub": dict(lufs=-23.0), "anvil": dict(lufs=-28.0, send=0.3),
}

VICTORY_SETUP = dict(
    mix=VICTORY_MIX, target=-15.0, ceiling=-2.2, comp=(-11.0, 1.8), drive=0.6, ends=(7.2, 1.6),
    room=dict(seconds=2.2, predelay=0.02, low=1.1, high=0.4, hp=170.0, lp=6500.0, early=14, early_span=0.07, early_gain=0.45, seed="hall"),
)


def defeat(only=None):
    s = Song("defeat", "Sand in the Mouth (stinger)", 120, 3, "D, no third: bare fifths", loop=False, tail=0.0, only=only)
    s.section("fall", 1, 2, "the head of the hook upside down on a lone reed: A4 F4 D4, then Bb3 A3 Eb3 on low strings")
    s.section("hollow", 3, 3, "D with only its fifth, a soft gong, nothing else")
    s.hook = ["| A4 . . F4 . . D4 . | Bb3 . . A3 . . Eb3 . | D3 (bare fifth D - A, held) |",
              "the battle head D-F-A read backwards, then a sigh through the flat second"]
    s.chords(1, "D5")
    s.chords(2, (0, "Gm"), (12, "Eb"))
    s.chords(3, "D5")
    line(s, "reed", 1, [(0, 6, "A4", .8), (6, 6, "F4", .72), (12, 4, "D4", .66)])
    notes(s, "cello", I.strings_long, 2, [(0, 6, "Bb3", .7), (6, 6, "A3", .66), (12, 4, "Eb3", .7)], hold=1.0, human=0.0, attack=0.12, release=0.3)
    notes(s, "cello", I.strings_long, 3, [(0, 12, "D3", .62), (0, 12, "A2", .55)], hold=1.0, human=0.0, attack=0.2, release=0.6)
    notes(s, "drone", I.low_horn, 1, [(0, 26, "D2", .5), (0, 15, "A2", .4)], hold=1.0, human=0.0)
    notes(s, "bass", I.bass_round, 2, [(0, 11, "G2", .5), (12, 4, "Eb2", .55)], hold=0.95, human=0.0)
    notes(s, "bass", I.bass_round, 3, [(0, 10, "D2", .55)], hold=1.0, human=0.0)
    hits(s, "taiko", I.taiko, 1, [(0, .75)], human=0.0, size=1.0)
    hits(s, "taiko", I.taiko, 3, [(0, .6)], human=0.0, size=1.0)
    hits(s, "tam", I.tam, 3, [(0, .8)], human=0.0)
    flush_lines(s, {"reed": (I.reed_line, dict(breath=0.08, depth=0.14))})
    return s


DEFEAT_MIX = {
    "reed": dict(lufs=-18.0, send=0.5), "cello": dict(lufs=-19.0, send=0.4, eq=[("lp", 2600.0, 0.7, 0.0)]),
    "drone": dict(lufs=-23.0, send=0.3, eq=[("lp", 900.0, 0.7, 0.0)]), "bass": dict(lufs=-23.0),
    "taiko": dict(lufs=-21.0, send=0.4), "tam": dict(lufs=-24.0, send=0.4),
}

DEFEAT_SETUP = dict(
    mix=DEFEAT_MIX, target=-17.0, ceiling=-2.2, comp=(-13.0, 1.6), drive=0.4, ends=(5.7, 1.8),
    room=dict(seconds=2.8, predelay=0.025, low=1.2, high=0.35, hp=150.0, lp=4500.0, early=12, early_span=0.09, early_gain=0.35, seed="hollow"),
)


# ---------------------------------------------------------------------------
# FILM -- 140 seconds for the demo film, cut from the same cloth
#
# Every section starts on a bar line at a round second, and the speed steps up
# from section to section, so pictures can be cut to the downbeats:
#
#   0     opening    4 bars of 3.5 s      (68.6 BPM)   the street hook, slow, on a lone reed
#   14    street    18 bars of 2.444 s    (98.2 BPM)   the hub groove and hook, light, room for a voice
#   58    build     10 bars of 2 s        (120 BPM)    war drums gather; the cadence Eb - D - C# in slow motion
#   78    battle    10 bars of 1.8 s      (133.3 BPM)  the battle hook at full drive
#   96    BIG HIT   14 bars of 1.714 s    (140 BPM)    the lift, then the hook over a long dominant
#   120   BIG HIT    5 bars of 1.6 s      (150 BPM)    the hook's last phrase with everything
#   128   close      6 bars of 2 s        (120 BPM)    fanfare, D major at 132 s, silence by 140 s
# ---------------------------------------------------------------------------

FILM_TEMPO = [(1, 240.0 / 3.5, 0.5), (5, 240.0 / (44.0 / 18.0), 0.57), (23, 120.0, 0.5), (33, 240.0 / 1.8, 0.5),
              (43, 140.0, 0.5), (57, 150.0, 0.5), (62, 120.0, 0.5)]


def big_hit(s, bar, sym):
    """One of the film's two marked hits: everything lands together after a short silence."""
    hits(s, "crash", I.crash, bar, [(0, 1.0)], human=0.0, dark=0.0)
    hits(s, "tam", I.tam, bar, [(0, 1.0)], human=0.0)
    hits(s, "sub", I.sub_boom, bar, [(0, 1.0)], human=0.0)
    hits(s, "anvil", I.anvil, bar, [(0, 1.0)], human=0.0, where=0.3)
    hits(s, "mids", I.taiko, bar, [(0, 1.0)], human=0.0, size=2.1, where=-0.4)
    hits(s, "mids", I.taiko, bar, [(0, 1.0)], human=0.0, size=2.5, where=0.4)
    stab(s, bar, 0, sym, 1.0)


def film(only=None):
    s = Song("film", "Maul Street (film score)", FILM_TEMPO[0][1], 67, "D minor (Phrygian street, Neapolitan-minor pit), ending on D major",
             loop=False, tail=0.0, only=only, tempo=FILM_TEMPO)
    s.section("A opening", 1, 4, "gong and low drone; a lone reed plays the street hook at two-thirds speed; the hand drums wake in the last bar")
    s.section("B street", 5, 22, "two bars of groove, then the street hook twice on the oud (the second time a reed answers); light, room for a voice")
    s.section("C build", 23, 32, "a dark hit, single war-drum strokes, the battle head in fragments, an ostinato that grows, then Eb - D - C# and a roll")
    s.section("D1 battle", 33, 42, "the battle hook at full drive (8 bars), then two bars climbing Eb - F - G - A to the first big hit")
    s.section("D2 battle", 43, 56, "BIG HIT at 96 s into the lift (8 bars); the hook's first phrase (4 bars); two bars on the dominant, then a breath")
    s.section("D3 battle", 57, 61, "BIG HIT at 120 s; the hook's last phrase with everything, then one hammered bar and a stop")
    s.section("E close", 62, 67, "fanfare: D4 F4 A4 | Eb5 D5 C#5 | D major at 132 s, held, released at 136.5 s, silent by 140 s")
    s.hook = ["the street hook (see street): slow on the reed in bars 2-3, then on the oud from bar 7 and bar 15",
              "the battle hook (see battle): bars 33-40 in full, its first phrase in bars 51-54, its last phrase in bars 57-60",
              "the close is the victory stinger: | D4 . . F4 . . A4 . | Eb5 . . D5 . . C#5 . | D5 + F#5 |"]
    s.allowed = [(31, 12, "D4 over Eb in the bass: the cadence Eb - D - C# in slow motion, passing to C# on the next bar")]
    s.events = [
        (1, 0, "gong, sub and low drone"),
        (2, 0, "the reed begins the street hook, slow"),
        (4, 8, "hand drums wake; oud pickup"),
        (5, 0, "street groove starts (bass, hand drums, shaker)"),
        (7, 0, "street hook on the oud, first time"),
        (15, 0, "street hook, second time, with reed answers and tambourine"),
        (22, 8, "drum fill and swell out of the street"),
        (23, 0, "dark hit: the build begins"),
        (27, 0, "ostinato and sixteenths start to grow"),
        (31, 0, "cadence Eb - D - C# over a snare roll"),
        (32, 12, "half a second of air before the drop"),
        (33, 0, "battle theme: the hook at full drive"),
        (41, 0, "two-bar climb (Eb F G A)"),
        (42, 12, "breath before the hit"),
        (43, 0, "BIG HIT 1: the lift begins"),
        (51, 0, "the hook's first phrase returns"),
        (55, 0, "two bars on the dominant"),
        (56, 12, "breath before the hit"),
        (57, 0, "BIG HIT 2: the hook's last phrase"),
        (61, 0, "one hammered bar"),
        (61, 12, "stop"),
        (62, 0, "close: fanfare, D4 F4 A4"),
        (63, 0, "cadence Eb5 D5 C#5"),
        (64, 0, "final chord: D major"),
        (66, 4, "final chord released; the hall rings out"),
    ]

    # ----- harmony
    for bar in range(1, 7):
        s.chords(bar, "Dm")
    street_hook_chords(s, 7)
    street_hook_chords(s, 15)
    for bar in range(23, 31):
        s.chords(bar, "Dm")
    s.chords(31, "Eb")
    s.chords(32, "A")
    battle_hook_chords(s, 33)
    s.chords(41, "Eb")
    s.chords(42, "A")
    for k, sym in enumerate(BATTLE_LIFT_CHORDS):
        s.chords(43 + k, sym)
    battle_hook_chords(s, 51, range(0, 4))
    s.chords(55, "A")
    s.chords(56, "A")
    battle_hook_chords(s, 57, range(4, 8))
    s.chords(61, "Dm")
    s.chords(62, (0, "Dm"), (6, "Bb"), (12, "F"))
    s.chords(63, (0, "Eb"), (6, "Asus4"), (12, "A"))
    for bar in range(64, 68):
        s.chords(bar, "D")

    # ===== A: the opening (bars 1-4, 3.5 s each)
    hits(s, "sub", I.sub_boom, 1, [(0, .9)], human=0.0)
    hits(s, "tam", I.tam, 1, [(0, .8)], human=0.0)
    notes(s, "lowbrass", I.low_horn, 1, [(0, 60, "D2", .5), (0, 60, "A2", .4)], hold=1.0, human=0.0, part="drone")
    for bar in range(1, 5):
        street_pad(s, bar, 0.36, 0.85)
    slow = STREET_HOOK["a'"]
    line(s, "reed", 2, [(p, l, n, .84 if p in (0, 8) else .74) for p, l, n in slow[:-1]] + [(16, 9, "D4", .8)])
    for bar, v in ((2, .62), (3, .55)):
        hits(s, "dum", I.dum, bar, [(0, v)], kick=True, human=0.0)
        hits(s, "boom", I.frame_boom, bar, [(0, v)], human=0.0)
    hits(s, "zill", I.zill, 2, [(0, .45)], where=-0.6, human=0.0)
    notes(s, "oud", I.oud, 4, [(0, 3, "F3", .5), (3, 3, "Eb3", .5), (6, 6, "D3", .56), (12, 2, "A3", .62), (14, 2, "C4", .7)], where=-0.12, part="oud echo")
    hits(s, "tek", I.tek, 4, [(8, .35), (10, .42), (12, .5), (13, .5), (14, .62), (15, .76)], where=0.2)
    hits(s, "dum", I.dum, 4, [(12, .6)], kick=True)
    swell_into(s, "swell", 5, 6, .8)

    # ===== B: the street (bars 5-22, 2.444 s each), light
    for first in (5, 7, 9, 13, 15, 17, 21):
        street_bass_unit(s, first, "dm", 0.92)
    for first in (11, 19):
        street_bass_unit(s, first, "up", 0.92)
    notes(s, "oud", I.oud, 5, [(0, 3, "D3", .55), (3, 3, "F3", .53), (6, 2, "G3", .55), (8, 4, "A3", .6)], where=-0.12, part="oud echo")
    notes(s, "oud", I.oud, 6, [(12, 2, "A3", .66), (14, 2, "C4", .72)], where=-0.12)
    for base in (7, 15):
        street_hook(s, base, "a", "to_a", False, 0.92)
        street_hook(s, base + 2, "a'", "to_a''", False, 0.92)
        street_hook(s, base + 4, "a''", "to_b", False, 0.92)
        street_hook(s, base + 6, "b", "to_a" if base == 7 else None, False, 0.92)
    for bar, items in zip((16, 18, 20, 22), STREET_ANSWERS):
        line(s, "reed", bar, items)
    for bar in range(5, 23):
        street_pad(s, bar, 0.42 if bar <= 14 else 0.5, 1.0 if bar <= 14 else 1.15)
        if bar <= 6:
            maqsum(s, bar, 0.78, ghosts=False)
            shake(s, bar, 0.6)
        elif bar <= 14:
            maqsum(s, bar, 0.86)
            shake(s, bar, 0.72)
        else:
            maqsum(s, bar, 0.92, boom=True)
            shake(s, bar, 0.8)
            riq(s, bar, 0.7)
            street_santur(s, bar, 0.42)
    hits(s, "tek", I.tek, 6, [(13, .45), (15, .6)], where=0.2)
    hits(s, "tek", I.tek, 14, [(13, .5), (15, .66)], where=0.2)
    hits(s, "tek", I.tek, 22, [(9, .45), (11, .55), (13, .65), (14, .75), (15, .9)], where=0.2)
    hits(s, "dum", I.dum, 22, [(12, .7), (14, .8)], kick=True)
    for bar in (5, 15):
        hits(s, "zill", I.zill, bar, [(0, .5)], where=-0.6, human=0.0)
    hits(s, "sub", I.sub_boom, 5, [(0, .5)], human=0.0)
    swell_into(s, "swell", 23, 8, 1.0)

    # ===== C: the build (bars 23-32, 2 s each)
    hits(s, "sub", I.sub_boom, 23, [(0, 1.0)], human=0.0)
    hits(s, "tam", I.tam, 23, [(0, .9)], human=0.0)
    notes(s, "lowbrass", I.low_horn, 23, [(0, 124, "D2", .55), (0, 124, "A2", .45)], hold=1.0, human=0.0, part="drone")
    big(s, 23, [(0, 1.0)])
    big(s, 24, [(0, .8), (12, .5), (14, .6)])
    big(s, 25, [(0, .9), (6, .5)])
    big(s, 26, [(0, .85), (10, .5), (12, .6), (14, .7)])
    shots(s, "ost", I.strings_short, 24, [(0, "D3", .5), (6, "F3", .5), (12, "A3", .55)], part="fragment", length=0.2)
    shots(s, "ost", I.strings_short, 26, [(0, "D3", .6), (6, "F3", .6), (12, "A3", .65), (0, "D4", .42), (6, "F4", .42), (12, "A4", .46)],
          part="fragment", length=0.2)
    for k, bar in enumerate(range(27, 31)):
        big(s, bar, TAIKO_ODD if bar % 2 else TAIKO_EVEN, 0.82 + 0.05 * k)
        mids(s, bar, range(16), 0.4 + 0.12 * k)
        ost_eighths(s, bar, 0.35 + 0.1 * k)
        battle_pulse(s, bar, "D2", 0.45 + 0.08 * k, 0.52 + 0.08 * k, stem="growl")
    line(s, "lead", 28, [(0, 7.5, "D4", .55), (8, 3.8, "C4", .5), (12, 3.8, "A3", .52)])
    line(s, "lead", 30, [(0, 5.2, "D4", .66), (6, 5.2, "F4", .68), (12, 3.8, "A4", .72)])
    line(s, "lead", 31, [(0, 11.5, "Eb4", .74), (12, 3.8, "D4", .76)])
    line(s, "lead", 32, [(0, 10, "C#4", .9)])
    battle_pulse(s, 31, "Eb2", 0.72, 0.86, stem="growl")
    battle_pulse(s, 32, "A1", 0.86, 0.98, until=12, stem="growl")
    notes(s, "lowbrass", I.low_horn, 31, [(0, 16, "Eb2", .7), (0, 16, "Bb2", .6)], hold=0.97, human=0.0, part="drone")
    notes(s, "lowbrass", I.low_horn, 32, [(0, 11, "A1", .82), (0, 11, "E2", .72), (0, 11, "A2", .7)], hold=0.97, human=0.0, part="drone")
    big(s, 31, [(0, .9), (4, .75), (8, .85), (12, .8)])
    mids(s, 31, range(16), 0.8)
    ost_eighths(s, 31, 0.75)
    big(s, 32, [(p, 0.7 + 0.03 * p) for p in range(0, 12, 2)])
    mids(s, 32, range(0, 12), 0.9, accents=(.8, .7, .85, .75) * 4)
    ost_eighths(s, 32, 0.85, until=12)
    snare_roll(s, 31, 16, 0.3, 0.6)
    snare_roll(s, 32, 12, 0.6, 1.0, fast=True)
    swell_into(s, "swell", 33, 28, 1.0)

    # ===== D1: the battle hook (bars 33-42, 1.8 s each)
    hits(s, "crash", I.crash, 33, [(0, .9)], human=0.0, dark=0.0)
    hits(s, "sub", I.sub_boom, 33, [(0, .85)], human=0.0)
    for k, items in enumerate(BATTLE_BASS_HOOK):
        battle_bass(s, 33 + k, items, "growl")
    battle_lead(s, 33, v=0.95)
    battle_strings(s, 33)
    hook_stabs(s, 33, True)
    notes(s, "lowbrass", I.low_horn, 36, [(4, 4, "A3", .72), (8, 4, "C#4", .76), (12, 4, "E4", .8)], hold=0.9, part="brass answer")
    notes(s, "lowbrass", I.low_horn, 40, [(0, 6, "D3", .8), (6, 6, "F3", .8), (12, 4, "A3", .84)], hold=0.86, part="brass answer")
    for bar in range(33, 41):
        ost_sixteenths(s, bar, 0.8)
        groove(s, bar, 1.0, anvil=0.8, shime=True)
    hits(s, "crash", I.crash, 37, [(0, .6)], human=0.0, dark=0.0)
    # the climb to the first hit: Eb F G | A, then a breath
    battle_bass(s, 41, _half("Eb2", 0) + _half("Eb2", 8), "growl")
    battle_pulse(s, 42, "A1", 0.85, 1.0, until=12, stem="growl")
    line(s, "lead", 41, [(0, 5.2, "Eb5", .95), (6, 5.2, "F5", .95), (12, 3.8, "G5", .97)])
    line(s, "lead", 42, [(0, 10.5, "A5", 1.0)])
    notes(s, "strings", I.strings_long, 41, [(0, 6, "Eb5", .78), (6, 6, "F5", .78), (12, 4, "G5", .8)], hold=0.9, part="strings hi")
    notes(s, "strings", I.strings_long, 42, [(0, 10.5, "A5", .82)], hold=0.95, part="strings hi")
    notes(s, "lowbrass", I.low_horn, 41, [(0, 16, "Eb2", .78), (0, 16, "Bb2", .7)], hold=0.95, human=0.0)
    notes(s, "lowbrass", I.low_horn, 42, [(0, 11, "A1", .85), (0, 11, "E2", .76), (0, 11, "A2", .74)], hold=0.95, human=0.0)
    for pos in (0, 6, 12):
        stab(s, 41, pos, "Eb", .85)
    for pos in (0, 6):
        stab(s, 42, pos, "A", .92)
    ost_sixteenths(s, 41, 0.82)
    ost_sixteenths(s, 42, 0.88, until=12)
    groove(s, 41, 1.0, anvil=0.8, shime=True)
    big(s, 42, [(p, 0.72 + 0.028 * p) for p in range(0, 12, 2)])
    roll(s, 42, 0, 12, .5, 1.0)
    snare_roll(s, 42, 12, 0.5, 1.0, fast=True)
    swell_into(s, "swell", 43, 12, 1.0)

    # ===== D2: first big hit, the lift, the hook's first phrase, the dominant (bars 43-56, 1.714 s each)
    big_hit(s, 43, "Bb")
    battle_lift(s, 43)
    for k, root in enumerate(BATTLE_LIFT_ROOTS):
        bar = 43 + k
        battle_gallop(s, bar, root, "growl")
        lift_drums(s, bar)
        ost_arps(s, bar, 0.82)
        choir_bar(s, bar, 0.7)
        if k:
            stab(s, bar, 0, BATTLE_LIFT_CHORDS[k], .9)
        low, high = BATTLE_LIFT_BRASS[k]
        notes(s, "lowbrass", I.low_horn, bar, [(0, 16, low, .8), (0, 16, high, .7)], hold=0.95, human=0.0)
    hits(s, "crash", I.crash, 47, [(0, .6)], human=0.0, dark=0.0)
    hits(s, "crash", I.crash, 51, [(0, .85)], human=0.0, dark=0.0)
    hits(s, "sub", I.sub_boom, 51, [(0, .8)], human=0.0)
    for k in range(4):
        battle_bass(s, 51 + k, BATTLE_BASS_HOOK[k] if k < 3 else _riff("A1", [(14, 1, "E2", .75), (15, 1, "A1", .8)]), "growl")
    battle_lead(s, 51, range(0, 4), 0.96)
    battle_strings(s, 51, range(0, 4))
    hook_stabs(s, 51, True, range(0, 4))
    for bar in range(51, 55):
        ost_sixteenths(s, bar, 0.82)
        groove(s, bar, 1.0, anvil=0.8, shime=True)
        choir_bar(s, bar, 0.66)
    # two more bars of A: the arpeggio climbs, the drums roll, then a breath
    battle_bass(s, 55, _riff("A1", [(14, 1, "E2", .78), (15, 1, "A1", .82)]), "growl")
    battle_pulse(s, 56, "A1", 0.86, 1.0, until=12, stem="growl")
    line(s, "lead", 55, [(0, 5.2, "A4", .95), (6, 5.2, "C#5", .96), (12, 3.8, "E5", .97)])
    line(s, "lead", 56, [(0, 10.5, "A5", 1.0)])
    notes(s, "strings", I.strings_long, 55, [(0, 6, "A5", .78), (6, 6, "C#6", .78), (12, 4, "E6", .8)], hold=0.9, part="strings hi")
    notes(s, "strings", I.strings_long, 56, [(0, 10.5, "A5", .82)], hold=0.95, part="strings hi")
    for bar, until in ((55, 16), (56, 11)):
        notes(s, "lowbrass", I.low_horn, bar, [(0, until, "A2", .82), (0, until, "E3", .74)], hold=0.95, human=0.0)
        choir_bar(s, bar, 0.7, until=12)
    for pos in (0, 6, 12):
        stab(s, 55, pos, "A", .88)
    for pos in (0, 6):
        stab(s, 56, pos, "A", .94)
    ost_sixteenths(s, 55, 0.84)
    ost_sixteenths(s, 56, 0.9, until=12)
    groove(s, 55, 1.0, anvil=0.8, shime=True)
    big(s, 56, [(p, 0.72 + 0.028 * p) for p in range(0, 12, 2)])
    roll(s, 56, 0, 12, .5, 1.0)
    snare_roll(s, 56, 12, 0.5, 1.0, fast=True)
    swell_into(s, "swell", 57, 12, 1.0)

    # ===== D3: second big hit, the hook's last phrase (bars 57-61, 1.6 s each)
    big_hit(s, 57, "Dm+")
    for k in range(4):
        battle_bass(s, 57 + k, BATTLE_BASS_HOOK[4 + k], "growl")
    battle_lead(s, 57, range(4, 8), 0.98)
    battle_strings(s, 57, range(4, 8), 0.76)
    hook_stabs(s, 57, True, range(4, 8))
    notes(s, "lowbrass", I.low_horn, 60, [(0, 6, "D3", .82), (6, 6, "F3", .82), (12, 4, "A3", .86)], hold=0.86, part="brass answer")
    for bar in range(57, 61):
        ost_sixteenths(s, bar, 0.84)
        groove(s, bar, 1.0, anvil=0.85, shime=True)
        choir_bar(s, bar, 0.7)
    # one more bar hammered on D, then a stop
    battle_pulse(s, 61, "D2", 0.85, 1.0, until=12, stem="growl")
    line(s, "lead", 61, [(0, 10.5, "D5", 1.0)])
    notes(s, "strings", I.strings_long, 61, [(0, 10.5, "D6", .8), (0, 10.5, "A5", .74)], hold=0.95, part="strings hi")
    choir_bar(s, 61, 0.72, until=11)
    for pos in (0, 6):
        stab(s, 61, pos, "Dm+", .95)
    ost_sixteenths(s, 61, 0.9, until=12)
    big(s, 61, [(0, 1.0), (3, .8), (6, .95), (8, .85), (10, 1.0)])
    roll(s, 61, 0, 12, .6, 1.0)
    snare_roll(s, 61, 12, 0.6, 1.0, fast=True)

    # ===== E: the close (bars 62-67, 2 s each)
    fanfare(s, 62, 36, bass_stem="growl")

    flush_lines(s, {"reed": (I.reed_line, dict(breath=0.06)), "lead": (I.brass_line, dict(bright=1.0)),
                    "lead2": (I.brass_line, dict(bright=1.0, low_octave=0.0))})
    return s


FILM_MIX = {
    # the street band, a little under its game level so a voice can sit on top
    "bass": dict(lufs=-21.5, eq=[("hp", 36.0, 0.7, 0.0)]),
    "dum": dict(lufs=-23.5, send=0.12),
    "tek": dict(lufs=-30.5, send=0.16),
    "boom": dict(lufs=-26.5),
    "shaker": dict(lufs=-37.0, send=0.08),
    "riq": dict(lufs=-36.5, send=0.12),
    "oud": dict(lufs=-21.0, send=0.22, echo=0.22),
    "reed": dict(lufs=-20.5, send=0.4, duck=0.1),
    "pad": dict(lufs=-28.0, send=0.25, duck=0.25),
    "santur": dict(lufs=-33.5, send=0.25, echo=0.3, duck=0.15),
    "zill": dict(lufs=-38.0, send=0.3),
    # the pit band at its game level
    "taiko": dict(lufs=-19.5, send=0.22),
    "mids": dict(lufs=-22.5, send=0.14),
    "rim": dict(lufs=-31.0, send=0.15),
    "shime": dict(lufs=-31.0, send=0.2),
    "anvil": dict(lufs=-27.0, send=0.25),
    "snare": dict(lufs=-24.5, send=0.25),
    "crash": dict(lufs=-26.0, send=0.2),
    "tam": dict(lufs=-25.0, send=0.3),
    "sub": dict(lufs=-24.0),
    "swell": dict(lufs=-30.0, send=0.15),
    "growl": dict(lufs=-20.5, eq=[("hp", 38.0, 0.7, 0.0)], duck=0.18),
    "lead": dict(lufs=-17.5, send=0.25),
    "lead2": dict(lufs=-22.0, send=0.3),
    "strings": dict(lufs=-22.5, send=0.3),
    "stabs": dict(lufs=-22.0, send=0.25),
    "ost": dict(lufs=-25.0, send=0.2),
    "choir": dict(lufs=-24.5, send=0.35, duck=0.15),
    "lowbrass": dict(lufs=-22.5, send=0.22, duck=0.12),
}

FILM_SETUP = dict(
    mix=FILM_MIX, target=-16.0, ceiling=-2.2, comp=(-11.0, 1.8), drive=0.6, width=1.15, tilt=[("hs", 7000.0, 0.7, 1.0)],
    room=HALL, echo=dict(sixteenths=3, bar=5, feedback=0.4, count=4, cutoff=2400.0), ends=(140.0, 2.2),
)

TRACKS = {
    "street": (street, STREET_SETUP),
    "battle": (battle, BATTLE_SETUP),
    "victory": (victory, VICTORY_SETUP),
    "defeat": (defeat, DEFEAT_SETUP),
    "film": (film, FILM_SETUP),
}


# ---------------------------------------------------------------------------
# timing, for cutting pictures
# ---------------------------------------------------------------------------

def timing(song):
    """Tempo sections, every downbeat and the marked events, in seconds."""
    sections = []
    for i, (first, speed, _swing) in enumerate(song.tempo):
        last = song.tempo[i + 1][0] - 1 if i + 1 < len(song.tempo) else song.bars
        names = [name for name, a, b, _what in song.sections if a <= first <= b]
        sections.append(dict(section=names[0] if names else "", firstBar=first, lastBar=last, bpm=round(speed, 3),
                             barSeconds=round(song.bar_len(first), 4), beatSeconds=round(song.bar_len(first) / 4.0, 4),
                             start=round(song.bar_start(first), 3), end=round(song.bar_start(last + 1), 3)))
    downbeats = [dict(bar=bar, time=round(song.bar_start(bar), 3)) for bar in range(1, song.bars + 1)]
    events = [dict(time=round(song.t(bar, pos), 3), bar=bar, beat=round(pos / 4.0 + 1.0, 2), what=what) for bar, pos, what in song.events]
    return dict(seconds=round(song.seconds, 3), sections=sections, downbeats=downbeats, events=events)


# ---------------------------------------------------------------------------
# checks on the written notes
# ---------------------------------------------------------------------------

BASS_PARTS = ("bass",)


def sounding(song, when):
    """Notes sounding at `when` (sixteenths from bar 1): [(part, pitch)]."""
    return [(part, pitch) for part, start, length, pitch in song.notes if start - 1e-6 <= when < start + length - 1e-6]


def clash_report(song):
    """Strong-beat intervals against the bass, and semitone rubs between upper parts.
    Returns (hard clashes, soft notes, lines of text)."""
    lines = []
    hard = soft = 0
    allowed = {(bar, pos): why for bar, pos, why in song.allowed}
    for bar in range(1, song.bars + 1):
        for pos in STRONG:
            now = sounding(song, (bar - 1) * 16 + pos)
            if not now:
                continue
            lows = [p for part, p in now if part in BASS_PARTS]
            bass = min(lows) if lows else min(p for _, p in now)
            for part, pitch in now:
                interval = int(round(pitch - bass)) % 12
                if pitch != bass and interval in (1, 6):
                    hard += 1
                    lines.append(f"      CLASH bar {bar} beat {pos // 4 + 1}: {note_name(pitch)} ({part}) is a "
                                 f"{'minor 2nd' if interval == 1 else 'tritone'} over {note_name(bass)}")
            uppers = sorted({(pitch, part) for part, pitch in now if pitch != bass})
            for i, (p1, part1) in enumerate(uppers):
                for p2, part2 in uppers[i + 1:]:
                    if part1 != part2 and int(round(p2 - p1)) % 12 in (1, 11):
                        soft += 1
                        lines.append(f"      rub   bar {bar} beat {pos // 4 + 1}: {note_name(p1)} ({part1}) against {note_name(p2)} ({part2})")
    # weaker beats: only report semitones and tritones against the bass that are not on the allow-list
    for bar in range(1, song.bars + 1):
        for pos in (4, 12):
            now = sounding(song, (bar - 1) * 16 + pos)
            lows = [p for part, p in now if part in BASS_PARTS]
            if not lows:
                continue
            bass = min(lows)
            for part, pitch in now:
                interval = int(round(pitch - bass)) % 12
                if interval in (1, 6, 11) and pitch != bass:
                    why = allowed.get((bar, pos))
                    tag = "meant" if why else "note "
                    name = {1: "minor 2nd", 6: "tritone", 11: "major 7th"}[interval]
                    lines.append(f"      {tag} bar {bar} beat {pos // 4 + 1}: {note_name(pitch)} ({part}) is a {name} over {note_name(bass)}"
                                 + (f"  [{why}]" if why else ""))
    return hard, soft, lines


def describe(song):
    """The form, the chords, the hook and the clash check, as text."""
    out = []
    out.append(f"  ===== {song.name}: \"{song.title}\" =====")
    if len(song.tempo) == 1:
        out.append(f"    key {song.key}; {song.bpm} BPM; {song.bars} bars of 4/4; "
                   f"{song.seconds:.3f} s{' loop' if song.loop else ''}; swing {int(round(song.swing * 100))}%")
    else:
        out.append(f"    key {song.key}; {song.bars} bars of 4/4; {song.seconds:.3f} s; the speed changes with the sections:")
        for row in timing(song)["sections"]:
            out.append(f"      {row['start']:7.3f} - {row['end']:7.3f} s  bars {row['firstBar']:2d}-{row['lastBar']:2d}  {row['bpm']:7.3f} BPM  "
                       f"bar {row['barSeconds']:.4f} s  beat {row['beatSeconds']:.4f} s  {row['section']}")
    out.append("    form:")
    for name, first, last, what in song.sections:
        out.append(f"      bars {first:2d}-{last:2d}  {song.t(first):6.2f}s  {name:20s} {what}")
    out.append("    chords (bar: chord, or chord@sixteenth when it changes inside the bar):")
    row = []
    for bar in range(1, song.bars + 1):
        entries = song.chart.get(bar, [])
        text = " ".join(sym if pos == 0 else f"{sym}@{pos}" for pos, sym in entries)
        row.append(f"{bar}: {text}")
        if len(row) == 8 or bar == song.bars:
            out.append("      " + " | ".join(row))
            row = []
    out.append("    hook:")
    out += [f"      {text}" for text in song.hook]
    if song.events:
        out.append("    downbeats (bar: seconds):")
        marks = [f"{row['bar']}: {row['time']:.3f}" for row in timing(song)["downbeats"]]
        for i in range(0, len(marks), 10):
            out.append("      " + "  ".join(marks[i:i + 10]))
        out.append("    moments to cut to:")
        for row in timing(song)["events"]:
            out.append(f"      {row['time']:8.3f} s  bar {row['bar']:2d} beat {row['beat']:g}  {row['what']}")
    parts = {}
    for part, start, length, pitch in song.notes:
        parts.setdefault(part, []).append(pitch)
    out.append("    parts (notes written, range):")
    for part, pitches in sorted(parts.items()):
        out.append(f"      {part:14s} {len(pitches):4d} notes  {note_name(min(pitches))} - {note_name(max(pitches))}")
    hard, soft, lines = clash_report(song)
    out.append(f"    clash check on beats 1 and 3: {hard} minor-2nd/tritone clashes against the bass, {soft} semitone rubs between upper parts")
    out += lines
    return "\n".join(out), hard
