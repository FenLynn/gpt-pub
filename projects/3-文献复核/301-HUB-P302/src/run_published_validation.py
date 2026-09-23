#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path

from published_validation import fit_ambient_threshold_line, residual_secant_audit


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
    ambient = cfg["ambient_temperature_c"]
    threshold = cfg["threshold_power_kw"]

    fit = fit_ambient_threshold_line(ambient, threshold)
    predicted = [
        fit.slope * float(t) + fit.intercept
        for t in ambient
    ]

    with (output / "ambient_threshold_points.csv").open(
        "w", encoding="utf-8", newline=""
    ) as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "ambient_temperature_c",
                "threshold_power_kw",
                "predicted_threshold_power_kw",
                "residual_kw",
            ],
        )
        writer.writeheader()
        for t, p, phat in zip(ambient, threshold, predicted):
            writer.writerow(
                {
                    "ambient_temperature_c": t,
                    "threshold_power_kw": p,
                    "predicted_threshold_power_kw": phat,
                    "residual_kw": float(p) - phat,
                }
            )

    with (output / "ambient_threshold_fit.csv").open(
        "w", encoding="utf-8", newline=""
    ) as f:
        writer = csv.DictWriter(
            f,
            fieldnames=list(fit.__dataclass_fields__),
        )
        writer.writeheader()
        writer.writerow(
            {name: getattr(fit, name) for name in fit.__dataclass_fields__}
        )

    precursor = cfg.get("precursor_2023")
    if precursor:
        audit = residual_secant_audit(
            input_power_1=precursor["input_power_kw"][0],
            input_power_2=precursor["input_power_kw"][1],
            residual_ratio_1=precursor["residual_ratio"][0],
            residual_ratio_2=precursor["residual_ratio"][1],
        )
        with (output / "precursor_residual_secant.csv").open(
            "w", encoding="utf-8", newline=""
        ) as f:
            writer = csv.DictWriter(
                f,
                fieldnames=list(audit.__dataclass_fields__),
            )
            writer.writeheader()
            writer.writerow(
                {
                    name: getattr(audit, name)
                    for name in audit.__dataclass_fields__
                }
            )

    print("compute: ok published validation")


if __name__ == "__main__":
    main()
