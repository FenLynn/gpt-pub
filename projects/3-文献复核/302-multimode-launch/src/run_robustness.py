from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path

from robustness import (
    dimensionless_residual,
    launch_difference,
    occupied_phase_space_fraction,
    selectivity_boundary,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    args = parser.parse_args()

    with open(args.config, "r", encoding="utf-8") as fh:
        cfg = json.load(fh)

    output_root = Path(os.environ.get("OUTPUT_ROOT", "output"))
    output_root.mkdir(parents=True, exist_ok=True)

    coupling_depth = float(cfg["coupling_depth"])
    absorption_depth = float(cfg["absorption_depth"])
    core_ratio = float(cfg["core_ratio"])
    reference_fill = float(cfg["reference_fill"])
    test_fill = float(cfg["test_fill"])
    bins = int(cfg.get("bins", 96))

    rows = []
    for mixing_depth in [float(v) for v in cfg["mixing_depths"]]:
        boundary = selectivity_boundary(
            test_fill,
            reference_fill,
            coupling_depth,
            absorption_depth,
            core_ratio,
            mixing_depth,
            bins=bins,
        )
        for uniform_fraction in [float(v) for v in cfg["uniform_absorption_fractions"]]:
            r_ref = dimensionless_residual(
                reference_fill,
                coupling_depth,
                absorption_depth,
                core_ratio,
                mixing_depth,
                uniform_fraction,
                bins=bins,
            )
            r_test = dimensionless_residual(
                test_fill,
                coupling_depth,
                absorption_depth,
                core_ratio,
                mixing_depth,
                uniform_fraction,
                bins=bins,
            )
            rows.append(
                {
                    "mixing_depth": mixing_depth,
                    "uniform_absorption_fraction": uniform_fraction,
                    "reference_residual": r_ref,
                    "test_residual": r_test,
                    "difference": r_test - r_ref,
                    "selectivity_boundary": boundary,
                }
            )

    with open(output_root / "robustness.csv", "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    phase = occupied_phase_space_fraction(
        float(cfg["spatial_fill"]),
        float(cfg["angular_fill"]),
    )
    with open(output_root / "phase_space_fraction.txt", "w", encoding="utf-8") as fh:
        fh.write(f"{phase:.12g}\n")


if __name__ == "__main__":
    main()
