#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path

from asymmetric_coupling import asymmetric_coupled_power_fractions


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
    for k1 in cfg["coupling_forward"]:
        for k2 in cfg["coupling_reverse"]:
            for a in cfg["absorption"]:
                state = asymmetric_coupled_power_fractions(
                    k1, k2, a, cfg["length"]
                )
                rows.append(
                    {
                        "coupling_forward": k1,
                        "coupling_reverse": k2,
                        "absorption": a,
                        "length": cfg["length"],
                        "pump_fraction": state.pump_fraction,
                        "active_fraction": state.active_fraction,
                        "absorbed_fraction": state.absorbed_fraction,
                    }
                )

    with (output / "asymmetric_coupling.csv").open(
        "w", encoding="utf-8", newline=""
    ) as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    print(f"compute: ok rows={len(rows)}")


if __name__ == "__main__":
    main()
