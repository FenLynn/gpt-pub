from __future__ import annotations

from dataclasses import dataclass
import math

from phenomenological_closure import coupled_power_fractions


@dataclass(frozen=True)
class DimensionlessState:
    x: float
    input_scale: float
    coupling: float
    residual_fraction: float
    active_fraction: float
    absorbed_fraction: float
    residual_power_derivative: float
    sharpness: float


@dataclass(frozen=True)
class TurningPoint:
    x: float
    input_scale: float
    residual_fraction: float
    derivative: float
    at_ambient_boundary: bool


def _central_derivative(function, x: float) -> float:
    h = 1e-5 * max(1.0, abs(float(x)))
    if x - h < 0.0:
        h = max(1e-8, 0.25 * max(float(x), 1e-8))
    return (function(x + h) - function(x - h)) / (2.0 * h)


def dimensionless_coupling(
    x: float,
    coupling_high: float,
    coupling_low: float,
) -> float:
    hi = float(coupling_high)
    lo = float(coupling_low)
    if hi < lo or lo < 0.0:
        raise ValueError("require coupling_high >= coupling_low >= 0")
    xx = float(x)
    if xx >= 0.0:
        q = math.exp(-xx)
        f = q / (1.0 + q)
    else:
        q = math.exp(xx)
        f = 1.0 / (1.0 + q)
    return lo + (hi - lo) * f


def dimensionless_coupling_derivative(
    x: float,
    coupling_high: float,
    coupling_low: float,
) -> float:
    hi = float(coupling_high)
    lo = float(coupling_low)
    if hi < lo or lo < 0.0:
        raise ValueError("require coupling_high >= coupling_low >= 0")
    if hi == lo:
        return 0.0
    k = dimensionless_coupling(x, hi, lo)
    f = (k - lo) / (hi - lo)
    return -(hi - lo) * f * (1.0 - f)


def dimensionless_state(
    x: float,
    absorption: float,
    coupling_high: float,
    coupling_low: float,
    ambient_offset: float,
) -> DimensionlessState:
    xx = float(x)
    a = float(absorption)
    x0 = float(ambient_offset)
    if a < 0.0:
        raise ValueError("absorption must be non-negative")
    if x0 <= 0.0:
        raise ValueError("ambient_offset must be positive")
    if xx < -x0:
        raise ValueError("x is below the ambient boundary")

    k = dimensionless_coupling(xx, coupling_high, coupling_low)
    state = coupled_power_fractions(k, a, 1.0)
    rise = xx + x0
    if state.absorbed_fraction <= 0.0:
        if rise == 0.0:
            p = 0.0
        else:
            raise ValueError("positive temperature rise requires absorption")
    else:
        p = rise / state.absorbed_fraction

    R_k = _central_derivative(
        lambda kval: coupled_power_fractions(
            kval, a, 1.0
        ).pump_fraction,
        k,
    )
    A_k = _central_derivative(
        lambda kval: coupled_power_fractions(
            kval, a, 1.0
        ).absorbed_fraction,
        k,
    )
    k_x = dimensionless_coupling_derivative(
        xx, coupling_high, coupling_low
    )
    if k > 0.0:
        chi = -rise * k_x / k
    else:
        chi = 0.0

    denominator = 1.0 - rise * (A_k / state.absorbed_fraction) * k_x
    derivative = state.pump_fraction + rise * R_k * k_x / denominator

    return DimensionlessState(
        x=xx,
        input_scale=float(p),
        coupling=float(k),
        residual_fraction=float(state.pump_fraction),
        active_fraction=float(state.active_fraction),
        absorbed_fraction=float(state.absorbed_fraction),
        residual_power_derivative=float(derivative),
        sharpness=float(chi),
    )


def ambient_derivative(
    absorption: float,
    coupling_high: float,
    coupling_low: float,
    ambient_offset: float,
) -> float:
    state = dimensionless_state(
        -float(ambient_offset),
        absorption,
        coupling_high,
        coupling_low,
        ambient_offset,
    )
    return state.residual_power_derivative


def high_temperature_derivative_limit(
    absorption: float,
    coupling_low: float,
) -> float:
    return coupled_power_fractions(
        float(coupling_low), float(absorption), 1.0
    ).pump_fraction


def first_turning_point(
    absorption: float,
    coupling_high: float,
    coupling_low: float,
    ambient_offset: float,
    derivative_threshold: float,
    x_max: float = 12.0,
    scan_points: int = 2001,
    bisection_steps: int = 70,
) -> TurningPoint | None:
    threshold = float(derivative_threshold)
    x0 = float(ambient_offset)
    if threshold < 0.0:
        raise ValueError("derivative_threshold must be non-negative")
    if scan_points < 3:
        raise ValueError("scan_points must be >= 3")
    if x_max <= -x0:
        raise ValueError("x_max must exceed ambient boundary")

    left = dimensionless_state(
        -x0,
        absorption,
        coupling_high,
        coupling_low,
        x0,
    )
    if left.residual_power_derivative >= threshold:
        return TurningPoint(
            x=left.x,
            input_scale=left.input_scale,
            residual_fraction=left.residual_fraction,
            derivative=left.residual_power_derivative,
            at_ambient_boundary=True,
        )

    x_prev = -x0
    f_prev = left.residual_power_derivative - threshold
    span = x_max + x0

    for i in range(1, int(scan_points)):
        x_now = -x0 + span * i / (scan_points - 1)
        state_now = dimensionless_state(
            x_now,
            absorption,
            coupling_high,
            coupling_low,
            x0,
        )
        f_now = state_now.residual_power_derivative - threshold
        if f_now >= 0.0 and f_prev < 0.0:
            lo = x_prev
            hi = x_now
            for _ in range(int(bisection_steps)):
                mid = 0.5 * (lo + hi)
                f_mid = (
                    dimensionless_state(
                        mid,
                        absorption,
                        coupling_high,
                        coupling_low,
                        x0,
                    ).residual_power_derivative
                    - threshold
                )
                if f_mid >= 0.0:
                    hi = mid
                else:
                    lo = mid
            root = dimensionless_state(
                0.5 * (lo + hi),
                absorption,
                coupling_high,
                coupling_low,
                x0,
            )
            return TurningPoint(
                x=root.x,
                input_scale=root.input_scale,
                residual_fraction=root.residual_fraction,
                derivative=root.residual_power_derivative,
                at_ambient_boundary=False,
            )
        x_prev = x_now
        f_prev = f_now

    return None
