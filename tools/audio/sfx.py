"""
sfx.py -- every sound effect in Maul Street, synthesised from scratch.

Each effect is a small function that layers a few physical ideas (a pitch-
dropping thump, a band of noise, a handful of ringing modes, a pulsed "throat"
through moving formants) and returns raw audio. `render(name)` then removes any
DC, trims it tight, fades the ends and sets the peak.

The `gain` beside each effect is its place in the game mix (the files are all
peak-normalised, so the player needs to know that a hover tick is much quieter
than a killing blow). It is written to manifest.json and applied by audio.js.
"""
from __future__ import annotations

import numpy as np

from dsp import (F, SR, TAU, balance, bandpass, biquad, colored, comb, curve, decorrelate, eq, fade,
                 highpass, hz, lowpass, make_ir, modal, normalize, nsamp, one_pole, pan, perc, place, reverb,
                 rng, sat, sat_norm, saw, secs, sine, smooth_noise, square, trim, tv_biquad, white)

REG: dict = {}
PEAK_DB = -3.0


def sound(name, gain=0.7, stereo=False, exact=None, tail_db=-58.0, fade_out=0.03, group="misc", cap=None, duck=0.0):
    """Register an effect. gain: level in the game mix. duck: how far it pushes the
    music down while it sounds (0 = not at all, 0.6 = by 60%). exact: fixed length
    in seconds (not trimmed). cap: longest allowed length, faded out over fade_out."""
    def deco(fn):
        REG[name] = dict(fn=fn, gain=gain, stereo=stereo, exact=exact, tail_db=tail_db, fade_out=fade_out,
                         group=group, cap=cap, duck=duck)
        return fn
    return deco


def render(name):
    """Final audio for one effect: mono (n,) or stereo (n, 2), peak at PEAK_DB."""
    spec = REG[name]
    x = np.asarray(spec["fn"](rng("sfx", name)), dtype=F)
    if spec["stereo"] and x.ndim == 1:
        x = np.stack([x, x], axis=1)
    if not spec["stereo"] and x.ndim == 2:
        x = x.mean(axis=1)
    x = highpass(x, 22.0, 2)
    if spec["exact"]:
        n = nsamp(spec["exact"])
        if x.shape[0] < n:
            x = np.concatenate([x, np.zeros((n - x.shape[0],) + x.shape[1:])])
        x = x[:n]
    else:
        x = trim(x, spec["tail_db"])
        if spec["cap"] and x.shape[0] > nsamp(spec["cap"]):
            x = x[: nsamp(spec["cap"])]
    x = x - x.mean(axis=0)
    x = fade(x, 0.002, min(spec["fade_out"], 0.25 * x.shape[0] / SR))
    return normalize(x, PEAK_DB)


# ---------------------------------------------------------------------------
# building blocks
# ---------------------------------------------------------------------------

def pts(*pairs):
    return list(pairs)


def _unit(x):
    return x / (np.sqrt(np.mean(x * x)) + 1e-9)


class Mix:
    """A little canvas: drop layers in at a time, a gain and (if stereo) a pan."""

    def __init__(self, dur, stereo=False):
        self.n = nsamp(dur)
        self.stereo = stereo
        self.buf = np.zeros((self.n, 2)) if stereo else np.zeros(self.n)

    def add(self, x, at=0.0, gain=1.0, pos=0.0):
        if self.stereo:
            x = pan(x, pos) * 1.4142 if x.ndim == 1 else balance(x, pos)
        elif x.ndim == 2:
            x = x.mean(axis=1)
        place(self.buf, x, int(round(at * SR)), gain)
        return self


def thump(dur, f_hi, f_lo, t_pitch, t_amp, drive=0.0, attack=0.0015, phase=0.0):
    """A sine whose pitch falls fast: the low body of every impact."""
    n = nsamp(dur)
    t = secs(n)
    f = f_lo + (f_hi - f_lo) * np.exp(-t / t_pitch)
    y = np.sin(TAU * np.cumsum(f) / SR + phase) * (1.0 - np.exp(-t / attack)) * np.exp(-t / t_amp)
    y = sat_norm(y, drive) if drive > 0 else y
    return fade(y, 0.0, min(0.04, 0.2 * dur))        # never stop on a live sample: a cut-off thump clicks


def nburst(dur, R, lo, hi, decay, attack=0.0004, slope=0.0, order=2, hold=0.0):
    """A shaped burst of band-limited noise, unit RMS before the envelope."""
    n = nsamp(dur)
    x = colored(n, R, slope) if slope else white(n, R)
    if lo and hi:
        x = bandpass(x, lo, hi, order)
    elif hi:
        x = lowpass(x, hi, order)
    elif lo:
        x = highpass(x, lo, order)
    return _unit(x) * perc(n, attack, decay, hold)


def crunch(dur, R, lo, hi, decay, push=1.5):
    """Noise driven into saturation: the gritty middle of a heavy blow."""
    return lowpass(sat(nburst(dur, R, lo, hi, decay, slope=-2.0) * push, 1.0), hi)


def sweep(dur, R, f_points, q, amp_points, slope=-2.0, shape="exp", block=16):
    """Noise through a band-pass that travels: whooshes, risers, tearing air."""
    n = nsamp(dur)
    f = curve(n, f_points, shape)
    a = curve(n, amp_points, "cos")
    x = colored(n, R, slope) if slope else white(n, R)
    return tv_biquad(x, "bp", f, q, block=block) * a * (2.0 + q)


def blip(dur, f0, f1, power=0.7):
    """A tiny chirped sine: one bubble, one drop."""
    n = nsamp(dur)
    t = secs(n)
    f = f0 + (f1 - f0) * (t / dur) ** power
    return np.sin(TAU * np.cumsum(f) / SR) * perc(n, dur * 0.08, dur * 0.3)


def tick(R, lo=2000.0, hi=9000.0, dur=0.004):
    """A grain of grit: a couple of milliseconds of band-passed noise."""
    n = nsamp(dur * 4.0)
    x = bandpass(white(n + 64, R), lo, hi, 2)[64:]
    return x / (np.max(np.abs(x)) + 1e-9) * perc(n, 0.0002, dur)


def ping(R, f, decay, n_modes=3, spread=1.7):
    """A small hard object: a few inharmonic modes that die in milliseconds."""
    freqs = [f * (spread ** k) * R.uniform(0.94, 1.06) for k in range(n_modes)]
    decays = [decay / (1.0 + 0.8 * k) for k in range(n_modes)]
    amps = [1.0 / (1.0 + 0.9 * k) for k in range(n_modes)]
    return modal(nsamp(decay * 7.0), freqs, decays, amps, R, attack=0.0002)


def grit(n, R, density=40.0, lo=1500.0, hi=7000.0):
    """Sparse random crackle: a noise band switched on in irregular grains."""
    gate = np.clip(smooth_noise(n, R, density) - 0.6, 0.0, None)
    x = bandpass(white(n, R), lo, hi, 2)
    return x * gate * 2.5


_IR = {
    "tight": dict(seconds=0.28, predelay=0.002, low=1.0, high=0.5, hp=260.0, lp=6000.0, early=8, early_span=0.02, early_gain=0.8),
    "pit": dict(seconds=0.75, predelay=0.006, low=1.1, high=0.45, hp=170.0, lp=5500.0, early=12, early_span=0.045, early_gain=0.7),
    "arena": dict(seconds=1.5, predelay=0.014, low=1.15, high=0.42, hp=150.0, lp=5000.0, early=14, early_span=0.07, early_gain=0.55),
    "cavern": dict(seconds=3.0, predelay=0.025, low=1.25, high=0.35, hp=110.0, lp=4200.0, early=16, early_span=0.1, early_gain=0.4),
}


def room(x, kind="pit", wet=0.12):
    """Put a sound in the stone pit. Mono stays mono, stereo gets a stereo tail."""
    return reverb(x, make_ir(seed=kind, **_IR[kind]), wet=wet)


def wide(x, R, amount=0.7):
    return decorrelate(x, R, amount)


def stereo_noise(n, R, slope=-3.0, common=0.35):
    """Two noise channels that share a little, for wide but solid beds."""
    c = colored(n, R, slope)
    left = colored(n, R, slope)
    right = colored(n, R, slope)
    return np.stack([common * c + (1 - common) * left, common * c + (1 - common) * right], axis=1)


def blow(R, dur, low, knock, grind=None, crack=None, clip=1.3, rumble=None):
    """The common skeleton of a blow, glued by a soft clip:
    low and knock are (f_hi, f_lo, pitch time, decay, drive, gain) thumps;
    grind is (lo, hi, decay, gain) of driven noise; crack is (lo, hi, decay, gain);
    rumble is (top Hz, decay, gain): low noise for weight (a second low tone would beat)."""
    m = Mix(dur)
    for f_hi, f_lo, t_pitch, t_amp, drive, gain in (low, knock):
        m.add(thump(min(dur, t_amp * 9.0), f_hi, f_lo, t_pitch, t_amp, drive), 0.0, gain)
    if rumble:
        top, decay, gain = rumble
        m.add(nburst(min(dur, decay * 8.0), R, None, top, decay, attack=0.004, slope=-3.0), 0.0, gain)
    if grind:
        lo, hi, decay, gain = grind
        m.add(crunch(min(dur, decay * 9.0), R, lo, hi, decay), 0.0, gain)
    if crack:
        lo, hi, decay, gain = crack
        m.add(nburst(min(dur, decay * 10.0), R, lo, hi, decay), 0.0, gain)
    return fade(sat(m.buf, clip), 0.0, 0.04)


# ---------------------------------------------------------------------------
# the creature voice
#
# A throat is a rough pulse train (irregular period and strength, alternate
# pulses weakened, breath noise let through while the folds are open), rolled
# by a slow flutter, pushed through formant resonances that move as the mouth
# opens and closes, then driven until it distorts like something very loud.
# ---------------------------------------------------------------------------

def throat(n, f0, R, jitter=0.04, shimmer=0.25, sub=0.0, breath=0.3, open_q=0.6, drift=0.02, tilt=None):
    f0 = np.asarray(f0, dtype=F)
    sub = np.broadcast_to(np.asarray(sub, dtype=F), (n,))
    f = f0 * (1.0 + drift * smooth_noise(n, R, 7.0))
    cyc = np.floor(np.cumsum(f) / SR).astype(np.int64)
    f = f * (1.0 + jitter * R.standard_normal(int(cyc[-1]) + 2))[cyc]
    phase = np.cumsum(f) / SR
    cyc = np.floor(phase).astype(np.int64)
    frac = phase - cyc
    strength = np.clip(1.0 + shimmer * R.standard_normal(int(cyc[-1]) + 2), 0.15, 2.2)[cyc]
    strength = strength * np.where(cyc % 2 == 1, 1.0 - sub, 1.0)
    tp, tn = open_q * 0.66, open_q * 0.34
    rise = frac < tp
    fall = (frac >= tp) & (frac < tp + tn)
    pulse = np.zeros(n)
    flow = np.zeros(n)
    pulse[rise] = (tn / tp) * np.sin(np.pi * frac[rise] / tp)
    pulse[fall] = -np.sin(0.5 * np.pi * (frac[fall] - tp) / tn)
    flow[rise] = 0.5 * (1.0 - np.cos(np.pi * frac[rise] / tp))
    flow[fall] = np.cos(0.5 * np.pi * (frac[fall] - tp) / tn)
    air = highpass(white(n, R), 500.0, 1) * (0.2 + 0.8 * flow)
    out = strength * (pulse + breath * air)
    return one_pole(out, tilt) if tilt else out


def flutter(n, rate, depth, R, sharp=2.0, wander=0.12):
    """The roll in a growl: 1 at the top of each pulse, dipping by `depth`."""
    rate = np.broadcast_to(np.asarray(rate, dtype=F), (n,))
    depth = np.broadcast_to(np.asarray(depth, dtype=F), (n,))
    phase = np.cumsum(rate * (1.0 + wander * smooth_noise(n, R, 9.0))) / SR
    shape = (0.5 + 0.5 * np.cos(TAU * phase)) ** sharp
    return 1.0 - depth * (1.0 - shape)


def formants(x, bank, block=32):
    """Parallel resonances with alternating sign, so the gaps between them stay full."""
    out = np.zeros_like(x)
    sign = 1.0
    for f, bw, gain in bank:
        f = np.asarray(f, dtype=F)
        out += sign * gain * tv_biquad(x, "bp", f, f / bw, block=block)
        sign = -sign
    return out


def voice(dur, R, f0, amp, bank, roll=None, jitter=0.04, shimmer=0.25, sub=0.0, breath=0.3, drive=2.0,
          chest=None, voices=2, detune=0.013, hiss=0.0, open_q=0.6, tilt=None, shape="exp", emph=0.93):
    """One creature call. f0 and amp are breakpoint lists; bank is a list of
    (formant Hz or breakpoints, bandwidth Hz, gain); roll is (rate, depth), each
    a number or breakpoints; chest is (Hz, q, gain) for the body under the voice;
    hiss is breath noise through the same mouth, relative to the voiced part."""
    n = nsamp(dur)

    def cv(v, kind="lin"):
        return curve(n, v, kind) if isinstance(v, (list, tuple)) else v

    f0c = cv(f0, shape)
    ampc = curve(n, amp, "cos")
    subc = cv(sub)
    src = np.zeros(n)
    for k in range(voices):
        offset = 1.0 + detune * (k - (voices - 1) / 2.0)
        src += throat(n, f0c * offset, rng("throat", int(R.integers(1 << 30)), k), jitter, shimmer, subc, breath, open_q, tilt=tilt)
    src /= np.sqrt(voices)
    if roll is not None:
        src *= flutter(n, cv(roll[0]), cv(roll[1]), R)
    bank = [(cv(f), bw, g) for f, bw, g in bank]
    # lift the top of the source so each formant gets a full-strength slice of it
    bright = np.concatenate([[src[0] * (1.0 - emph)], src[1:] - emph * src[:-1]]) / (1.0 - emph) if emph else src
    wet = formants(bright, bank)
    if chest is not None:
        cf, cq, cg = chest
        wet += cg * tv_biquad(src, "bp", cv(cf), cq)
    if hiss:
        air = colored(n, R, -2.0)
        if roll is not None:
            air *= flutter(n, cv(roll[0]), 0.6 * np.asarray(cv(roll[1])), R)
        wet += hiss * np.sqrt(np.mean(wet ** 2)) * _unit(formants(air, [(f, bw * 2.2, g) for f, bw, g in bank]))
    active = ampc > 0.15
    wet /= np.sqrt(np.mean(wet[active] ** 2)) + 1e-9
    return sat_norm(wet * ampc * 0.45, drive)


# ---------------------------------------------------------------------------
# UI
# ---------------------------------------------------------------------------

def tine(f, dur, R, bright=1.0, decay=0.3):
    """A struck metal tongue (thumb-piano like): pure body, a clink on top."""
    n = nsamp(dur)
    y = modal(n, [f, f * 2.0, f * 5.42, f * 8.9], [decay, decay * 0.45, decay * 0.16, decay * 0.07],
              [1.0, 0.12, 0.3 * bright, 0.14 * bright], R, attack=0.0008)
    snap = tick(R, 2500, 9000, 0.002)[:n]
    y[: snap.size] += 0.25 * bright * snap
    return y


@sound("ui_hover", gain=0.3, group="ui")
def ui_hover(R):
    n = nsamp(0.08)
    y = modal(n, [1480, 2350, 3900], [0.011, 0.007, 0.004], [1.0, 0.5, 0.22], R)
    y += 0.25 * nburst(0.08, R, 2500, 7000, 0.005)
    return room(lowpass(y, 6500), "tight", 0.05)


@sound("ui_click", gain=0.45, group="ui")
def ui_click(R):
    n = nsamp(0.14)
    y = 0.8 * thump(0.14, 360, 170, 0.012, 0.028)
    y += 0.7 * modal(n, [620, 1180, 1930, 2900], [0.028, 0.018, 0.011, 0.006], [1.0, 0.6, 0.35, 0.2], R)
    y += 0.25 * nburst(0.14, R, 2000, 8000, 0.003)
    return room(y, "tight", 0.07)


@sound("ui_confirm", gain=0.5, group="ui")
def ui_confirm(R):
    m = Mix(0.6)
    m.add(tine(hz("A4"), 0.3, R, 0.9, 0.16), 0.0, 0.75)
    m.add(tine(hz("D5"), 0.5, R, 1.1, 0.26), 0.085, 1.0)
    m.add(tine(hz("D6"), 0.3, R, 0.6, 0.12), 0.085, 0.22)
    m.add(thump(0.1, 280, 140, 0.01, 0.025), 0.0, 0.45)
    return room(lowpass(m.buf, 7000), "tight", 0.12)


@sound("ui_back", gain=0.42, group="ui")
def ui_back(R):
    m = Mix(0.5)
    m.add(tine(hz("D5"), 0.25, R, 0.6, 0.12), 0.0, 0.8)
    m.add(tine(hz("A4"), 0.4, R, 0.5, 0.2), 0.08, 0.9)
    m.add(sweep(0.16, R, pts((0, 1500), (0.16, 350)), 1.2, pts((0, 0), (0.02, 1), (0.16, 0))), 0.0, 0.12)
    return room(lowpass(m.buf, 3600), "tight", 0.1)


@sound("ui_error", gain=0.5, group="ui")
def ui_error(R):
    m = Mix(0.4)
    for at, level in ((0.0, 1.0), (0.135, 0.9)):
        n = nsamp(0.115)
        buzz = square(hz("G3"), n, 0.42) + square(hz("G#3"), n, 0.5) + 0.6 * square(hz("G2") * 1.01, n, 0.3)
        env = curve(n, pts((0, 0), (0.004, 1), (0.075, 0.85), (0.115, 0)), "cos")
        m.add(lowpass(buzz, 1500, 2) * env, at, 0.5 * level)
        m.add(thump(0.09, 220, 100, 0.012, 0.03, 1.5), at, 0.55 * level)
    return room(m.buf, "tight", 0.06)


def clink(R, f, ring=0.25, bright=1.0):
    """One coin edge: a bright set of inharmonic modes, each doubled a hair apart."""
    ratios = [1.0, 1.58, 2.24, 2.92, 3.61, 4.47]
    amps = [1.0, 0.75, 0.6, 0.42 * bright, 0.3 * bright, 0.2 * bright]
    freqs, decays, levels = [], [], []
    for k, (r, a) in enumerate(zip(ratios, amps)):
        base = f * r * R.uniform(0.996, 1.004)
        for twin, share in ((1.0, 1.0), (1.0035 + 0.002 * k, 0.6)):
            freqs.append(base * twin)
            decays.append(ring / (1.0 + 0.55 * k))
            levels.append(a * share)
    n = nsamp(ring * 5.0)
    y = modal(n, freqs, decays, levels, R, attack=0.0003)
    snap = tick(R, 4000, 14000, 0.0012)[:n]
    y[: snap.size] += 0.5 * snap
    return y


@sound("coin", gain=0.6, group="ui")
def coin(R):
    m = Mix(0.9)
    m.add(clink(R, hz("B6"), 0.09, 0.9), 0.0, 0.7)
    m.add(clink(R, hz("E7"), 0.2, 1.0), 0.072, 1.0)
    m.add(thump(0.05, 900, 500, 0.004, 0.008), 0.0, 0.25)
    return room(highpass(m.buf, 700, 2), "tight", 0.1)


@sound("purchase", gain=0.6, group="ui")
def purchase(R):
    m = Mix(1.0)
    for at, f, level in ((0.0, 2450, 0.55), (0.05, 3150, 0.5), (0.095, 2100, 0.6), (0.15, 2780, 0.5)):
        m.add(clink(R, f * R.uniform(0.97, 1.03), 0.045, 0.8), at + R.uniform(-0.004, 0.004), level)
    at = 0.215
    m.add(thump(0.25, 210, 85, 0.02, 0.055, 1.5), at, 0.9)
    m.add(modal(nsamp(0.2), [310, 525, 890, 1420], [0.05, 0.035, 0.02, 0.012], [1, 0.7, 0.4, 0.25], R), at, 0.6)
    m.add(nburst(0.05, R, 1500, 6000, 0.004), at, 0.14)
    m.add(clink(R, hz("E7"), 0.17, 1.0), at + 0.012, 0.6)
    m.add(clink(R, hz("A6"), 0.14, 0.8), at + 0.012, 0.4)
    return room(m.buf, "tight", 0.1)


@sound("upgrade", gain=0.65, duck=0.2, tail_db=-46.0, cap=1.75, fade_out=0.25, group="ui")
def upgrade(R):
    rise = 0.72
    n = nsamp(rise)
    f = curve(n, pts((0, hz("D2")), (rise, hz("D4"))), "exp")
    stack = sum(saw(f * (1.0 + c), None, R.uniform()) for c in (-0.006, 0.0, 0.007)) / 3.0
    cutoff = curve(n, pts((0, 300), (rise, 5200)), "exp")
    tone = tv_biquad(stack, "lp", cutoff, 1.6)
    trem_rate = curve(n, pts((0, 7), (rise, 26)), "exp")
    trem = 1.0 - 0.45 * (0.5 + 0.5 * np.cos(TAU * np.cumsum(trem_rate) / SR))
    grow = curve(n, pts((0, 0.06), (rise * 0.85, 0.8), (rise, 1.0)), "exp")
    m = Mix(1.9)
    m.add(tone * trem * grow, 0.0, 0.7)
    m.add(sine(f * 0.5) * grow, 0.0, 0.3)
    m.add(sweep(rise, R, pts((0, 300), (rise, 5200)), 1.5, pts((0, 0), (rise * 0.9, 1), (rise, 0.6))), 0.0, 0.2)
    # the landing: an anvil-weight chord on D and A with a thump underneath
    hit = modal(nsamp(1.1), [hz("D4"), hz("A4"), hz("D5"), hz("A5") * 1.004, hz("D6") * 0.997, 2637 * 1.31, 5120],
                [0.5, 0.42, 0.36, 0.28, 0.22, 0.1, 0.05], [1.0, 0.8, 0.7, 0.45, 0.35, 0.25, 0.15], R, attack=0.0006)
    m.add(hit, rise, 0.6)
    m.add(thump(0.5, 150, 58, 0.03, 0.13, 1.8), rise, 0.7)
    m.add(nburst(0.08, R, 1800, 9000, 0.006), rise, 0.25)
    m.add(tine(hz("D7"), 0.5, R, 1.0, 0.2), rise + 0.02, 0.2)
    return room(m.buf, "pit", 0.14)


@sound("equip", gain=0.55, group="ui")
def equip(R):
    m = Mix(0.5)
    n = nsamp(0.17)
    strap = sweep(0.17, R, pts((0, 900), (0.07, 2300), (0.17, 1200)), 1.3,
                  pts((0, 0), (0.03, 0.8), (0.08, 1.0), (0.17, 0)), slope=-1.0)
    strap *= 0.55 + 0.45 * np.clip(smooth_noise(n, R, 70.0), -1, 1)
    m.add(strap, 0.0, 0.35)
    m.add(thump(0.12, 240, 110, 0.01, 0.03, 1.5), 0.12, 0.55)
    m.add(modal(nsamp(0.1), [2900, 4350, 6100], [0.014, 0.01, 0.006], [1, 0.7, 0.4], R), 0.12, 0.55)
    m.add(modal(nsamp(0.1), [3300, 4900, 7200], [0.016, 0.011, 0.007], [1, 0.7, 0.4], R), 0.158, 0.7)
    m.add(modal(nsamp(0.3), [1760, 3940, 5270], [0.07, 0.05, 0.03], [1, 0.5, 0.3], R), 0.158, 0.2)
    m.add(nburst(0.03, R, 2500, 9000, 0.002), 0.158, 0.2)
    return room(m.buf, "tight", 0.08)


def horn_call(notes, R, bright=1.0, rough=0.07):
    """A war horn: detuned saws whose filter opens with the breath.
    notes = [(start, end, Hz, level)], tongued one after another."""
    end = max(e for _, e, _, _ in notes) + 0.25
    n = nsamp(end)
    t = secs(n)
    f = np.full(n, notes[0][2], dtype=F)
    amp = np.zeros(n)
    for start, stop, pitch, level in notes:
        on = t >= start
        scoop = 1.0 - 0.035 * np.exp(-np.maximum(t - start, 0.0) / 0.03)
        f = np.where(on, pitch * scoop, f)
        seg = np.clip((t - start) / 0.045, 0, 1) ** 0.7 * np.where(t > stop, np.exp(-(t - stop) / 0.06), 1.0)
        swell = 0.8 + 0.2 * np.clip((t - start) / max(stop - start, 0.05), 0, 1)
        amp = np.where(on, level * seg * swell, amp)
    last_start, last_stop = notes[-1][0], notes[-1][1]
    f = f * (1.0 - 0.03 * np.clip((t - last_stop + 0.05) / 0.2, 0, 1) ** 2)
    f = f * (1.0 + 0.004 * np.sin(TAU * 5.2 * t) * np.clip((t - last_start - 0.25) / 0.3, 0, 1))
    amp = one_pole(amp, 60.0)
    lips = 1.0 + rough * smooth_noise(n, R, 38.0)
    tone = sum(saw(f * (1.0 + c) * (1.0 + 0.0015 * smooth_noise(n, R, 3.0)), None, R.uniform()) for c in (-0.004, 0.0, 0.0045)) / 3.0
    cutoff = 240.0 + 2900.0 * bright * amp ** 1.6
    tone = tv_biquad(tone * lips, "lp", cutoff, 1.1)
    tone = eq(tone, [("peak", 520.0, 1.4, 4.0), ("peak", 1250.0, 1.6, 2.5), ("hp", 90.0, 0.7, 0.0)])
    air = bandpass(white(n, R), 900, 3200, 1) * amp * 0.03
    return sat((tone + air) * amp * 1.6, 1.0)


@sound("challenge", gain=0.65, duck=0.4, tail_db=-44.0, fade_out=0.3, cap=1.8, group="ui")
def challenge(R):
    notes = [(0.0, 0.2, hz("D3"), 0.8), (0.24, 1.12, hz("A3"), 1.0)]
    m = Mix(1.5, True)
    m.add(horn_call(notes, R), 0.0, 1.0)
    m.add(horn_call([(0.24, 1.12, hz("A2"), 0.9)], R, bright=0.6), 0.0, 0.45)
    return room(m.buf, "arena", 0.3)


@sound("tick", gain=0.38, group="ui")
def tick_sound(R):
    n = nsamp(0.06)
    y = modal(n, [2150, 3380, 5300], [0.006, 0.004, 0.003], [1.0, 0.6, 0.3], R, attack=0.0002)
    y += 0.5 * thump(0.06, 950, 700, 0.004, 0.007)
    y += 0.2 * nburst(0.06, R, 3000, 10000, 0.0015)
    return y


# ---------------------------------------------------------------------------
# movement and impact
# ---------------------------------------------------------------------------

@sound("whoosh_light", gain=0.5, group="move")
def whoosh_light(R):
    d = 0.3
    amp = pts((0, 0), (0.035, 0.2), (0.115, 1.0), (0.19, 0.3), (d, 0))
    y = sweep(d, R, pts((0, 600), (0.11, 2700), (d, 950)), 1.6, amp, slope=-2.0)
    y += 0.3 * sweep(d, R, pts((0, 1500), (0.11, 6000), (d, 2400)), 2.4, amp, slope=0.0)
    return y


@sound("whoosh_heavy", gain=0.62, group="move")
def whoosh_heavy(R):
    d = 0.55
    amp = pts((0, 0), (0.08, 0.2), (0.24, 1.0), (0.36, 0.35), (d, 0))
    y = sweep(d, R, pts((0, 180), (0.24, 1300), (d, 300)), 1.4, amp, slope=-2.5)
    y += 0.35 * sweep(d, R, pts((0, 600), (0.24, 3400), (d, 900)), 2.0, amp, slope=-1.0)
    n = nsamp(d)
    wub = sine(curve(n, pts((0, 60), (0.24, 105), (d, 55)))) * curve(n, amp, "cos") ** 1.5
    return y + 0.9 * wub


def _hit_light(v):
    low_hi, low_lo, tau, lo, hi, crack_t = [(215, 96, 0.055, 1400, 4500, 0.012), (250, 110, 0.045, 1800, 5500, 0.010),
                                             (190, 84, 0.065, 1000, 3500, 0.014)][v]

    def make(R):
        y = blow(R, 0.3, (low_hi, low_lo, 0.018, tau, 1.4, 0.8), (low_hi * 2.0, low_lo * 1.8, 0.01, 0.03, 1.3, 0.7),
                 (300, 2000, 0.02, 0.5), (lo, hi, crack_t, 0.75))
        snap = tick(R, 2500, 9000, 0.002)
        y[: snap.size] += 0.6 * snap
        return room(y, "pit", 0.06)
    return make


for _v in range(3):
    sound(f"hit_light_{_v + 1}", gain=0.8, tail_db=-42.0, group="impact")(_hit_light(_v))


def _hit_heavy(v):
    low_hi, low_lo, tau, grind_g, crack_g = [(160, 68, 0.14, 0.8, 0.8), (180, 76, 0.12, 1.0, 0.65), (145, 61, 0.16, 0.7, 0.95)][v]

    def make(R):
        y = blow(R, 0.7, (low_hi, low_lo, 0.035, tau, 1.8, 0.9), (low_hi * 2.0, low_lo * 1.9, 0.014, 0.05, 1.5, 1.0),
                 (150, 2400, 0.05, grind_g), (2000, 9000, 0.008, crack_g))
        if v == 1:
            y[: nsamp(0.12)] += 0.35 * modal(nsamp(0.12), [410, 730, 1190], [0.03, 0.02, 0.012], [1, 0.6, 0.4], R)
        return room(y, "pit", 0.11)
    return make


for _v in range(3):
    sound(f"hit_heavy_{_v + 1}", gain=1.0, duck=0.15, tail_db=-42.0, group="impact")(_hit_heavy(_v))


@sound("hit_crit", gain=1.0, duck=0.25, tail_db=-46.0, group="impact")
def hit_crit(R):
    m = Mix(1.0)
    m.add(blow(R, 0.7, (170, 70, 0.035, 0.14, 1.8, 0.9), (340, 140, 0.014, 0.05, 1.5, 1.0), (150, 2400, 0.05, 0.8),
               (2000, 9000, 0.008, 0.8)), 0.0, 1.0)
    ring_f = [3136, 4435, 5920, 7480, 9100]
    freqs = [f * k for f in ring_f for k in (1.0, 1.004)]
    decays = [d for d in (0.3, 0.24, 0.17, 0.12, 0.08) for _ in (0, 1)]
    amps = [a * s for a in (1.0, 0.8, 0.55, 0.4, 0.25) for s in (1.0, 0.7)]
    m.add(modal(nsamp(0.9), freqs, decays, amps, R, attack=0.0002, glide=-0.012, glide_time=0.08), 0.0, 0.2)
    m.add(nburst(0.03, R, 4000, 14000, 0.002), 0.0, 0.5)
    m.add(nburst(0.2, R, 5000, 12000, 0.05, attack=0.002), 0.0, 0.1)
    return room(m.buf, "pit", 0.12)


@sound("block", gain=0.9, tail_db=-42.0, group="impact")
def block(R):
    m = Mix(0.45)
    clang = modal(nsamp(0.4), [233, 412, 688, 1010, 1530, 2210], [0.07, 0.06, 0.045, 0.034, 0.022, 0.014],
                  [1, 0.8, 0.6, 0.45, 0.3, 0.2], R)
    m.add(clang, 0.0, 1.0)
    m.add(thump(0.3, 170, 75, 0.02, 0.06, 1.6), 0.0, 0.7)
    m.add(thump(0.15, 380, 190, 0.01, 0.03, 1.3), 0.0, 0.5)
    m.add(nburst(0.05, R, 1500, 6000, 0.004), 0.0, 0.35)
    return room(lowpass(sat(m.buf, 1.3), 4200), "pit", 0.09)


@sound("guard_crush", gain=1.0, duck=0.25, tail_db=-46.0, group="impact")
def guard_crush(R):
    m = Mix(1.1, True)
    m.add(blow(R, 0.7, (160, 66, 0.035, 0.15, 1.8, 0.9), (320, 130, 0.014, 0.05, 1.5, 1.0), (150, 2400, 0.06, 1.0),
               (2000, 9000, 0.008, 0.9)), 0.0, 1.0)
    for at, level in ((0.0, 1.0), (0.019, 0.7), (0.043, 0.85)):
        where = R.uniform(-0.3, 0.3)
        m.add(ping(R, R.uniform(700, 1100), 0.008), at, 0.6 * level, where)
        m.add(tick(R, 1000, 8000, 0.0025), at, 0.5 * level, where)
    n = nsamp(0.3)
    drop = saw(curve(n, pts((0, 520), (0.28, 130)), "exp")) * curve(n, pts((0, 0), (0.006, 1), (0.2, 0.5), (0.3, 0)), "cos")
    m.add(sat(lowpass(drop, 1800), 2.0), 0.01, 0.35)
    for _ in range(60):
        at = 0.015 + R.exponential(0.17)
        if at > 0.95:
            continue
        m.add(ping(R, R.uniform(1800, 9000), R.uniform(0.006, 0.03), 2, 1.5), at, 0.6 * np.exp(-at / 0.3) * R.uniform(0.3, 1.0), R.uniform(-0.9, 0.9))
    hiss = grit(nsamp(0.6), R, 55.0, 3000, 9000) * perc(nsamp(0.6), 0.01, 0.16)
    m.add(wide(hiss, R), 0.02, 0.35)
    return room(m.buf, "pit", 0.14)


@sound("interrupt", gain=0.85, tail_db=-42.0, group="impact")
def interrupt(R):
    m = Mix(0.22)
    n = nsamp(0.06)
    chirp = sine(curve(n, pts((0, 3400), (0.028, 520), (0.06, 420)), "exp")) * perc(n, 0.0003, 0.011)
    m.add(chirp, 0.0, 1.0)
    m.add(nburst(0.08, R, 2500, 9000, 0.007), 0.0, 0.7)
    m.add(thump(0.12, 420, 190, 0.008, 0.024, 1.5), 0.0, 0.9)
    m.add(thump(0.12, 190, 110, 0.012, 0.03, 1.3), 0.0, 0.5)
    m.add(nburst(0.05, R, 1800, 7000, 0.005), 0.032, 0.12)
    return room(sat(m.buf, 1.2), "pit", 0.07)


def _sand(dur, R, decay, lo=1800.0, hi=7000.0):
    n = nsamp(dur)
    grain = 0.45 + 0.55 * np.clip(smooth_noise(n, R, 120.0), -1, 1)
    return _unit(bandpass(white(n, R), lo, hi, 2)) * grain * perc(n, 0.012, decay)


@sound("body_fall", gain=0.9, duck=0.15, tail_db=-44.0, group="impact")
def body_fall(R):
    m = Mix(1.1)
    m.add(blow(R, 0.7, (125, 60, 0.04, 0.13, 1.8, 0.9), (250, 105, 0.02, 0.06, 1.4, 0.7), (60, 600, 0.09, 0.6), None,
               rumble=(85.0, 0.14, 0.3)), 0.0, 1.0)
    m.add(_sand(0.6, R, 0.15), 0.0, 0.16)
    m.add(thump(0.35, 110, 55, 0.03, 0.08, 1.6), 0.21, 0.35)
    m.add(crunch(0.3, R, 60, 500, 0.05), 0.21, 0.2)
    m.add(_sand(0.4, R, 0.1), 0.21, 0.07)
    m.add(_sand(0.7, R, 0.3, 2500, 8000), 0.25, 0.025)
    return room(m.buf, "pit", 0.1)


@sound("entrance", gain=1.0, duck=0.35, tail_db=-46.0, group="impact")
def entrance(R):
    m = Mix(1.5, True)
    at = 0.14
    m.add(sweep(0.16, R, pts((0, 2600), (0.16, 280)), 1.3, pts((0, 0), (0.12, 1.0), (0.16, 0.0))), 0.0, 0.2)
    m.add(blow(R, 1.0, (140, 54, 0.05, 0.2, 2.0, 0.9), (280, 105, 0.015, 0.06, 1.6, 0.9), (100, 1800, 0.09, 0.9),
               (1500, 8000, 0.01, 0.6), rumble=(80.0, 0.22, 0.35)), at, 1.0)
    for _ in range(70):
        dt = R.exponential(0.22)
        if dt > 1.1:
            continue
        m.add(ping(R, R.uniform(900, 6000), R.uniform(0.003, 0.014), 2, 1.6), at + 0.02 + dt,
              0.36 * np.exp(-dt / 0.35) * R.uniform(0.3, 1.0), R.uniform(-0.9, 0.9))
    m.add(wide(_sand(0.9, R, 0.3, 2500, 8000), R), at, 0.07)
    return room(m.buf, "arena", 0.16)


# ---------------------------------------------------------------------------
# creature voices
# ---------------------------------------------------------------------------

@sound("roar_quad", gain=0.9, duck=0.35, tail_db=-46.0, group="voice")
def roar_quad(R):
    d = 1.7
    f0 = pts((0, 92), (0.12, 150), (0.38, 168), (0.9, 128), (1.3, 92), (d, 60))
    amp = pts((0, 0), (0.05, 0.75), (0.22, 1.0), (0.85, 0.92), (1.25, 0.6), (1.55, 0.25), (d, 0))
    bank = [(pts((0, 330), (0.3, 580), (1.0, 540), (d, 340)), 120, 1.5),
            (pts((0, 900), (0.3, 1280), (1.0, 1180), (d, 880)), 170, 0.9),
            (pts((0, 1900), (0.3, 2350), (1.0, 2250), (d, 1850)), 260, 0.45),
            (3200.0, 400, 0.22)]
    roll = (pts((0, 30), (0.4, 36), (1.2, 27), (d, 20)), pts((0, 0.35), (0.3, 0.5), (1.0, 0.6), (d, 0.85)))
    main = voice(d, R, f0, amp, bank, roll, jitter=0.05, shimmer=0.3, sub=pts((0, 0.15), (0.9, 0.3), (d, 0.7)),
                 breath=0.35, drive=2.2, chest=(175.0, 1.6, 0.75), hiss=0.3)
    low = voice(d, R, [(t, f * 0.5) for t, f in f0], amp, [(260.0, 160, 1.0), (520.0, 200, 0.4)], roll,
                jitter=0.06, shimmer=0.3, sub=0.3, breath=0.15, drive=1.5, chest=(110.0, 1.2, 1.0), voices=1)
    m = Mix(d)
    m.add(main, 0.0, 1.0)
    m.add(lowpass(low, 420), 0.0, 0.25)
    m.add(nburst(0.09, R, 900, 3500, 0.02, attack=0.004), 0.0, 0.1)
    y = eq(m.buf, [("hp", 60.0, 0.7, 0.0), ("hs", 6000.0, 0.7, -4.0)])
    return room(y, "pit", 0.15)


@sound("roar_biped", gain=0.9, duck=0.35, tail_db=-46.0, group="voice")
def roar_biped(R):
    d = 1.75
    f0 = pts((0, 62), (0.3, 96), (0.95, 90), (1.4, 72), (d, 52))
    amp = pts((0, 0), (0.06, 0.8), (0.3, 1.0), (1.05, 0.9), (1.45, 0.5), (d, 0))
    bank = [(pts((0, 270), (0.35, 450), (1.1, 410), (d, 290)), 100, 1.8),
            (pts((0, 620), (0.35, 820), (1.1, 770), (d, 640)), 140, 1.3),
            (pts((0, 1300), (0.35, 1520), (d, 1340)), 220, 0.5),
            (2300.0, 350, 0.2)]
    roll = (pts((0, 17), (0.5, 22), (d, 15)), pts((0, 0.25), (0.6, 0.4), (d, 0.6)))
    main = voice(d, R, f0, amp, bank, roll, jitter=0.035, shimmer=0.22, sub=pts((0, 0.1), (1.0, 0.25), (d, 0.5)),
                 breath=0.25, drive=1.9, chest=(125.0, 1.3, 0.8), hiss=0.22, open_q=0.7)
    n = nsamp(d)
    ampc = curve(n, amp, "cos")
    rumble = _unit(lowpass(colored(n, R, -6.0), 140, 2)) * ampc * (0.7 + 0.3 * smooth_noise(n, R, 6.0))
    grind = lowpass(grit(n, R, 30.0, 150, 1200), 900) * ampc
    m = Mix(d)
    m.add(main, 0.0, 1.0)
    m.add(rumble, 0.0, 0.05)
    m.add(grind, 0.0, 0.12)
    y = eq(m.buf, [("hp", 50.0, 0.7, 0.0), ("hs", 5000.0, 0.7, -5.0)])
    return room(y, "pit", 0.2)


@sound("roar_serpent", gain=0.8, duck=0.35, tail_db=-46.0, group="voice")
def roar_serpent(R):
    d = 1.7
    n = nsamp(d)
    t = secs(n)
    lift = curve(n, pts((0, 0.9), (1.0, 1.12), (d, 1.2)))
    air = white(n, R)
    hiss = np.zeros(n)
    for f, bw, g in ((3100, 1100, 0.9), (4700, 1500, 1.0), (6500, 1900, 0.6)):
        hiss += g * tv_biquad(air, "bp", f * lift, f / bw, block=64)
    swell = curve(n, pts((0, 0), (0.025, 0.5), (0.2, 0.35), (0.6, 0.6), (1.0, 1.0), (1.3, 0.7), (d, 0)), "cos")
    tongue = 1.0 - curve(n, pts((0, 0.05), (0.8, 0.25), (d, 0.5))) * (0.5 + 0.5 * np.sin(TAU * 43.0 * t + 2.0 * smooth_noise(n, R, 5.0)))
    hiss = hiss * swell * tongue
    gullet = tv_biquad(colored(n, R, -1.0), "bp", curve(n, pts((0, 900), (d, 1500))), 2.5, block=64)
    gullet *= swell * flutter(n, 31.0, 0.6, R)
    m = Mix(d)
    m.add(hiss, 0.0, 0.5)
    m.add(gullet, 0.0, 0.12)
    # the rattle: dry, noisy shell clicks that speed up
    rate = curve(n, pts((0, 13), (0.7, 16), (1.45, 58), (d, 60)), "exp")
    level = curve(n, pts((0, 0), (0.62, 0), (0.8, 0.45), (1.42, 1.0), (1.6, 0.6), (d, 0)), "cos")
    marks = np.nonzero(np.diff(np.floor(np.cumsum(rate) / SR)) > 0)[0]
    for i in marks:
        if level[i] <= 0.01:
            continue
        g = level[i] * R.uniform(0.6, 1.0)
        m.add(tick(R, 2400, 8500, 0.0035), i / SR, 0.9 * g)
        m.add(ping(R, R.uniform(1800, 4200), 0.004, 2, 1.8), i / SR, 0.25 * g)
    y = lowpass(highpass(m.buf, 500, 2), 9500, 2)
    return room(y, "pit", 0.07)


@sound("roar_winged", gain=0.62, duck=0.35, tail_db=-46.0, group="voice")
def roar_winged(R):
    d = 1.3
    f0 = pts((0, 880), (0.06, 1280), (0.25, 1460), (0.7, 1260), (1.05, 900), (d, 640))
    amp = pts((0, 0), (0.03, 0.9), (0.2, 1.0), (0.8, 0.85), (1.1, 0.45), (d, 0))
    bank = [(pts((0, 1700), (0.3, 1900), (d, 1500)), 420, 1.0),
            (pts((0, 2900), (0.3, 3200), (d, 2600)), 520, 0.6),
            (4300.0, 700, 0.25), (6000.0, 900, 0.1)]
    roll = (pts((0, 95), (0.6, 80), (d, 62)), pts((0, 0.45), (0.7, 0.55), (d, 0.8)))
    main = voice(d, R, f0, amp, bank, roll, jitter=0.05, shimmer=0.35, sub=pts((0, 0.25), (0.7, 0.45), (d, 0.8)),
                 breath=0.55, drive=2.6, hiss=0.3, open_q=0.5, emph=0.8)
    under = voice(d, R, [(t, f * 0.25) for t, f in f0], amp, [(420.0, 150, 1.0), (900.0, 220, 0.6)],
                  (34.0, 0.6), jitter=0.06, shimmer=0.3, sub=0.4, breath=0.2, drive=2.0, voices=1)
    m = Mix(d)
    m.add(main, 0.0, 1.0)
    m.add(lowpass(under, 1300), 0.0, 0.4)
    y = eq(m.buf, [("hp", 220.0, 0.7, 0.0), ("lp", 8000.0, 0.7, 0.0)])
    return room(y, "pit", 0.18)


def _pain(v):
    def make(R):
        if v == 0:      # low grunt
            d = 0.34
            f0 = pts((0, 105), (0.05, 126), (d, 68))
            bank = [(pts((0, 400), (d, 300)), 110, 1.5), (pts((0, 980), (d, 800)), 160, 0.8), (2200.0, 300, 0.3)]
            roll, chest, hp, drive = (30.0, 0.5), (140.0, 1.4, 0.8), 55.0, 2.2
        elif v == 1:    # snarling yelp
            d = 0.37
            f0 = pts((0, 212), (0.06, 282), (0.18, 244), (d, 158))
            bank = [(pts((0, 640), (d, 500)), 130, 1.2), (pts((0, 1380), (d, 1150)), 190, 0.6), (2500.0, 320, 0.25)]
            roll, chest, hp, drive = (46.0, 0.6), (230.0, 1.4, 0.9), 80.0, 2.4
        else:           # high shriek
            d = 0.31
            f0 = pts((0, 490), (0.05, 650), (0.15, 575), (d, 400))
            bank = [(pts((0, 980), (d, 850)), 180, 1.0), (pts((0, 1950), (d, 1700)), 260, 0.5), (3100.0, 420, 0.22)]
            roll, chest, hp, drive = (82.0, 0.6), (480.0, 1.5, 0.7), 180.0, 2.6
        amp = pts((0, 0), (0.012, 1.0), (d * 0.45, 0.8), (d, 0))
        y = voice(d, R, f0, amp, bank, roll, jitter=0.05, shimmer=0.3, sub=0.3, breath=0.4, drive=drive, chest=chest, hiss=0.25)
        burst = nburst(0.05, R, 700, 4000, 0.012)
        y[: burst.size] += 0.12 * burst
        return room(eq(y, [("hp", hp, 0.7, 0.0), ("hs", 6500.0, 0.7, -5.0)]), "pit", 0.1)
    return make


for _v in range(3):
    sound(f"pain_{_v + 1}", gain=0.75, tail_db=-44.0, group="voice")(_pain(_v))


def _faint(v):
    """A dazed "ooh" that sags as the beast goes down: no rattle, no last breath.
    v 0 is a low, big-bodied voice, v 1 a high one."""
    def make(R):
        d = 1.25
        n = nsamp(d)
        top = (190.0, 420.0)[v]
        f0 = curve(n, pts((0, top * 0.92), (0.1, top), (0.45, top * 0.72), (d, top * 0.45)), "exp")
        f0 = f0 * (1.0 + 0.04 * np.sin(TAU * 5.5 * secs(n)))   # a woozy wobble
        amp = pts((0, 0), (0.05, 1.0), (0.4, 0.85), (0.95, 0.55), (d, 0))
        bank = [(pts((0, 650 + 150 * v), (d, 420 + 100 * v)), 130, 1.4),
                (pts((0, 1050 + 300 * v), (d, 760 + 200 * v)), 180, 0.6), (2500.0, 300, 0.2)]
        main = voice(d, R, f0, amp, bank, None, jitter=0.04, shimmer=0.22, sub=0.15, breath=0.4, drive=1.8, hiss=0.25)
        y = eq(main, [("hp", 60.0 + 30.0 * v, 0.7, 0.0), ("hs", 5500.0, 0.7, -5.0)])
        return room(y, "pit", 0.16)
    return make


for _v in range(2):
    sound(f"faint_{_v + 1}", gain=0.8, duck=0.25, tail_db=-46.0, group="voice")(_faint(_v))


@sound("dizzy", gain=0.45, stereo=True, tail_db=-46.0, group="fight")
def dizzy(R):
    # stars round the head: little bells chasing each other left and right
    d = 2.3
    m = Mix(d, True)
    for i, name in enumerate(("E6", "B6", "Ab6", "E7", "Db7", "B6", "Ab6", "E6")):
        f = hz(name) * (1.0 + R.uniform(-0.002, 0.002))
        ping = modal(nsamp(0.7), [f, f * 2.0, f * 2.76], [0.35, 0.18, 0.08], [1.0, 0.25, 0.12], R, attack=0.002)
        m.add(ping, 0.03 + 0.2 * i, 0.3 * (1.0 - 0.07 * i), 0.75 * np.sin(1.6 * i))
    return room(m.buf, "arena", 0.3)


# ---------------------------------------------------------------------------
# fight system
# ---------------------------------------------------------------------------

def bell_note(f, dur, R, decay=0.4, bright=1.0):
    n = nsamp(dur)
    return modal(n, [f, f * 2.0, f * 2.99, f * 4.2, f * 5.43], [decay, decay * 0.6, decay * 0.4, decay * 0.25, decay * 0.18],
                 [1.0, 0.45, 0.3 * bright, 0.2 * bright, 0.12 * bright], R, attack=0.0008)


@sound("rage_full", gain=0.75, duck=0.3, tail_db=-46.0, cap=1.5, fade_out=0.25, group="fight")
def rage_full(R):
    d = 0.62
    snarl = voice(d, R, pts((0, 120), (0.1, 186), (0.35, 172), (d, 124)), pts((0, 0), (0.03, 1.0), (0.3, 0.8), (d, 0)),
                  [(pts((0, 480), (0.2, 560), (d, 430)), 120, 1.4), (pts((0, 1250), (0.2, 1400), (d, 1150)), 180, 0.8), (2500.0, 300, 0.35)],
                  (40.0, 0.75), jitter=0.05, shimmer=0.3, sub=0.35, breath=0.4, drive=2.5, chest=(180.0, 1.4, 0.7), hiss=0.3)
    m = Mix(1.5, True)
    m.add(snarl, 0.0, 0.9)
    for at, name, level in ((0.16, "D6", 0.5), (0.27, "A6", 0.6), (0.38, "D7", 0.7), (0.5, "A7", 0.55)):
        m.add(bell_note(hz(name), 0.9, R, 0.32), at, 0.26 * level, R.uniform(-0.6, 0.6))
    n = nsamp(0.75)
    glide = curve(n, pts((0, hz("D5")), (0.5, hz("D6")), (0.75, hz("D6"))), "exp")
    trem = 0.6 + 0.4 * np.sin(TAU * 13.0 * secs(n))
    tone = (sine(glide) + 0.5 * sine(glide * 1.498) + 0.3 * sine(glide * 2.0)) * trem * curve(n, pts((0, 0), (0.45, 1.0), (0.75, 0)), "cos")
    m.add(tone, 0.12, 0.09)
    air = sweep(0.9, R, pts((0, 3000), (0.5, 9000), (0.9, 9500)), 2.0, pts((0, 0), (0.45, 1.0), (0.9, 0)), slope=0.0)
    air *= 0.6 + 0.4 * np.sin(TAU * 14.0 * secs(air.shape[0]))
    m.add(wide(air, R), 0.1, 0.05)
    return room(m.buf, "arena", 0.12)


@sound("special_charge", gain=0.7, duck=0.3, exact=1.6, fade_out=0.035, group="fight")
def special_charge(R):
    d = 1.6
    n = nsamp(d)
    grow = curve(n, pts((0, 0.04), (1.0, 0.4), (1.56, 1.0), (d, 1.0)), "exp")
    f = curve(n, pts((0, 55), (d, 220)), "exp")
    stack = sum(saw(f * (1.0 + c), None, R.uniform()) for c in (-0.007, 0.0, 0.008)) / 3.0
    tone = tv_biquad(stack, "lp", curve(n, pts((0, 200), (d, 6000)), "exp"), 1.8)
    rate = curve(n, pts((0, 5), (d, 30)), "exp")
    pulse = 1.0 - 0.6 * (0.5 + 0.5 * np.cos(TAU * np.cumsum(rate) / SR)) ** 2
    m = Mix(d, True)
    m.add(tone * pulse * grow, 0.0, 0.7)
    m.add(sine(f * 0.5) * grow, 0.0, 0.25)
    air = sweep(d, R, pts((0, 250), (d, 6500)), 2.0, pts((0, 0), (1.5, 1.0), (d, 1.0)), slope=-1.0) * grow
    m.add(wide(air, R), 0.0, 0.14)
    sparks = grit(n, R, 60.0, 4000, 11000) * grow ** 2
    m.add(wide(sparks, R), 0.0, 0.16)
    return m.buf


@sound("special_ember", gain=0.95, duck=0.4, stereo=True, tail_db=-48.0, group="fight")
def special_ember(R):
    d = 1.8
    n = nsamp(d)
    m = Mix(d, True)
    m.add(blow(R, 0.6, (120, 50, 0.05, 0.14, 1.8, 0.7), (240, 100, 0.02, 0.06, 1.4, 0.5), (60, 900, 0.1, 0.5), None), 0.0, 1.0)
    m.add(sweep(0.5, R, pts((0, 300), (0.16, 2600), (0.5, 700)), 1.2, pts((0, 0), (0.05, 1.0), (0.5, 0))), 0.0, 0.3)
    env = perc(n, 0.03, 0.5)
    for side in (-1.0, 1.0):
        flame = _unit(bandpass(colored(n, R, -4.0), 130, 1800, 2))
        lick = 0.5 + 0.5 * np.abs(smooth_noise(n, R, 13.0))
        m.add(flame * env * lick, 0.0, 0.55, side * 0.7)
    for _ in range(55):
        at = R.uniform(0.02, 1.5)
        m.add(tick(R, 2000, 9000, R.uniform(0.0008, 0.003)), at, 0.3 * np.exp(-at / 0.6) * min(float(R.pareto(3.0)), 2.5), R.uniform(-0.9, 0.9))
    hiss = _unit(highpass(white(n, R), 4000, 2)) * perc(n, 0.05, 0.45)
    m.add(wide(hiss, R), 0.0, 0.05)
    return room(m.buf, "pit", 0.08)


def _creak(dur, R, rate_pts, amp_pts, modes):
    """Stick-slip: irregular little slips ringing a set of woody resonances."""
    n = nsamp(dur)
    rate = curve(n, rate_pts, "exp") * (1.0 + 0.2 * smooth_noise(n, R, 12.0))
    marks = np.nonzero(np.diff(np.floor(np.cumsum(rate) / SR)) > 0)[0]
    drive = np.zeros(n)
    drive[marks] = R.uniform(0.5, 1.0, marks.size)
    drive = lowpass(drive, 3500, 1)
    out = np.zeros(n)
    for f, q, g in modes:
        out += g * biquad(drive, "res", f, q)
    out *= curve(n, amp_pts, "cos")
    return out / (np.max(np.abs(out)) + 1e-9)


@sound("special_thorn", gain=0.95, duck=0.4, tail_db=-46.0, group="fight")
def special_thorn(R):
    d = 1.8
    m = Mix(d, True)
    modes = [(430, 14, 1.0), (910, 16, 0.8), (1380, 12, 0.6), (2240, 10, 0.35)]
    creak = _creak(0.95, R, pts((0, 24), (0.35, 72), (0.5, 38), (0.86, 115), (0.95, 120)),
                   pts((0, 0), (0.05, 0.7), (0.4, 0.9), (0.5, 0.4), (0.86, 1.0), (0.93, 0)), modes)
    m.add(creak, 0.0, 0.8, -0.15)
    creak2 = _creak(0.8, R, pts((0, 15), (0.5, 44), (0.8, 85)), pts((0, 0), (0.1, 0.6), (0.7, 0.8), (0.8, 0)),
                    [(f * 0.63, q, g) for f, q, g in modes])
    m.add(creak2, 0.08, 0.55, 0.3)
    n = nsamp(1.0)
    rumble = _unit(lowpass(colored(n, R, -6.0), 150, 2)) * curve(n, pts((0, 0), (0.3, 0.6), (0.88, 1.0), (1.0, 0)), "cos")
    m.add(rumble, 0.0, 0.1)
    launch = 0.9
    m.add(blow(R, 0.3, (170, 70, 0.02, 0.06, 1.6, 0.6), (340, 150, 0.012, 0.03, 1.3, 0.5), (200, 2000, 0.03, 0.3), None), launch, 1.0)
    m.add(sweep(0.14, R, pts((0, 600), (0.14, 3600)), 1.5, pts((0, 0), (0.04, 1.0), (0.14, 0))), launch - 0.02, 0.35)
    for _ in range(26):
        at = launch + R.uniform(0.0, 0.33)
        dart = sweep(0.03, R, pts((0, 6500), (0.03, 2400)), 3.0, pts((0, 0), (0.004, 1.0), (0.03, 0)), slope=0.0)
        where = R.uniform(-0.9, 0.9)
        m.add(dart, at, 0.09 * R.uniform(0.5, 1.0), where)
        land = at + R.uniform(0.1, 0.32)
        if land < d - 0.1:
            m.add(ping(R, R.uniform(1200, 2600), R.uniform(0.006, 0.01), 2, 1.9), land, 0.4 * R.uniform(0.4, 1.0), where)
    return room(m.buf, "pit", 0.1)


@sound("special_stone", gain=1.0, duck=0.4, tail_db=-46.0, group="fight")
def special_stone(R):
    d = 2.0
    m = Mix(d, True)
    m.add(blow(R, 1.0, (120, 50, 0.05, 0.21, 2.0, 0.9), (230, 95, 0.02, 0.07, 1.6, 0.9), (90, 2200, 0.07, 0.8),
               (1500, 9000, 0.01, 0.5), rumble=(80.0, 0.24, 0.35)), 0.0, 1.0)
    m.add(modal(nsamp(0.6), [172, 263, 388, 541, 760], [0.12, 0.1, 0.08, 0.06, 0.04], [1, 0.8, 0.6, 0.5, 0.3], R), 0.0, 0.6)
    for _ in range(42):
        at = 0.05 + R.exponential(0.34)
        if at > d - 0.25:
            continue
        size = R.uniform(0.0, 1.0)
        rock = ping(R, 250.0 + 2300.0 * (1.0 - size) ** 1.5, 0.012 + 0.035 * size, 3, 1.63)
        where = R.uniform(-0.9, 0.9)
        level = 0.75 * np.exp(-at / 0.55) * R.uniform(0.35, 1.0)
        m.add(rock, at, level, where)
        m.add(tick(R, 1500, 7000, 0.002), at, 0.5 * level, where)
        if size > 0.75:
            m.add(thump(0.12, 190, 95, 0.012, 0.03, 1.5), at, 0.9 * level, where)
    m.add(wide(_sand(1.2, R, 0.42, 1200, 6000), R), 0.03, 0.08)
    return room(m.buf, "arena", 0.15)


def _thunder(m, R, at, d, level=1.0, cut=pts((0, 2800), (0.3, 900), (1.2, 260), (2.4, 120))):
    n = nsamp(d)
    for side in (-1.0, 1.0):
        roll = colored(n, R, -4.0)
        roll = tv_biquad(roll, "lp", curve(n, cut, "exp"), 0.7, block=64)
        roll = roll / (np.sqrt(np.mean(roll[: nsamp(0.4)] ** 2)) + 1e-9)
        shape = curve(n, pts((0, 0), (0.02, 1.0), (0.25, 0.7), (0.8, 0.5), (1.6, 0.22), (d, 0)), "cos")
        m.add(roll * shape * (0.6 + 0.4 * np.abs(smooth_noise(n, R, 5.0))), at, 0.3 * level, side * 0.75)


@sound("special_storm", gain=0.95, duck=0.4, stereo=True, tail_db=-46.0, cap=2.2, fade_out=0.35, group="fight")
def special_storm(R):
    d = 2.4
    m = Mix(d, True)
    for at, level in ((0.0, 1.0), (0.012, 0.55), (0.027, 0.7), (0.049, 0.4), (0.08, 0.5)):
        m.add(nburst(0.2, R, 900, 14000, 0.03 * (0.5 + level), attack=0.0002), at, 0.6 * level, R.uniform(-0.5, 0.5))
    m.add(sweep(0.3, R, pts((0, 5000), (0.25, 600), (0.3, 500)), 1.4, pts((0, 0), (0.003, 1.0), (0.12, 0.35), (0.3, 0)), slope=-1.0), 0.0, 0.5)
    m.add(blow(R, 1.2, (95, 40, 0.07, 0.3, 1.8, 0.55), (220, 85, 0.02, 0.07, 1.5, 0.5), (80, 1500, 0.12, 0.5), None), 0.03, 1.0)
    _thunder(m, R, 0.02, d - 0.02, 1.6)
    return room(sat(m.buf, 0.8), "arena", 0.2)


@sound("special_tide", gain=0.95, duck=0.4, stereo=True, tail_db=-46.0, cap=2.3, fade_out=0.35, group="fight")
def special_tide(R):
    d = 2.5
    crash = 0.6
    m = Mix(d, True)
    n1 = nsamp(crash)
    rear = stereo_noise(n1, R, -3.0)
    cut = curve(n1, pts((0, 250), (crash, 3600)), "exp")
    rear = np.stack([tv_biquad(rear[:, s], "lp", cut, 0.8, block=64) for s in (0, 1)], axis=1)
    m.add(rear * curve(n1, pts((0, 0.03), (crash, 1.0)), "exp")[:, None], 0.0, 0.5)
    m.add(_unit(lowpass(colored(n1, R, -6.0), 200, 2)) * curve(n1, pts((0, 0), (crash, 1.0))), 0.0, 0.2)
    m.add(nburst(0.6, R, 300, 12000, 0.18, attack=0.004), crash, 0.4)
    m.add(blow(R, 0.7, (100, 48, 0.05, 0.16, 1.8, 0.5), (210, 90, 0.02, 0.06, 1.4, 0.4), None, None), crash, 1.0)
    n2 = nsamp(d - crash)
    wash = stereo_noise(n2, R, -3.0)
    cut = curve(n2, pts((0, 6000), (d - crash, 900)), "exp")
    wash = np.stack([tv_biquad(wash[:, s], "lp", cut, 0.7, block=64) for s in (0, 1)], axis=1)
    shape = perc(n2, 0.02, 0.6) * (0.75 + 0.25 * smooth_noise(n2, R, 3.0))
    m.add(wash * shape[:, None], crash, 0.75)
    foam = _unit(highpass(white(n2, R), 5000, 2)) * np.clip(0.3 + smooth_noise(n2, R, 65.0), 0, None) * perc(n2, 0.03, 0.75)
    m.add(wide(foam, R), crash, 0.06)
    body = tv_biquad(colored(n2, R, -2.0), "bp", 650.0 * (1.0 + 0.4 * smooth_noise(n2, R, 4.0)), 1.5, block=64) * perc(n2, 0.02, 0.5)
    m.add(body, crash, 0.25)
    for _ in range(34):
        at = crash + 0.04 + R.exponential(0.4)
        if at > d - 0.2:
            continue
        f = R.uniform(300, 1500)
        m.add(blip(R.uniform(0.012, 0.04), f, f * R.uniform(1.3, 2.0)), at, 0.2 * np.exp(-(at - crash) / 0.7), R.uniform(-0.9, 0.9))
    return room(m.buf, "pit", 0.07)


@sound("status_burn", gain=0.55, group="status")
def status_burn(R):
    d = 0.62
    n = nsamp(d)
    m = Mix(d)
    sizzle = _unit(highpass(white(n, R), 3500, 2)) * (0.45 + 0.55 * np.clip(smooth_noise(n, R, 90.0), -1, 1)) * perc(n, 0.01, 0.2)
    m.add(sizzle, 0.0, 0.3)
    m.add(nburst(0.4, R, 300, 1100, 0.11, attack=0.015, slope=-3.0) * (0.6 + 0.4 * np.abs(smooth_noise(nsamp(0.4), R, 16.0))), 0.0, 0.5)
    m.add(thump(0.15, 190, 95, 0.02, 0.04), 0.0, 0.5)
    for _ in range(22):
        at = R.uniform(0.01, 0.5)
        m.add(tick(R, 2500, 9000, R.uniform(0.0008, 0.002)), at, 0.5 * np.exp(-at / 0.25) * R.uniform(0.3, 1.0))
    return room(m.buf, "tight", 0.06)


@sound("status_winded", gain=0.6, group="status")
def status_winded(R):
    # two hard breaths out, the second weaker: the wind knocked out of it
    d = 0.62
    m = Mix(d)
    for at, level, shift in ((0.0, 1.0, 1.0), (0.27, 0.7, 0.9)):
        n = nsamp(0.26)
        puff = formants(colored(n, R, -1.0), [(760.0 * shift, 240, 1.0), (1300.0 * shift, 360, 0.6), (2700.0, 600, 0.25)])
        puff = puff * curve(n, pts((0, 0), (0.02, 1.0), (0.09, 0.55), (0.26, 0)), "cos")
        m.add(puff / (np.max(np.abs(puff)) + 1e-9), at, 0.55 * level)
    m.add(thump(0.1, 150, 80, 0.012, 0.03, 0.8), 0.0, 0.35)
    return room(lowpass(m.buf, 6500), "tight", 0.08)


@sound("status_sunder", gain=0.6, group="status")
def status_sunder(R):
    d = 0.62
    m = Mix(d)
    for at, level in ((0.0, 1.0), (0.022, 0.7)):
        m.add(modal(nsamp(0.1), [R.uniform(380, 520), R.uniform(820, 1100), R.uniform(1500, 2100)], [0.018, 0.012, 0.008],
                    [1.0, 0.8, 0.5], R, attack=0.0002), at, 0.8 * level)
        m.add(tick(R, 900, 6000, 0.003), at, 0.6 * level)
    m.add(thump(0.2, 200, 85, 0.02, 0.045, 1.8), 0.0, 0.7)
    n = nsamp(0.34)
    sag = saw(curve(n, pts((0, 330), (0.3, 110), (0.34, 105)), "exp")) * curve(n, pts((0, 0), (0.006, 1.0), (0.2, 0.45), (0.34, 0)), "cos")
    m.add(sat(lowpass(sag, 1400), 2.0), 0.015, 0.45)
    for _ in range(14):
        at = R.uniform(0.05, 0.45)
        m.add(ping(R, R.uniform(700, 3000), R.uniform(0.004, 0.012), 2, 1.6), at, 0.3 * np.exp(-at / 0.2) * R.uniform(0.3, 1.0))
    return room(m.buf, "pit", 0.08)


@sound("status_shock", gain=0.55, group="status")
def status_shock(R):
    d = 0.48
    n = nsamp(d)
    gate = one_pole((smooth_noise(n, R, 55.0) > -0.25).astype(F), 900.0)
    buzz = square(curve(n, pts((0, 190), (d, 96)), "exp"), None, 0.3)
    arc = highpass(buzz, 500, 2) * 0.5 + bandpass(white(n, R), 2500, 9000, 2) * 0.55
    y = arc * gate * perc(n, 0.002, 0.17)
    m = Mix(d)
    m.add(y, 0.0, 0.5)
    for _ in range(16):
        at = R.uniform(0.0, 0.36)
        m.add(tick(R, 4000, 13000, 0.0007), at, 0.45 * np.exp(-at / 0.2) * R.uniform(0.4, 1.0))
    m.add(thump(0.08, 300, 120, 0.008, 0.02), 0.0, 0.5)
    return room(m.buf, "tight", 0.06)


@sound("status_soak", gain=0.55, group="status")
def status_soak(R):
    d = 0.62
    m = Mix(d)
    m.add(nburst(0.3, R, 900, 4500, 0.07, attack=0.004), 0.0, 0.3)
    m.add(nburst(0.3, R, 250, 1200, 0.09, attack=0.006, slope=-2.0), 0.0, 0.28)
    for at, f0, f1, dur in ((0.03, 180, 300, 0.07), (0.13, 240, 150, 0.06), (0.2, 150, 260, 0.08)):
        m.add(blip(dur, f0, f1, 1.0), at, 0.6)
    for _ in range(12):
        at = R.uniform(0.04, 0.42)
        f = R.uniform(350, 950)
        m.add(blip(R.uniform(0.02, 0.05), f, f * R.uniform(1.4, 2.2)), at, 0.4 * np.exp(-at / 0.3) * R.uniform(0.4, 1.0))
    return room(lowpass(m.buf, 6500), "tight", 0.07)


@sound("slowmo_in", gain=0.8, duck=0.3, tail_db=-50.0, group="fight")
def slowmo_in(R):
    d = 1.15
    n = nsamp(d)
    f = curve(n, pts((0, 240), (0.5, 46), (d, 36)), "exp")
    shape = curve(n, pts((0, 0), (0.012, 1.0), (0.45, 0.8), (d, 0)), "cos")
    whoomp = sat_norm((sine(f) + 0.3 * sine(f * 2.0) + 0.15 * sine(f * 3.0)) * shape, 1.6)
    m = Mix(d, True)
    m.add(whoomp, 0.0, 0.9)
    air = sweep(d, R, pts((0, 5200), (0.5, 420), (d, 200)), 1.4, pts((0, 0), (0.03, 0.9), (0.5, 0.4), (d - 0.05, 0), (d, 0)))
    m.add(wide(air, R), 0.0, 0.16)
    n2 = nsamp(0.7)
    slow = curve(n2, pts((0, 1.0), (0.6, 0.27), (0.7, 0.25)), "exp")
    chord = sum(saw(hz(p) * slow, None, R.uniform()) for p in ("D3", "A3", "D4")) / 3.0
    chord = tv_biquad(chord, "lp", curve(n2, pts((0, 2600), (0.7, 220)), "exp"), 1.0)
    m.add(chord * curve(n2, pts((0, 0), (0.01, 1.0), (0.4, 0.6), (0.7, 0)), "cos"), 0.0, 0.3)
    return m.buf


@sound("slowmo_out", gain=0.7, tail_db=-46.0, group="fight")
def slowmo_out(R):
    d = 0.8
    hit = 0.62
    n = nsamp(hit)
    f = curve(n, pts((0, 38), (hit, 250)), "exp")
    shape = curve(n, pts((0, 0), (0.2, 0.3), (hit - 0.02, 1.0), (hit, 0)), "cos")
    m = Mix(d, True)
    m.add(sat_norm((sine(f) + 0.3 * sine(f * 2.0) + 0.15 * sine(f * 3.0)) * shape, 1.4), 0.0, 0.8)
    air = sweep(hit, R, pts((0, 200), (hit, 6200)), 1.4, pts((0, 0), (hit - 0.03, 1.0), (hit, 0)))
    m.add(wide(air, R), 0.0, 0.16)
    slow = curve(n, pts((0, 0.3), (hit, 1.0)), "exp")
    chord = sum(saw(hz(p) * slow, None, R.uniform()) for p in ("D3", "A3", "D4")) / 3.0
    chord = tv_biquad(chord, "lp", curve(n, pts((0, 240), (hit, 3000)), "exp"), 1.0)
    m.add(chord * shape, 0.0, 0.25)
    m.add(thump(0.12, 320, 140, 0.01, 0.03, 1.5), hit, 0.6)
    m.add(nburst(0.12, R, 1500, 8000, 0.025), hit, 0.14)
    return room(m.buf, "tight", 0.08)


@sound("ko_boom", gain=1.0, duck=0.6, stereo=True, tail_db=-50.0, fade_out=0.6, cap=3.0, group="fight")
def ko_boom(R):
    d = 3.4
    n = nsamp(d)
    m = Mix(d, True)
    m.add(thump(d, 68, 36, 0.09, 0.7, 1.8), 0.0, 0.6)
    m.add(thump(1.6, 170, 74, 0.05, 0.27, 2.2), 0.0, 1.0)
    front = Mix(1.0, True)
    front.add(thump(0.5, 340, 130, 0.025, 0.08, 1.8), 0.0, 0.9)
    front.add(nburst(0.3, R, 1200, 9000, 0.015), 0.0, 0.7)
    front.add(crunch(0.6, R, 100, 2500, 0.07, 1.8), 0.0, 1.0)
    blast = sweep(0.6, R, pts((0, 3000), (0.5, 320), (0.6, 300)), 1.2, pts((0, 0), (0.005, 1.0), (0.25, 0.3), (0.6, 0)))
    front.add(wide(blast, R), 0.0, 0.2)
    wet = room(sat(front.buf, 1.2), "cavern", 0.4)
    place(m.buf, wet[: n], 0, 1.0)
    for side in (-1.0, 1.0):
        rumble = _unit(lowpass(colored(n, R, -5.0), 320, 2))
        shape = curve(n, pts((0, 0), (0.03, 1.0), (0.6, 0.6), (d, 0)), "cos") * (0.7 + 0.3 * smooth_noise(n, R, 3.0))
        m.add(rumble * shape, 0.0, 0.22, side * 0.7)
    return sat(m.buf, 0.9)


@sound("gong", gain=0.85, duck=0.5, stereo=True, tail_db=-50.0, fade_out=0.9, cap=3.6, group="fight")
def gong(R):
    d = 4.4
    n = nsamp(d)
    t = secs(n)
    base = hz("D3")
    ratios = [0.5, 1.0, 1.49, 2.0, 2.61, 3.0, 3.52, 4.07, 4.83, 5.4, 6.3, 7.12, 8.2, 9.6, 11.3, 13.1]
    amps = [0.5, 1.0, 0.55, 0.8, 0.5, 0.6, 0.42, 0.45, 0.36, 0.3, 0.26, 0.22, 0.17, 0.13, 0.1, 0.07]
    bend = 1.012 - 0.012 * (1.0 - np.exp(-t / 0.3))
    out = np.zeros((n, 2))
    count = len(ratios)
    for k, (ratio, amp) in enumerate(zip(ratios, amps)):
        u = k / (count - 1.0)
        tau = 1.6 * (1.0 - u) ** 1.3 + 0.35
        bloom = 0.004 + 0.09 * u ** 1.5
        for twin, share in ((1.0, 1.0), (1.0 + R.uniform(0.003, 0.011), 0.7)):
            f = base * ratio * twin * R.uniform(0.997, 1.003)
            tone = np.sin(TAU * (np.cumsum(f * bend) / SR + R.uniform()))
            env = (1.0 - np.exp(-t / bloom)) * np.exp(-t / tau)
            out += pan(tone * env * amp * share, R.uniform(-0.5, 0.5))
    out *= 0.16
    m = Mix(d, True)
    m.add(out, 0.0, 1.0)
    m.add(thump(0.35, 140, 70, 0.03, 0.08, 1.5), 0.0, 0.45)
    m.add(nburst(0.2, R, 80, 700, 0.02, attack=0.002, slope=-3.0), 0.0, 0.14)
    shimmer = bandpass(white(n, R), 2500, 7500, 2) * (1.0 - np.exp(-t / 0.15)) * np.exp(-t / 0.9)
    m.add(wide(shimmer, R), 0.0, 0.02)
    return room(m.buf, "cavern", 0.2)


_VOWELS = [((730, 1090, 2440), 1.0), ((570, 840, 2410), 1.0), ((660, 1720, 2410), 0.8), ((440, 1020, 2240), 0.9), ((520, 1190, 2390), 1.0)]


@sound("crowd_roar", gain=0.5, duck=0.2, stereo=True, exact=3.0, fade_out=0.25, group="fight")
def crowd_roar(R):
    d = 3.0
    n = nsamp(d)
    swell = curve(n, pts((0, 0.0), (0.25, 0.22), (1.0, 0.9), (1.5, 1.0), (2.2, 0.75), (d, 0.0)), "cos")
    bands = [(260, 1.2, 0.5), (430, 1.4, 0.9), (620, 1.6, 1.0), (850, 1.6, 0.95), (1150, 1.8, 0.8),
             (1500, 1.8, 0.55), (2000, 2.0, 0.36), (2700, 2.0, 0.2), (3600, 2.0, 0.09)]
    bed = np.zeros((n, 2))
    for side in (0, 1):
        for f, q, g in bands:
            src = colored(n, R, -3.0)
            centre = f * (1.0 + 0.06 * smooth_noise(n, R, 0.8))
            band = tv_biquad(src, "bp", centre, q, block=128) * (2.0 + q)
            wobble = np.clip(0.6 + 0.4 * smooth_noise(n, R, R.uniform(1.5, 5.0)), 0.12, None)
            bed[:, side] += g * band * wobble
    bed /= np.sqrt(np.mean(bed ** 2)) + 1e-9
    m = Mix(d + 0.4, True)
    m.add(bed * swell[:, None], 0.0, 0.3)
    # single throats in the crowd: short shouts, each with its own vowel and rise
    for k in range(44):
        length = R.uniform(0.35, 1.1)
        at = float(np.clip(R.normal(1.25, 0.65), 0.05, d - length - 0.1))
        base = R.uniform(120, 190) if R.uniform() < 0.65 else R.uniform(210, 330)
        lift = R.uniform(1.1, 1.45)
        f0 = pts((0, base), (length * R.uniform(0.2, 0.5), base * lift), (length, base * R.uniform(0.85, 1.1)))
        (f1, f2, f3), level = _VOWELS[int(R.integers(len(_VOWELS)))]
        scale = R.uniform(0.92, 1.1)
        shout = voice(length, R, f0, pts((0, 0), (length * 0.15, 1.0), (length * 0.6, 0.8), (length, 0)),
                      [(f1 * scale, 130, 1.0), (f2 * scale, 180, 0.5), (f3 * scale, 300, 0.12)], None,
                      jitter=0.02, shimmer=0.15, sub=0.0, breath=0.5, drive=1.2, voices=1, shape="lin", emph=0.8)
        m.add(shout, at, 0.085 * level * swell[int(at * SR)] ** 0.5 * R.uniform(0.5, 1.0), R.uniform(-0.95, 0.95))
    low = _unit(lowpass(colored(n, R, -6.0), 130, 2))
    m.add(low * swell, 0.0, 0.03)
    y = room(m.buf, "arena", 0.35)
    y = eq(y, [("hp", 110.0, 0.7, 0.0), ("lp", 4600.0, 0.7, 0.0), ("hs", 3000.0, 0.7, -3.0)])
    return sat(y, 1.6)


@sound("heartbeat", gain=0.9, exact=1.0, fade_out=0.02, group="fight")
def heartbeat(R):
    m = Mix(1.0)
    m.add(thump(0.3, 125, 62, 0.03, 0.05, 2.2), 0.03, 1.0)
    m.add(nburst(0.1, R, 140, 600, 0.02, attack=0.003, slope=-3.0), 0.03, 0.45)
    m.add(thump(0.26, 150, 74, 0.025, 0.038, 2.0), 0.33, 0.72)
    m.add(nburst(0.1, R, 160, 680, 0.016, attack=0.003, slope=-3.0), 0.33, 0.32)
    return lowpass(m.buf, 700, 2)


@sound("finisher_bolt", gain=1.0, duck=0.5, stereo=True, tail_db=-46.0, cap=2.2, fade_out=0.35, group="fight")
def finisher_bolt(R):
    d = 2.4
    strike = 0.075
    m = Mix(d, True)
    n0 = nsamp(strike)
    fizz = bandpass(white(n0, R), 3000, 9500, 2) * (0.5 + 0.5 * np.sign(np.sin(TAU * 118.0 * secs(n0)))) * curve(n0, pts((0, 0.0), (strike, 1.0))) ** 2
    m.add(wide(fizz, R), 0.0, 0.2)
    for at, level in ((0.0, 1.0), (0.009, 0.5), (0.021, 0.75), (0.036, 0.45), (0.058, 0.55)):
        m.add(nburst(0.2, R, 1200, 15000, 0.022 * (0.5 + level), attack=0.0002), strike + at, 0.65 * level, R.uniform(-0.6, 0.6))
    n1 = nsamp(0.26)
    tear = white(n1, R) * perc(n1, 0.001, 0.08)
    tear = sum(comb(tear, f, 0.9) for f in (2400.0, 1310.0, 640.0)) / 3.0
    tear = tv_biquad(tear, "lp", curve(n1, pts((0, 9000), (0.26, 600)), "exp"), 0.8)
    m.add(tear / (np.max(np.abs(tear)) + 1e-9), strike, 0.6)
    m.add(blow(R, 1.2, (110, 38, 0.07, 0.3, 2.0, 0.6), (240, 85, 0.02, 0.07, 1.6, 0.6), (80, 1800, 0.12, 0.5), None), strike + 0.005, 1.0)
    _thunder(m, R, strike, d - strike, 1.3, pts((0, 1500), (0.4, 600), (1.2, 220), (2.4, 120)))
    for _ in range(34):
        at = strike + 0.08 + R.exponential(0.3)
        if at > d - 0.3:
            continue
        m.add(tick(R, 5000, 14000, 0.0006), at, 0.3 * np.exp(-(at - strike) / 0.5) * R.uniform(0.3, 1.0), R.uniform(-0.9, 0.9))
    return room(sat(m.buf, 0.8), "arena", 0.22)


@sound("finisher_bell", gain=0.95, duck=0.5, stereo=True, tail_db=-46.0, fade_out=0.7, cap=3.0, group="fight")
def finisher_bell(R):
    d = 2.9
    m = Mix(d, True)
    # a peal of small golden bells running down a D major chord, left to right
    partials = [1.0, 2.0, 2.76, 4.07, 5.4]
    for i, name in enumerate(("D7", "A6", "Gb6", "D6", "A5", "Gb5", "D5")):
        f = hz(name) * (1.0 + R.uniform(-0.0015, 0.0015))
        ping = modal(nsamp(1.4), [f * r for r in partials], [0.9, 0.55, 0.35, 0.2, 0.12], [1.0, 0.45, 0.3, 0.18, 0.1], R, attack=0.001)
        m.add(ping, 0.02 + 0.08 * i, 0.2, -0.7 + 0.23 * i)
    # then one big bright bell under them: a major tierce, so it rings out rather than tolls
    base = hz("D4")
    ratios = [0.5, 1.0, 1.26, 1.5, 2.0, 2.52, 3.0, 4.0, 5.04, 6.0]
    taus = [1.8, 1.5, 1.1, 0.95, 0.8, 0.6, 0.5, 0.36, 0.26, 0.18]
    amps = [0.5, 1.0, 0.6, 0.4, 0.8, 0.35, 0.3, 0.25, 0.18, 0.12]
    freqs = [base * r * k for r in ratios for k in (1.0, 1.0025)]
    decays = [tau for tau in taus for _ in (0, 1)]
    levels = [a * s for a in amps for s in (1.0, 0.6)]
    m.add(wide(modal(nsamp(d - 0.6), freqs, decays, levels, R, attack=0.0015), R), 0.6, 0.42)
    # a glitter of tiny chimes on top
    for k in range(14):
        f = hz("D7") * [1.0, 1.26, 1.5, 2.0][int(R.integers(0, 4)) if hasattr(R, "integers") else int(R.randint(0, 4))]
        chime = modal(nsamp(0.4), [f, f * 2.76], [0.18, 0.06], [1.0, 0.2], R, attack=0.001)
        m.add(chime, 0.7 + 0.11 * k + R.uniform(-0.03, 0.03), 0.07, R.uniform(-0.9, 0.9))
    return room(m.buf, "arena", 0.35)


@sound("finisher_redmoon", gain=1.0, duck=0.5, stereo=True, tail_db=-46.0, fade_out=0.8, cap=3.5, group="fight")
def finisher_redmoon(R):
    d = 3.8
    toll = 1.45
    n = nsamp(toll + 2.0)
    t = secs(n)
    rise = curve(n, pts((0, 0.0), (0.5, 0.2), (toll, 1.0), (toll + 0.5, 0.7), (toll + 2.0, 0)), "cos")
    m = Mix(d, True)
    cut = curve(n, pts((0, 140), (toll, 1500), (toll + 2.0, 260)), "exp")
    for name, level, where in (("D1", 0.5, 0.0), ("D2", 1.0, -0.3), ("A2", 0.8, 0.3), ("Eb3", 0.4, -0.5), ("D3", 0.7, 0.5)):
        stack = sum(saw(hz(name) * (1.0 + c) * (1.0 + 0.002 * smooth_noise(n, R, 0.7)), None, R.uniform()) for c in (-0.006, 0.0, 0.007)) / 3.0
        m.add(tv_biquad(stack, "lp", cut, 0.9, block=64) * rise, 0.0, 0.3 * level, where)
    m.add(sine(hz("D2"), n) * rise, 0.0, 0.25)
    choir = sum(saw(hz(p) * (1.0 + 0.004 * np.sin(TAU * 4.9 * t + k)), None, R.uniform()) for k, p in enumerate(("D3", "A3", "D4"))) / 3.0
    choir = formants(choir, [(420.0, 110, 1.0), (800.0, 140, 0.6), (2600.0, 240, 0.15)])
    m.add(wide(choir * rise, R), 0.0, 0.35)
    air = sweep(toll, R, pts((0, 400), (toll, 2600)), 1.0, pts((0, 0), (toll - 0.04, 1.0), (toll, 0)), slope=-2.0)
    m.add(wide(air, R), 0.0, 0.06)
    # the bell: hum, prime, minor tierce, quint, nominal and a cloud above
    base = hz("D3")
    ratios = [0.5, 1.0, 1.189, 1.5, 2.0, 2.52, 3.0, 4.0, 5.33, 6.7, 8.2]
    taus = [1.9, 1.5, 1.2, 1.0, 0.85, 0.6, 0.5, 0.36, 0.26, 0.18, 0.12]
    amps = [0.7, 1.0, 0.7, 0.45, 0.8, 0.35, 0.3, 0.3, 0.2, 0.14, 0.1]
    freqs = [base * r * k for r in ratios for k in (1.0, 1.0022)]
    decays = [tau for tau in taus for _ in (0, 1)]
    levels = [a * s for a in amps for s in (1.0, 0.6)]
    bell = modal(nsamp(d - toll), freqs, decays, levels, R, attack=0.0015)
    m.add(bell, toll, 0.4)
    m.add(thump(0.5, 130, 60, 0.03, 0.1, 1.8), toll, 0.5)
    m.add(nburst(0.05, R, 1500, 6000, 0.004), toll, 0.12)
    return room(m.buf, "cavern", 0.28)


# ---------------------------------------------------------------------------
# lists the playback module needs
# ---------------------------------------------------------------------------

def names():
    return list(REG)


def variants():
    """{'hit_light': ['hit_light_1', ...]} for every name with numbered takes."""
    groups: dict = {}
    for name in REG:
        stem, _, tail = name.rpartition("_")
        if stem and tail.isdigit():
            groups.setdefault(stem, []).append(name)
    return {k: v for k, v in groups.items() if len(v) > 1}


FIGHT_PRELOAD_GROUPS = ("move", "impact", "voice", "fight", "status")


def preload():
    return [name for name, spec in REG.items() if spec["group"] in FIGHT_PRELOAD_GROUPS]
