"""Exact two-guide coupled-power propagation with absorption.

Dimensionless variables:
  q = k*L
  a = alpha*L

The normalized coupled-power equations are
  dp1/ds = -q*p1 + q*p2
  dp2/ds =  q*p1 - (q+a)*p2
for s in [0,1], with p1(0)=1, p2(0)=0.
"""

from __future__ import annotations

import numpy as np


def output_state(coupling_length: float, absorption_length: float) -> np.ndarray:
    q = float(coupling_length)
    a = float(absorption_length)
    if q < 0.0 or a < 0.0:
        raise ValueError("dimensionless rates must be non-negative")
    matrix = np.array([[-q, q], [q, -q - a]], dtype=float)
    eigenvalues, eigenvectors = np.linalg.eigh(matrix)
    propagator = (
        eigenvectors
        @ np.diag(np.exp(eigenvalues))
        @ eigenvectors.T
    )
    return propagator @ np.array([1.0, 0.0])


def residual_power(coupling_length: float, absorption_length: float) -> float:
    return float(np.sum(output_state(coupling_length, absorption_length)))


def log_sensitivity_to_coupling(
    coupling_length: float,
    absorption_length: float,
    step: float = 1e-5,
) -> float:
    q = float(coupling_length)
    if q <= 0.0:
        return 0.0
    if step <= 0.0:
        raise ValueError("step must be positive")
    minus = residual_power(q * np.exp(-step), absorption_length)
    plus = residual_power(q * np.exp(step), absorption_length)
    return float(abs(np.log(plus / minus)) / (2.0 * step))


def scan_observable_amplification(
    absorption_values: np.ndarray,
    coupling_values: np.ndarray,
    minimum_residual: float,
) -> tuple[float, tuple[float, float, float]]:
    """Maximum |d ln P_res / d ln k| above a residual-power floor."""
    rmin = float(minimum_residual)
    if not (0.0 < rmin <= 1.0):
        raise ValueError("minimum_residual must lie in (0,1]")

    best = -np.inf
    state = (np.nan, np.nan, np.nan)
    for a in np.asarray(absorption_values, dtype=float):
        for q in np.asarray(coupling_values, dtype=float):
            residual = residual_power(q, a)
            if residual < rmin:
                continue
            gain = log_sensitivity_to_coupling(q, a)
            if gain > best:
                best = gain
                state = (float(a), float(q), float(residual))
    if not np.isfinite(best):
        raise ValueError("no scan point satisfies the residual-power floor")
    return float(best), state
