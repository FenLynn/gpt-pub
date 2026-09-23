#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path

import numpy as np

from phenomenological_identifiability import log_sensitivity_audit


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
    powers = np.asarray(cfg["input_powers"], dtype=float)

    rows = []
    for a in cfg["absorption"]:
        for hi in cfg["coupling_high"]:
            for lo in cfg["coupling_low"]:
                if lo >= hi:
                    continue
                for x0 in cfg["ambient_offset"]:
                    for q in cfg["power_scale"]:
                        audit = log_sensitivity_audit(
                            input_powers=powers,
                            absorption=a,
                            coupling_high=hi,
                            coupling_low=lo,
                            ambient_offset=x0,
                            power_scale=q,
                            x_max=cfg["x_max"],
                        )
                        row = {
                            "absorption": a,
                            "coupling_high": hi,
                            "coupling_low": lo,
                            "ambient_offset": x0,
                            "power_scale": q,
                            "condition_number": audit.condition_number,
                        }
                        for i, value in enumerate(audit.singular_values):
                            row[f"singular_value_{i + 1}"] = float(value)
                        rows.append(row)

    with (output / "phenomenological_identifiability.csv").open(
        "w", encoding="utf-8", newline=""
    ) as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    print(f"compute: ok rows={len(rows)}")


if __name__ == "__main__":
    main()
