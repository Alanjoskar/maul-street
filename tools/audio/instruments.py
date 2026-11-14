"""
instruments.py -- the band. Every instrument in the Maul Street score is a
function here that turns (pitch, length, velocity) into audio.

Struck and plucked things are cached per note; the two lead voices (a reed and
a brass section) are rendered a phrase at a time so that slurs, scoops and
vibrato can run across notes the way a player would do it.
"""
from __future__ import annotations

import numpy as np

from dsp import (F, SR, TAU, adsr, bandpass, biquad, colored, eq, highpass, karplus, lowpass, modal, mtof, nsamp,
                 one_pole, pan, perc, rng, sat, sat_norm, saw, secs, smooth_noise, square, tv_biquad, white)

_cache: dict = {}


def cached(fn):
    """Cache by arguments. Velocity and length are bucketed so repeats are cheap,
    and `var` picks a different take so repeats do not sound machine-made."""
    def wrapped(*args, **kw):
        key = (fn.__name__, args, tuple(sorted(kw.items())))
        hit = _cache.get(key)
        if hit is None:
            hit = np.asarray(fn(*args, **kw), dtype=np.float32)
            _cache[key] = hit
        return hit
    wrapped.__name__ = fn.__name__
    return wrapped


def clear_cache():
    _cache.clear()


def bucket(value, steps):
    return round(float(value) * steps) / steps


def _unit(x):
    return x / (np.sqrt(np.mean(x * x)) + 1e-9)


def _stack(f0, n, R, cents, pans, drift=0.0012):
    """Detuned sawtooths spread across the stereo field. Returns (left, right)."""
    left = np.zeros(n)
    right = np.zeros(n)
    for c, p in zip(cents, pans):
        f = f0 * 2.0 ** ((c + R.normal(0.0, 1.0)) / 1200.0)
        wave = saw(f * (1.0 + drift * smooth_noise(n, R, 0.6)), None, R.uniform())
        angle = (p + 1.0) * np.pi / 4.0
        left += wave * np.cos(angle)
        right += wave * np.sin(angle)
    scale = 1.0 / np.sqrt(len(cents))
    return left * scale, right * scale


# ---------------------------------------------------------------------------
# plucked and struck strings
# ---------------------------------------------------------------------------

def _pluck(f, n, R, t60, damp, pick, tone):
    period = SR / f
    burst = R.uniform(-1.0, 1.0, int(period) + 2)
    buf = np.zeros(int(2 * period) + 8)
    buf[: burst.size] += burst
    k = max(1, int(period * pick))
    buf[k:k + burst.size] -= 0.9 * burst
    buf = one_pole(buf, tone)
    return karplus(buf, f, n, t60, damp)


@cached
def oud(pitch, dur, vel=0.8, var=0):
    """Short-necked lute: two gut strings per note, a hair apart, in a round body."""
    R = rng("oud", pitch, var)
    f0 = float(mtof(pitch))
    n = nsamp(min(dur + 0.4, 4.0))
    t = secs(n)
    out = np.zeros(n)
    for cents, late, gain in ((-3.5, 0.0, 1.0), (4.0, 0.009, 0.8)):
        f = f0 * 2.0 ** (cents / 1200.0)
        t60 = 2.3 * (220.0 / f) ** 0.35
        string = _pluck(f, n, R, t60, 0.5, 0.24 + 0.03 * R.uniform(-1, 1), 700.0 + 3000.0 * vel)
        d = int(late * SR)
        out[d:] += gain * string[: n - d]
    out = eq(out, [("hp", 70.0, 0.7, 0.0), ("peak", 190.0, 1.0, 4.0), ("peak", 420.0, 1.2, 3.0),
                   ("peak", 1300.0, 1.5, -3.0), ("hs", 4500.0, 0.7, -5.0)])
    out /= np.sqrt(np.mean(out[: nsamp(0.08)] ** 2)) + 1e-9
    click = bandpass(white(nsamp(0.012), R), 1500.0, 6000.0, 1) * perc(nsamp(0.012), 0.0003, 0.002)
    out[: click.size] += 0.5 * vel * click
    out *= np.where(t > dur, np.exp(-(t - dur) / 0.07), 1.0)
    return 0.25 * out * vel ** 0.9


@cached
def santur(pitch, dur, vel=0.7, var=0):
    """Hammered dulcimer: three bright wires, quick to speak, quick to fade."""
    R = rng("santur", pitch, var)
    f0 = float(mtof(pitch))
    n = nsamp(min(dur + 0.5, 2.5))
    t = secs(n)
    out = np.zeros(n)
    for cents in (-5.0, 0.5, 5.5):
        f = f0 * 2.0 ** (cents / 1200.0)
        out += _pluck(f, n, R, 1.3 * (440.0 / f) ** 0.3, 0.28, 0.11, 2500.0 + 7000.0 * vel)
    out = eq(out, [("hp", 220.0, 0.7, 0.0), ("peak", 2400.0, 1.2, 2.0)])
    out /= np.sqrt(np.mean(out[: nsamp(0.06)] ** 2)) + 1e-9
    out *= np.where(t > dur, np.exp(-(t - dur) / 0.25), 1.0)
    return 0.2 * out * vel


# ---------------------------------------------------------------------------
# basses
# ---------------------------------------------------------------------------

@cached
def bass_round(pitch, dur, vel=0.8, var=0):
    """The Street's bass: a clean sub with a plucked, slightly driven top."""
    R = rng("bassr", pitch, var)
    f0 = float(mtof(pitch))
    n = nsamp(dur + 0.12)
    t = secs(n)
    env = adsr(n, 0.004, 0.2, 0.62, 0.045, dur)
    sub = np.sin(TAU * f0 * t)
    top = 0.6 * saw(f0, n, R.uniform()) + 0.3 * square(f0, n, 0.45, R.uniform())
    cutoff = 420.0 + (300.0 + 1300.0 * vel) * np.exp(-t / 0.12)
    top = tv_biquad(top, "lp", cutoff, 1.2)
    y = (0.75 * sub + 0.3 * np.sin(2.0 * TAU * f0 * t + 0.6) + 1.1 * top) * env
    return 0.5 * sat(y * (0.5 + 0.6 * vel), 1.3)


@cached
def bass_growl(pitch, dur, vel=0.8, var=0):
    """The pit's bass: two saws driven hard through a filter that barks on every note."""
    R = rng("bassg", pitch, var)
    f0 = float(mtof(pitch))
    n = nsamp(dur + 0.07)
    t = secs(n)
    env = adsr(n, 0.003, 0.09, 0.55, 0.03, dur)
    raw = 0.5 * (saw(f0 * 1.004, n, R.uniform()) + saw(f0 * 0.996, n, R.uniform())) + 0.3 * square(f0, n, 0.35, R.uniform())
    raw = sat_norm(raw * 2.2, 1.0)
    cutoff = 240.0 + (500.0 + 2500.0 * vel) * np.exp(-t / 0.07)
    tone = tv_biquad(raw, "lp", cutoff, 1.7)
    tone = biquad(tone, "peak", 850.0, 1.5, 4.0)
    y = (0.8 * tone + 0.85 * np.sin(TAU * f0 * t)) * env
    return 0.45 * sat(y * (0.55 + 0.6 * vel), 1.4)


# ---------------------------------------------------------------------------
# sustained sections (stereo)
# ---------------------------------------------------------------------------

@cached
def pad(pitch, dur, vel=0.6, var=0, bright=1.0, attack=0.6, release=0.9):
    """Dark, slow pad: six detuned saws under a low filter that breathes."""
    R = rng("pad", pitch, var)
    f0 = float(mtof(pitch))
    n = nsamp(dur + release * 2.5)
    t = secs(n)
    left, right = _stack(f0, n, R, (-11, -6, -2, 3, 7, 12), (-0.8, 0.5, -0.3, 0.3, -0.5, 0.8))
    cutoff = (480.0 + 900.0 * bright * vel) * (1.0 + 0.22 * np.sin(TAU * 0.13 * t + R.uniform(0, 6.28)))
    left = tv_biquad(left, "lp", cutoff, 0.8, block=128)
    right = tv_biquad(right, "lp", cutoff, 0.8, block=128)
    env = np.sin(np.clip(t / attack, 0.0, 1.0) * np.pi / 2.0) ** 2 * np.where(t > dur, np.exp(-(t - dur) / release), 1.0)
    out = np.stack([left, right], axis=1) * env[:, None]
    return 0.3 * vel * eq(out, [("hp", 110.0, 0.7, 0.0), ("peak", 600.0, 1.0, 1.5)])


@cached
def strings_long(pitch, dur, vel=0.7, var=0, attack=0.09, release=0.22):
    """A bowed section holding a note."""
    R = rng("strl", pitch, var)
    f0 = float(mtof(pitch))
    n = nsamp(dur + release * 4.0)
    t = secs(n)
    left, right = _stack(f0, n, R, (-12, -7, -3, 2, 6, 11), (-0.7, 0.45, -0.25, 0.25, -0.45, 0.7), drift=0.002)
    opening = 1.0 - np.exp(-t / max(attack, 0.02))
    cutoff = 1.4 * f0 + (700.0 + 3000.0 * vel) * (0.4 + 0.6 * opening)
    left = tv_biquad(left, "lp", cutoff, 0.75, block=96)
    right = tv_biquad(right, "lp", cutoff, 0.75, block=96)
    env = np.sin(np.clip(t / attack, 0.0, 1.0) * np.pi / 2.0) ** 2 * np.where(t > dur, np.exp(-(t - dur) / release), 1.0)
    out = np.stack([left, right], axis=1) * env[:, None]
    return 0.3 * vel * eq(out, [("hp", 90.0, 0.7, 0.0), ("peak", 950.0, 0.8, 2.0), ("peak", 3200.0, 1.0, 2.0), ("hs", 9000.0, 0.7, -5.0)])


@cached
def strings_short(pitch, vel=0.7, var=0, length=0.11):
    """A bounced bow stroke: the engine of the battle ostinato and the stabs."""
    R = rng("strs", pitch, var)
    f0 = float(mtof(pitch))
    n = nsamp(length * 3.5 + 0.2)
    t = secs(n)
    left, right = _stack(f0, n, R, (-10, -4, 1, 5, 10), (-0.6, 0.35, 0.0, -0.35, 0.6), drift=0.0)
    cutoff = 1.5 * f0 + 900.0 + (1200.0 + 5200.0 * vel) * np.exp(-t / (length * 1.5))
    left = tv_biquad(left, "lp", cutoff, 0.9, block=48)
    right = tv_biquad(right, "lp", cutoff, 0.9, block=48)
    env = (1.0 - np.exp(-t / 0.005)) * np.exp(-t / length)
    out = np.stack([left, right], axis=1) * env[:, None]
    grit = bandpass(white(n, R), 2000.0, 6000.0, 1) * np.exp(-t / 0.014) * 0.1
    out += grit[:, None]
    return 0.33 * vel * eq(out, [("hp", 100.0, 0.7, 0.0), ("peak", 2600.0, 1.0, 2.0), ("hs", 8500.0, 0.7, -4.0)])


@cached
def brass_hit(pitch, vel=0.8, var=0, length=0.16):
    """A short brass blat for stabs: the filter snaps open and shuts."""
    R = rng("brh", pitch, var)
    f0 = float(mtof(pitch))
    n = nsamp(length * 3.0 + 0.2)
    t = secs(n)
    scoop = 1.0 - 0.012 * np.exp(-t / 0.02)
    left, right = _stack(f0 * scoop, n, R, (-6, 0, 6), (-0.3, 0.0, 0.3), drift=0.0)
    env = (1.0 - np.exp(-t / 0.008)) * np.exp(-t / length)
    cutoff = 300.0 + (700.0 + 3800.0 * vel) * env ** 0.7
    left = tv_biquad(left, "lp", cutoff, 1.3, block=48)
    right = tv_biquad(right, "lp", cutoff, 1.3, block=48)
    out = np.stack([left, right], axis=1) * env[:, None]
    out = eq(out, [("hp", 90.0, 0.7, 0.0), ("peak", 1300.0, 1.2, 3.0), ("hs", 7000.0, 0.7, -6.0)])
    return 0.4 * vel * sat(out * 1.5, 1.0)


@cached
def choir(pitch, dur, vel=0.6, var=0, attack=0.22, release=0.35):
    """A wordless 'ah': saws through three vowel formants."""
    R = rng("choir", pitch, var)
    f0 = float(mtof(pitch))
    n = nsamp(dur + release * 4.0)
    t = secs(n)
    env = np.sin(np.clip(t / attack, 0.0, 1.0) * np.pi / 2.0) ** 2 * np.where(t > dur, np.exp(-(t - dur) / release), 1.0)
    sides = []
    for side in range(2):
        tone = np.zeros(n)
        for k in range(3):
            vib = 1.0 + 0.004 * np.sin(TAU * R.uniform(4.6, 5.6) * t + R.uniform(0, 6.28)) * np.clip((t - 0.25) / 0.4, 0, 1)
            tone += saw(f0 * 2.0 ** (R.normal(0.0, 5.0) / 1200.0) * vib, None, R.uniform())
        tone /= np.sqrt(3.0)
        shaped = (biquad(tone, "bp", 650.0, 650.0 / 120.0) - 0.6 * biquad(tone, "bp", 1080.0, 1080.0 / 140.0)
                  + 0.25 * biquad(tone, "bp", 2650.0, 2650.0 / 200.0) + 0.12 * lowpass(tone, 400.0, 1))
        sides.append(shaped * env)
    out = np.stack(sides, axis=1)
    return 0.7 * vel * eq(out, [("hp", 120.0, 0.7, 0.0)])


# ---------------------------------------------------------------------------
# phrase-rendered leads
# ---------------------------------------------------------------------------

def _line(notes, n, glide, scoop, attack, release, vib_delay, slur_gap=0.035):
    """Turn [(start s, length s, midi pitch, velocity)] into per-sample pitch,
    amplitude and vibrato-depth curves, slurring notes that touch."""
    t = secs(n)
    pitch = np.full(n, float(notes[0][2]))
    amp = np.zeros(n)
    vib = np.zeros(n)
    onsets = []
    for i, (start, length, p, vel) in enumerate(notes):
        prev_end = notes[i - 1][0] + notes[i - 1][1] if i else -10.0
        slurred = start - prev_end < slur_gap
        next_start = notes[i + 1][0] if i + 1 < len(notes) else None
        slur_out = next_start is not None and next_start - (start + length) < slur_gap
        i0 = max(0, int(start * SR))
        i1 = n if next_start is None else min(n, int(next_start * SR))
        tt = t[i0:i1] - start
        if slurred:
            pitch[i0:i1] = p + (notes[i - 1][2] - p) * np.exp(-tt / (glide / 3.0))
        else:
            pitch[i0:i1] = p - scoop * np.exp(-tt / 0.03)
            onsets.append((start, vel))
        att = attack * (0.45 if slurred else 1.0)
        rel = release * (0.12 if slur_out else 1.0)     # a slur hands over quickly, so the level stays even
        tn = t - start
        shape = np.clip(tn / att, 0.0, 1.0) ** 0.8
        shape = shape * (0.86 + 0.14 * np.sin(np.pi * np.clip(tn / max(length, 0.05), 0.0, 1.0) ** 0.8))
        shape = shape * np.exp(-np.maximum(tn - length, 0.0) / rel)
        shape[tn < 0] = 0.0
        amp += vel * shape
        vib[i0:i1] = np.clip((tt - vib_delay) / 0.3, 0.0, 1.0)
    return t, pitch, np.clip(amp, 0.0, 1.3), vib, onsets


def reed_line(notes, n, seed="reed", breath=0.05, depth=0.11, rate=5.2):
    """A duduk-like double reed: hollow, breathy, sliding between notes."""
    R = rng("reedline", seed, len(notes), n)
    t, pitch, amp, vib, onsets = _line(notes, n, glide=0.05, scoop=0.4, attack=0.07, release=0.13, vib_delay=0.2)
    wob = np.sin(TAU * rate * t + 1.5 * smooth_noise(n, R, 0.7))
    f = mtof(pitch + depth * vib * wob) * (1.0 + 0.0015 * smooth_noise(n, R, 3.0))
    phase = TAU * np.cumsum(f) / SR
    amp_s = one_pole(amp, 40.0)
    harmonics = (1.0, 0.14, 0.42, 0.09, 0.2, 0.05, 0.1, 0.035, 0.05, 0.02, 0.03, 0.012)
    tone = np.zeros(n)
    for k, h in enumerate(harmonics, start=1):
        tone += h * np.clip(amp_s, 0.0, 1.0) ** (0.14 * (k - 1)) * np.sin(k * phase + (0.3 * k if k % 2 == 0 else 0.0))
    tone *= 1.0 + 0.5 * depth * vib * wob
    air = bandpass(white(n, R), 1200.0, 5000.0, 1) * breath * (0.6 + 0.4 * smooth_noise(n, R, 8.0))
    chiff = np.zeros(n)
    for start, vel in onsets:
        i0 = int(start * SR)
        m = min(nsamp(0.05), n - i0)
        if m > 8:
            chiff[i0:i0 + m] += vel * bandpass(white(m + 32, R), 900.0, 3500.0, 1)[32:] * perc(m, 0.004, 0.012) * 0.25
    y = (tone + air) * amp_s + chiff
    y = eq(y, [("hp", 120.0, 0.7, 0.0), ("peak", 950.0, 1.8, 4.0), ("peak", 1900.0, 2.0, 2.0), ("lp", 5200.0, 0.7, 0.0)])
    return 0.35 * sat(y, 0.8)


def brass_line(notes, n, seed="brass", bright=1.0, voices=3, low_octave=0.45):
    """A unison brass section with horns an octave under it: the battle lead."""
    R = rng("brassline", seed, len(notes), n)
    t, pitch, amp, vib, _ = _line(notes, n, glide=0.03, scoop=0.3, attack=0.04, release=0.07, vib_delay=0.28)
    amp_s = one_pole(amp, 55.0)
    out = np.zeros((n, 2))
    wob = np.sin(TAU * 5.4 * t + smooth_noise(n, R, 0.6))
    for layer, (octave, level, cut, spread) in enumerate(((0.0, 1.0, 1.0, 0.25), (-12.0, low_octave, 0.55, 0.5))):
        for v in range(voices):
            cents = (v - (voices - 1) / 2.0) * 7.0 + R.normal(0.0, 1.5)
            f = mtof(pitch + octave + cents / 100.0 + 0.06 * vib * wob) * (1.0 + 0.001 * smooth_noise(n, R, 2.5))
            wave = saw(f, None, R.uniform())
            cutoff = 280.0 + (4300.0 * bright * cut) * np.clip(amp_s, 0.0, 1.2) ** 1.4 + 0.8 * f
            wave = tv_biquad(wave, "lp", cutoff, 1.15, block=48)
            where = spread * (v - (voices - 1) / 2.0) * (1.0 if layer == 0 else -1.0)
            out += pan(wave * level / np.sqrt(voices), where)
    out *= (amp_s * (1.0 + 0.05 * smooth_noise(n, R, 30.0)))[:, None]
    out = eq(out, [("hp", 100.0, 0.7, 0.0), ("peak", 1300.0, 1.2, 3.0), ("peak", 2800.0, 1.4, 1.5), ("hs", 7500.0, 0.7, -5.0)])
    return 0.4 * sat(out * 1.4, 1.0)


# ---------------------------------------------------------------------------
# hand drums and small percussion (the Street)
# ---------------------------------------------------------------------------

@cached
def dum(vel=0.9, var=0):
    """Goblet drum, centre of the skin: the low 'dum'."""
    R = rng("dum", var)
    n = nsamp(0.55)
    t = secs(n)
    f = 92.0 + 75.0 * np.exp(-t / 0.02)
    phase = TAU * np.cumsum(f) / SR
    body = (np.sin(phase) * np.exp(-t / 0.13) + 0.35 * np.sin(1.59 * phase + 0.4) * np.exp(-t / 0.06)
            + 0.2 * np.sin(2.3 * phase + 1.1) * np.exp(-t / 0.035))
    slap = bandpass(white(n, R), 250.0, 1800.0, 1) * np.exp(-t / 0.013) * (0.5 + 0.6 * vel)
    y = (body + slap) * (1.0 - np.exp(-t / 0.0012))
    return 0.55 * sat(y * (0.6 + 0.5 * vel), 1.2)


@cached
def tek(vel=0.8, var=0, soft=False):
    """Goblet drum, rim: the bright 'tek' (soft=True is the lighter 'ka')."""
    R = rng("tek", var, soft)
    n = nsamp(0.3)
    scale = (0.9 if soft else 1.0) * R.uniform(0.985, 1.015)
    freqs = [540.0 * scale, 1130.0 * scale, 1870.0 * scale, 2680.0 * scale, 3900.0 * scale]
    decays = [d * (0.6 if soft else 1.0) for d in (0.045, 0.036, 0.025, 0.018, 0.01)]
    ring = modal(n, freqs, decays, [0.5, 1.0, 0.7, 0.45, 0.3], R, attack=0.0003)
    t = secs(n)
    snap = bandpass(white(n, R), 1500.0, 7000.0, 1) * np.exp(-t / 0.004)
    y = 0.6 * ring + (0.35 + 0.35 * vel) * snap
    return 0.38 * y * vel ** 1.2


@cached
def frame_boom(vel=0.8, var=0):
    """A big frame drum under the goblet drum: weight for the downbeats."""
    R = rng("fboom", var)
    n = nsamp(0.8)
    t = secs(n)
    f = 52.0 + 44.0 * np.exp(-t / 0.03)
    y = np.sin(TAU * np.cumsum(f) / SR) * np.exp(-t / 0.22)
    y += lowpass(white(n, R), 500.0, 1) * np.exp(-t / 0.02) * 0.2
    y *= 1.0 - np.exp(-t / 0.002)
    return 0.6 * sat(y * (0.6 + 0.5 * vel), 1.5)


@cached
def shaker(vel=0.5, var=0):
    R = rng("shk", var)
    n = nsamp(0.12)
    t = secs(n)
    y = bandpass(white(n, R), 4200.0, 9500.0, 2)
    env = (1.0 - np.exp(-t / (0.004 + 0.006 * (1.0 - vel)))) * np.exp(-t / (0.018 + 0.02 * vel))
    return 0.2 * y * env * vel


@cached
def jingle(vel=0.6, var=0):
    """Tambourine discs: a cluster of high metal modes and a hiss."""
    R = rng("jing", var)
    n = nsamp(0.3)
    t = secs(n)
    freqs = [R.uniform(5200.0, 11500.0) for _ in range(8)]
    ring = modal(n, freqs, [R.uniform(0.03, 0.09) for _ in freqs], [R.uniform(0.5, 1.0) for _ in freqs], R, attack=0.001)
    hiss = highpass(white(n, R), 6000.0, 2) * np.exp(-t / 0.03)
    return 0.1 * (0.5 * ring + 0.5 * hiss) * vel


@cached
def clap(vel=0.7, var=0):
    R = rng("clap", var)
    n = nsamp(0.3)
    t = secs(n)
    out = np.zeros((n, 2))
    for k, late in enumerate((0.0, 0.009, 0.019, 0.03)):
        burst = bandpass(white(n, R), 900.0, 3600.0, 2) * np.exp(-np.maximum(t - late, 0.0) / (0.006 if k < 3 else 0.06)) * (t >= late)
        out += pan(burst * (0.7 if k < 3 else 1.0), R.uniform(-0.5, 0.5))
    return 0.4 * out * vel


@cached
def snap(vel=0.6, var=0):
    R = rng("snap", var)
    n = nsamp(0.15)
    t = secs(n)
    y = bandpass(white(n, R), 1800.0, 5200.0, 2) * np.exp(-t / 0.009)
    y += 0.5 * modal(n, [1950.0 * R.uniform(0.97, 1.03), 3300.0], [0.012, 0.008], [1.0, 0.5], R, attack=0.0003)
    return 0.25 * y * vel


@cached
def zill(vel=0.5, var=0):
    """Finger cymbal: two discs a few hertz apart."""
    R = rng("zill", var)
    n = nsamp(1.6)
    y = modal(n, [3350.0, 3412.0, 6900.0, 9750.0, 12300.0], [0.5, 0.45, 0.22, 0.14, 0.08], [1.0, 0.9, 0.4, 0.25, 0.12], R, attack=0.0005)
    return 0.09 * y * vel


# ---------------------------------------------------------------------------
# war drums and metal (the pit)
# ---------------------------------------------------------------------------

@cached
def taiko(vel=0.9, var=0, size=1.0):
    """A barrel drum. size 1 is the big one; 2 and up are the mid drums."""
    R = rng("taiko", var, size)
    n = nsamp(1.0 if size < 1.5 else 0.5)
    t = secs(n)
    low = 60.0 * size * R.uniform(0.99, 1.01)
    f = low + 0.85 * low * np.exp(-t / (0.035 / size ** 0.5))
    phase = TAU * np.cumsum(f) / SR
    tau = 0.3 / size ** 1.2
    body = (np.sin(phase) * np.exp(-t / tau) + 0.8 * np.sin(1.5 * phase + 1.0) * np.exp(-t / (tau * 0.6))
            + 0.5 * np.sin(2.3 * phase + 2.0) * np.exp(-t / (tau * 0.4)) + 0.3 * np.sin(3.6 * phase) * np.exp(-t / (tau * 0.25)))
    slap = bandpass(colored(n, R, -2.0), 250.0 * size ** 0.5, 950.0 * size ** 0.5, 1)
    slap = _unit(slap) * np.exp(-t / 0.035) * (0.35 + 0.45 * vel)
    stick = bandpass(white(n, R), 1500.0, 4500.0, 1) * np.exp(-t / 0.008) * (0.5 + 0.9 * vel)
    y = (body + slap + stick) * (1.0 - np.exp(-t / 0.0015))
    return 0.6 * sat(y * (0.55 + 0.6 * vel), 1.6)


@cached
def shime(vel=0.7, var=0):
    """Small tight drum for the driving sixteenths and the rolls."""
    R = rng("shime", var)
    n = nsamp(0.22)
    t = secs(n)
    low = 250.0 * R.uniform(0.98, 1.02)
    f = low + 90.0 * np.exp(-t / 0.012)
    body = np.sin(TAU * np.cumsum(f) / SR) * np.exp(-t / 0.045)
    crack = bandpass(white(n, R), 1800.0, 6500.0, 1) * np.exp(-t / 0.016) * (0.8 + 1.0 * vel)
    y = (body + crack) * (1.0 - np.exp(-t / 0.001))
    return 0.36 * y * vel ** 1.1


@cached
def rim(vel=0.6, var=0):
    """Stick on the wooden rim: 'ka'."""
    R = rng("rim", var)
    n = nsamp(0.12)
    y = modal(n, [1120.0 * R.uniform(0.97, 1.03), 1860.0, 2740.0, 4100.0], [0.02, 0.016, 0.011, 0.006], [1.0, 0.8, 0.5, 0.3], R, attack=0.0002)
    return 0.3 * y * vel


@cached
def anvil(vel=0.8, var=0):
    """Hammer on iron: the backbeat of the pit."""
    R = rng("anvil", var)
    n = nsamp(0.7)
    t = secs(n)
    base = 587.33 * R.uniform(0.995, 1.005)
    freqs = [base, base * 2.44, base * 3.77, base * 5.03, base * 6.6, base * 8.7, base * 11.4]
    y = modal(n, freqs, [0.2, 0.17, 0.13, 0.1, 0.075, 0.05, 0.03], [0.7, 1.0, 0.8, 0.6, 0.45, 0.3, 0.2], R, attack=0.0002)
    y += bandpass(white(n, R), 2500.0, 9000.0, 1) * np.exp(-t / 0.004) * 0.6
    return 0.2 * y * vel


@cached
def crash(vel=0.8, var=0, dark=0.0):
    """A big cymbal (dark=1 leans towards a tam-tam). Stereo."""
    R = rng("crash", var, dark)
    n = nsamp(2.6)
    t = secs(n)
    out = np.zeros((n, 2))
    lo = 1600.0 - 1100.0 * dark
    for side in range(2):
        noise = lowpass(highpass(white(n, R), lo, 2), 9500.0 - 3500.0 * dark, 2)
        bright = highpass(noise, 6000.0, 1) * np.exp(-t / 0.5)
        body = (noise - bright * 0.5) * np.exp(-t / (0.9 + 0.5 * dark))
        partials = modal(n, [R.uniform(lo * 0.6, 7000.0) for _ in range(14)], [R.uniform(0.5, 1.3) for _ in range(14)],
                         [R.uniform(0.3, 1.0) for _ in range(14)], R, attack=0.002)
        out[:, side] = (0.6 * body + 0.5 * bright + 0.25 * partials) * (1.0 - np.exp(-t / 0.004))
    return 0.11 * out * vel


@cached
def swell(length=1.6, var=0, lo=900.0, hi=6500.0):
    """A reversed cymbal: noise that grows into the next section. Stereo."""
    R = rng("swell", var, length)
    n = nsamp(length)
    t = secs(n)
    out = np.zeros((n, 2))
    env = np.exp(-(length - t) / (length * 0.28))
    cut = lo + (hi - lo) * (t / length) ** 2
    for side in range(2):
        noise = tv_biquad(white(n, R), "bp", cut, 0.9, block=64)
        out[:, side] = noise * env
    out[-nsamp(0.012):] *= np.linspace(1.0, 0.0, nsamp(0.012))[:, None]
    return 0.12 * out


@cached
def sub_boom(vel=0.9, var=0):
    R = rng("subb", var)
    n = nsamp(1.6)
    t = secs(n)
    f = 36.0 + 40.0 * np.exp(-t / 0.07)
    y = np.sin(TAU * np.cumsum(f) / SR) * np.exp(-t / 0.5) * (1.0 - np.exp(-t / 0.003))
    y += lowpass(white(n, R), 300.0, 1) * np.exp(-t / 0.04) * 0.15
    return 0.6 * sat(y * (0.6 + 0.5 * vel), 1.6)


@cached
def field_snare(vel=0.7, var=0):
    """Rope-tension snare for the build-up rolls."""
    R = rng("fsnare", var)
    n = nsamp(0.25)
    t = secs(n)
    tone = np.sin(TAU * np.cumsum(185.0 + 60.0 * np.exp(-t / 0.01)) / SR) * np.exp(-t / 0.05)
    wires = bandpass(white(n, R), 1200.0, 7000.0, 1) * np.exp(-t / (0.03 + 0.04 * vel))
    y = (0.6 * tone + 0.7 * wires) * (1.0 - np.exp(-t / 0.001))
    return 0.3 * y * vel ** 1.2


@cached
def low_horn(pitch, dur, vel=0.7, var=0):
    """Trombones and tubas holding the floor."""
    R = rng("lhorn", pitch, var)
    f0 = float(mtof(pitch))
    n = nsamp(dur + 0.4)
    t = secs(n)
    env = adsr(n, 0.06, 0.25, 0.85, 0.09, dur)
    left, right = _stack(f0, n, R, (-5, 0, 5), (-0.35, 0.0, 0.35), drift=0.0015)
    cutoff = 200.0 + (1500.0 + 1500.0 * vel) * env ** 1.5 + f0
    left = tv_biquad(left, "lp", cutoff, 1.1, block=64)
    right = tv_biquad(right, "lp", cutoff, 1.1, block=64)
    out = np.stack([left, right], axis=1) * (env * (1.0 + 0.05 * smooth_noise(n, R, 28.0)))[:, None]
    out = eq(out, [("hp", 60.0, 0.7, 0.0), ("peak", 480.0, 1.2, 3.0), ("hs", 5000.0, 0.7, -6.0)])
    return 0.4 * vel * sat(out * 1.5, 1.0)


@cached
def tam(vel=0.7, var=0):
    """A low gong stroke for the stingers and section turns. Stereo."""
    R = rng("tam", var)
    n = nsamp(4.0)
    t = secs(n)
    base = 73.42
    out = np.zeros((n, 2))
    ratios = [1.0, 2.0, 2.71, 3.56, 4.3, 5.42, 6.8, 8.3, 10.1, 12.6, 15.2, 18.9]
    for k, ratio in enumerate(ratios):
        u = k / (len(ratios) - 1.0)
        for twin in (1.0, 1.0 + R.uniform(0.003, 0.01)):
            tone = np.sin(TAU * (base * ratio * twin * t + R.uniform()))
            env = (1.0 - np.exp(-t / (0.004 + 0.12 * u ** 1.4))) * np.exp(-t / (1.9 * (1.0 - u) ** 1.2 + 0.4))
            out += pan(tone * env * (1.0 - 0.6 * u), R.uniform(-0.6, 0.6))
    return 0.05 * out * vel
