from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class ThermalGainReconstruction:
    inferred_temperature: np.ndarray
    inferred_absorbed_fraction: np.ndarray
    thermal_gain: np.ndarray


def _prepare_monotone_reference(
    temperatures: np.ndarray,
    residual_fraction: np.ndarray,
    absorbed_fraction: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    T = np.asarray(temperatures, dtype=float)
    R = np.asarray(residual_fraction, dtype=float)
    A = np.asarray(absorbed_fraction, dtype=float)

    if T.ndim != 1 or R.ndim != 1 or A.ndim != 1:
        raise ValueError("reference arrays must be one-dimensional")
    if not (len(T) == len(R) == len(A)) or len(T) < 3:
        raise ValueError("reference arrays must have equal length >= 3")
    if np.any(~np.isfinite(T)) or np.any(~np.isfinite(R)) or np.any(~np.isfinite(A)):
        raise ValueError("reference arrays must be finite")
    if np.any(np.diff(T) <= 0.0):
        raise ValueError("temperatures must be strictly increasing")
    if np.any(A <= 0.0):
        raise ValueError("absorbed fractions must be positive")

    dR = np.diff(R)
    if np.all(dR > 0.0):
        return T, R, A
    if np.all(dR < 0.0):
        return T[::-1], R[::-1], A[::-1]
    raise ValueError("residual reference must be strictly monotone")


def reconstruct_thermal_gain(
    reference_temperatures: np.ndarray,
    reference_residual_fraction: np.ndarray,
    reference_absorbed_fraction: np.ndarray,
    ambient_temperature: float,
    input_power: np.ndarray,
    observed_residual_fraction: np.ndarray,
) -> ThermalGainReconstruction:
    Tref, Rref, Aref = _prepare_monotone_reference(
        reference_temperatures,
        reference_residual_fraction,
        reference_absorbed_fraction,
    )
    P = np.asarray(input_power, dtype=float)
    Robs = np.asarray(observed_residual_fraction, dtype=float)

    if P.ndim != 1 or Robs.ndim != 1 or len(P) != len(Robs):
        raise ValueError("observed arrays must be one-dimensional and equal length")
    if len(P) == 0:
        raise ValueError("at least one observed point is required")
    if np.any(P <= 0.0):
        raise ValueError("input powers must be positive")
    if np.any(~np.isfinite(P)) or np.any(~np.isfinite(Robs)):
        raise ValueError("observed arrays must be finite")

    rmin = float(Rref[0])
    rmax = float(Rref[-1])
    if np.any(Robs < rmin) or np.any(Robs > rmax):
        raise ValueError("observed residual fraction lies outside reference range")

    inferred_T = np.interp(Robs, Rref, Tref)
    inferred_A = np.interp(inferred_T, Tref, Aref)
    rise = inferred_T - float(ambient_temperature)
    if np.any(rise < 0.0):
        raise ValueError("inferred temperature lies below ambient")
    gain = rise / (P * inferred_A)

    return ThermalGainReconstruction(
        inferred_temperature=inferred_T,
        inferred_absorbed_fraction=inferred_A,
        thermal_gain=gain,
    )
