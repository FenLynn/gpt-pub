"""Phase-space transport utilities for a circular multimode guide.

The module provides normalized ray-collision rates, boundary incidence angles,
a local dielectric transmission average, and selective-depletion evolution.
Lengths are not hard-coded; the main optical kernel is dimensionless.
"""

from __future__ import annotations

import numpy as np

from ftir import slab_rt


def _check_beta_max(beta_max_rad: float) -> float:
    beta_max = float(beta_max_rad)
    if not (0.0 < beta_max < 0.5 * np.pi):
        raise ValueError("beta_max_rad must satisfy 0 < beta_max_rad < pi/2")
    return beta_max


def mean_tan_beta(beta_max_rad: float) -> float:
    """Mean tan(beta) for a uniformly filled transverse-k disk.

    The normalized angular density is
        p(beta) = 2 sin(beta) cos(beta) / sin(beta_max)^2.
    """
    beta_max = _check_beta_max(beta_max_rad)
    s = np.sin(beta_max)
    return float((beta_max - s * np.cos(beta_max)) / (s * s))


def zero_gap_kernel(beta_max_rad: float) -> float:
    """Return K0 = (a/f) k for unit transmission at every contact encounter."""
    return float((2.0 / np.pi) * mean_tan_beta(beta_max_rad))


def _quadrature(beta_max_rad: float, n_beta: int, n_impact: int):
    beta_max = _check_beta_max(beta_max_rad)
    if n_beta < 8 or n_impact < 8:
        raise ValueError("quadrature orders must be >= 8")

    zb, wb = np.polynomial.legendre.leggauss(int(n_beta))
    zx, wx = np.polynomial.legendre.leggauss(int(n_impact))

    beta = 0.5 * (zb + 1.0) * beta_max
    wb = 0.5 * beta_max * wb
    x = 0.5 * (zx + 1.0)
    wx = 0.5 * wx
    return beta, wb, x, wx


def _average_transmission(
    beta: np.ndarray,
    impact: np.ndarray,
    index_ratio: float,
    optical_gap: float,
) -> np.ndarray:
    eta = float(index_ratio)
    xi = float(optical_gap)
    if not (0.0 < eta < 1.0):
        raise ValueError("index_ratio must satisfy 0 < index_ratio < 1")
    if xi < 0.0:
        raise ValueError("optical_gap must be non-negative")

    radial_direction = np.sqrt(1.0 - impact[None, :] ** 2)
    cos_incidence = np.sin(beta)[:, None] * radial_direction
    theta = np.arccos(np.clip(cos_incidence, 0.0, 1.0))

    te, _ = slab_rt(1.0, eta, 1.0, theta, xi, "TE")
    tm, _ = slab_rt(1.0, eta, 1.0, theta, xi, "TM")
    return 0.5 * (te + tm)


def dimensionless_transfer_kernel(
    beta_max_rad: float,
    index_ratio: float,
    optical_gap: float,
    n_beta: int = 64,
    n_impact: int = 64,
) -> float:
    """Return K = (a/f) k for a phase-mixed circular guide.

    beta is the ray angle from the guide axis.
    impact is the normalized line impact parameter b/a in [0, 1].
    index_ratio is n_gap/n_high.
    optical_gap is n_high*w/lambda0 after setting n_high=lambda0=1.

    The boundary event model uses a transmission probability T per encounter.
    """
    beta, wb, impact, wx = _quadrature(beta_max_rad, n_beta, n_impact)
    tavg = _average_transmission(beta, impact, index_ratio, optical_gap)

    beta_max = float(beta_max_rad)
    p_beta = (
        2.0
        * np.sin(beta)
        * np.cos(beta)
        / (np.sin(beta_max) ** 2)
    )
    impact_average = tavg @ wx
    integral = np.sum(wb * p_beta * np.tan(beta) * impact_average)
    return float((2.0 / np.pi) * integral)


def channel_quadrature(
    beta_max_rad: float,
    index_ratio: float,
    optical_gap: float,
    n_beta: int = 64,
    n_impact: int = 64,
) -> tuple[np.ndarray, np.ndarray]:
    """Return normalized channel weights and q=(a/f)k_channel."""
    beta_max = _check_beta_max(beta_max_rad)
    if n_beta < 8 or n_impact < 8:
        raise ValueError("quadrature orders must be >= 8")

    zb, wb = np.polynomial.legendre.leggauss(int(n_beta))
    zt, wt = np.polynomial.legendre.leggauss(int(n_impact))

    beta = 0.5 * (zb + 1.0) * beta_max
    wb = 0.5 * beta_max * wb
    impact_angle = 0.25 * np.pi * (zt + 1.0)
    wt = 0.25 * np.pi * wt
    impact = np.sin(impact_angle)

    tavg = _average_transmission(beta, impact, index_ratio, optical_gap)

    p_beta = (
        2.0
        * np.sin(beta)
        * np.cos(beta)
        / (np.sin(beta_max) ** 2)
    )
    p_impact_angle = 4.0 * np.cos(impact_angle) ** 2 / np.pi

    weights = (
        (wb * p_beta)[:, None]
        * (wt * p_impact_angle)[None, :]
    )
    weights = weights / np.sum(weights)

    q = (
        np.tan(beta)[:, None]
        * tavg
        / (2.0 * np.cos(impact_angle)[None, :])
    )
    return weights, q


def depletion_curve(
    beta_max_rad: float,
    index_ratio: float,
    optical_gap: float,
    zeta: np.ndarray,
    n_beta: int = 64,
    n_impact: int = 64,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return normalized power, effective kernel, and channel-rate variance.

    zeta = z*f/a is the dimensionless propagation coordinate.
    For independent channels with q=(a/f)k_channel:
        P(zeta) = <exp(-q*zeta)>
        K_eff   = -d ln(P)/d zeta
        dK_eff/dzeta = -Var(q)
    """
    zeta_values = np.asarray(zeta, dtype=float)
    if np.any(zeta_values < 0.0):
        raise ValueError("zeta must be non-negative")

    weights, q = channel_quadrature(
        beta_max_rad,
        index_ratio,
        optical_gap,
        n_beta=n_beta,
        n_impact=n_impact,
    )

    power = np.empty_like(zeta_values)
    kernel = np.empty_like(zeta_values)
    variance = np.empty_like(zeta_values)

    for i, value in np.ndenumerate(zeta_values):
        survival = np.exp(-q * value)
        weighted = weights * survival
        norm = np.sum(weighted)
        mean_q = np.sum(weighted * q) / norm
        power[i] = norm
        kernel[i] = mean_q
        variance[i] = np.sum(weighted * (q - mean_q) ** 2) / norm

    return power, kernel, variance
