from __future__ import annotations

from dataclasses import dataclass
import numpy as np


@dataclass(frozen=True)
class AmbientThresholdFit:
    slope: float
    intercept: float
    effective_gain: float
    turning_temperature: float
    rmse: float
    max_abs_residual: float
    relative_rmse: float
    condition_gain_mean: float
    condition_gain_cv: float
    condition_gain_span_fraction: float


def fit_ambient_threshold_line(
    ambient_temperature,
    threshold_power,
) -> AmbientThresholdFit:
    ta = np.asarray(ambient_temperature, dtype=float)
    p = np.asarray(threshold_power, dtype=float)

    if ta.ndim != 1 or p.ndim != 1 or ta.shape != p.shape:
        raise ValueError("ambient_temperature and threshold_power must be equal 1D arrays")
    if len(ta) < 2:
        raise ValueError("at least two points are required")
    if not (np.all(np.isfinite(ta)) and np.all(np.isfinite(p))):
        raise ValueError("all values must be finite")
    if np.any(p <= 0.0):
        raise ValueError("threshold powers must be positive")
    if np.ptp(ta) <= 0.0:
        raise ValueError("ambient temperatures must not all be equal")

    x = np.column_stack([ta, np.ones_like(ta)])
    slope, intercept = np.linalg.lstsq(x, p, rcond=None)[0]
    if slope >= 0.0:
        raise ValueError("expected threshold power to decrease with ambient temperature")

    predicted = slope * ta + intercept
    residual = p - predicted
    rmse = float(np.sqrt(np.mean(residual**2)))
    relative_rmse = float(rmse / np.mean(p))

    effective_gain = float(-1.0 / slope)
    turning_temperature = float(-intercept / slope)

    if turning_temperature <= np.max(ta):
        raise ValueError("fitted turning temperature must exceed all ambient temperatures")

    condition_gain = (turning_temperature - ta) / p
    gain_mean = float(np.mean(condition_gain))
    gain_cv = float(np.std(condition_gain) / gain_mean)
    gain_span_fraction = float(
        (np.max(condition_gain) - np.min(condition_gain)) / gain_mean
    )

    return AmbientThresholdFit(
        slope=float(slope),
        intercept=float(intercept),
        effective_gain=effective_gain,
        turning_temperature=turning_temperature,
        rmse=rmse,
        max_abs_residual=float(np.max(np.abs(residual))),
        relative_rmse=relative_rmse,
        condition_gain_mean=gain_mean,
        condition_gain_cv=gain_cv,
        condition_gain_span_fraction=gain_span_fraction,
    )


def predict_threshold_power(
    ambient_temperature,
    turning_temperature: float,
    effective_gain: float,
):
    ta = np.asarray(ambient_temperature, dtype=float)
    tstar = float(turning_temperature)
    gain = float(effective_gain)
    if gain <= 0.0:
        raise ValueError("effective_gain must be positive")
    if np.any(ta >= tstar):
        raise ValueError("ambient temperature must remain below turning temperature")
    return (tstar - ta) / gain
