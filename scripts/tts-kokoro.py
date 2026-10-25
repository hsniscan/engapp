#!/usr/bin/env python3
"""Kokoro-82M synthesis worker for the pre-generated pronunciation audio (docs/decisions/0042).

Driven by scripts/tts-pregen.ts, which owns the text list, the cache keys and the uploads;
this process only turns text into MP3 files. Protocol: one JSON object per line on stdin
  {"id": "<file stem>", "text": "...", "voice": "en-US" | "en-GB"}
and one JSON object per line on stdout
  {"id": ..., "ok": true, "path": "<out>/<id>.mp3", "bytes": n, "seconds": s}
  {"id": ..., "ok": false, "error": "..."}
The first line written is {"ready": true, ...} once the model is loaded.

Engine: Kokoro-82M (Apache-2.0) through kokoro-onnx (MIT) on CPU, with misaki (Apache-2.0)
for grapheme-to-phoneme (the G2P Kokoro was trained with); espeak-ng is misaki's fallback for
words outside its dictionary. Output: MP3, 48 kbps CBR, mono, 24 kHz (lameenc).

Usage: python scripts/tts-kokoro.py --model kokoro-v1.0.onnx --voices voices-v1.0.bin --out DIR
       python scripts/tts-kokoro.py ... --say "text" --voice en-GB   (one clip, for a quick try)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

# Kokoro voice and misaki dialect per app voice. Change here and bump TTS_CACHE_VERSION in
# supabase/functions/_shared/tts-contract.ts (the key names the audio, not the engine).
VOICES = {
    "en-US": {"voice": "af_heart", "british": False, "lang": "en-us"},
    "en-GB": {"voice": "bf_emma", "british": True, "lang": "en-gb"},
}
SAMPLE_RATE = 24_000
BITRATE_KBPS = 48
# A little slower than normal speech, like the device voice (rate 0.92): this is for learners.
SPEED = 0.92
HEAD_PAD_S = 0.05  # some mobile players clip the first few milliseconds
TAIL_PAD_S = 0.15


def load_engine(model: str, voices: str):
    import espeakng_loader
    from kokoro_onnx import Kokoro
    from phonemizer.backend.espeak.wrapper import EspeakWrapper

    # misaki's espeak fallback finds no library on Linux by itself; use the bundled one.
    EspeakWrapper.set_library(espeakng_loader.get_library_path())
    EspeakWrapper.set_data_path(espeakng_loader.get_data_path())
    from misaki import en, espeak

    kokoro = Kokoro(model, voices)
    g2p = {}
    for app_voice, v in VOICES.items():
        g2p[app_voice] = en.G2P(
            trf=False, british=v["british"], fallback=espeak.EspeakFallback(british=v["british"])
        )
    return kokoro, g2p


def encode_mp3(samples) -> bytes:
    import lameenc
    import numpy as np

    pcm = np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0)
    pad_head = np.zeros(int(SAMPLE_RATE * HEAD_PAD_S), dtype=np.float32)
    pad_tail = np.zeros(int(SAMPLE_RATE * TAIL_PAD_S), dtype=np.float32)
    pcm = np.concatenate([pad_head, pcm, pad_tail])
    enc = lameenc.Encoder()
    enc.set_bit_rate(BITRATE_KBPS)
    enc.set_in_sample_rate(SAMPLE_RATE)
    enc.set_channels(1)
    enc.set_quality(2)  # 2 = high quality, slower (it is a batch job)
    data = (pcm * 32767.0).astype("<i2").tobytes()
    return bytes(enc.encode(data) + enc.flush())


def synthesize(kokoro, g2p, text: str, voice: str) -> tuple[bytes, float]:
    v = VOICES[voice]
    phonemes, _ = g2p[voice](text)
    if not phonemes.strip():
        raise ValueError("no phonemes")
    samples, rate = kokoro.create(
        phonemes, voice=v["voice"], speed=SPEED, lang=v["lang"], is_phonemes=True
    )
    if rate != SAMPLE_RATE:
        raise ValueError(f"unexpected sample rate {rate}")
    if len(samples) < SAMPLE_RATE * 0.1:
        raise ValueError("audio too short")
    return encode_mp3(samples), len(samples) / SAMPLE_RATE


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--voices", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--say")
    ap.add_argument("--voice", default="en-US", choices=sorted(VOICES))
    ap.add_argument("--name", default="sample")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    kokoro, g2p = load_engine(args.model, args.voices)

    if args.say is not None:
        mp3, secs = synthesize(kokoro, g2p, args.say, args.voice)
        path = os.path.join(args.out, f"{args.name}.mp3")
        with open(path, "wb") as f:
            f.write(mp3)
        print(json.dumps({"path": path, "bytes": len(mp3), "seconds": round(secs, 2)}))
        return 0

    def emit(obj: dict) -> None:
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()

    emit({"ready": True, "voices": {k: v["voice"] for k, v in VOICES.items()}})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        job_id = None
        try:
            job = json.loads(line)
            job_id = str(job["id"])
            if not job_id.replace("-", "").isalnum():
                raise ValueError("bad id")
            voice = job["voice"]
            if voice not in VOICES:
                raise ValueError("unknown voice")
            t0 = time.monotonic()
            mp3, secs = synthesize(kokoro, g2p, str(job["text"]), voice)
            path = os.path.join(args.out, f"{job_id}.mp3")
            with open(path, "wb") as f:
                f.write(mp3)
            emit({
                "id": job_id, "ok": True, "path": path, "bytes": len(mp3),
                "seconds": round(secs, 3), "elapsed": round(time.monotonic() - t0, 3),
            })
        except Exception as e:  # one bad text must not stop the run
            emit({"id": job_id, "ok": False, "error": f"{type(e).__name__}: {e}"[:300]})
    return 0


if __name__ == "__main__":
    sys.exit(main())
