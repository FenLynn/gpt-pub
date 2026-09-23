from __future__ import annotations

import math

import numpy as np
from scipy.optimize import brentq
from scipy.sparse import bmat, csr_matrix, diags
from scipy.sparse.linalg import expm_multiply

try:
    from .phase_space import (
        collision_shape,
        core_overlap,
        impact_pdf,
        mean_collision_shape,
    )
except ImportError:
    from phase_space import (
        collision_shape,
        core_overlap,
        impact_pdf,
        mean_collision_shape,
    )


def occupied_phase_space_fraction(spatial_fill: float, angular_fill: float) -> float:
    if not (0.0 < spatial_fill <= 1.0):
        raise ValueError("spatial_fill must lie in (0, 1]")
    if not (0.0 <= angular_fill <= 1.0):
        raise ValueError("angular_fill must lie in [0, 1]")
    return spatial_fill**2 * angular_fill**2


def calibrated_absorption_profile(
    x: np.ndarray,
    core_ratio: float,
    uniform_fraction: float,
) -> np.ndarray:
    if not (0.0 < core_ratio <= 1.0):
        raise ValueError("core_ratio must lie in (0, 1]")
    if not (0.0 <= uniform_fraction <= 1.0):
        raise ValueError("uniform_fraction must lie in [0, 1]")

    h = np.asarray(core_overlap(x, core_ratio), dtype=float)
    return uniform_fraction + (1.0 - uniform_fraction) * h / (core_ratio**2)


def dimensionless_residual(
    fill: float,
    coupling_depth: float,
    absorption_depth: float,
    core_ratio: float,
    mixing_depth: float,
    uniform_absorption_fraction: float,
    bins: int = 120,
) -> float:
    if not (0.0 < fill <= 1.0):
        raise ValueError("fill must lie in (0, 1]")
    if coupling_depth < 0.0 or absorption_depth < 0.0 or mixing_depth < 0.0:
        raise ValueError("depth parameters must be non-negative")
    if bins < 24:
        raise ValueError("bins must be >= 24")

    dx = 1.0 / bins
    x = (np.arange(bins, dtype=float) + 0.5) * dx

    equilibrium = np.asarray(impact_pdf(x, 1.0), dtype=float) * dx
    equilibrium /= equilibrium.sum()

    initial = np.asarray(impact_pdf(x, fill), dtype=float) * dx
    initial /= initial.sum()

    q_shape = np.asarray(collision_shape(x), dtype=float)
    q_shape /= mean_collision_shape(1.0)
    q = coupling_depth * q_shape

    a_shape = calibrated_absorption_profile(
        x,
        core_ratio,
        uniform_absorption_fraction,
    )
    a = absorption_depth * a_shape

    qd = diags(q, format="csr")
    ad = diags(a, format="csr")
    eye = diags(np.ones(bins), format="csr")

    if mixing_depth == 0.0:
        mix = csr_matrix((bins, bins))
    else:
        mix = mixing_depth * (
            csr_matrix(np.outer(equilibrium, np.ones(bins))) - eye
        )

    block = bmat(
        [[mix - qd, qd], [qd, mix - qd - ad]],
        format="csr",
    )

    y0 = np.concatenate([initial, np.zeros(bins)])
    y1 = expm_multiply(block, y0)
    return float(y1[:bins].sum())


def launch_difference(
    test_fill: float,
    reference_fill: float,
    coupling_depth: float,
    absorption_depth: float,
    core_ratio: float,
    mixing_depth: float,
    uniform_absorption_fraction: float,
    bins: int = 120,
) -> float:
    return dimensionless_residual(
        test_fill,
        coupling_depth,
        absorption_depth,
        core_ratio,
        mixing_depth,
        uniform_absorption_fraction,
        bins=bins,
    ) - dimensionless_residual(
        reference_fill,
        coupling_depth,
        absorption_depth,
        core_ratio,
        mixing_depth,
        uniform_absorption_fraction,
        bins=bins,
    )


def selectivity_boundary(
    test_fill: float,
    reference_fill: float,
    coupling_depth: float,
    absorption_depth: float,
    core_ratio: float,
    mixing_depth: float,
    bins: int = 120,
) -> float | None:
    def f(value: float) -> float:
        return launch_difference(
            test_fill,
            reference_fill,
            coupling_depth,
            absorption_depth,
            core_ratio,
            mixing_depth,
            value,
            bins=bins,
        )

    left = 0.0
    right = 1.0
    f_left = f(left)
    f_right = f(right)
    if f_left == 0.0:
        return left
    if f_right == 0.0:
        return right
    if f_left * f_right > 0.0:
        return None

    for _ in range(40):
        mid = 0.5 * (left + right)
        f_mid = f(mid)
        if abs(f_mid) < 1e-10 or right - left < 1e-8:
            return float(mid)
        if f_left * f_mid <= 0.0:
            right = mid
            f_right = f_mid
        else:
            left = mid
            f_left = f_mid
    return float(0.5 * (left + right))


def small_signal_cladding_absorption(
    core_ratio: float,
    absorption_cross_section: float,
    dopant_density: float,
) -> float:
    if not (0.0 < core_ratio <= 1.0):
        raise ValueError("core_ratio must lie in (0, 1]")
    if absorption_cross_section < 0.0 or dopant_density < 0.0:
        raise ValueError("material parameters must be non-negative")
    return core_ratio**2 * absorption_cross_section * dopant_density


def nonabsorbing_passive_residual(
    fill: float,
    mean_coupling: float,
    length: float,
    bins: int = 400,
) -> float:
    if not (0.0 < fill <= 1.0):
        raise ValueError("fill must lie in (0, 1]")
    if mean_coupling < 0.0 or length < 0.0:
        raise ValueError("mean_coupling and length must be non-negative")
    if bins < 32:
        raise ValueError("bins must be >= 32")
    if length == 0.0:
        return 1.0

    dx = 1.0 / bins
    x = (np.arange(bins, dtype=float) + 0.5) * dx
    weight = np.asarray(impact_pdf(x, fill), dtype=float) * dx
    weight /= weight.sum()
    q = mean_coupling * np.asarray(collision_shape(x), dtype=float) / mean_collision_shape(1.0)
    return float(np.sum(weight * 0.5 * (1.0 + np.exp(-2.0 * q * length))))


def nonabsorbing_apparent_coupling(
    fill: float,
    mean_coupling: float,
    length: float,
    bins: int = 400,
) -> float:
    if length <= 0.0:
        raise ValueError("length must be positive")
    residual = nonabsorbing_passive_residual(
        fill,
        mean_coupling,
        length,
        bins=bins,
    )
    exchange = 2.0 * residual - 1.0
    if not (0.0 < exchange <= 1.0):
        raise ValueError("invalid residual for symmetric nonabsorbing inversion")
    return float(-math.log(exchange) / (2.0 * length))
