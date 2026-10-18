from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from phenomenological_map import dimensionless_state


@dataclass(frozen=True)
class SensitivityAudit:
    matrix: np.ndarray
    singular_values: np.ndarray
    condition_number: float


def solve_x_for_input_scale(
    input_scale: float,
    absorption: float,
    coupling_high: float,
    coupling_low: float,
    ambient_offset: float,
    x_max: float = 20.0,
    bisection_steps: int = 80,
) -> float:
    target = float(input_scale)
    if target < 0.0:
        raise ValueError("input_scale must be non-negative")
    x0 = float(ambient_offset)
    if target == 0.0:
        return -x0

    lo = -x0
    hi = max(2.0, lo + 1.0)
    state_hi = dimensionless_state(
        hi,
        absorption,
        coupling_high,
        coupling_low,
        x0,
    )
    while state_hi.input_scale < target and hi < x_max:
        hi = min(x_max, hi + 2.0)
        state_hi = dimensionless_state(
            hi,
            absorption,
            coupling_high,
            coupling_low,
            x0,
        )

    if state_hi.input_scale < target:
        raise ValueError("input_scale exceeds configured x_max bracket")

    for _ in range(int(bisection_steps)):
        mid = 0.5 * (lo + hi)
        state_mid = dimensionless_state(
            mid,
            absorption,
            coupling_high,
            coupling_low,
            x0,
        )
        if state_mid.input_scale >= target:
            hi = mid
        else:
            lo = mid
    return 0.5 * (lo + hi)


def residual_fraction_at_input_scale(
    input_scale: float,
    absorption: float,
    coupling_high: float,
    coupling_low: float,
    ambient_offset: float,
    x_max: float = 20.0,
) -> float:
    x = solve_x_for_input_scale(
        input_scale,
        absorption,
        coupling_high,
        coupling_low,
        ambient_offset,
        x_max=x_max,
    )
    return dimensionless_state(
        x,
        absorption,
        coupling_high,
        coupling_low,
        ambient_offset,
    ).residual_fraction


def physical_residual_fraction(
    input_power: float,
    power_scale: float,
    absorption: float,
    coupling_high: float,
    coupling_low: float,
    ambient_offset: float,
    x_max: float = 20.0,
) -> float:
    q = float(power_scale)
    if q <= 0.0:
        raise ValueError("power_scale must be positive")
    P = float(input_power)
    if P < 0.0:
        raise ValueError("input_power must be non-negative")
    return residual_fraction_at_input_scale(
        P / q,
        absorption,
        coupling_high,
        coupling_low,
        ambient_offset,
        x_max=x_max,
    )


def log_sensitivity_audit(
    input_powers: np.ndarray,
    absorption: float,
    coupling_high: float,
    coupling_low: float,
    ambient_offset: float,
    power_scale: float,
    relative_step: float = 1e-4,
    x_max: float = 20.0,
) -> SensitivityAudit:
    powers = np.asarray(input_powers, dtype=float)
    if powers.ndim != 1 or len(powers) < 2:
        raise ValueError("input_powers must be a 1D array with >= 2 points")
    if np.any(powers <= 0.0):
        raise ValueError("input_powers must be positive")
    if relative_step <= 0.0:
        raise ValueError("relative_step must be positive")

    theta = np.array(
        [
            float(absorption),
            float(coupling_high),
            float(coupling_low),
            float(ambient_offset),
            float(power_scale),
        ],
        dtype=float,
    )
    if np.any(theta <= 0.0):
        raise ValueError("all audited parameters must be positive")

    h = float(relative_step)
    J = np.empty((len(powers), len(theta)), dtype=float)

    def curve(params: np.ndarray) -> np.ndarray:
        return np.array(
            [
                physical_residual_fraction(
                    P,
                    params[4],
                    params[0],
                    params[1],
                    params[2],
                    params[3],
                    x_max=x_max,
                )
                for P in powers
            ],
            dtype=float,
        )

    for j in range(len(theta)):
        plus = theta.copy()
        minus = theta.copy()
        plus[j] *= np.exp(h)
        minus[j] *= np.exp(-h)
        yp = curve(plus)
        ym = curve(minus)
        if np.any(yp <= 0.0) or np.any(ym <= 0.0):
            raise ValueError("residual fractions must remain positive")
        J[:, j] = (np.log(yp) - np.log(ym)) / (2.0 * h)

    singular = np.linalg.svd(J, full_matrices=False, compute_uv=False)
    if singular[-1] <= 0.0:
        condition = float("inf")
    else:
        condition = float(singular[0] / singular[-1])

    return SensitivityAudit(
        matrix=J,
        singular_values=singular,
        condition_number=condition,
    )
