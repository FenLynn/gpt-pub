from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from scipy.integrate import quad
from scipy.optimize import brentq
from scipy.special import ellipe, ellipk
from scipy.sparse import bmat, csr_matrix, diags


def uniformization_action(
    matrix,
    vector: np.ndarray,
    time: float = 1.0,
    tolerance: float = 1e-13,
    max_terms: int = 10000,
) -> np.ndarray:
    """Positivity-preserving exponential action for a Metzler loss generator."""
    if time < 0.0:
        raise ValueError("time must be non-negative")
    vector = np.asarray(vector, dtype=float)
    if time == 0.0:
        return vector.copy()

    matrix = csr_matrix(matrix)
    rate = float(np.max(-matrix.diagonal()))
    if rate <= 0.0:
        return vector.copy()

    step = diags(np.ones(matrix.shape[0]), format="csr") + matrix / rate
    mean = rate * time
    weight = math.exp(-mean)
    state = vector.copy()
    result = weight * state
    cumulative = weight

    for n in range(1, max_terms + 1):
        if 1.0 - cumulative <= tolerance:
            return np.asarray(result, dtype=float)
        state = step @ state
        weight *= mean / n
        result += weight * state
        cumulative += weight

    raise RuntimeError("uniformization series did not converge")


def _check_unit_interval(value: float, name: str, *, strict_zero: bool = False) -> None:
    lower_ok = value > 0.0 if strict_zero else value >= 0.0
    if not (lower_ok and value <= 1.0):
        op = '(0, 1]' if strict_zero else '[0, 1]'
        raise ValueError(f'{name} must lie in {op}')


def impact_pdf(x: float | np.ndarray, fill: float) -> float | np.ndarray:
    """Normalized impact-parameter density for a centered spatially underfilled disk."""
    _check_unit_interval(fill, 'fill', strict_zero=True)
    arr = np.asarray(x, dtype=float)
    out = np.zeros_like(arr)
    mask = (arr >= 0.0) & (arr <= fill)
    out[mask] = 4.0 / (math.pi * fill**2) * np.sqrt(np.maximum(fill**2 - arr[mask] ** 2, 0.0))
    if np.isscalar(x):
        return float(out)
    return out


def impact_cdf(cut: float, fill: float) -> float:
    """CDF of normalized impact parameter x=b/R."""
    _check_unit_interval(fill, 'fill', strict_zero=True)
    if cut <= 0.0:
        return 0.0
    if cut >= fill:
        return 1.0
    y = cut / fill
    return 2.0 / math.pi * (math.asin(y) + y * math.sqrt(1.0 - y**2))


def collision_shape(x: float | np.ndarray) -> float | np.ndarray:
    """Spatial part of the circular-wall collision rate, proportional to 1/sqrt(1-x^2)."""
    arr = np.asarray(x, dtype=float)
    if np.any((arr < 0.0) | (arr >= 1.0)):
        raise ValueError('x must lie in [0, 1)')
    out = 1.0 / np.sqrt(1.0 - arr**2)
    if np.isscalar(x):
        return float(out)
    return out


def mean_collision_shape(fill: float) -> float:
    """Exact expectation of collision_shape over the underfilled impact distribution."""
    _check_unit_interval(fill, 'fill', strict_zero=True)
    if math.isclose(fill, 1.0, rel_tol=0.0, abs_tol=1e-14):
        return 4.0 / math.pi
    m = fill**2
    return 4.0 / (math.pi * fill**2) * (ellipe(m) - (1.0 - m) * ellipk(m))


def core_overlap(x: float | np.ndarray, core_ratio: float) -> float | np.ndarray:
    """Ray path-length fraction inside a centered circular inner core."""
    _check_unit_interval(core_ratio, 'core_ratio', strict_zero=True)
    arr = np.asarray(x, dtype=float)
    if np.any((arr < 0.0) | (arr >= 1.0)):
        raise ValueError('x must lie in [0, 1)')
    out = np.zeros_like(arr)
    mask = arr < core_ratio
    out[mask] = np.sqrt(core_ratio**2 - arr[mask] ** 2) / np.sqrt(1.0 - arr[mask] ** 2)
    if np.isscalar(x):
        return float(out)
    return out


def mean_core_overlap(fill: float, core_ratio: float) -> float:
    _check_unit_interval(fill, 'fill', strict_zero=True)
    _check_unit_interval(core_ratio, 'core_ratio', strict_zero=True)
    upper = min(fill, core_ratio)
    value, _ = quad(
        lambda x: impact_pdf(x, fill) * core_overlap(x, core_ratio),
        0.0,
        upper,
        epsabs=1e-12,
        epsrel=1e-11,
        limit=300,
    )
    return float(value)


def angular_mean_tan(beta_max: float) -> float:
    """Mean tan(beta) for a uniformly filled transverse-k disk up to beta_max."""
    if not (0.0 < beta_max < math.pi / 2.0):
        raise ValueError('beta_max must lie in (0, pi/2)')
    s = math.sin(beta_max)
    c = math.cos(beta_max)
    return (beta_max - s * c) / (s * s)


def angular_mean_sec(beta_max: float) -> float:
    """Mean sec(beta) for a uniformly filled transverse-k disk up to beta_max."""
    if not (0.0 < beta_max < math.pi / 2.0):
        raise ValueError('beta_max must lie in (0, pi/2)')
    return 2.0 / (1.0 + math.cos(beta_max))


def mean_transfer_factor(fill: float, beta_max: float) -> float:
    """Separable zero-gap mean transfer factor for centered circular launch."""
    return mean_collision_shape(fill) * angular_mean_tan(beta_max)


def mean_absorption_factor(fill: float, beta_max: float, core_ratio: float) -> float:
    """Separable central-core path-overlap factor per unit axial length."""
    return mean_core_overlap(fill, core_ratio) * angular_mean_sec(beta_max)


def beta_for_equal_transfer(
    reference_fill: float,
    reference_beta_max: float,
    test_fill: float,
) -> float:
    """Angular cutoff required for test_fill to match the reference mean transfer factor."""
    target = mean_transfer_factor(reference_fill, reference_beta_max)
    spatial = mean_collision_shape(test_fill)

    def objective(beta: float) -> float:
        return spatial * angular_mean_tan(beta) - target

    lo = 1e-12
    hi = math.pi / 2.0 - 1e-8
    if objective(hi) < 0.0:
        raise ValueError('no finite beta below pi/2 reaches the target')
    return float(brentq(objective, lo, hi, xtol=1e-13, rtol=1e-12))

def channel_residual(q: float, a: float, length: float) -> float:
    """Passive-guide residual for one incoherent channel with symmetric exchange q and active loss a."""
    if q < 0.0 or a < 0.0 or length < 0.0:
        raise ValueError('q, a, and length must be non-negative')
    if length == 0.0:
        return 1.0
    if q == 0.0:
        return 1.0
    delta = math.sqrt(4.0 * q * q + a * a)
    s = 2.0 * q + a
    lp = (-s + delta) / 2.0
    lm = (-s - delta) / 2.0
    return (
        0.5 * (1.0 + a / delta) * math.exp(lp * length)
        + 0.5 * (1.0 - a / delta) * math.exp(lm * length)
    )


def residual_fraction(
    fill: float,
    length: float,
    q0: float,
    a0: float,
    core_ratio: float,
) -> float:
    """Impact-averaged residual for the minimal independent-channel circular model."""
    _check_unit_interval(fill, 'fill', strict_zero=True)
    _check_unit_interval(core_ratio, 'core_ratio', strict_zero=True)
    if length < 0.0 or q0 < 0.0 or a0 < 0.0:
        raise ValueError('length, q0, and a0 must be non-negative')

    def integrand(x: float) -> float:
        q = q0 * collision_shape(x)
        a = a0 * core_overlap(x, core_ratio)
        return impact_pdf(x, fill) * channel_residual(q, a, length)

    split = min(fill, core_ratio)
    total = 0.0
    if split > 0.0:
        value, _ = quad(
            integrand,
            0.0,
            split,
            epsabs=1e-9,
            epsrel=1e-8,
            limit=300,
        )
        total += value
    if split < fill:
        value, _ = quad(
            integrand,
            split,
            fill,
            epsabs=1e-9,
            epsrel=1e-8,
            limit=300,
        )
        total += value
    return float(total)


def bgk_residual_fraction(
    fill: float,
    length: float,
    q0: float,
    a0: float,
    core_ratio: float,
    mixing: float,
    bins: int = 160,
) -> float:
    """Residual from a conservative BGK relaxation model on impact-parameter space."""
    _check_unit_interval(fill, 'fill', strict_zero=True)
    _check_unit_interval(core_ratio, 'core_ratio', strict_zero=True)
    if length < 0.0 or q0 < 0.0 or a0 < 0.0 or mixing < 0.0:
        raise ValueError('length, q0, a0, and mixing must be non-negative')
    if bins < 16:
        raise ValueError('bins must be >= 16')
    if length == 0.0:
        return 1.0

    dx = 1.0 / bins
    x = (np.arange(bins, dtype=float) + 0.5) * dx
    equilibrium = impact_pdf(x, 1.0) * dx
    equilibrium /= equilibrium.sum()
    initial = impact_pdf(x, fill) * dx
    initial /= initial.sum()

    q = q0 * collision_shape(x)
    a = a0 * core_overlap(x, core_ratio)
    qd = diags(q, format='csr')
    ad = diags(a, format='csr')
    eye = diags(np.ones(bins), format='csr')
    if mixing == 0.0:
        mix = csr_matrix((bins, bins))
    else:
        mix = mixing * (csr_matrix(np.outer(equilibrium, np.ones(bins))) - eye)

    block = bmat(
        [[mix - qd, qd], [qd, mix - qd - ad]],
        format='csr',
    )
    y0 = np.concatenate([initial, np.zeros(bins)])
    yz = uniformization_action(block, y0, time=length)
    return float(yz[:bins].sum())

def nonabsorbing_floor(fill: float, core_ratio: float) -> float:
    """Infinite-length residual in the ideal no-mixing ray model with zero absorption for x>=core_ratio."""
    _check_unit_interval(fill, 'fill', strict_zero=True)
    _check_unit_interval(core_ratio, 'core_ratio', strict_zero=True)
    return 0.5 * (1.0 - impact_cdf(core_ratio, fill))


def first_crossover_length(
    fill_a: float,
    fill_b: float,
    q0: float,
    a0: float,
    core_ratio: float,
    z_min: float = 1e-6,
    z_max: float = 1e3,
    points: int = 400,
) -> float | None:
    """First positive crossing of two residual curves on a logarithmic search grid."""
    if not (0.0 < z_min < z_max):
        raise ValueError('require 0 < z_min < z_max')
    if points < 3:
        raise ValueError('points must be >= 3')

    def delta(z: float) -> float:
        return residual_fraction(fill_a, z, q0, a0, core_ratio) - residual_fraction(
            fill_b, z, q0, a0, core_ratio
        )

    grid = np.geomspace(z_min, z_max, points)
    prev_z = float(grid[0])
    prev_v = delta(prev_z)
    for z in grid[1:]:
        z = float(z)
        value = delta(z)
        if prev_v == 0.0:
            return prev_z
        if value == 0.0 or prev_v * value < 0.0:
            return float(brentq(delta, prev_z, z, xtol=1e-11, rtol=1e-10))
        prev_z, prev_v = z, value
    return None


def fit_apparent_coupling(
    target_residual: float,
    absorption: float,
    length: float,
    k_max: float = 1e3,
) -> float:
    """Fit a scalar symmetric coupling rate to one passive-guide residual value."""
    if not (0.0 < target_residual <= 1.0):
        raise ValueError('target_residual must lie in (0, 1]')
    if absorption < 0.0 or length <= 0.0 or k_max <= 0.0:
        raise ValueError('absorption must be non-negative and length, k_max positive')
    if math.isclose(target_residual, 1.0, rel_tol=0.0, abs_tol=1e-14):
        return 0.0

    def objective(k: float) -> float:
        return channel_residual(k, absorption, length) - target_residual

    lo = 0.0
    hi = k_max
    if objective(hi) > 0.0:
        raise ValueError('target residual is below the scalar model range for k_max')
    return float(brentq(objective, lo, hi, xtol=1e-12, rtol=1e-11))

@dataclass(frozen=True)
class ScanRow:
    fill: float
    core_ratio: float
    mean_collision: float
    mean_core_overlap: float
    residual: float
    floor: float
