"""
dsp.py -- signal-processing building blocks for the Maul Street audio build.

Everything in the game's soundtrack and effects is made from the functions in
this file: oscillators, noise, filters, envelopes, a string model, generated
reverb impulse responses, dynamics and loudness meters. numpy and scipy only.

Conventions: mono audio is a 1-D float64 array, stereo is (n, 2). Times are in
seconds, frequencies in Hz, and SR is the one sample rate used everywhere.
"""
from __future__ import annotations

import hashlib
import re
import wave

import numpy as np
from scipy import signal
from scipy.ndimage import minimum_filter1d, uniform_filter1d

SR = 44100
F = np.float64
TAU = 2.0 * np.pi


# ---------------------------------------------------------------------------
# basics
# ---------------------------------------------------------------------------

def rng(*key):
    """A random generator seeded only by `key`: renders never depend on call order."""
    digest = hashlib.sha256(repr(key).encode()).digest()
    return np.random.Generator(np.random.PCG64(int.from_bytes(digest[:8], "little")))


def nsamp(seconds):
    return max(1, int(round(float(seconds) * SR)))


def secs(n):
    return np.arange(int(n), dtype=F) / SR


def db(value):
    return 10.0 ** (value / 20.0)


def to_db(value):
    return 20.0 * np.log10(max(float(value), 1e-12))


_NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_NOTE_RE = re.compile(r"^([A-G])([#b]*)(-?\d+)$")
_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"]


def midi(name):
    """'C#4' -> 61. Numbers pass straight through."""
    if isinstance(name, (int, float, np.integer, np.floating)):
        return float(name)
    match = _NOTE_RE.match(name)
    if not match:
        raise ValueError(f"bad note name {name!r}")
    letter, acc, octave = match.groups()
    return float(_NOTE[letter] + acc.count("#") - acc.count("b") + 12 * (int(octave) + 1))


def note_name(pitch):
    pitch = int(round(pitch))
    return f"{_NAMES[pitch % 12]}{pitch // 12 - 1}"


def mtof(pitch):
    return 440.0 * 2.0 ** ((np.asarray(pitch, dtype=F) - 69.0) / 12.0)


def hz(name):
    return float(mtof(midi(name)))


# ---------------------------------------------------------------------------
# envelopes
# ---------------------------------------------------------------------------

def curve(n, points, shape="lin"):
    """Breakpoint envelope over n samples. points = [(seconds, value), ...].
    shape: 'lin', 'exp' (geometric between positive values) or 'cos' (eased)."""
    t = secs(n)
    ts = np.array([p[0] for p in points], dtype=F)
    vs = np.array([p[1] for p in points], dtype=F)
    if shape == "exp":
        return np.exp(np.interp(t, ts, np.log(np.maximum(vs, 1e-9))))
    if shape == "cos":
        idx = np.clip(np.searchsorted(ts, t, side="right") - 1, 0, len(ts) - 2)
        t0, t1 = ts[idx], ts[idx + 1]
        u = np.clip((t - t0) / np.maximum(t1 - t0, 1e-9), 0.0, 1.0)
        u = u * u * (3.0 - 2.0 * u)
        return vs[idx] + (vs[idx + 1] - vs[idx]) * u
    return np.interp(t, ts, vs)


def perc(n, attack, decay, hold=0.0):
    """Percussive envelope: quick rise, optional hold, exponential fall. Peak 1."""
    t = secs(n)
    rise = 1.0 - np.exp(-t / max(attack, 1e-5))
    fall = np.exp(-np.maximum(t - hold, 0.0) / max(decay, 1e-5))
    env = rise * fall
    return env / (env.max() + 1e-12)


def adsr(n, attack, decay, sustain, release, gate):
    """Classic envelope in seconds; the note is released at `gate`."""
    t = secs(n)
    attack = max(attack, 1e-4)
    body = sustain + (1.0 - sustain) * np.exp(-np.maximum(t - attack, 0.0) / max(decay, 1e-4))
    env = np.where(t < attack, np.sin(np.clip(t / attack, 0.0, 1.0) * np.pi / 2.0) ** 2, body)
    return env * np.where(t > gate, np.exp(-np.maximum(t - gate, 0.0) / max(release, 1e-4)), 1.0)


def fade(x, fin=0.003, fout=0.003):
    """Raised-cosine fades at both ends (seconds)."""
    x = np.array(x, dtype=F, copy=True)
    n = x.shape[0]
    a = min(nsamp(fin), n // 2) if fin > 0 else 0
    b = min(nsamp(fout), n // 2) if fout > 0 else 0
    if a > 1:
        ramp = 0.5 - 0.5 * np.cos(np.pi * np.arange(a) / a)
        x[:a] = x[:a] * (ramp[:, None] if x.ndim == 2 else ramp)
    if b > 1:
        ramp = 0.5 + 0.5 * np.cos(np.pi * (np.arange(b) + 1) / b)
        x[-b:] = x[-b:] * (ramp[:, None] if x.ndim == 2 else ramp)
    return x


# ---------------------------------------------------------------------------
# noise
# ---------------------------------------------------------------------------

def white(n, R):
    return R.standard_normal(int(n))


def colored(n, R, slope=-3.0, floor=25.0):
    """Unit-RMS noise with a spectral slope in dB per octave (-3 pink, -6 brown)."""
    n = int(n)
    spec = np.fft.rfft(R.standard_normal(n))
    f = np.fft.rfftfreq(n, 1.0 / SR)
    spec *= np.maximum(f, floor) ** (slope / 6.0206)
    spec[0] = 0.0
    y = np.fft.irfft(spec, n)
    return y / (np.sqrt(np.mean(y * y)) + 1e-12)


def smooth_noise(n, R, rate):
    """Slow random wander with roughly unit deviation; `rate` is its bandwidth in Hz."""
    n = int(n)
    step = max(1, int(SR / (4.0 * max(rate, 0.05))))
    count = n // step + 4
    knots = R.standard_normal(count)
    kernel = np.array([0.25, 0.5, 0.25])
    knots = np.convolve(np.pad(knots, 1, mode="edge"), kernel, mode="valid")
    knots = np.convolve(np.pad(knots, 1, mode="edge"), kernel, mode="valid")
    pos = np.arange(n, dtype=F) / step
    i = np.floor(pos).astype(np.int64)
    u = pos - i
    u = u * u * (3.0 - 2.0 * u)
    y = knots[i] + (knots[i + 1] - knots[i]) * u
    return y / (np.std(knots) + 1e-9)


# ---------------------------------------------------------------------------
# oscillators
# ---------------------------------------------------------------------------

def _freq_array(freq, n):
    if np.ndim(freq) == 0:
        return np.full(int(n), float(freq), dtype=F)
    return np.asarray(freq, dtype=F)


def phasor(freq, n=None, phase0=0.0):
    """Running phase in cycles for a per-sample (or constant) frequency."""
    freq = _freq_array(freq, n)
    return phase0 + (np.cumsum(freq) - freq) / SR


def sine(freq, n=None, phase0=0.0):
    return np.sin(TAU * phasor(freq, n, phase0))


def saw(freq, n=None, phase0=0.0):
    """Band-limited sawtooth (polyBLEP)."""
    freq = _freq_array(freq, n)
    dt = np.clip(freq / SR, 1e-7, 0.49)
    phase = (phase0 + (np.cumsum(freq) - freq) / SR) % 1.0
    out = 2.0 * phase - 1.0
    low = phase < dt
    x = phase[low] / dt[low]
    out[low] -= x + x - x * x - 1.0
    high = phase > 1.0 - dt
    x = (phase[high] - 1.0) / dt[high]
    out[high] -= x * x + x + x + 1.0
    return out


def square(freq, n=None, width=0.5, phase0=0.0):
    """Band-limited pulse wave made from two sawtooths."""
    return saw(freq, n, phase0) - saw(freq, n, phase0 + width)


def triangle(freq, n=None, phase0=0.0):
    phase = phasor(freq, n, phase0) % 1.0
    return 4.0 * np.abs(phase - 0.5) - 1.0


# ---------------------------------------------------------------------------
# filters
# ---------------------------------------------------------------------------

def _rbj(kind, f, q, gain_db=0.0):
    """RBJ cookbook coefficients, vectorised over f and q. Returns b0, b1, b2, a1, a2."""
    f = np.clip(np.asarray(f, dtype=F), 8.0, 0.46 * SR)
    q = np.maximum(np.asarray(q, dtype=F), 0.05)
    w0 = TAU * f / SR
    cw, sw = np.cos(w0), np.sin(w0)
    alpha = sw / (2.0 * q)
    if kind == "lp":
        b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0
        a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
    elif kind == "hp":
        b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0
        a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
    elif kind == "bp":          # 0 dB at the centre
        b0 = alpha; b1 = 0.0 * cw; b2 = -alpha
        a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
    elif kind == "res":         # resonator: gain Q at the centre
        b0 = sw / 2; b1 = 0.0 * cw; b2 = -sw / 2
        a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
    elif kind == "notch":
        b0 = 1.0 + 0.0 * cw; b1 = -2 * cw; b2 = 1.0 + 0.0 * cw
        a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
    elif kind == "peak":
        amp = 10.0 ** (gain_db / 40.0)
        b0 = 1 + alpha * amp; b1 = -2 * cw; b2 = 1 - alpha * amp
        a0 = 1 + alpha / amp; a1 = -2 * cw; a2 = 1 - alpha / amp
    elif kind in ("ls", "hs"):
        amp = 10.0 ** (gain_db / 40.0)
        root = 2.0 * np.sqrt(amp) * alpha
        if kind == "ls":
            b0 = amp * ((amp + 1) - (amp - 1) * cw + root)
            b1 = 2 * amp * ((amp - 1) - (amp + 1) * cw)
            b2 = amp * ((amp + 1) - (amp - 1) * cw - root)
            a0 = (amp + 1) + (amp - 1) * cw + root
            a1 = -2 * ((amp - 1) + (amp + 1) * cw)
            a2 = (amp + 1) + (amp - 1) * cw - root
        else:
            b0 = amp * ((amp + 1) + (amp - 1) * cw + root)
            b1 = -2 * amp * ((amp - 1) + (amp + 1) * cw)
            b2 = amp * ((amp + 1) + (amp - 1) * cw - root)
            a0 = (amp + 1) - (amp - 1) * cw + root
            a1 = 2 * ((amp - 1) - (amp + 1) * cw)
            a2 = (amp + 1) - (amp - 1) * cw - root
    else:
        raise ValueError(kind)
    return b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0


def biquad(x, kind, f, q=0.7071, gain_db=0.0):
    """One fixed RBJ biquad over mono or stereo audio."""
    b0, b1, b2, a1, a2 = (float(v) for v in _rbj(kind, f, q, gain_db))
    return signal.lfilter([b0, b1, b2], [1.0, a1, a2], x, axis=0)


def eq(x, bands):
    """Chain of (kind, freq, q, gain_db) biquads."""
    for kind, f, q, gain in bands:
        x = biquad(x, kind, f, q, gain)
    return x


def lowpass(x, f, order=2):
    return signal.sosfilt(signal.butter(order, min(f, 0.45 * SR), "lowpass", fs=SR, output="sos"), x, axis=0)


def highpass(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, "highpass", fs=SR, output="sos"), x, axis=0)


def bandpass(x, lo, hi, order=2):
    return signal.sosfilt(signal.butter(order, [lo, min(hi, 0.45 * SR)], "bandpass", fs=SR, output="sos"), x, axis=0)


def tv_biquad(x, kind, f, q=0.7071, gain_db=0.0, block=32):
    """Biquad whose frequency (and optionally q) follow per-sample arrays.
    Coefficients are refreshed every `block` samples and the state is carried."""
    x = np.asarray(x, dtype=F)
    n = x.shape[0]
    count = (n + block - 1) // block
    centre = np.minimum(np.arange(count, dtype=np.int64) * block + block // 2, n - 1)
    fa = np.asarray(f, dtype=F)
    fa = fa[centre] if fa.ndim else np.full(count, float(fa))
    qa = np.asarray(q, dtype=F)
    qa = qa[centre] if qa.ndim else np.full(count, float(qa))
    b0, b1, b2, a1, a2 = _rbj(kind, fa, qa, gain_db)
    out = np.empty(n, dtype=F)
    zi = np.zeros(2)
    for i in range(count):
        s = i * block
        e = min(n, s + block)
        out[s:e], zi = signal.lfilter([b0[i], b1[i], b2[i]], [1.0, a1[i], a2[i]], x[s:e], zi=zi)
    return out


def one_pole(x, cutoff):
    """6 dB/octave low-pass."""
    a = np.exp(-TAU * cutoff / SR)
    return signal.lfilter([1.0 - a], [1.0, -a], x, axis=0)


def dc_block(x, f=20.0):
    return highpass(x, f, 2)


# ---------------------------------------------------------------------------
# shaping
# ---------------------------------------------------------------------------

def sat(x, drive=1.0):
    """tanh saturation that keeps small signals at unity gain."""
    if drive <= 0:
        return x
    return np.tanh(x * drive) / drive


def sat_norm(x, drive=1.0):
    """tanh saturation normalised so that an input of 1 comes out at 1."""
    return np.tanh(x * drive) / np.tanh(drive)


def fold(x, drive=1.0, bias=0.0):
    """Asymmetric saturation: adds even harmonics, then removes the offset."""
    y = np.tanh(drive * (x + bias)) - np.tanh(drive * bias)
    return y / max(np.tanh(drive * (1.0 + abs(bias))), 1e-6)


def frac_delay(x, samples):
    """Delay by a possibly fractional number of samples (linear interpolation)."""
    n = x.shape[0]
    pos = np.arange(n, dtype=F) - samples
    return np.interp(pos, np.arange(n, dtype=F), x, left=0.0, right=0.0)


def comb(x, freq, feedback, damp=0.3):
    """Feedback comb tuned to `freq`: gives noise a pitched, metallic or hollow ring."""
    period = SR / freq
    whole = int(np.floor(period - damp))
    d = period - damp - whole
    a = np.zeros(whole + 3)
    a[0] = 1.0
    a[whole] -= feedback * (1 - damp) * (1 - d)
    a[whole + 1] -= feedback * ((1 - damp) * d + damp * (1 - d))
    a[whole + 2] -= feedback * damp * d
    return signal.lfilter([1.0], a, x)


def karplus(excitation, f0, n, t60, damp=0.5):
    """Plucked or struck string: `excitation` circulates in a damped delay loop.
    damp (0..0.5) is how fast the highs die; t60 is the decay time of the note."""
    period = SR / f0
    whole = int(np.floor(period - damp))
    d = period - damp - whole
    g = 0.001 ** (1.0 / (max(f0, 1.0) * max(t60, 0.02)))
    a = np.zeros(whole + 3)
    a[0] = 1.0
    a[whole] -= g * (1 - damp) * (1 - d)
    a[whole + 1] -= g * ((1 - damp) * d + damp * (1 - d))
    a[whole + 2] -= g * damp * d
    x = np.zeros(int(n))
    m = min(int(n), excitation.size)
    x[:m] = excitation[:m]
    return signal.lfilter([1.0], a, x)


def modal(n, freqs, decays, amps, R=None, attack=0.0006, glide=0.0, glide_time=0.05):
    """Sum of decaying sine partials: bells, bars, anvils, stones, skins.
    decays are time constants in seconds; glide bends every partial (ratio at t=0)."""
    t = secs(n)
    out = np.zeros(int(n), dtype=F)
    bend = 1.0 + glide * np.exp(-t / max(glide_time, 1e-4)) if glide else None
    for i, (f, tau, amp) in enumerate(zip(freqs, decays, amps)):
        if f >= 0.47 * SR:
            continue
        phase0 = 0.0 if R is None else R.uniform(0.0, 1.0)
        if bend is None:
            tone = np.sin(TAU * (f * t + phase0))
        else:
            tone = np.sin(TAU * (np.cumsum(f * bend) / SR + phase0))
        out += amp * tone * np.exp(-t / max(tau, 1e-4))
    out *= 1.0 - np.exp(-t / max(attack, 1e-5))
    tail = min(nsamp(0.03), int(n) // 5)
    if tail > 1:
        out[-tail:] *= 0.5 + 0.5 * np.cos(np.pi * np.arange(tail) / tail)   # a ring that is cut short must not click
    return out


# ---------------------------------------------------------------------------
# stereo
# ---------------------------------------------------------------------------

def pan(mono, position=0.0):
    """Equal-power pan of a mono signal; position from -1 (left) to 1 (right)."""
    angle = (np.clip(position, -1.0, 1.0) + 1.0) * np.pi / 4.0
    return np.stack([mono * np.cos(angle), mono * np.sin(angle)], axis=1)


def to_stereo(x, position=0.0):
    return x if x.ndim == 2 else pan(x, position)


def to_mono(x):
    return x if x.ndim == 1 else x.mean(axis=1)


def balance(x, position):
    """Shift an already-stereo signal left or right without collapsing it."""
    if abs(position) < 1e-6:
        return x
    left = min(1.0, 1.0 - position)
    right = min(1.0, 1.0 + position)
    return x * np.array([left, right])


def widen(x, width=1.3):
    mid = 0.5 * (x[:, 0] + x[:, 1])
    side = 0.5 * (x[:, 0] - x[:, 1]) * width
    return np.stack([mid + side, mid - side], axis=1)


def decorrelate(mono, R, amount=0.6, span=0.012):
    """Make a wide stereo image from mono with two short random all-pass-like
    filters (sparse taps): the tone is kept, the sides stop being identical."""
    taps = nsamp(span)
    out = []
    for _ in range(2):
        h = np.zeros(taps)
        h[0] = 1.0
        for _k in range(6):
            h[R.integers(8, taps)] += amount * R.uniform(-0.5, 0.5)
        h /= np.sqrt(np.sum(h * h))
        out.append(signal.fftconvolve(mono, h)[: mono.shape[0]])
    return np.stack(out, axis=1)


# ---------------------------------------------------------------------------
# reverb
# ---------------------------------------------------------------------------

_ir_cache: dict = {}


def make_ir(seconds=1.2, predelay=0.008, low=1.15, high=0.45, hp=140.0, lp=7000.0,
            early=10, early_span=0.05, early_gain=0.5, seed="room"):
    """Generated stereo impulse response: sparse early taps, then a dense noise
    tail whose low, middle and high bands decay at different speeds."""
    key = (seconds, predelay, low, high, hp, lp, early, early_span, early_gain, seed)
    hit = _ir_cache.get(key)
    if hit is not None:
        return hit
    R = rng("ir", *key)
    n = nsamp(seconds * 1.15 + predelay + 0.02)
    t = secs(n)
    sides = []
    for _side in range(2):
        noise = R.standard_normal(n)
        lo = lowpass(noise, 350.0, 2)
        hi = highpass(noise, 2800.0, 2)
        mid = noise - lo - hi
        tail = (lo * np.exp(-6.908 * t / (seconds * low))
                + mid * np.exp(-6.908 * t / seconds)
                + hi * np.exp(-6.908 * t / (seconds * high)))
        tail *= np.minimum(t / 0.012, 1.0) ** 1.5
        taps = np.zeros(n)
        for k in range(early):
            when = R.uniform(0.0015, early_span)
            taps[int(when * SR)] += R.choice([-1.0, 1.0]) * np.exp(-when / (early_span * 0.6)) * R.uniform(0.5, 1.0)
        tail_energy = np.sqrt(np.sum(tail * tail)) + 1e-12
        tap_energy = np.sqrt(np.sum(taps * taps)) + 1e-12
        ir = tail / tail_energy + early_gain * taps / tap_energy
        shift = int(predelay * SR)
        ir = np.concatenate([np.zeros(shift), ir])[:n]
        ir = highpass(ir, hp, 2)
        ir = lowpass(ir, lp, 2)
        ir *= np.where(t > seconds, np.exp(-(t - seconds) / (0.03 * seconds + 1e-6)), 1.0)
        sides.append(ir / (np.sqrt(np.sum(ir * ir)) + 1e-12))
    out = np.stack(sides, axis=1)
    _ir_cache[key] = out
    return out


def convolve(x, ir, loop=False):
    """Wet signal only. x mono -> mono (left IR), x stereo -> stereo.
    loop=True is a circular convolution: the tail of the end lands on the start."""
    n = x.shape[0]

    def one(sig, h):
        if not loop:
            return signal.fftconvolve(sig, h)
        if h.shape[0] > n:
            h = _wrap_ir(h, n)
        return np.fft.irfft(np.fft.rfft(sig, n) * np.fft.rfft(h, n), n)

    if x.ndim == 1:
        return one(x, ir[:, 0])
    return np.stack([one(x[:, side], ir[:, side]) for side in range(2)], axis=1)


def _wrap_ir(h, size):
    out = np.zeros(size)
    for start in range(0, h.shape[0], size):
        chunk = h[start:start + size]
        out[: chunk.shape[0]] += chunk
    return out


def reverb(x, ir, wet=0.2, dry=1.0, tail=True):
    """Dry plus wet for one-shot sounds. With tail=True the result is longer than x."""
    w = convolve(x, ir)
    if not tail:
        w = w[: x.shape[0]]
    out = wet * w
    out[: x.shape[0]] += dry * x
    return out


# ---------------------------------------------------------------------------
# dynamics and meters
# ---------------------------------------------------------------------------

def periodic(fn, x, pre=2.0, post=0.0):
    """Run a stateful process on a loop so that its state is right at the wrap."""
    n = x.shape[0]
    a = min(nsamp(pre), n) if pre > 0 else 0
    b = min(nsamp(post), n) if post > 0 else 0
    parts = ([x[n - a:]] if a else []) + [x] + ([x[:b]] if b else [])
    y = fn(np.concatenate(parts))
    return y[a:a + n]


def compress(x, threshold=-18.0, ratio=2.0, attack=0.02, release=0.2, knee=6.0, makeup=0.0, grid=32):
    """Feed-forward, stereo-linked compressor with a soft knee."""
    n = x.shape[0]
    level = np.abs(x) if x.ndim == 1 else np.max(np.abs(x), axis=1)
    edges = np.arange(0, n, grid, dtype=np.int64)
    peaks = np.maximum.reduceat(level, edges)
    step = grid / SR
    a_coef = np.exp(-step / attack)
    r_coef = np.exp(-step / release)
    env = np.empty(peaks.size, dtype=F)
    state = 0.0
    for i, value in enumerate(peaks):
        coef = a_coef if value > state else r_coef
        state = coef * state + (1.0 - coef) * value
        env[i] = state
    over = 20.0 * np.log10(np.maximum(env, 1e-7)) - threshold
    slope = 1.0 / ratio - 1.0
    red = np.zeros_like(over)
    soft = (over > -knee / 2.0) & (over < knee / 2.0)
    red[soft] = slope * (over[soft] + knee / 2.0) ** 2 / (2.0 * knee)
    hard = over >= knee / 2.0
    red[hard] = slope * over[hard]
    gain = np.interp(np.arange(n, dtype=F), edges.astype(F) + grid / 2.0, 10.0 ** ((red + makeup) / 20.0))
    return x * (gain if x.ndim == 1 else gain[:, None])


def duck_env(n, hit_times, depth=0.4, attack=0.006, hold=0.02, release=0.16, loop=False):
    """Gain curve that dips after every hit: the 'sidechain' that lets drums through."""
    env = np.ones(n, dtype=F)
    span = nsamp(attack + hold + release * 5.0)
    t = secs(span)
    shape = np.where(t < attack, t / attack,
                     np.where(t < attack + hold, 1.0, np.exp(-(t - attack - hold) / release)))
    for when in hit_times:
        start = int(round(when * SR))
        idx = np.arange(start, start + span)
        dip = 1.0 - depth * shape
        if loop:
            idx = idx % n
        else:
            keep = (idx >= 0) & (idx < n)
            idx, dip = idx[keep], dip[keep]
        env[idx] = np.minimum(env[idx], dip)
    return env


def oversampled_peak(x, chunk=1 << 16, factor=4):
    """For every sample, the largest inter-sample value near it (all channels),
    found by oversampling a chunk at a time so a long piece needs little memory."""
    n = x.shape[0]
    out = np.empty(n, dtype=F)
    margin = 64
    for start in range(0, n, chunk):
        a = max(0, start - margin)
        b = min(n, start + chunk + margin)
        up = np.abs(signal.resample_poly(x[a:b], factor, 1, axis=0))
        if up.ndim == 2:
            up = up.max(axis=1)
        up = up[: (b - a) * factor].reshape(b - a, factor).max(axis=1)
        stop = min(n, start + chunk)
        out[start:stop] = up[start - a: stop - a]
    return out


def true_peak(x):
    """Inter-sample peak (linear), by 4x oversampling."""
    return float(np.max(oversampled_peak(x)))


def limit(x, ceiling_db=-1.5, lookahead=0.006, release=0.09):
    """Look-ahead true-peak limiter. The gain is a held minimum, a release and a
    moving average of the hold length, which never lets a peak past the ceiling."""
    ceiling = db(ceiling_db)
    over = oversampled_peak(x)
    n = x.shape[0]
    block = 16
    edges = np.arange(0, n, block, dtype=np.int64)
    need = np.minimum(1.0, ceiling / np.maximum(np.maximum.reduceat(over, edges), 1e-9))
    span = max(3, int(lookahead * SR / block)) | 1
    held = minimum_filter1d(need, span, mode="nearest")
    coef = np.exp(-(block / SR) / release)
    out = np.empty_like(held)
    state = 1.0
    for i, value in enumerate(held):
        if value < state:
            state = value                                   # the hold already looked ahead
        else:
            state += (1.0 - coef) * (value - state)         # recover slowly, never above `held`
        out[i] = state
    smooth = uniform_filter1d(out, span, mode="nearest")
    gain = np.interp(np.arange(n, dtype=F), edges.astype(F) + block / 2.0, smooth)
    return x * (gain if x.ndim == 1 else gain[:, None])


def _k_weighting():
    """ITU-R BS.1770 K-weighting biquads for this sample rate."""
    f0, gain, q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    k = np.tan(np.pi * f0 / SR)
    vh = 10.0 ** (gain / 20.0)
    vb = vh ** 0.4996667741545416
    a0 = 1.0 + k / q + k * k
    pre_b = np.array([(vh + vb * k / q + k * k) / a0, 2.0 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0])
    pre_a = np.array([1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0])
    f0, q = 38.13547087602444, 0.5003270373238773
    k = np.tan(np.pi * f0 / SR)
    a0 = 1.0 + k / q + k * k
    rlb_b = np.array([1.0, -2.0, 1.0])
    rlb_a = np.array([1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0])
    return (pre_b, pre_a), (rlb_b, rlb_a)


_K_PRE, _K_RLB = _k_weighting()


def lufs(x):
    """Integrated loudness (BS.1770, both gates). Mono counts as one channel."""
    if x.ndim == 1:
        x = x[:, None]
    n, channels = x.shape
    hop = int(0.1 * SR)
    count = n // hop
    if count < 4:
        weighted = signal.lfilter(*_K_RLB, signal.lfilter(*_K_PRE, x, axis=0), axis=0)
        return -0.691 + 10.0 * np.log10(max(float(np.mean(np.sum(weighted ** 2, axis=1))), 1e-12))
    # K-weight a chunk at a time (filter state carried), keeping only the energy of each 100 ms hop:
    # a whole piece is measured without ever holding a filtered copy of it.
    hops = np.zeros(count)
    state_pre = np.zeros((2, channels))
    state_rlb = np.zeros((2, channels))
    chunk = hop * 64
    for start in range(0, count * hop, chunk):
        seg = np.asarray(x[start:min(start + chunk, count * hop)], dtype=F)
        seg, state_pre = signal.lfilter(*_K_PRE, seg, axis=0, zi=state_pre)
        seg, state_rlb = signal.lfilter(*_K_RLB, seg, axis=0, zi=state_rlb)
        power = np.sum(seg * seg, axis=1)
        hops[start // hop: start // hop + power.size // hop] = power.reshape(-1, hop).sum(axis=1)
    energy = (hops[:-3] + hops[1:-2] + hops[2:-1] + hops[3:]) / (4.0 * hop)      # 400 ms windows, 75% overlap
    loud = -0.691 + 10.0 * np.log10(np.maximum(energy, 1e-12))
    gated = energy[loud > -70.0]
    if gated.size == 0:
        return -70.0
    threshold = -0.691 + 10.0 * np.log10(np.mean(gated)) - 10.0
    final = energy[loud > threshold]
    if final.size == 0:
        return -70.0
    return float(-0.691 + 10.0 * np.log10(np.mean(final)))


def momentary_max(x):
    """Loudest 400 ms window, in LUFS: how loud a short effect feels at its peak."""
    if x.ndim == 1:
        x = x[:, None]
    weighted = signal.lfilter(*_K_RLB, signal.lfilter(*_K_PRE, x, axis=0), axis=0)
    power = np.sum(weighted ** 2, axis=1)
    size = int(0.4 * SR)
    if power.size <= size:
        power = np.concatenate([power, np.zeros(size - power.size + 1)])
    cum = np.concatenate([[0.0], np.cumsum(power, dtype=F)])
    energy = (cum[size:] - cum[:-size]) / size
    return float(-0.691 + 10.0 * np.log10(max(float(energy.max()), 1e-12)))


# ---------------------------------------------------------------------------
# buffers and files
# ---------------------------------------------------------------------------

def place(buf, x, start, gain=1.0, loop=False):
    """Add x into buf at sample `start`. With loop=True anything past the end
    (or before the start) wraps around."""
    n = buf.shape[0]
    start = int(start)
    if x.ndim == 1 and buf.ndim == 2:
        x = np.stack([x, x], axis=1) * 0.7071
    m = x.shape[0]
    if loop:
        idx = (start + np.arange(m)) % n
        if m <= n:
            buf[idx] += gain * x
        else:
            np.add.at(buf, idx, gain * x)
        return
    a = max(0, start)
    b = min(n, start + m)
    if b > a:
        buf[a:b] += gain * x[a - start:b - start]


def trim(x, threshold_db=-60.0, lead=0.001, tail_pad=0.004):
    """Cut leading and trailing near-silence, measured against the peak."""
    level = np.abs(x) if x.ndim == 1 else np.max(np.abs(x), axis=1)
    peak = level.max()
    if peak <= 0:
        return x
    loud = np.nonzero(level > peak * db(threshold_db))[0]
    a = max(0, loud[0] - nsamp(lead))
    b = min(x.shape[0], loud[-1] + nsamp(tail_pad))
    return x[a:b]


def normalize(x, peak_db=-3.0):
    peak = np.max(np.abs(x))
    return x if peak <= 0 else x * (db(peak_db) / peak)


def write_wav16(path, x):
    """16-bit PCM WAV at SR. Returns the integer samples that were written."""
    data = np.clip(np.round(np.asarray(x, dtype=F) * 32767.0), -32768, 32767).astype("<i2")
    channels = 1 if data.ndim == 1 else data.shape[1]
    with wave.open(path, "wb") as handle:
        handle.setnchannels(channels)
        handle.setsampwidth(2)
        handle.setframerate(SR)
        handle.writeframes(data.tobytes())
    return data


def write_wav24(path, x):
    """24-bit PCM WAV at SR, written a slice at a time."""
    channels = 1 if x.ndim == 1 else x.shape[1]
    with wave.open(path, "wb") as handle:
        handle.setnchannels(channels)
        handle.setsampwidth(3)
        handle.setframerate(SR)
        step = 1 << 18
        for i in range(0, x.shape[0], step):
            ints = np.clip(np.round(np.asarray(x[i:i + step], dtype=F) * 8388607.0), -8388608, 8388607).astype("<i4")
            handle.writeframes(ints.reshape(-1).view(np.uint8).reshape(-1, 4)[:, :3].tobytes())


def read_wav(path):
    """Returns (float audio, sample rate, channels, sample width in bytes)."""
    with wave.open(path, "rb") as handle:
        channels = handle.getnchannels()
        width = handle.getsampwidth()
        rate = handle.getframerate()
        raw = handle.readframes(handle.getnframes())
    if width != 2:
        raise ValueError(f"{path}: expected 16-bit, found {8 * width}-bit")
    data = np.frombuffer(raw, dtype="<i2").astype(F) / 32768.0
    if channels > 1:
        data = data.reshape(-1, channels)
    return data, rate, channels, width
