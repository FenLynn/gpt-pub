#!/usr/bin/env python3
"""Run exact planar-FTIR and repeated-encounter sensitivity benchmarks."""

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
    repeated_encounter_rate_factor_from_reflectance,
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


def metric_values(
    transmission: np.ndarray,
    reflectance: np.ndarray,
    metric: str,
) -> np.ndarray:
    if metric == "transmission":
        return transmission
    if metric == "encounter_rate_factor":
        return repeated_encounter_rate_factor_from_reflectance(reflectance)
    raise ValueError(f"unknown metric: {metric}")


def nominal_scan(cfg: dict, metric: str) -> list[dict]:
    nh = float(cfg["n_high"])
    lam = float(cfg["wavelength_um"])
    wc = float(cfg["gap_center_um"])
    s = float(cfg["gap_half_width_um"])
    total = 2.0 * s

    rows: list[dict] = []
    for ng in cfg["n_gap_values"]:
        theta = angle_grid(nh, float(ng), cfg["theta_max_deg"], cfg["theta_points"])
        for pol in ("TE", "TM"):
            tm, rm = slab_rt(nh, ng, lam, theta, wc - s, pol)
            tc, rc = slab_rt(nh, ng, lam, theta, wc, pol)
            tp, rp = slab_rt(nh, ng, lam, theta, wc + s, pol)

            vm = metric_values(tm, rm, metric)
            vc = metric_values(tc, rc, metric)
            vp = metric_values(tp, rp, metric)
            sensitivity = logarithmic_sensitivity(vm, vp, total)

            for cutoff in cfg["transmission_cutoffs"]:
                mask = (tc >= float(cutoff)) & np.isfinite(sensitivity)
                if not np.any(mask):
                    continue
                eligible = np.flatnonzero(mask)
                i = eligible[np.argmax(sensitivity[mask])]
                rows.append(
                    {
                        "metric": metric,
                        "n_high": nh,
                        "n_gap": float(ng),
                        "polarization": pol,
                        "T_mid_cutoff": float(cutoff),
                        "max_log_sensitivity_per_um": float(sensitivity[i]),
                        "angle_deg": float(np.rad2deg(theta[i])),
                        "T_mid": float(tc[i]),
                        "R_mid": float(rc[i]),
                        "value_mid": float(vc[i]),
                        "value_plus_over_value_minus": float(vp[i] / vm[i]),
                    }
                )
    return rows


def broad_stress_scan(cfg: dict, metric: str) -> dict:
    b = cfg["broad_scan"]
    lam = float(cfg["wavelength_um"])
    wc = float(cfg["gap_center_um"])
    s = float(cfg["gap_half_width_um"])
    total = 2.0 * s

    best = {"max_log_sensitivity_per_um": -np.inf}

    for nh in np.linspace(b["n_high_min"], b["n_high_max"], b["n_high_points"]):
        gap_max = nh - float(b["n_gap_offset_max"])
        for ng in np.linspace(b["n_gap_min"], gap_max, b["n_gap_points"]):
            theta = angle_grid(float(nh), float(ng), cfg["theta_max_deg"], b["theta_points"])
            for pol in ("TE", "TM"):
                tm, rm = slab_rt(nh, ng, lam, theta, wc - s, pol)
                tc, rc = slab_rt(nh, ng, lam, theta, wc, pol)
                tp, rp = slab_rt(nh, ng, lam, theta, wc + s, pol)
                vm = metric_values(tm, rm, metric)
                vc = metric_values(tc, rc, metric)
                vp = metric_values(tp, rp, metric)
                sensitivity = logarithmic_sensitivity(vm, vp, total)
                finite = np.isfinite(sensitivity)
                if not np.any(finite):
                    continue
                eligible = np.flatnonzero(finite)
                i = eligible[np.argmax(sensitivity[finite])]
                if sensitivity[i] > best["max_log_sensitivity_per_um"]:
                    best = {
                        "metric": metric,
                        "max_log_sensitivity_per_um": float(sensitivity[i]),
                        "n_high": float(nh),
                        "n_gap": float(ng),
                        "polarization": pol,
                        "angle_deg": float(np.rad2deg(theta[i])),
                        "T_minus": float(tm[i]),
                        "T_mid": float(tc[i]),
                        "T_plus": float(tp[i]),
                        "R_mid": float(rc[i]),
                        "value_minus": float(vm[i]),
                        "value_mid": float(vc[i]),
                        "value_plus": float(vp[i]),
                        "value_plus_over_value_minus": float(vp[i] / vm[i]),
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


def metric_summary(cfg: dict, rows: list[dict], broad: dict) -> dict:
    target = logistic_target_sensitivity(cfg["gap_half_width_um"])
    nominal_max = max(r["max_log_sensitivity_per_um"] for r in rows)
    informative = max(
        r["max_log_sensitivity_per_um"]
        for r in rows
        if np.isclose(r["T_mid_cutoff"], 0.1)
    )
    return {
        "target_log_sensitivity_per_um": target,
        "nominal_scan_max_log_sensitivity_per_um": nominal_max,
        "nominal_scan_max_with_T_mid_ge_0p1_per_um": informative,
        "target_to_nominal_max_factor": target / nominal_max,
        "target_to_informative_max_factor": target / informative,
        "broad_stress": broad,
    }


def make_plots(
    cfg: dict,
    transmission_rows: list[dict],
    rate_rows: list[dict],
    output: Path,
) -> None:
    output.mkdir(parents=True, exist_ok=True)
    target = logistic_target_sensitivity(cfg["gap_half_width_um"])

    fig, ax = plt.subplots(figsize=(7.2, 4.4))
    for rows, label_prefix, marker in (
        (transmission_rows, "T", "o"),
        (rate_rows, "-ln(R)", "s"),
    ):
        selected = [r for r in rows if np.isclose(r["T_mid_cutoff"], 0.1)]
        for pol in ("TE", "TM"):
            pr = [r for r in selected if r["polarization"] == pol]
            ax.plot(
                [r["n_gap"] for r in pr],
                [r["max_log_sensitivity_per_um"] for r in pr],
                marker=marker,
                label=f"{label_prefix}, {pol}, T(center)>=0.1",
            )
    ax.axhline(target, linestyle="--", label=f"3.2 nm target = {target:.1f} /um")
    ax.set_xlabel("gap refractive index")
    ax.set_ylabel("max average logarithmic sensitivity (1/um)")
    ax.set_title("Planar FTIR local and repeated-encounter rate sensitivity")
    ax.legend(fontsize=8)
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
    ax.plot(
        (gaps - wc) * 1000.0,
        logistic / logistic0,
        linestyle="--",
        label="reference logistic / center",
    )
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

    t_rows = nominal_scan(cfg, "transmission")
    g_rows = nominal_scan(cfg, "encounter_rate_factor")
    t_broad = broad_stress_scan(cfg, "transmission")
    g_broad = broad_stress_scan(cfg, "encounter_rate_factor")

    write_csv(t_rows, output / "nominal_transmission_scan.csv")
    write_csv(g_rows, output / "nominal_encounter_rate_scan.csv")

    summary = {
        "transmission": metric_summary(cfg, t_rows, t_broad),
        "encounter_rate_factor": metric_summary(cfg, g_rows, g_broad),
    }
    (output / "summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    make_plots(cfg, t_rows, g_rows, output)

    print(json.dumps(summary, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
