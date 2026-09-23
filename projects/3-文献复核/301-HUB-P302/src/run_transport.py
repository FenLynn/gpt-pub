#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path

import numpy as np

from transport import depletion_curve, dimensionless_transfer_kernel, zero_gap_kernel


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
    n = int(cfg["quadrature_points"])

    kernel_rows = []
    for deg in cfg["beta_max_deg"]:
        beta_max = np.deg2rad(float(deg))
        k0 = zero_gap_kernel(beta_max)
        for eta in cfg["index_ratio"]:
            for xi in cfg["optical_gap"]:
                value = dimensionless_transfer_kernel(
                    beta_max,
                    float(eta),
                    float(xi),
                    n_beta=n,
                    n_impact=n,
                )
                kernel_rows.append(
                    {
                        "beta_max_deg": float(deg),
                        "index_ratio": float(eta),
                        "optical_gap": float(xi),
                        "kernel": value,
                        "kernel_over_zero_gap": value / k0,
                    }
                )

    with (output / "transport_kernel.csv").open(
        "w", encoding="utf-8", newline=""
    ) as f:
        writer = csv.DictWriter(f, fieldnames=list(kernel_rows[0]))
        writer.writeheader()
        writer.writerows(kernel_rows)

    beta_max = np.deg2rad(10.0)
    zeta = np.asarray(cfg["depletion_zeta"], dtype=float)
    power, kernel, variance = depletion_curve(
        beta_max,
        0.9,
        0.1,
        zeta,
        n_beta=n,
        n_impact=n,
    )
    with (output / "depletion.csv").open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["zeta", "power", "kernel", "variance"])
        writer.writerows(zip(zeta, power, kernel, variance))

    print(f"compute: ok rows={len(kernel_rows) + len(zeta)}")


if __name__ == "__main__":
    main()
