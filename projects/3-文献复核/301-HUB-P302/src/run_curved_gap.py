#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path

import numpy as np

from curved_gap import curved_phase_space_kernel


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
    for deg in cfg["beta_max_deg"]:
        for rho in cfg["radius_optical"]:
            for delta in cfg["minimum_gap_optical"]:
                value = curved_phase_space_kernel(
                    np.deg2rad(float(deg)),
                    float(cfg["index_ratio"]),
                    float(rho),
                    float(delta),
                    n_beta=int(cfg["n_beta"]),
                    n_impact=int(cfg["n_impact"]),
                    n_phi=int(cfg["n_phi"]),
                )
                rows.append({
                    "beta_max_deg": float(deg),
                    "radius_optical": float(rho),
                    "minimum_gap_optical": float(delta),
                    "kernel": value,
                })

    with (output / "curved_gap.csv").open(
        "w", encoding="utf-8", newline=""
    ) as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    print(f"compute: ok rows={len(rows)}")


if __name__ == "__main__":
    main()
