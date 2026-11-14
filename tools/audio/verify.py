"""
verify.py -- measurements. Nobody can listen during a build, so every file is
described in numbers: level, spectrum, envelope, loudness, and the loop seam.
"""
from __future__ import annotations

import os
import re
import subprocess

import numpy as np

from dsp import F, SR, highpass, lufs, momentary_max, to_db, to_mono, true_peak

BANDS = [("<80", 0, 80), ("80-200", 80, 200), ("200-600", 200, 600), ("600-1.5k", 600, 1500),
         ("1.5-3k", 1500, 3000), ("3-8k", 3000, 8000), (">8k", 8000, SR / 2)]


def spectrum(x):
    """Long-term power spectrum of the mono sum. Returns (freqs, power)."""
    mono = to_mono(np.asarray(x, dtype=F))
    n = mono.size
    frame = 4096 if n >= 8192 else max(256, 1 << int(np.floor(np.log2(max(n, 256)))))
    if n < frame:
        mono = np.concatenate([mono, np.zeros(frame - n)])
        n = frame
    hop = frame // 4
    window = np.hanning(frame)
    power = np.zeros(frame // 2 + 1)
    for start in range(0, n - frame + 1, hop):
        power += np.abs(np.fft.rfft(mono[start:start + frame] * window)) ** 2
    return np.fft.rfftfreq(frame, 1.0 / SR), power


def share(freqs, power, lo, hi):
    total = power.sum() + 1e-20
    return float(power[(freqs >= lo) & (freqs < hi)].sum() / total)


def envelope(x, window=0.004, hop=0.001):
    """Short RMS envelope of the mono sum. Returns (times, level)."""
    mono = to_mono(np.asarray(x, dtype=F))
    w = max(8, int(window * SR))
    h = max(1, int(hop * SR))
    sq = np.concatenate([[0.0], np.cumsum(mono * mono)])
    starts = np.arange(0, max(1, mono.size - w), h)
    level = np.sqrt((sq[np.minimum(starts + w, mono.size)] - sq[starts]) / w)
    return (starts + w / 2.0) / SR, level


def measure(x):
    """Everything the checks need about one sound."""
    x = np.asarray(x, dtype=F)
    mono = to_mono(x)
    freqs, power = spectrum(x)
    total = power.sum() + 1e-20
    centroid = float((freqs * power).sum() / total)
    smooth = np.convolve(power, np.ones(5) / 5.0, mode="same")
    peak_hz = float(freqs[int(np.argmax(smooth[1:])) + 1])
    times, env = envelope(x)
    top = float(env.max()) + 1e-12
    i_peak = int(np.argmax(env))
    above10 = np.nonzero(env >= 0.1 * top)[0]
    above90 = np.nonzero(env >= 0.9 * top)[0]
    attack = float(times[above90[0]] - times[above10[0]]) if above10.size and above90.size else 0.0
    after = np.nonzero(env[i_peak:] >= 0.1 * top)[0]
    decay = float(times[i_peak + after[-1]] - times[i_peak]) if after.size else 0.0
    flat = power[(freqs > 100) & (freqs < 8000)] + 1e-20
    flatness = float(np.exp(np.mean(np.log(flat))) / np.mean(flat))
    return dict(
        duration=x.shape[0] / SR,
        channels=1 if x.ndim == 1 else x.shape[1],
        peak_db=to_db(np.max(np.abs(x))),
        rms_db=to_db(np.sqrt(np.mean(mono * mono))),
        dc=float(np.max(np.abs(np.mean(x, axis=0)))),
        centroid=centroid,
        peak_hz=peak_hz,
        attack=attack,
        time_to_peak=float(times[i_peak]),
        decay=decay,
        flatness=flatness,
        loud=momentary_max(x),
        loud_small=momentary_max(highpass(x, 200.0, 2)),
        bands={label: share(freqs, power, lo, hi) for label, lo, hi in BANDS},
        low200=share(freqs, power, 0, 200),
        b80_600=share(freqs, power, 80, 600),
        b500_1500=share(freqs, power, 500, 1500),
        b3k_8k=share(freqs, power, 3000, 8000),
    )


def formant_peaks(x, lo=250.0, hi=4000.0, count=4):
    """Centres of the strongest broad spectral humps: where the formants ended up."""
    freqs, power = spectrum(x)
    width = max(3, int(120.0 / (freqs[1] - freqs[0])))
    kernel = np.hanning(width * 2 + 1)
    smooth = np.convolve(10.0 * np.log10(power + 1e-20), kernel / kernel.sum(), mode="same")
    keep = (freqs >= lo) & (freqs <= hi)
    idx = np.nonzero(keep)[0]
    peaks = [i for i in idx[1:-1] if smooth[i] > smooth[i - 1] and smooth[i] >= smooth[i + 1]]
    peaks.sort(key=lambda i: -smooth[i])
    return sorted(float(freqs[i]) for i in peaks[:count])


def f0_track(x, lo=40.0, hi=900.0, frame=None, hop=0.02):
    """Pitch track by autocorrelation: [(time, Hz or 0, strength 0..1, frame rms)].
    The strongest repeat after the correlation has first fallen through zero is the
    period; `strength` is how exactly the wave repeats there (1 = a pure tone, a
    rough growl is well below that, noise is near 0)."""
    mono = to_mono(np.asarray(x, dtype=F))
    frame = frame or max(0.04, 3.2 / lo)
    size = int(frame * SR)
    top = float(np.max(np.abs(mono))) + 1e-12
    out = []
    for start in range(0, max(1, mono.size - size), int(hop * SR)):
        seg = mono[start:start + size]
        level = float(np.sqrt(np.mean(seg * seg))) if seg.size == size else 0.0
        if level < 0.02 * top:
            out.append((start / SR, 0.0, 0.0, level))
            continue
        seg = (seg - seg.mean()) * np.hanning(size)
        ac = np.fft.irfft(np.abs(np.fft.rfft(seg, size * 2)) ** 2)[:size]
        # undo the triangular bias of a windowed autocorrelation, roughly
        ac = ac / (ac[0] + 1e-20)
        a, b = max(2, int(SR / hi)), min(int(SR / lo), size - 2)
        below = np.nonzero(ac[:b] < 0.0)[0]
        first = int(below[0]) if below.size else a
        a = max(a, first)
        if a >= b:
            out.append((start / SR, 0.0, 0.0, level))
            continue
        k = a + int(np.argmax(ac[a:b]))
        strength = float(ac[k]) / max(1e-6, 1.0 - k / size)
        out.append((start / SR, SR / k if strength > 0.2 else 0.0, float(np.clip(strength, 0.0, 1.0)), level))
    return out


def voice_report(x, lo, hi):
    """Summary of a creature call over its loud part (the room's tail is left out):
    the middle pitch of its first third, its highest pitch and the middle pitch of
    its last third, and how exactly the wave repeats (see f0_track). A rough voice
    makes the tracker jump an octave now and then, so these are medians."""
    frames = f0_track(x, lo, hi)
    loud = max((level for _t, _f, _s, level in frames), default=0.0)
    track = [(t, f, s) for t, f, s, level in frames if f > 0 and level >= 0.3 * loud]
    if len(track) < 6:
        return None
    freqs = np.array([f for _t, f, _s in track])
    strengths = np.array([s for _t, _f, s in track])
    k = max(2, len(freqs) // 3)
    return dict(start=float(np.median(freqs[:k])), high=float(np.quantile(freqs, 0.9)), end=float(np.median(freqs[-k:])),
                strength=float(np.median(strengths)), voiced=len(track))


def pitch_near(x, when, expected_hz, span=0.12):
    """The fundamental within a major third of `expected_hz` in the `span` seconds
    after `when`, by autocorrelation. Returns Hz, or 0 if there is nothing there."""
    mono = to_mono(np.asarray(x, dtype=F))
    a = max(0, int(when * SR))
    seg = mono[a:a + int(span * SR)]
    if seg.size < 256 or np.sqrt(np.mean(seg * seg)) < 1e-5:
        return 0.0
    seg = (seg - seg.mean()) * np.hanning(seg.size)
    size = 1 << int(np.ceil(np.log2(seg.size * 2)))
    ac = np.fft.irfft(np.abs(np.fft.rfft(seg, size)) ** 2)
    lo = max(2, int(SR / (expected_hz * 1.26)))
    hi = min(size // 2 - 2, int(SR / (expected_hz / 1.26)) + 1)
    k = lo + int(np.argmax(ac[lo:hi + 1]))
    y0, y1, y2 = ac[k - 1], ac[k], ac[k + 1]
    denom = y0 - 2.0 * y1 + y2
    shift = 0.5 * (y0 - y2) / denom if abs(denom) > 1e-20 else 0.0
    return SR / (k + float(np.clip(shift, -1.0, 1.0)))


def hook_played(song, stem_audio, part, first_bar, last_bar):
    """Compare the performed lead with the written notes. Returns (rows, summary line);
    rows are (bar, written note, cents off or None when no pitch was found)."""
    from dsp import mtof, note_name
    rows = []
    for name, start, length, pitch in song.notes:
        bar = int(start // 16) + 1
        if name != part or not first_bar <= bar <= last_bar:
            continue
        when = song.t(bar, start % 16) + 0.045
        span = float(np.clip(song.d(length) * 0.7, 0.05, 0.14))
        found = pitch_near(stem_audio, when, float(mtof(pitch)), span)
        cents = 1200.0 * np.log2(found / float(mtof(pitch))) if found > 0 else None
        rows.append((bar, note_name(pitch), cents))
    good = [r for r in rows if r[2] is not None and abs(r[2]) <= 25.0]
    worst = max((abs(r[2]) for r in rows if r[2] is not None), default=0.0)
    summary = f"{len(good)} of {len(rows)} written notes found within 25 cents (largest error {worst:.0f} cents)"
    return rows, summary


# --- ffmpeg helpers ---------------------------------------------------------

def ebur(ffmpeg, path):
    """(integrated LUFS, true peak dBTP, loudness range LU) as ffmpeg measures them."""
    run = subprocess.run([ffmpeg, "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
                         capture_output=True, text=True)
    text = run.stderr
    i = re.findall(r"I:\s*(-?\d+\.\d+) LUFS", text)
    p = re.findall(r"Peak:\s*(-?\d+\.\d+) dBFS", text)
    lra = re.findall(r"LRA:\s*(-?\d+\.\d+) LU", text)
    return (float(i[-1]) if i else None, float(p[-1]) if p else None, float(lra[-1]) if lra else None)


def decode(ffmpeg, path, channels=2):
    """Decode any audio file to float at SR."""
    run = subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-i", path, "-f", "f32le", "-ac", str(channels),
                          "-ar", str(SR), "-"], capture_output=True)
    if run.returncode != 0:
        raise RuntimeError(run.stderr.decode(errors="replace"))
    raw = np.frombuffer(run.stdout, dtype=np.float32)        # kept as 32-bit: a long piece is not copied to 64-bit
    return raw.reshape(-1, channels) if channels > 1 else raw


def probe(ffmpeg, path):
    """Stream facts from ffmpeg's banner: codec, rate, channels, bitrate."""
    run = subprocess.run([ffmpeg, "-hide_banner", "-i", path], capture_output=True, text=True)
    text = run.stderr
    stream = re.search(r"Stream #0:0.*?: Audio: (\w+).*?, (\d+) Hz, (\w+)[^,]*, \w+(?:, (\d+) kb/s)?", text)
    duration = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", text)
    info = {}
    if stream:
        info.update(codec=stream.group(1), rate=int(stream.group(2)), layout=stream.group(3),
                    kbps=int(stream.group(4)) if stream.group(4) else None)
    if duration:
        h, m, s = duration.groups()
        info["duration"] = int(h) * 3600 + int(m) * 60 + float(s)
    return info


def spectrogram(ffmpeg, path, png, width=1200, height=420, stop=None):
    args = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", path, "-lavfi",
            "aformat=channel_layouts=mono,showspectrumpic=s=%dx%d:legend=1:scale=log:fscale=log:color=intensity%s"
            % (width, height, ":stop=%d" % stop if stop else ""), png]
    subprocess.run(args, check=True)


# --- loop seam ---------------------------------------------------------------

def seam_report(loop):
    """How the last sample runs into the first, compared with the music's own motion,
    and how level and spectrum behave across the join when the loop is played twice."""
    x = loop
    # steps between neighbouring samples over the whole loop, gathered a slice at a time
    max_step = 0.0
    some_steps, some_curves = [], []
    chunk = 1 << 19
    for i in range(0, x.shape[0] - 2, chunk):
        seg = np.asarray(x[i:i + chunk + 2], dtype=F)
        d1 = np.abs(np.diff(seg, axis=0))
        max_step = max(max_step, float(d1.max()))
        some_steps.append(d1[::7].ravel())
        some_curves.append(np.abs(np.diff(seg, n=2, axis=0))[::7].ravel())
    typical_step = float(np.quantile(np.concatenate(some_steps), 0.999))
    typical_curve = float(np.quantile(np.concatenate(some_curves), 0.999))
    first, second, last, before = (np.asarray(x[k], dtype=F) for k in (0, 1, -1, -2))
    wrap_step = float(np.max(np.abs(first - last)))
    wrap_curve = float(max(np.max(np.abs(second - 2.0 * first + last)), np.max(np.abs(first - 2.0 * last + before))))
    twice = np.concatenate([np.asarray(x[-SR:], dtype=F), np.asarray(x[:SR], dtype=F)])     # one second each side of the join
    mono = to_mono(twice)
    # short-window level across the join (10 ms windows)
    w = int(0.01 * SR)
    levels = np.array([np.sqrt(np.mean(mono[i:i + w] ** 2)) for i in range(0, mono.size - w + 1, w)])
    lev_db = 20.0 * np.log10(levels + 1e-9)
    jumps = np.abs(np.diff(lev_db))
    mid = len(lev_db) // 2
    seam_jump = float(np.max(jumps[mid - 2:mid + 1]))
    # spectral flux in the top band (a click is broadband: it lights up the highs)
    frame, hop = 512, 128
    win = np.hanning(frame)
    mags = np.array([np.abs(np.fft.rfft(mono[i:i + frame] * win)) for i in range(0, mono.size - frame, hop)])
    freqs = np.fft.rfftfreq(frame, 1.0 / SR)
    high = mags[:, freqs > 6000].sum(axis=1)
    flux = np.abs(np.diff(high))
    seam_frame = (SR - frame // 2) // hop
    near = flux[max(0, seam_frame - 4):seam_frame + 5]
    return dict(
        wrap_step=wrap_step, typical_step=typical_step, max_step=max_step,
        wrap_curve=wrap_curve, typical_curve=typical_curve,
        seam_level_jump_db=seam_jump, typical_level_jump_db=float(np.quantile(jumps, 0.95)),
        seam_hf_flux=float(near.max()), typical_hf_flux=float(np.quantile(flux, 0.99)), max_hf_flux=float(flux.max()),
        head_rms_db=to_db(np.sqrt(np.mean(to_mono(np.asarray(x[:int(0.3 * SR)], dtype=F)) ** 2))),
        tail_rms_db=to_db(np.sqrt(np.mean(to_mono(np.asarray(x[-int(0.3 * SR):], dtype=F)) ** 2))),
    )


def seam_ok(report):
    return (report["wrap_step"] <= 1.5 * report["max_step"] and report["wrap_step"] <= 4.0 * report["typical_step"] + 1e-4
            and report["seam_hf_flux"] <= 1.5 * report["max_hf_flux"])


# --- the names the game asks for ---------------------------------------------

_CALL = re.compile(r"\b(?:sfx|music|stinger|loop)\s*\??\.?\(")
_PROP = re.compile(r"\bsfx\s*:\s*['\"]([a-z][a-z0-9_]*)['\"]")
_STRING = re.compile(r"['\"]([a-z][a-z0-9_]*)['\"]")
_COMPARED = re.compile(r"(?:[=!]==?|\bcase)\s*$")


def called_names(src_dir, prefixes=(), skip=("audio.js",)):
    """Every sound and track name the game's own code hands to the audio module:
    {name: [file:line, ...]}. Looks at the first argument of sfx(), music(),
    stinger() and loop() calls, at `sfx: '...'` options, and at any string that
    starts like a sound name (for names kept in tables and picked at run time)."""
    found: dict = {}

    def add(name, where):
        found.setdefault(name, [])
        if where not in found[name]:
            found[name].append(where)

    for folder, _dirs, files in os.walk(src_dir):
        for fname in sorted(files):
            if not fname.endswith(".js") or fname in skip:
                continue
            path = os.path.join(folder, fname)
            rel = os.path.relpath(path, src_dir).replace("\\", "/")
            with open(path, encoding="utf-8", errors="replace") as handle:
                text = handle.read()

            def where(index):
                return f"{rel}:{text.count(chr(10), 0, index) + 1}"

            for call in _CALL.finditer(text):
                depth, i = 0, call.end()
                while i < len(text):
                    c = text[i]
                    if c in "([{":
                        depth += 1
                    elif c in ")]}":
                        if depth == 0:
                            break
                        depth -= 1
                    elif c == "," and depth == 0:
                        break
                    i += 1
                for m in _STRING.finditer(text, call.end(), i):
                    if not _COMPARED.search(text, max(0, m.start() - 12), m.start()):
                        add(m.group(1), where(m.start()))
            for m in _PROP.finditer(text):
                add(m.group(1), where(m.start()))
            for m in _STRING.finditer(text):
                name = m.group(1)
                if "_" in name and name.split("_")[0] in prefixes and not _COMPARED.search(text, max(0, m.start() - 12), m.start()):
                    add(name, where(m.start()))
    return found


def loudness_line(x):
    return "LUFS %6.2f  true peak %6.2f dBTP  peak %6.2f dBFS" % (lufs(x), to_db(true_peak(x)), to_db(np.max(np.abs(x))))
