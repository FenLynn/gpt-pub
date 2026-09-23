#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path

import numpy as np

from power_flow import solve_power_flow


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
    beta_max = np.deg2rad(float(cfg["beta_max_deg"]))
    zeta = np.asarray(cfg["zeta"], dtype=float)

    rows = []
    for mu in cfg["mixing_mu"]:
        result = solve_power_flow(
            beta_max,
            float(cfg["index_ratio"]),
            float(cfg["optical_gap"]),
            float(mu),
            zeta,
            n_cells=int(cfg["n_cells"]),
            n_impact=int(cfg["n_impact"]),
        )
        for i, value in enumerate(zeta):
            rows.append(
                {
                    "mixing_mu": float(mu),
                    "zeta": float(value),
                    "power": float(result["power"][i]),
                    "kernel": float(result["kernel"][i]),
                }
            )

    with (output / "power_flow.csv").open(
        "w", encoding="utf-8", newline=""
    ) as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    print(f"compute: ok rows={len(rows)}")


if __name__ == "__main__":
    main()
