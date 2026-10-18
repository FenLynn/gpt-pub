#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path

from phenomenological_map import (
    ambient_derivative,
    first_turning_point,
    high_temperature_derivative_limit,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()

    output_root = os.environ.get("OUTPUT_ROOT")
    if not output_root:
        raise SystemExit("OUTPUT_ROOT must be set explicitly")
    output = Path(output_root)
    output.mkdir(parents=True, exist_ok=True)

    cfg = json.loads(args.config.read_text(encoding="utf-8"))
    rows = []
    for a in cfg["absorption"]:
        for hi in cfg["coupling_high"]:
            for lo in cfg["coupling_low"]:
                if lo > hi:
                    continue
                for x0 in cfg["ambient_offset"]:
                    d0 = ambient_derivative(a, hi, lo, x0)
                    dinf = high_temperature_derivative_limit(a, lo)
                    for threshold in cfg["derivative_threshold"]:
                        tp = first_turning_point(
                            absorption=a,
                            coupling_high=hi,
                            coupling_low=lo,
                            ambient_offset=x0,
                            derivative_threshold=threshold,
                            x_max=cfg["x_max"],
                            scan_points=cfg["scan_points"],
                        )
                        rows.append(
                            {
                                "absorption": a,
                                "coupling_high": hi,
                                "coupling_low": lo,
                                "ambient_offset": x0,
                                "derivative_threshold": threshold,
                                "ambient_derivative": d0,
                                "high_temperature_limit": dinf,
                                "has_turning_point": int(tp is not None),
                                "at_ambient_boundary": (
                                    int(tp.at_ambient_boundary)
                                    if tp is not None
                                    else 0
                                ),
                                "turning_x": (
                                    tp.x if tp is not None else ""
                                ),
                                "turning_input_scale": (
                                    tp.input_scale if tp is not None else ""
                                ),
                            }
                        )

    with (output / "phenomenological_phase_map.csv").open(
        "w", encoding="utf-8", newline=""
    ) as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    print(f"compute: ok rows={len(rows)}")


if __name__ == "__main__":
    main()
