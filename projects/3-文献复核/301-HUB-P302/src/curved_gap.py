"""Curved near-contact optical transfer between equal circular guides.

All geometry is dimensionless with n_high=lambda0=1:
  rho = n_high * radius / lambda0
  delta = n_high * minimum_surface_separation / lambda0

The facing surfaces of two equal circles have local gap
  h(phi) = delta + 2*rho*(1-cos(phi))
for azimuth phi around the contact point.  Negative h is clamped to zero as a
minimal non-penetration model.  The resulting transfer is averaged over wall
azimuth, impact parameter, and a uniformly filled transverse-k disk.
"""

from __future__ import annotations

import numpy as np

from ftir import slab_rt


def local_curved_gap(
    phi_rad: np.ndarray | float,
    radius_optical: float,
    minimum_gap_optical: float,
) -> np.ndarray:
    rho = float(radius_optical)
    if rho <= 0.0:
        raise ValueError("radius_optical must be positive")
    phi = np.asarray(phi_rad, dtype=float)
    raw = float(minimum_gap_optical) + 2.0 * rho * (1.0 - np.cos(phi))
    return np.maximum(raw, 0.0)


def arc_transfer_average(
    theta_rad: np.ndarray | float,
    index_ratio: float,
    radius_optical: float,
    minimum_gap_optical: float,
    n_phi: int = 128,
) -> np.ndarray:
    """Average TE/TM transfer probability over the full wall circumference."""
    if n_phi < 16:
        raise ValueError("n_phi must be >= 16")
    eta = float(index_ratio)
    if not (0.0 < eta < 1.0):
        raise ValueError("index_ratio must satisfy 0 < index_ratio < 1")

    z, w = np.polynomial.legendre.leggauss(int(n_phi))
    phi = 0.5 * np.pi * z
    weights = 0.5 * np.pi * w
    gap = local_curved_gap(phi, radius_optical, minimum_gap_optical)

    theta_values = np.asarray(theta_rad, dtype=float)
    critical = np.arcsin(eta)
    if np.any(theta_values <= critical):
        raise ValueError(
            "curved-gap kernel currently requires total internal reflection "
            "for all supplied incidence angles"
        )

    # In the TIR regime transmission decays exponentially with gap.  Very
    # large curved gaps can overflow a raw characteristic-matrix evaluation,
    # so discard tails once the smallest evanescent exponent exceeds 40.
    decay_min = 2.0 * np.pi * np.sqrt(
        np.min(np.sin(theta_values) ** 2 - eta**2)
    )
    max_gap = 40.0 / decay_min
    active = gap <= max_gap
    safe_gap = np.minimum(gap, max_gap)

    theta = theta_values[..., None]
    gap_b = safe_gap.reshape((1,) * theta_values.ndim + (gap.size,))
    te, _ = slab_rt(1.0, eta, 1.0, theta, gap_b, "TE")
    tm, _ = slab_rt(1.0, eta, 1.0, theta, gap_b, "TM")
    transmission = 0.5 * (te + tm)
    transmission = transmission * active.reshape(
        (1,) * theta_values.ndim + (gap.size,)
    )

    # Integral over facing half-circumference, divided by total 2*pi wall arc.
    return np.sum(transmission * weights, axis=-1) / (2.0 * np.pi)


def curved_phase_space_kernel(
    beta_max_rad: float,
    index_ratio: float,
    radius_optical: float,
    minimum_gap_optical: float,
    n_beta: int = 48,
    n_impact: int = 48,
    n_phi: int = 96,
) -> float:
    """Return K=a*k for phase-mixed equal circular guides.

    Unlike the flat-window model, no separate contact fraction is supplied.
    The optical window emerges from the curved gap geometry itself.
    """
    beta_max = float(beta_max_rad)
    if not (0.0 < beta_max < 0.5 * np.pi):
        raise ValueError("beta_max_rad must satisfy 0 < beta_max_rad < pi/2")
    if n_beta < 8 or n_impact < 8:
        raise ValueError("quadrature orders must be >= 8")

    zb, wb = np.polynomial.legendre.leggauss(int(n_beta))
    zi, wi = np.polynomial.legendre.leggauss(int(n_impact))

    beta = 0.5 * (zb + 1.0) * beta_max
    wb = 0.5 * beta_max * wb
    impact = 0.5 * (zi + 1.0)
    wi = 0.5 * wi

    p_beta = (
        2.0 * np.sin(beta) * np.cos(beta)
        / (np.sin(beta_max) ** 2)
    )

    radial_direction = np.sqrt(1.0 - impact[None, :] ** 2)
    cos_incidence = np.sin(beta)[:, None] * radial_direction
    theta = np.arccos(np.clip(cos_incidence, 0.0, 1.0))

    arc_average = arc_transfer_average(
        theta,
        index_ratio,
        radius_optical,
        minimum_gap_optical,
        n_phi=n_phi,
    )

    # p_x(x)=4/pi*sqrt(1-x^2) cancels the collision-rate denominator.
    integral = np.sum(
        (wb * p_beta * np.tan(beta))[:, None]
        * wi[None, :]
        * arc_average
    )
    return float((2.0 / np.pi) * integral)


def thermal_mismatch_gap_scale(
    radius_um: float,
    alpha_matrix_per_k: float,
    alpha_inclusion_per_k: float,
    delta_temperature_k: float,
    transfer_factor: float = 1.0,
) -> float:
    """Affine free-mismatch estimate for two equal inclusions.

    Returns the surface-gap change in micrometres:
      Delta g = 2*a*C*(alpha_matrix-alpha_inclusion)*DeltaT.
    C=1 is the affine far-field limit; C is kept explicit so mechanics can later
    replace it without changing the optical layer.
    """
    a = float(radius_um)
    c = float(transfer_factor)
    if a <= 0.0 or c < 0.0:
        raise ValueError("radius must be positive and transfer_factor non-negative")
    return (
        2.0
        * a
        * c
        * (float(alpha_matrix_per_k) - float(alpha_inclusion_per_k))
        * float(delta_temperature_k)
    )
