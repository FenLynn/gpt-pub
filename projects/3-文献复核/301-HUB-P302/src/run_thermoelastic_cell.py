#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path

from thermoelastic_cell import solve_two_inclusion_cell


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
    for ratio in cfg["modulus_ratio"]:
        for half_width in cfg["half_width_over_radius"]:
            result = solve_two_inclusion_cell(
                radius=1.0,
                half_width=float(half_width),
                half_height=float(cfg["half_height_over_radius"]),
                nx=int(cfg["nx"]),
                ny=int(cfg["ny"]),
                matrix_young=1.0,
                matrix_poisson=float(cfg["matrix_poisson"]),
                matrix_alpha=float(cfg["matrix_alpha"]),
                inclusion_young=float(ratio),
                inclusion_poisson=float(cfg["inclusion_poisson"]),
                inclusion_alpha=float(cfg["inclusion_alpha"]),
            )
            rows.append({
                "modulus_ratio": float(ratio),
                "half_width_over_radius": float(half_width),
                "surface_gap_change": result.surface_gap_change,
                "transfer_factor": result.transfer_factor,
            })

    with (output / "thermoelastic_cell.csv").open(
        "w", encoding="utf-8", newline=""
    ) as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    print(f"compute: ok rows={len(rows)}")


if __name__ == "__main__":
    main()
