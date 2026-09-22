#!/usr/bin/env python3
"""Run the public planar-FTIR sensitivity benchmark."""

from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

from ftir import (
    critical_angle_rad,
    logarithmic_sensitivity,
    logistic_normalized,
    logistic_target_sensitivity,
    slab_rt,
)


def load_config(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def angle_grid(n_high: float, n_gap: float, max_deg: float, points: int) -> np.ndarray:
    theta_c = critical_angle_rad(n_high, n_gap)
    theta_max = np.deg2rad(max_deg)
    if theta_c >= theta_max:
        raise ValueError("critical angle is above requested maximum angle")
    return np.linspace(theta_c + 1e-8, theta_max, points)


def nominal_scan(cfg: dict) -> list[dict]:
    nh = float(cfg["n_high"])
    lam = float(cfg["wavelength_um"])
    wc = float(cfg["gap_center_um"])
    s = float(cfg["gap_half_width_um"])
    total = 2.0 * s

    rows: list[dict] = []
    for ng in cfg["n_gap_values"]:
        theta = angle_grid(nh, float(ng), cfg["theta_max_deg"], cfg["theta_points"])
        for pol in ("TE", "TM"):
            tm, _ = slab_rt(nh, ng, lam, theta, wc - s, pol)
            tc, _ = slab_rt(nh, ng, lam, theta, wc, pol)
            tp, _ = slab_rt(nh, ng, lam, theta, wc + s, pol)
            sensitivity = logarithmic_sensitivity(tm, tp, total)

            for cutoff in cfg["transmission_cutoffs"]:
                mask = tc >= float(cutoff)
                if not np.any(mask):
                    continue
                eligible = np.flatnonzero(mask)
                i = eligible[np.argmax(sensitivity[mask])]
                rows.append(
                    {
                        "n_high": nh,
                        "n_gap": float(ng),
                        "polarization": pol,
                        "T_mid_cutoff": float(cutoff),
                        "max_log_sensitivity_per_um": float(sensitivity[i]),
                        "angle_deg": float(np.rad2deg(theta[i])),
                        "T_mid": float(tc[i]),
                        "T_plus_over_T_minus": float(tp[i] / tm[i]),
                    }
                )
    return rows


def broad_stress_scan(cfg: dict) -> dict:
    b = cfg["broad_scan"]
    lam = float(cfg["wavelength_um"])
    wc = float(cfg["gap_center_um"])
    s = float(cfg["gap_half_width_um"])
    total = 2.0 * s

    best = {
        "max_log_sensitivity_per_um": -np.inf,
        "n_high": None,
        "n_gap": None,
        "polarization": None,
        "angle_deg": None,
        "T_minus": None,
        "T_mid": None,
        "T_plus": None,
        "T_plus_over_T_minus": None,
    }

    for nh in np.linspace(b["n_high_min"], b["n_high_max"], b["n_high_points"]):
        gap_max = nh - float(b["n_gap_offset_max"])
        for ng in np.linspace(b["n_gap_min"], gap_max, b["n_gap_points"]):
            theta = angle_grid(float(nh), float(ng), cfg["theta_max_deg"], b["theta_points"])
            for pol in ("TE", "TM"):
                tm, _ = slab_rt(nh, ng, lam, theta, wc - s, pol)
                tc, _ = slab_rt(nh, ng, lam, theta, wc, pol)
                tp, _ = slab_rt(nh, ng, lam, theta, wc + s, pol)
                sensitivity = logarithmic_sensitivity(tm, tp, total)
                i = int(np.argmax(sensitivity))
                if sensitivity[i] > best["max_log_sensitivity_per_um"]:
                    best = {
                        "max_log_sensitivity_per_um": float(sensitivity[i]),
                        "n_high": float(nh),
                        "n_gap": float(ng),
                        "polarization": pol,
                        "angle_deg": float(np.rad2deg(theta[i])),
                        "T_minus": float(tm[i]),
                        "T_mid": float(tc[i]),
                        "T_plus": float(tp[i]),
                        "T_plus_over_T_minus": float(tp[i] / tm[i]),
                    }

    target = logistic_target_sensitivity(s)
    best["target_log_sensitivity_per_um"] = target
    best["target_to_broad_max_factor"] = target / best["max_log_sensitivity_per_um"]
    return best


def write_csv(rows: list[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def make_plots(cfg: dict, rows: list[dict], output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    target = logistic_target_sensitivity(cfg["gap_half_width_um"])

    selected = [r for r in rows if np.isclose(r["T_mid_cutoff"], 0.1)]
    fig, ax = plt.subplots(figsize=(7.2, 4.4))
    for pol in ("TE", "TM"):
        pr = [r for r in selected if r["polarization"] == pol]
        ax.plot(
            [r["n_gap"] for r in pr],
            [r["max_log_sensitivity_per_um"] for r in pr],
            marker="o",
            label=f"exact FTIR, {pol}, T(center)>=0.1",
        )
    ax.axhline(target, linestyle="--", label=f"3.2 nm target = {target:.1f} /um")
    ax.set_xlabel("gap refractive index")
    ax.set_ylabel("max average |Delta ln T| / Delta w (1/um)")
    ax.set_title("Planar FTIR sensitivity versus nanometre-scale target")
    ax.legend()
    ax.grid(True, alpha=0.25)
    fig.tight_layout()
    fig.savefig(output / "max_sensitivity.svg")
    plt.close(fig)

    nh = float(cfg["n_high"])
    ng = 1.38
    lam = float(cfg["wavelength_um"])
    wc = float(cfg["gap_center_um"])
    scale = float(cfg["gap_half_width_um"])
    theta = np.deg2rad(80.0)
    gaps = np.linspace(wc - 0.02, wc + 0.02, 801)

    fig, ax = plt.subplots(figsize=(7.2, 4.4))
    for pol in ("TE", "TM"):
        t, _ = slab_rt(nh, ng, lam, theta, gaps, pol)
        t0, _ = slab_rt(nh, ng, lam, theta, wc, pol)
        ax.plot((gaps - wc) * 1000.0, t / t0, label=f"FTIR {pol}, n_gap=1.38, 80 deg")

    logistic = logistic_normalized(gaps, wc, scale)
    logistic0 = logistic_normalized(wc, wc, scale)
    ax.plot((gaps - wc) * 1000.0, logistic / logistic0, linestyle="--", label="reference logistic / center")
    ax.set_xlabel("gap offset from center (nm)")
    ax.set_ylabel("normalized response")
    ax.set_title("Local gap response: exact FTIR versus reference logistic")
    ax.set_ylim(0.0, 2.1)
    ax.legend()
    ax.grid(True, alpha=0.25)
    fig.tight_layout()
    fig.savefig(output / "ftir_vs_logistic.svg")
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()

    output_root = os.environ.get("OUTPUT_ROOT")
    if not output_root:
        raise SystemExit("OUTPUT_ROOT must be set explicitly")
    output = Path(output_root)
    output.mkdir(parents=True, exist_ok=True)

    cfg = load_config(args.config)
    rows = nominal_scan(cfg)
    broad = broad_stress_scan(cfg)

    write_csv(rows, output / "nominal_scan.csv")
    (output / "broad_stress.json").write_text(
        json.dumps(broad, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )

    target = logistic_target_sensitivity(cfg["gap_half_width_um"])
    nominal_max = max(r["max_log_sensitivity_per_um"] for r in rows)
    informative = max(
        r["max_log_sensitivity_per_um"]
        for r in rows
        if np.isclose(r["T_mid_cutoff"], 0.1)
    )
    summary = {
        "target_log_sensitivity_per_um": target,
        "nominal_scan_max_log_sensitivity_per_um": nominal_max,
        "nominal_scan_max_with_T_mid_ge_0p1_per_um": informative,
        "target_to_nominal_max_factor": target / nominal_max,
        "target_to_informative_max_factor": target / informative,
        "broad_stress": broad,
    }
    (output / "summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    make_plots(cfg, rows, output)

    print(json.dumps(summary, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
