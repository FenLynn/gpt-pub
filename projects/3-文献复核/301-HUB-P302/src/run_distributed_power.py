#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path

import numpy as np

from distributed_power import scan_observable_amplification


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
    lo, hi, count = cfg["coupling_length_log10"]
    q_values = np.logspace(float(lo), float(hi), int(count))
    a_values = np.asarray(cfg["absorption_length"], dtype=float)

    rows = []
    for floor in cfg["residual_floors"]:
        gain, state = scan_observable_amplification(
            a_values, q_values, float(floor)
        )
        rows.append({
            "minimum_residual": float(floor),
            "maximum_log_gain": gain,
            "absorption_length": state[0],
            "coupling_length": state[1],
            "residual": state[2],
        })

    with (output / "distributed_power.csv").open(
        "w", encoding="utf-8", newline=""
    ) as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    print(f"compute: ok rows={len(rows)}")


if __name__ == "__main__":
    main()
