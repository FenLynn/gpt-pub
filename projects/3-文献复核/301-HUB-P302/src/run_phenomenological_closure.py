#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path

from phenomenological_closure import (
    drive_from_temperature,
    midpoint_metrics,
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
    common = {
        "ambient_temperature": float(cfg["ambient_temperature"]),
        "thermal_gain": float(cfg["thermal_gain"]),
        "absorption": float(cfg["absorption"]),
        "length": float(cfg["length"]),
        "coupling_high": float(cfg["coupling_high"]),
        "coupling_low": float(cfg["coupling_low"]),
        "coupling_midpoint_temperature": float(
            cfg["coupling_midpoint_temperature"]
        ),
        "coupling_temperature_width": float(
            cfg["coupling_temperature_width"]
        ),
    }

    rows = []
    for x in cfg["normalized_temperature"]:
        T = (
            common["coupling_midpoint_temperature"]
            + common["coupling_temperature_width"] * float(x)
        )
        if T < common["ambient_temperature"]:
            continue
        P, state, k = drive_from_temperature(temperature=T, **common)
        rows.append(
            {
                "normalized_temperature": float(x),
                "temperature": T,
                "input_power": P,
                "coupling": k,
                "pump_fraction": state.pump_fraction,
                "active_fraction": state.active_fraction,
                "absorbed_fraction": state.absorbed_fraction,
            }
        )

    with (output / "phenomenological_curve.csv").open(
        "w", encoding="utf-8", newline=""
    ) as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    midpoint = midpoint_metrics(**common)
    midpoint_row = {
        "input_power": midpoint.input_power,
        "coupling": midpoint.coupling,
        "residual_fraction": midpoint.residual_fraction,
        "absorbed_fraction": midpoint.absorbed_fraction,
        "loop_gain": midpoint.loop_gain,
        "log_slope": midpoint.log_slope,
        "residual_elasticity": midpoint.residual_elasticity,
        "absorption_elasticity": midpoint.absorption_elasticity,
        "constitutive_sharpness": midpoint.constitutive_sharpness,
    }
    with (output / "phenomenological_midpoint.csv").open(
        "w", encoding="utf-8", newline=""
    ) as f:
        writer = csv.DictWriter(f, fieldnames=list(midpoint_row))
        writer.writeheader()
        writer.writerow(midpoint_row)

    print(f"compute: ok rows={len(rows)}")


if __name__ == "__main__":
    main()
