from __future__ import annotations

import sys

import round11_flicker_gate_runner_base as round11
import round12_footer_gate


def main() -> int:
    footer_result = int(round12_footer_gate.main())
    if footer_result != 0:
        return footer_result
    return int(round11.main())


if __name__ == "__main__":
    sys.exit(main())
