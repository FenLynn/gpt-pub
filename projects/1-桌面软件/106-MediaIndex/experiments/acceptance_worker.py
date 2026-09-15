from __future__ import annotations

import argparse
import sys

import a004_real_image_acceptance_runner as image_runner
import acceptance_summary as summary_runner
import v011_real_video_acceptance_runner as video_runner


def run_module(module, argv: list[str]) -> int:
    original = sys.argv[:]
    try:
        sys.argv = [original[0], *argv]
        module.main()
        return 0
    except SystemExit as exc:
        code = exc.code
        if code is None:
            return 0
        if isinstance(code, int):
            return code
        print(code, file=sys.stderr)
        return 1
    finally:
        sys.argv = original


def main() -> int:
    parser = argparse.ArgumentParser(
        description="MediaIndex Acceptance worker"
    )
    subparsers = parser.add_subparsers(
        dest="command",
        required=True,
    )

    image_parser = subparsers.add_parser("image")
    image_parser.add_argument(
        "args",
        nargs=argparse.REMAINDER,
    )

    video_parser = subparsers.add_parser("video")
    video_parser.add_argument(
        "args",
        nargs=argparse.REMAINDER,
    )

    summary_parser = subparsers.add_parser("summary")
    summary_parser.add_argument(
        "args",
        nargs=argparse.REMAINDER,
    )

    parsed = parser.parse_args()

    if parsed.command == "image":
        return run_module(
            image_runner,
            parsed.args,
        )

    if parsed.command == "video":
        return run_module(
            video_runner,
            parsed.args,
        )

    if parsed.command == "summary":
        return run_module(
            summary_runner,
            parsed.args,
        )

    return 2


if __name__ == "__main__":
    raise SystemExit(main())
