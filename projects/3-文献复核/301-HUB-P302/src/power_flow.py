"""Conservative radial phase-space diffusion with an interface-transfer sink.

The normalized transverse-wavevector coordinate is u=sin(beta)/sin(beta_max).
The state f(u,zeta) is a density per transverse-k area, so total power is
proportional to integral_0^1 u*f du.  The mixing operator is the radial
Laplacian with no-flux boundaries.
"""

from __future__ import annotations

import numpy as np

from ftir import slab_rt


def angle_transfer_kernel(
    beta_rad: np.ndarray | float,
    index_ratio: float,
    optical_gap: float,
    n_impact: int = 96,
) -> np.ndarray:
    """Impact-averaged dimensionless transfer rate q(beta).

    q=(a/f)k_beta after averaging the circular-guide impact parameter.
    index_ratio is n_gap/n_high and optical_gap is n_high*w/lambda0.
    """
    beta = np.asarray(beta_rad, dtype=float)
    if np.any(beta < 0.0) or np.any(beta >= 0.5 * np.pi):
        raise ValueError("beta must satisfy 0 <= beta < pi/2")
    eta = float(index_ratio)
    xi = float(optical_gap)
    if not (0.0 < eta < 1.0):
        raise ValueError("index_ratio must satisfy 0 < index_ratio < 1")
    if xi < 0.0:
        raise ValueError("optical_gap must be non-negative")
    if n_impact < 8:
        raise ValueError("n_impact must be >= 8")

    z, w = np.polynomial.legendre.leggauss(int(n_impact))
    t = 0.25 * np.pi * (z + 1.0)
    wt = 0.25 * np.pi * w
    x = np.sin(t)

    cos_incidence = np.sin(beta)[..., None] * np.cos(t)[None, ...]
    theta = np.arccos(np.clip(cos_incidence, 0.0, 1.0))

    te, _ = slab_rt(1.0, eta, 1.0, theta, xi, "TE")
    tm, _ = slab_rt(1.0, eta, 1.0, theta, xi, "TM")
    transmission = 0.5 * (te + tm)

    integral_dx = np.sum(
        transmission * (wt * np.cos(t))[None, :],
        axis=-1,
    )
    return (2.0 / np.pi) * np.tan(beta) * integral_dx


def radial_grid(n_cells: int) -> tuple[np.ndarray, np.ndarray]:
    """Return cell centers and exact radial-area cell volumes."""
    n = int(n_cells)
    if n < 16:
        raise ValueError("n_cells must be >= 16")
    edges = np.linspace(0.0, 1.0, n + 1)
    centers = 0.5 * (edges[:-1] + edges[1:])
    volumes = 0.5 * (edges[1:] ** 2 - edges[:-1] ** 2)
    return centers, volumes


def radial_diffusion_matrix(n_cells: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Finite-volume radial Laplacian with reflecting boundaries.

    L approximates (1/u) d/du [u df/du].
    It conserves sum(V_i f_i) and has L*1=0.
    """
    u, volumes = radial_grid(n_cells)
    n = len(u)
    du = 1.0 / n
    L = np.zeros((n, n), dtype=float)

    for edge_index in range(1, n):
        edge = edge_index / n
        left = edge_index - 1
        right = edge_index
        conductance = edge / du

        L[left, left] -= conductance / volumes[left]
        L[left, right] += conductance / volumes[left]
        L[right, left] += conductance / volumes[right]
        L[right, right] -= conductance / volumes[right]

    return u, volumes, L


def transfer_profile(
    beta_max_rad: float,
    index_ratio: float,
    optical_gap: float,
    n_cells: int = 120,
    n_impact: int = 96,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return u, radial volumes, and q(u) for the interface sink."""
    beta_max = float(beta_max_rad)
    if not (0.0 < beta_max < 0.5 * np.pi):
        raise ValueError("beta_max_rad must satisfy 0 < beta_max_rad < pi/2")
    u, volumes = radial_grid(n_cells)
    beta = np.arcsin(u * np.sin(beta_max))
    q = angle_transfer_kernel(
        beta,
        index_ratio,
        optical_gap,
        n_impact=n_impact,
    )
    return u, volumes, q


def solve_power_flow(
    beta_max_rad: float,
    index_ratio: float,
    optical_gap: float,
    mixing_mu: float,
    zeta: np.ndarray,
    n_cells: int = 120,
    n_impact: int = 96,
) -> dict[str, np.ndarray]:
    """Solve dimensionless mixing-transfer evolution.

    Equation:
        df/dzeta = mu * (1/u) d/du[u df/du] - q(u) f

    zeta = f_contact*z/a.
    For a small-angle Gloge diffusion coefficient D_beta [rad^2/length],
        mu = a*D_beta / (f_contact*beta_max^2).

    Reflecting boundaries isolate mode remixing from radiative escape.
    The initial state f(u,0)=1 is uniform over the transverse-k disk.
    """
    mu = float(mixing_mu)
    if mu < 0.0:
        raise ValueError("mixing_mu must be non-negative")
    zeta_values = np.asarray(zeta, dtype=float)
    if np.any(zeta_values < 0.0):
        raise ValueError("zeta must be non-negative")

    u, volumes, L = radial_diffusion_matrix(n_cells)
    beta_max = float(beta_max_rad)
    beta = np.arcsin(u * np.sin(beta_max))
    q = angle_transfer_kernel(
        beta,
        index_ratio,
        optical_gap,
        n_impact=n_impact,
    )

    A = mu * L - np.diag(q)

    sqrt_v = np.sqrt(volumes)
    symmetric = sqrt_v[:, None] * A / sqrt_v[None, :]
    symmetric = 0.5 * (symmetric + symmetric.T)
    eigenvalues, eigenvectors = np.linalg.eigh(symmetric)

    f0 = np.ones_like(u)
    g0 = sqrt_v * f0
    coeff = eigenvectors.T @ g0

    power0 = np.sum(volumes * f0)
    power = np.empty_like(zeta_values)
    kernel = np.empty_like(zeta_values)
    variance = np.empty_like(zeta_values)

    for index, value in np.ndenumerate(zeta_values):
        g = eigenvectors @ (np.exp(eigenvalues * value) * coeff)
        f = g / sqrt_v

        total = np.sum(volumes * f)
        weights = volumes * f / total
        power[index] = total / power0
        kernel[index] = np.sum(weights * q)
        variance[index] = np.sum(weights * (q - kernel[index]) ** 2)

    return {
        "u": u,
        "volumes": volumes,
        "q": q,
        "zeta": zeta_values,
        "power": power,
        "kernel": kernel,
        "variance": variance,
        "eigenvalues": eigenvalues,
    }


def mean_transfer_kernel(
    beta_max_rad: float,
    index_ratio: float,
    optical_gap: float,
    n_cells: int = 240,
    n_impact: int = 128,
) -> float:
    """Uniform-disk phase-space mean of q(u)."""
    _, volumes, q = transfer_profile(
        beta_max_rad,
        index_ratio,
        optical_gap,
        n_cells=n_cells,
        n_impact=n_impact,
    )
    return float(np.sum(volumes * q) / np.sum(volumes))
