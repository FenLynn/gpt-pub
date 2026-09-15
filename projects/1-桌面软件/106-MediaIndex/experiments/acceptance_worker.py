from __future__ import annotations

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
    if len(sys.argv) < 2:
        print(
            "Usage: MediaIndex.Acceptance.Worker.exe "
            "{image|video|summary} [arguments...]",
            file=sys.stderr,
        )
        return 2

    command = sys.argv[1].strip().lower()
    arguments = sys.argv[2:]

    if command == "image":
        return run_module(image_runner, arguments)

    if command == "video":
        return run_module(video_runner, arguments)

    if command == "summary":
        return run_module(summary_runner, arguments)

    print(
        f"Unknown command: {command}",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
