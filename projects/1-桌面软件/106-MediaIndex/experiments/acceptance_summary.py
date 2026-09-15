from __future__ import annotations

import argparse
import json
from pathlib import Path


def read_json(path: Path):
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--image",
        default="a004_results.json",
    )
    parser.add_argument(
        "--video",
        default="v011_results.json",
    )
    parser.add_argument(
        "--output",
        default="real_domain_summary.json",
    )
    args = parser.parse_args()

    image = read_json(Path(args.image))
    video = read_json(Path(args.video))

    combined = {
        "image": (
            image.get("summary")
            if image
            else None
        ),
        "video": (
            video.get("summary")
            if video
            else None
        ),
        "private_media_committed": False,
        "phase_gate": (
            "Ready for review. Do not freeze production "
            "thresholds until failures are classified."
        ),
    }

    Path(args.output).write_text(
        json.dumps(
            combined,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(
        json.dumps(
            combined,
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
