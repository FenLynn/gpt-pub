#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path

import numpy as np

from closed_loop import build_curved_optical_table, irreversible_ramp


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
    temperatures = np.linspace(
        0.0, float(cfg["temperature_max"]), int(cfg["temperature_points"])
    )
    beta = np.deg2rad(float(cfg["beta_max_deg"]))

    common = dict(
        temperature=temperatures,
        beta_max_rad=beta,
        index_ratio=float(cfg["index_ratio"]),
        radius_optical=float(cfg["radius_optical"]),
        gap0_optical=float(cfg["gap0_optical"]),
        gap_per_temperature=float(cfg["gap_per_temperature"]),
        coupling_scale=float(cfg["coupling_scale"]),
        n_beta=int(cfg["n_beta"]),
        n_impact=int(cfg["n_impact"]),
        n_phi=int(cfg["n_phi"]),
    )

    undamaged = build_curved_optical_table(**common)
    damaged = build_curved_optical_table(
        **common,
        extra_gap_optical=float(cfg["damage_extra_gap_optical"]),
    )

    pumps = np.linspace(0.0, float(cfg["pump_max"]), int(cfg["pump_points"]))
    rows = []
    for preload in cfg["preload_opening"]:
        result = irreversible_ramp(
            pumps,
            thermal_gain=float(cfg["thermal_gain"]),
            absorption_length=float(cfg["absorption_length"]),
            undamaged=undamaged,
            damaged=damaged,
            opening_per_temperature=float(cfg["opening_per_temperature"]),
            preload_opening=float(preload),
            critical_free_opening=float(cfg["critical_free_opening"]),
        )
        for i, pump in enumerate(pumps):
            rows.append({
                "preload_opening": float(preload),
                "pump_drive": float(pump),
                "temperature": float(result["temperature"][i]),
                "residual": float(result["residual"][i]),
                "coupling_length": float(result["coupling_length"][i]),
                "damaged": int(result["damaged"][i]),
            })

    with (output / "closed_loop.csv").open(
        "w", encoding="utf-8", newline=""
    ) as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    print(f"compute: ok rows={len(rows)}")


if __name__ == "__main__":
    main()
