from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from scipy.io import wavfile


SAMPLE_RATE = 44_100
DURATION = 24


def run(command: list[str]) -> None:
    subprocess.run(command, check=True)


def make_audio(path: Path, unrelated: bool = False) -> None:
    time_axis = np.arange(
        SAMPLE_RATE * DURATION,
        dtype=np.float64,
    ) / SAMPLE_RATE

    signal = np.zeros_like(time_axis)

    if unrelated:
        frequencies = [180, 310, 260, 480, 350, 610]
    else:
        frequencies = [220, 277, 330, 392, 440, 523]

    for segment, frequency in enumerate(frequencies):
        mask = (
            (time_axis >= segment * 4)
            & (time_axis < (segment + 1) * 4)
        )
        local_time = time_axis[mask] - segment * 4

        signal[mask] = (
            0.35
            * np.sin(
                2
                * np.pi
                * (
                    frequency
                    + 15
                    * np.sin(
                        2 * np.pi * 0.4 * local_time
                    )
                )
                * local_time
            )
            + 0.20
            * np.sin(
                2
                * np.pi
                * 1.5
                * frequency
                * local_time
            )
        )

    signal = np.clip(signal, -1.0, 1.0)

    wavfile.write(
        path,
        SAMPLE_RATE,
        (signal * 32767).astype(np.int16),
    )


def chromaprint(
    media_path: Path,
    fingerprint_path: Path,
) -> np.ndarray:
    run(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(media_path),
            "-map",
            "0:a:0",
            "-f",
            "chromaprint",
            "-fp_format",
            "raw",
            str(fingerprint_path),
        ]
    )
    return np.fromfile(
        fingerprint_path,
        dtype="<u4",
    )


def sliding_distance(
    query: np.ndarray,
    source: np.ndarray,
):
    best = None

    if len(query) > len(source):
        return None

    for offset in range(
        len(source) - len(query) + 1
    ):
        distances = np.bitwise_count(
            query
            ^ source[
                offset : offset + len(query)
            ]
        ).astype(np.float32)

        candidate = (
            float(distances.mean()),
            offset,
            float(np.median(distances)),
            float(np.mean(distances <= 8)),
        )

        if best is None or candidate[0] < best[0]:
            best = candidate

    return best


def scaled_distance(
    query: np.ndarray,
    source: np.ndarray,
):
    best = None

    for scale in np.arange(0.90, 1.111, 0.005):
        span = int(
            round(
                (len(query) - 1) * scale
            )
        ) + 1

        for offset in range(
            max(1, len(source) - span + 1)
        ):
            indices = (
                offset
                + np.rint(
                    np.arange(len(query)) * scale
                ).astype(int)
            )

            if indices[-1] >= len(source):
                break

            distances = np.bitwise_count(
                query ^ source[indices]
            ).astype(np.float32)

            candidate = (
                float(distances.mean()),
                float(scale),
                offset,
                float(np.median(distances)),
                float(np.mean(distances <= 8)),
            )

            if best is None or candidate[0] < best[0]:
                best = candidate

    return best


def main() -> None:
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg is required")

    with tempfile.TemporaryDirectory(prefix="p106-v010-") as temp:
        root = Path(temp)

        source_audio = root / "source.wav"
        other_audio = root / "other.wav"

        make_audio(source_audio)
        make_audio(
            other_audio,
            unrelated=True,
        )

        source_media = root / "source.m4a"
        aac48 = root / "aac48.m4a"
        clip8 = root / "clip8.m4a"
        speed105 = root / "speed105.m4a"
        unrelated = root / "unrelated.m4a"

        run(
            [
                "ffmpeg", "-y", "-loglevel", "error",
                "-i", str(source_audio),
                "-c:a", "aac", "-b:a", "128k",
                str(source_media),
            ]
        )

        run(
            [
                "ffmpeg", "-y", "-loglevel", "error",
                "-i", str(source_media),
                "-c:a", "aac", "-b:a", "48k",
                str(aac48),
            ]
        )

        run(
            [
                "ffmpeg", "-y", "-loglevel", "error",
                "-ss", "7",
                "-i", str(source_media),
                "-t", "8",
                "-c:a", "aac", "-b:a", "64k",
                str(clip8),
            ]
        )

        run(
            [
                "ffmpeg", "-y", "-loglevel", "error",
                "-i", str(source_media),
                "-filter:a", "atempo=1.05",
                "-c:a", "aac", "-b:a", "64k",
                str(speed105),
            ]
        )

        run(
            [
                "ffmpeg", "-y", "-loglevel", "error",
                "-i", str(other_audio),
                "-c:a", "aac", "-b:a", "128k",
                str(unrelated),
            ]
        )

        source_fp = chromaprint(
            source_media,
            root / "source.fp",
        )

        for name, media in (
            ("aac48", aac48),
            ("clip8", clip8),
            ("speed105", speed105),
            ("unrelated", unrelated),
        ):
            query_fp = chromaprint(
                media,
                root / f"{name}.fp",
            )

            print()
            print(name)
            print("fingerprint_length=", len(query_fp))
            print(
                "sliding=",
                sliding_distance(
                    query_fp,
                    source_fp,
                ),
            )
            print(
                "scaled=",
                scaled_distance(
                    query_fp,
                    source_fp,
                ),
            )


if __name__ == "__main__":
    main()
