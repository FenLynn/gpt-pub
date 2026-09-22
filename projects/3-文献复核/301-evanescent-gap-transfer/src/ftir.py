"""Exact planar dielectric-gap transmission for a symmetric high/low/high stack.

All lengths use micrometres. Angles are measured from the interface normal.
The implementation uses the standard 2x2 characteristic matrix for the
tangential electromagnetic fields and supports both TE and TM polarization.
"""

from __future__ import annotations

import numpy as np


def _positive_branch_cosine(value: np.ndarray | complex) -> np.ndarray:
    """Return sqrt(value) on the branch with non-negative imaginary part."""
    c = np.lib.scimath.sqrt(value)
    c = np.asarray(c, dtype=complex)
    return np.where(np.imag(c) < 0.0, -c, c)


def slab_rt(
    n_high: float,
    n_gap: float,
    wavelength_um: float,
    theta_rad: np.ndarray | float,
    gap_um: np.ndarray | float,
    polarization: str,
) -> tuple[np.ndarray, np.ndarray]:
    """Power transmittance and reflectance of high/gap/high dielectric stack."""
    gap = np.asarray(gap_um, dtype=float)
    if n_high <= 0 or n_gap <= 0 or wavelength_um <= 0 or np.any(gap < 0):
        raise ValueError("indices/wavelength must be positive and gap non-negative")

    pol = polarization.upper()
    if pol not in {"TE", "TM"}:
        raise ValueError("polarization must be TE or TM")

    theta = np.asarray(theta_rad, dtype=float)
    if np.any(theta < 0) or np.any(theta >= 0.5 * np.pi):
        raise ValueError("theta must satisfy 0 <= theta < pi/2")

    sin0 = np.sin(theta)
    cos0 = np.cos(theta).astype(complex)
    sin_gap = (n_high / n_gap) * sin0
    cos_gap = _positive_branch_cosine(1.0 - sin_gap**2)
    cos_exit = cos0

    if pol == "TE":
        q0 = n_high * cos0
        q1 = n_gap * cos_gap
        q2 = n_high * cos_exit
    else:
        q0 = n_high / cos0
        q1 = n_gap / cos_gap
        q2 = n_high / cos_exit

    delta = 2.0 * np.pi * n_gap * cos_gap * gap / wavelength_um
    c = np.cos(delta)
    s = np.sin(delta)

    m11 = c
    m12 = 1j * s / q1
    m21 = 1j * q1 * s
    m22 = c

    denominator = q0 * m11 + q0 * q2 * m12 + m21 + q2 * m22
    t = 2.0 * q0 / denominator
    r = (q0 * m11 + q0 * q2 * m12 - m21 - q2 * m22) / denominator

    T = (np.real(q2) / np.real(q0)) * np.abs(t) ** 2
    R = np.abs(r) ** 2
    return np.real_if_close(T).astype(float), np.real_if_close(R).astype(float)


def critical_angle_rad(n_high: float, n_gap: float) -> float:
    if not (0 < n_gap < n_high):
        raise ValueError("TIR requires 0 < n_gap < n_high")
    return float(np.arcsin(n_gap / n_high))


def repeated_encounter_rate_factor_from_reflectance(
    reflectance: np.ndarray | float,
) -> np.ndarray:
    """Dimensionless exact leakage-rate factor for repeated identical encounters.

    If each encounter leaves a fraction R in the original guide and encounters
    occur at rate nu_hit per unit axial length, then

        P(z) = P(0) * R**(nu_hit*z)
             = P(0) * exp[-nu_hit * (-ln R) * z],

    hence k_ray = nu_hit * g with g = -ln(R).

    This is exact for a repeated identical ray encounter. The weak-transfer
    approximation g ~= T follows from R = 1-T and -ln(1-T) ~= T.
    """
    r = np.asarray(reflectance, dtype=float)
    if np.any(r <= 0.0) or np.any(r > 1.0 + 1e-12):
        raise ValueError("reflectance must satisfy 0 < R <= 1")
    r = np.minimum(r, 1.0)
    return -np.log(r)


def logistic_normalized(gap_um: np.ndarray | float, center_um: float, scale_um: float):
    """Normalized logistic coupling used as the comparison target."""
    w = np.asarray(gap_um, dtype=float)
    return 1.0 / (1.0 + np.exp((w - center_um) / scale_um))


def logarithmic_sensitivity(
    value_minus: np.ndarray,
    value_plus: np.ndarray,
    total_gap_change_um: float,
) -> np.ndarray:
    """Average |Delta ln(value)| / Delta w across a finite gap interval."""
    if total_gap_change_um <= 0:
        raise ValueError("total_gap_change_um must be positive")
    if np.any(value_minus <= 0) or np.any(value_plus <= 0):
        raise ValueError("values must be positive")
    return np.abs(np.log(value_plus / value_minus)) / total_gap_change_um


def logistic_target_sensitivity(scale_um: float) -> float:
    """Sensitivity from center-scale to center+scale of a logistic curve."""
    if scale_um <= 0:
        raise ValueError("scale_um must be positive")
    return 1.0 / (2.0 * scale_um)
