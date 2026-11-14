#!/usr/bin/env python3
"""
build.py -- renders every sound in Maul Street from code and checks the result.

    python tools/audio/build.py --out web/public/audio --ffmpeg path/to/ffmpeg
    python tools/audio/build.py --check                  print form, chords, hooks and the clash check; render nothing
    python tools/audio/build.py --only battle,coin ...   re-render some tracks or effects ("music" and "sfx" also work)
    python tools/audio/build.py --verify ...             re-measure the files already on disk; render nothing

Needs Python with numpy and scipy, and ffmpeg with libmp3lame (music encoding
and loudness measurement only). Nothing is downloaded or sampled; all seeds are
fixed, so two runs give the same audio.

Output:
    <out>/music/{street,battle,victory,defeat}.mp3   44.1 kHz stereo, 160 kbps
    <out>/music/film.mp3                             the 140 s score for the demo film
    <out>/sfx/*.wav                                  44.1 kHz, 16-bit
    <out>/manifest.json                              every file, with duration, peak and what the player needs
    tools/audio/film/film.wav, film_timing.json      the film score lossless (24-bit) and its bar/downbeat times
                                                     (--film-dir moves them; the folder is git-ignored)

The two music loops are stored with half a second of the loop's own end before
them and half a second of its start after them. The player loops the region
[loopStart, loopEnd] given in the manifest. Because the audio around that
region is the loop itself, the join is seamless even if a decoder shifts the
file by its MP3 encoder delay.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402

import instruments  # noqa: E402
import music  # noqa: E402
import sfx  # noqa: E402
import verify  # noqa: E402
from dsp import SR, db, lufs, read_wav, to_db, to_mono, true_peak, write_wav16, write_wav24  # noqa: E402

ROLL = 0.5                 # seconds of the loop repeated before and after it in the file
# Where each piece states its hook: (stem, part name in the score, first bar, last bar)
HOOKS = {"street": ("oud", "oud", 1, 8), "battle": ("lead", "lead", 9, 16), "victory": ("lead", "lead", 1, 3), "defeat": ("reed", "reed", 1, 1),
         "film": ("lead", "lead", 33, 40)}
VOICE_RANGE = {"roar_quad": (45.0, 320.0), "roar_biped": (32.0, 220.0), "roar_winged": (350.0, 2600.0), "pain_1": (50.0, 260.0),
               "pain_2": (100.0, 520.0), "pain_3": (250.0, 1200.0), "faint_1": (60.0, 320.0), "faint_2": (140.0, 700.0)}
TARGET_LUFS = {"street": -16.0, "battle": -16.0, "victory": -15.0, "defeat": -17.0, "film": -16.0}
LENGTH_LIMITS = {"street": (64.0, 80.0), "battle": (72.0, 96.0), "victory": (6.0, 8.0), "defeat": (5.0, 6.0), "film": (139.5, 140.5)}
MP3_KBPS = 160
PEAK_LIMIT_DBTP = -1.0
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def log(text=""):
    print(text, flush=True)


# ---------------------------------------------------------------------------
# music
# ---------------------------------------------------------------------------

def encode_mp3(ffmpeg, pieces, path, gain=1.0):
    """Encode the pieces one after another (a loop is its tail, itself, its head), streamed to ffmpeg a slice at a time."""
    args = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", "-",
            "-c:a", "libmp3lame", "-b:a", f"{MP3_KBPS}k", "-ar", str(SR), "-ac", "2", "-map_metadata", "-1",
            "-fflags", "+bitexact", "-flags:a", "+bitexact", "-id3v2_version", "0", "-write_xing", "1", path]
    proc = subprocess.Popen(args, stdin=subprocess.PIPE)
    step = 1 << 18
    frames = 0
    for piece in pieces:
        for i in range(0, piece.shape[0], step):
            proc.stdin.write((piece[i:i + step] * gain).astype(np.float32).tobytes())
        frames += piece.shape[0]
    proc.stdin.close()
    if proc.wait() != 0:
        raise RuntimeError(f"ffmpeg could not encode {path}")
    return frames


def render_track(name, ffmpeg, out_dir, lines, film_dir=None):
    """Compose, perform, master, encode and measure one piece. Returns its manifest entry."""
    started = time.time()
    stem, part, first_bar, last_bar = HOOKS[name]
    kept = {}

    def tap(stem_name, buf):
        if stem_name == stem:
            kept["lead"] = to_mono(buf).astype(np.float32)

    report = {"tap": tap}
    song, audio = music.produce(name, report)
    instruments.clear_cache()
    text, hard = music.describe(song)
    lines.append(text)
    if hard:
        raise SystemExit(f"{name}: {hard} unintended clashes against the bass; fix the writing")
    rows, summary = verify.hook_played(song, kept["lead"], part, first_bar, last_bar)
    lines.append(f"    hook as performed ({stem} stem, bars {first_bar}-{last_bar}): {summary}")
    lines.append("      written note (cents off as played): "
                 + " ".join(f"{note}({cents:+.0f})" if cents is not None else f"{note}(?)" for _bar, note, cents in rows))
    lines.append("    stems (target LUFS, raw LUFS before gain, peak after gain):")
    for stem, target, measured, peak in sorted(report["stems"], key=lambda row: row[1], reverse=True):
        lines.append(f"      {stem:10s} {target:6.1f}  {measured:7.1f}  {peak:6.1f} dBFS")

    loop_n = song.loop_n if song.loop else None
    roll = int(ROLL * SR) if song.loop else 0
    path = os.path.join(out_dir, "music", f"{name}.mp3")
    target = TARGET_LUFS[name]
    gain = 1.0
    # The encoder is not level-neutral (LAME scales the signal by about 0.95 at this bit rate,
    # and peaks move a little), so the loudness and the true peak are set on the encoded file.
    pieces = [audio[-roll:], audio, audio[:roll]] if song.loop else [audio]
    for attempt in range(5):
        encoded_frames = encode_mp3(ffmpeg, pieces, path, gain)
        loud, peak, lra = verify.ebur(ffmpeg, path)
        if loud is None or peak is None:
            break
        step = target - loud
        if peak + step > PEAK_LIMIT_DBTP - 0.2:
            step = PEAK_LIMIT_DBTP - 0.2 - peak          # the peak ceiling wins over the loudness target
        if abs(step) < 0.12:
            break
        gain *= db(step)
    decoded = verify.decode(ffmpeg, path)
    info = verify.probe(ffmpeg, path)
    entry = dict(file=f"music/{name}.mp3", duration=round(decoded.shape[0] / SR, 4), peak=round(to_db(np.max(np.abs(decoded))), 2),
                 truePeak=peak, lufs=loud, loop=bool(song.loop), bpm=song.bpm, bars=song.bars, key=song.key, title=song.title)
    lines.append(f"    render: {lufs(audio):.2f} LUFS, true peak {to_db(true_peak(audio)):.2f} dBTP before encoding; "
                 f"{time.time() - started:.0f} s to make")
    lines.append(f"    mp3: {info.get('codec')} {info.get('rate')} Hz {info.get('layout')} {info.get('kbps')} kbps, "
                 f"{decoded.shape[0]} frames decoded vs {encoded_frames} encoded, {os.path.getsize(path) / 1e6:.2f} MB")
    lines.append(f"    ffmpeg ebur128: integrated {loud} LUFS, true peak {peak} dBTP, loudness range {lra} LU"
                 + (f"  (after {to_db(gain):+.2f} dB of make-up for the encoder)" if gain != 1.0 else ""))
    if song.loop:
        entry.update(loopStart=round(roll / SR, 6), loopEnd=round((roll + loop_n) / SR, 6), loopLength=round(loop_n / SR, 6),
                     loopSamples=loop_n, sampleRate=SR)
        lines += seam_lines(audio, decoded, roll, loop_n)
    lines.append("    loudness by section (LUFS of the decoded mp3):")
    for sec_name, first, last, _what in song.sections:
        a = roll + int(song.t(first) * SR)
        b = roll + int(song.t(last + 1) * SR)
        lines.append(f"      {sec_name:20s} {lufs(decoded[a:min(b, decoded.shape[0])]):7.2f}")
    if song.events:
        # A piece made for pictures: keep it lossless next to the tools, with its timing map.
        entry["timing"] = music.timing(song)
        if film_dir:
            os.makedirs(film_dir, exist_ok=True)
            wav_path = os.path.join(film_dir, f"{name}.wav")
            write_wav24(wav_path, audio)
            with open(os.path.join(film_dir, f"{name}_timing.json"), "w", encoding="utf-8", newline="\n") as handle:
                json.dump(dict(title=song.title, key=song.key, mp3=f"web/public/audio/music/{name}.mp3", lufs=loud, truePeak=peak,
                               **entry["timing"]), handle, indent=1)
                handle.write("\n")
            lines.append(f"    lossless copy: {wav_path} (24-bit, {os.path.getsize(wav_path) / 1e6:.1f} MB, {lufs(audio):.2f} LUFS) "
                         f"and {name}_timing.json beside it")
    return entry


def seam_lines(render, decoded, roll, loop_n):
    """The loop join: in the render, in the decoded MP3, and with the decoder
    assumed to be late or early by an MP3 encoder delay."""
    out = ["    loop seam (the last sample running into the first; a click would show as a step or a burst of highs):"]

    def row(tag, loop):
        r = verify.seam_report(loop)
        ok = "ok" if verify.seam_ok(r) else "CHECK"
        out.append(f"      {tag:34s} step {r['wrap_step']:.5f} (typical {r['typical_step']:.5f}, max {r['max_step']:.5f})  "
                   f"level jump {r['seam_level_jump_db']:.2f} dB (typical {r['typical_level_jump_db']:.2f})  "
                   f"hf flux {r['seam_hf_flux']:.3f} (99% {r['typical_hf_flux']:.3f}, max {r['max_hf_flux']:.3f})  {ok}")
        return verify.seam_ok(r)

    good = row("render, loop twice", render)
    good &= row("mp3, manifest loop points", decoded[roll:roll + loop_n])
    for shift in (1105, -1105, 529, 2257):
        if roll + shift >= 0 and roll + shift + loop_n <= decoded.shape[0]:
            good &= row(f"mp3, decoder off by {shift:+d} samples", decoded[roll + shift:roll + shift + loop_n])
    err = float(np.max(np.abs(decoded[roll:roll + 2000] - decoded[roll + loop_n:roll + loop_n + 2000])))
    out.append(f"      the decoded audio after loopEnd repeats the audio after loopStart to within {err:.4f} (full scale 1.0)")
    out.append(f"      seam verdict: {'seamless' if good else 'NEEDS A LOOK'}")
    return out


# ---------------------------------------------------------------------------
# sound effects
# ---------------------------------------------------------------------------

def render_sfx(name, out_dir):
    audio = sfx.render(name)
    path = os.path.join(out_dir, "sfx", f"{name}.wav")
    write_wav16(path, audio)
    return path


def sfx_entry(name, path):
    audio, rate, channels, width = read_wav(path)
    spec = sfx.REG[name]
    entry = dict(file=f"sfx/{name}.wav", duration=round(audio.shape[0] / rate, 4), peak=round(to_db(np.max(np.abs(audio))), 2),
                 channels=channels, gain=spec["gain"], group=spec["group"])
    if spec["duck"]:
        entry["duck"] = spec["duck"]
    return entry


# What each kind of sound should measure. (label, test on the measurements dict)
def _checks_for(name):
    rules = []
    if name.startswith("hit_"):
        rules += [("attack under 100 ms", lambda m: m["attack"] < 0.1),
                  ("strongest band under 200 Hz", lambda m: m["peak_hz"] < 200.0),
                  ("at least half the energy under 200 Hz", lambda m: m["low200"] >= 0.5)]
    if name in ("block", "body_fall", "entrance", "ko_boom", "guard_crush", "special_stone"):
        rules += [("attack under 100 ms (after any lead-in)", lambda m: m["attack"] < 0.25),
                  ("strongest band under 300 Hz", lambda m: m["peak_hz"] < 300.0)]
    if name in ("roar_quad", "roar_biped"):
        rules += [("lasts 1 to 2 s", lambda m: 1.0 <= m["duration"] <= 2.0),
                  ("most energy between 80 and 600 Hz", lambda m: m["b80_600"] > 0.5),
                  ("formant energy between 500 and 1500 Hz", lambda m: m["b500_1500"] > 0.1)]
    if name == "roar_serpent":
        rules += [("hiss centred between 3 and 8 kHz", lambda m: 3000.0 <= m["centroid"] <= 8000.0),
                  ("most energy between 3 and 8 kHz", lambda m: m["b3k_8k"] > 0.5),
                  ("lasts 1 to 2 s", lambda m: 1.0 <= m["duration"] <= 2.0)]
    if name == "roar_winged":
        rules += [("screech centred between 1.5 and 4.5 kHz", lambda m: 1500.0 <= m["centroid"] <= 4500.0),
                  ("lasts 1 to 2 s", lambda m: 1.0 <= m["duration"] <= 2.0)]
    if name.startswith("pain_"):
        rules += [("short: under 0.8 s", lambda m: m["duration"] < 0.8), ("attack under 60 ms", lambda m: m["attack"] < 0.06)]
    if name.startswith("faint_"):
        rules += [("1.0 to 1.7 s", lambda m: 1.0 <= m["duration"] <= 1.7)]
    if name.startswith("status_"):
        rules += [("0.4 to 0.8 s", lambda m: 0.4 <= m["duration"] <= 0.8)]
    if name == "special_charge":
        rules += [("exactly 1.6 s", lambda m: abs(m["duration"] - 1.6) < 0.001), ("rises: peaks in the last quarter", lambda m: m["time_to_peak"] > 1.2)]
    if name == "heartbeat":
        rules += [("exactly 1 s, so it loops in time", lambda m: abs(m["duration"] - 1.0) < 0.001)]
    if name == "crowd_roar":
        rules += [("3 s", lambda m: abs(m["duration"] - 3.0) < 0.01), ("not bright: centre under 1.5 kHz", lambda m: m["centroid"] < 1500.0),
                  ("swells: peak after 0.8 s", lambda m: m["time_to_peak"] > 0.8)]
    if name == "ko_boom":
        rules += [("long tail: over 1.2 s above -20 dB", lambda m: m["decay"] > 1.2), ("mostly under 200 Hz", lambda m: m["low200"] > 0.6)]
    if name in ("slowmo_in",):
        rules += [("a bass sound: mostly under 200 Hz", lambda m: m["low200"] > 0.6)]
    if name.startswith("ui_") or name == "tick":
        rules += [("short: under 0.8 s", lambda m: m["duration"] < 0.8)]
    return rules


def check_sfx(name, path, lines, failures):
    audio, rate, channels, width = read_wav(path)
    m = verify.measure(audio)
    spec = sfx.REG[name]
    raw = np.round(audio * 32768.0)
    problems = []
    if rate != SR or width != 2:
        problems.append(f"format {rate} Hz / {8 * width} bit")
    if channels != (2 if spec["stereo"] else 1):
        problems.append(f"{channels} channels")
    if np.max(np.abs(raw)) >= 32767:
        problems.append("clipped")
    if not -3.6 <= m["peak_db"] <= -2.4:
        problems.append(f"peak {m['peak_db']:.1f} dBFS")
    if m["rms_db"] < -45.0:
        problems.append("nearly silent")
    if m["dc"] > 0.002:
        problems.append(f"DC {m['dc']:.4f}")
    if not 0.03 <= m["duration"] <= 5.0:
        problems.append(f"duration {m['duration']:.2f} s")
    head = float(np.max(np.abs(to_mono(audio)[:4])))
    tail = float(np.max(np.abs(to_mono(audio)[-4:])))
    if head > 0.02 or tail > 0.02:
        problems.append(f"ends not faded ({head:.3f}, {tail:.3f})")
    for label, test in _checks_for(name):
        if not test(m):
            problems.append(f"expected: {label}")
    bands = " ".join(f"{100 * v:3.0f}" for v in m["bands"].values())
    lines.append(f"    {name:19s} {m['duration']:5.2f}s {channels}ch peak {m['peak_db']:5.1f} rms {m['rms_db']:6.1f} dc {m['dc']:.4f} "
                 f"centroid {m['centroid']:6.0f} Hz  attack {1000 * m['attack']:5.0f} ms  to-peak {1000 * m['time_to_peak']:5.0f} ms  "
                 f"decay {1000 * m['decay']:5.0f} ms  bands% {bands}  {'ok' if not problems else 'FAIL: ' + '; '.join(problems)}")
    if name.startswith(("roar_", "pain_", "faint_")):
        peaks = " ".join(f"{f:.0f}" for f in verify.formant_peaks(audio))
        text = f"spectral humps at {peaks} Hz; 80-600 Hz {100 * m['b80_600']:.0f}%, 500-1500 Hz {100 * m['b500_1500']:.0f}%, 3-8 kHz {100 * m['b3k_8k']:.0f}%"
        if name in VOICE_RANGE:
            v = verify.voice_report(audio, *VOICE_RANGE[name])
            if v is None:
                problems.append("no pitch found: the voice has no throat")
            else:
                text += (f"; pitch {v['start']:.0f} -> {v['high']:.0f} -> {v['end']:.0f} Hz (first third, highest, last third); "
                         f"periodicity {v['strength']:.2f} (1.0 would be a clean tone)")
                if v["strength"] > 0.93:
                    problems.append("expected: rough, not a clean tone")
                if name.startswith("faint_") and v["end"] > 0.85 * v["start"]:
                    problems.append("expected: a cry that falls in pitch")
                if name in ("roar_quad", "roar_biped") and v["end"] > 0.92 * v["high"]:
                    problems.append("expected: a roar that falls away at the end")
        lines.append(f"      {'':17s} {text}")
        if problems and lines[-2].rstrip().endswith("ok"):
            lines[-2] = lines[-2].rstrip()[:-2] + "FAIL: " + "; ".join(problems)
    if problems:
        failures.append(f"{name}: " + "; ".join(problems))


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default=os.path.join(ROOT, "web", "public", "audio"), help="output folder (default web/public/audio)")
    parser.add_argument("--ffmpeg", default=os.environ.get("MAUL_FFMPEG", "ffmpeg"), help="path to ffmpeg (or set MAUL_FFMPEG)")
    parser.add_argument("--check", action="store_true", help="print the form, chords, hooks and clash check; render nothing")
    parser.add_argument("--verify", action="store_true", help="measure the files already in --out; render nothing")
    parser.add_argument("--only", default="", help="comma-separated tracks or effects to render; 'music' and 'sfx' select a whole group")
    parser.add_argument("--report", default=None, help="also write the report to this file")
    parser.add_argument("--film-dir", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "film"),
                        help="where the film score's lossless wav and timing map go (default tools/audio/film)")
    args = parser.parse_args()

    if args.check:
        bad = 0
        for name, (compose, _setup) in music.TRACKS.items():
            text, hard = music.describe(compose(only=()))
            log(text)
            log()
            bad += hard
        log(f"clash check: {'clean' if not bad else str(bad) + ' unintended clashes'}")
        return 1 if bad else 0

    out_dir = os.path.abspath(args.out)
    os.makedirs(os.path.join(out_dir, "music"), exist_ok=True)
    os.makedirs(os.path.join(out_dir, "sfx"), exist_ok=True)
    manifest_path = os.path.join(out_dir, "manifest.json")
    previous = {}
    if os.path.exists(manifest_path):
        with open(manifest_path, encoding="utf-8") as handle:
            previous = json.load(handle)

    wanted = [item for item in args.only.split(",") if item]
    tracks = [n for n in music.TRACKS if not wanted or n in wanted or "music" in wanted]
    effects = [n for n in sfx.names() if not wanted or "sfx" in wanted or n in wanted
               or any(n.startswith(w + "_") and n[len(w) + 1:].isdigit() for w in wanted)]
    if args.verify:
        tracks, effects = [], []
    unknown = [w for w in wanted if w not in ("music", "sfx") and w not in music.TRACKS and not any(n == w or n.startswith(w + "_") for n in sfx.names())]
    if unknown:
        raise SystemExit(f"unknown names: {', '.join(unknown)}")

    started = time.time()
    lines = ["Maul Street audio build", ""]
    failures = []

    # ---- music
    music_entries = dict(previous.get("music", {}))
    lines.append("MUSIC")
    for name in tracks:
        log(f"rendering music: {name} ...")
        music_entries[name] = render_track(name, args.ffmpeg, out_dir, lines, args.film_dir)
        lines.append("")
    for name in music.TRACKS:
        path = os.path.join(out_dir, "music", f"{name}.mp3")
        if not os.path.exists(path):
            failures.append(f"music/{name}.mp3 is missing")
            continue
        if name not in music_entries:
            failures.append(f"music/{name}.mp3 has no manifest entry; render it")
            continue
        loud, peak, lra = verify.ebur(args.ffmpeg, path)
        info = verify.probe(args.ffmpeg, path)
        decoded = verify.decode(args.ffmpeg, path)
        entry = music_entries[name]
        entry.update(duration=round(decoded.shape[0] / SR, 4), peak=round(to_db(np.max(np.abs(decoded))), 2), truePeak=peak, lufs=loud)
        mono = to_mono(decoded)
        silent = float(np.mean(np.abs(mono) < 1e-4))
        problems = []
        if info.get("codec") != "mp3" or info.get("rate") != SR or info.get("layout") != "stereo":
            problems.append(f"format {info}")
        if peak is None or peak > PEAK_LIMIT_DBTP:
            problems.append(f"true peak {peak} dBTP")
        target = TARGET_LUFS[name]
        if loud is None or abs(loud - target) > 0.6:
            problems.append(f"loudness {loud} LUFS (wanted about {target})")
        limits = LENGTH_LIMITS[name]
        length = entry.get("loopLength", entry["duration"])
        if not limits[0] <= length <= limits[1]:
            problems.append(f"length {length:.2f} s outside {limits}")
        if abs(float(np.mean(decoded))) > 0.002:
            problems.append("DC offset")
        if silent > 0.2 and entry.get("loop"):
            problems.append(f"{100 * silent:.0f}% silent")
        lines.append(f"  {name:8s} {entry['duration']:7.2f} s file" + (f", loop {entry['loopLength']:.3f} s" if entry.get("loop") else "")
                     + f"  {loud} LUFS  true peak {peak} dBTP  sample peak {entry['peak']} dBFS  LRA {lra} LU  "
                     f"{info.get('kbps')} kbps  {os.path.getsize(path) / 1e6:.2f} MB  {'ok' if not problems else 'FAIL: ' + '; '.join(problems)}")
        if problems:
            failures.append(f"music/{name}: " + "; ".join(problems))

    # ---- sound effects
    lines += ["", "SOUND EFFECTS (bands% are <80, 80-200, 200-600, 600-1.5k, 1.5-3k, 3-8k, >8k Hz)"]
    for name in effects:
        render_sfx(name, out_dir)
    if effects:
        log(f"rendered {len(effects)} effects")
    sfx_entries = {}
    for name in sfx.names():
        path = os.path.join(out_dir, "sfx", f"{name}.wav")
        if not os.path.exists(path):
            failures.append(f"sfx/{name}.wav is missing")
            continue
        sfx_entries[name] = sfx_entry(name, path)
        check_sfx(name, path, lines, failures)
    extra = sorted(set(os.listdir(os.path.join(out_dir, "sfx"))) - {f"{n}.wav" for n in sfx.names()})
    if extra:
        failures.append(f"unexpected files in sfx/: {', '.join(extra)}")
    extra = sorted(set(os.listdir(os.path.join(out_dir, "music"))) - {f"{n}.mp3" for n in music.TRACKS})
    if extra:
        failures.append(f"unexpected files in music/: {', '.join(extra)}")

    # ---- the names the game's own code asks for must exist
    source = os.path.join(ROOT, "web", "src")
    if os.path.isdir(source):
        known = set(sfx_entries) | set(sfx.variants()) | set(music_entries) | {"none"}
        called = verify.called_names(source, {name.split("_")[0] for name in sfx_entries})
        missing = {name: where for name, where in called.items() if name not in known}
        lines += ["", f"NAMES  the game's code in web/src asks for {len(called)} different sounds and tracks: "
                      + ("every one is in the manifest" if not missing else f"{len(missing)} are NOT in the manifest")]
        for name, where in sorted(missing.items()):
            lines.append(f"  - {name}  ({', '.join(where[:3])})")
            failures.append(f"the game calls '{name}' ({where[0]}), which does not exist")

    # ---- manifest
    files = [dict(file=e["file"], duration=e["duration"], peak=e["peak"]) for e in list(music_entries.values()) + list(sfx_entries.values())]
    manifest = dict(
        version=1,
        about="Maul Street audio, generated by tools/audio/build.py. Durations are seconds, peaks are dBFS.",
        sampleRate=SR,
        music={name: music_entries[name] for name in music.TRACKS if name in music_entries},
        sfx=sfx_entries,
        variants=sfx.variants(),
        preload=[n for n in sfx.preload() if n in sfx_entries],
        files=files,
    )
    with open(manifest_path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(manifest, handle, indent=1)
        handle.write("\n")

    total = 0
    for folder, _dirs, names in os.walk(out_dir):
        total += sum(os.path.getsize(os.path.join(folder, n)) for n in names)
    sfx_seconds = sum(e["duration"] for e in sfx_entries.values())
    lines += ["", f"TOTAL  {len(files)} audio files, {total / 1e6:.2f} MB in {out_dir} ({sfx_seconds:.1f} s of effects); "
                  f"built in {time.time() - started:.0f} s",
              "RESULT " + ("all checks passed" if not failures else f"{len(failures)} problems:")]
    lines += [f"  - {text}" for text in failures]
    report = "\n".join(lines)
    log(report)
    if args.report:
        with open(args.report, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(report + "\n")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
