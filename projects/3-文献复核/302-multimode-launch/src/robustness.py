from __future__ import annotations

import math

import numpy as np
from scipy.optimize import brentq
from scipy.sparse import bmat, csr_matrix, diags
from scipy.sparse.linalg import expm_multiply

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

    lo = f(0.0)
    hi = f(1.0)
    if lo == 0.0:
        return 0.0
    if hi == 0.0:
        return 1.0
    if lo * hi > 0.0:
        return None
    return float(brentq(f, 0.0, 1.0, xtol=1e-9, rtol=1e-8))


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
