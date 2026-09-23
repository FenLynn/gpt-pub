from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ThresholdMetrics:
    residual_fraction: float
    residual_fraction_derivative: float
    residual_power_derivative: float
    residual_fraction_log_slope: float


def threshold_metrics(
    input_power: float,
    residual_fraction: float,
    residual_fraction_derivative: float,
) -> ThresholdMetrics:
    p = float(input_power)
    r = float(residual_fraction)
    rp = float(residual_fraction_derivative)
    if p <= 0.0:
        raise ValueError("input_power must be positive")
    if r <= 0.0:
        raise ValueError("residual_fraction must be positive")

    d_abs = r + p * rp
    log_slope = p * rp / r

    return ThresholdMetrics(
        residual_fraction=r,
        residual_fraction_derivative=rp,
        residual_power_derivative=float(d_abs),
        residual_fraction_log_slope=float(log_slope),
    )


def from_absolute_derivative(
    input_power: float,
    residual_fraction: float,
    residual_power_derivative: float,
) -> ThresholdMetrics:
    p = float(input_power)
    r = float(residual_fraction)
    d = float(residual_power_derivative)
    if p <= 0.0:
        raise ValueError("input_power must be positive")
    if r <= 0.0:
        raise ValueError("residual_fraction must be positive")
    rp = (d - r) / p
    return threshold_metrics(p, r, rp)


def from_log_slope(
    input_power: float,
    residual_fraction: float,
    residual_fraction_log_slope: float,
) -> ThresholdMetrics:
    p = float(input_power)
    r = float(residual_fraction)
    s = float(residual_fraction_log_slope)
    if p <= 0.0:
        raise ValueError("input_power must be positive")
    if r <= 0.0:
        raise ValueError("residual_fraction must be positive")
    rp = r * s / p
    return threshold_metrics(p, r, rp)
