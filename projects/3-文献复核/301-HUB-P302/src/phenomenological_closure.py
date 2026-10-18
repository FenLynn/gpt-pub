from __future__ import annotations

from dataclasses import dataclass
import math


@dataclass(frozen=True)
class OpticalState:
    pump_fraction: float
    active_fraction: float
    absorbed_fraction: float


@dataclass(frozen=True)
class MidpointMetrics:
    input_power: float
    coupling: float
    residual_fraction: float
    absorbed_fraction: float
    loop_gain: float
    log_slope: float
    residual_elasticity: float
    absorption_elasticity: float
    constitutive_sharpness: float


def coupled_power_fractions(
    coupling: float,
    absorption: float,
    length: float,
) -> OpticalState:
    k = float(coupling)
    alpha = float(absorption)
    L = float(length)
    if k < 0.0 or alpha < 0.0 or L < 0.0:
        raise ValueError("coupling, absorption, and length must be non-negative")
    if L == 0.0:
        return OpticalState(1.0, 0.0, 0.0)

    delta = math.sqrt(alpha * alpha + 4.0 * k * k)
    if delta == 0.0:
        return OpticalState(1.0, 0.0, 0.0)

    lam_plus = -0.5 * (2.0 * k + alpha) + 0.5 * delta
    lam_minus = -0.5 * (2.0 * k + alpha) - 0.5 * delta
    ep = math.exp(lam_plus * L)
    em = math.exp(lam_minus * L)

    p1 = 0.5 * (
        (1.0 + alpha / delta) * ep
        + (1.0 - alpha / delta) * em
    )
    p2 = (k / delta) * (ep - em)
    absorbed = 1.0 - p1 - p2

    tol = 5e-14
    if -tol < p1 < 0.0:
        p1 = 0.0
    if -tol < p2 < 0.0:
        p2 = 0.0
    if -tol < absorbed < 0.0:
        absorbed = 0.0
    if 1.0 < p1 < 1.0 + tol:
        p1 = 1.0
    if 1.0 < p2 < 1.0 + tol:
        p2 = 1.0
    if 1.0 < absorbed < 1.0 + tol:
        absorbed = 1.0

    return OpticalState(float(p1), float(p2), float(absorbed))


def logistic_coupling(
    temperature: float,
    high: float,
    low: float,
    midpoint: float,
    width: float,
) -> float:
    hi = float(high)
    lo = float(low)
    w = float(width)
    if hi < lo or lo < 0.0:
        raise ValueError("require high >= low >= 0")
    if w <= 0.0:
        raise ValueError("width must be positive")

    x = (float(temperature) - float(midpoint)) / w
    if x >= 0.0:
        q = math.exp(-x)
        f = q / (1.0 + q)
    else:
        q = math.exp(x)
        f = 1.0 / (1.0 + q)
    return lo + (hi - lo) * f


def _central_derivative(function, x: float) -> float:
    x = float(x)
    h = 1e-5 * max(1.0, abs(x))
    if x - h < 0.0:
        h = max(1e-8, 0.25 * max(x, 1e-8))
    return (function(x + h) - function(x - h)) / (2.0 * h)


def drive_from_temperature(
    temperature: float,
    ambient_temperature: float,
    thermal_gain: float,
    absorption: float,
    length: float,
    coupling_high: float,
    coupling_low: float,
    coupling_midpoint_temperature: float,
    coupling_temperature_width: float,
) -> tuple[float, OpticalState, float]:
    T = float(temperature)
    Tamb = float(ambient_temperature)
    g = float(thermal_gain)
    if T < Tamb:
        raise ValueError("temperature must be >= ambient_temperature")
    if g <= 0.0:
        raise ValueError("thermal_gain must be positive")

    k = logistic_coupling(
        T,
        coupling_high,
        coupling_low,
        coupling_midpoint_temperature,
        coupling_temperature_width,
    )
    state = coupled_power_fractions(k, absorption, length)
    if state.absorbed_fraction <= 0.0:
        if T == Tamb:
            return 0.0, state, k
        raise ValueError("positive temperature rise requires positive absorption")
    input_power = (T - Tamb) / (g * state.absorbed_fraction)
    return float(input_power), state, float(k)


def solve_temperature(
    input_power: float,
    ambient_temperature: float,
    thermal_gain: float,
    absorption: float,
    length: float,
    coupling_high: float,
    coupling_low: float,
    coupling_midpoint_temperature: float,
    coupling_temperature_width: float,
    iterations: int = 90,
) -> float:
    P = float(input_power)
    Tamb = float(ambient_temperature)
    g = float(thermal_gain)
    if P < 0.0:
        raise ValueError("input_power must be non-negative")
    if g <= 0.0:
        raise ValueError("thermal_gain must be positive")
    if P == 0.0:
        return Tamb

    def residual(T: float) -> float:
        k = logistic_coupling(
            T,
            coupling_high,
            coupling_low,
            coupling_midpoint_temperature,
            coupling_temperature_width,
        )
        A = coupled_power_fractions(k, absorption, length).absorbed_fraction
        return T - Tamb - g * P * A

    lo = Tamb
    hi = Tamb + g * P
    flo = residual(lo)
    fhi = residual(hi)
    if flo > 1e-12 or fhi < -1e-12:
        raise RuntimeError("thermal root is not bracketed")

    for _ in range(int(iterations)):
        mid = 0.5 * (lo + hi)
        if residual(mid) > 0.0:
            hi = mid
        else:
            lo = mid
    return 0.5 * (lo + hi)


def midpoint_metrics(
    ambient_temperature: float,
    thermal_gain: float,
    absorption: float,
    length: float,
    coupling_high: float,
    coupling_low: float,
    coupling_midpoint_temperature: float,
    coupling_temperature_width: float,
) -> MidpointMetrics:
    Tamb = float(ambient_temperature)
    g = float(thermal_gain)
    Tc = float(coupling_midpoint_temperature)
    width = float(coupling_temperature_width)
    hi = float(coupling_high)
    lo = float(coupling_low)

    if Tc <= Tamb:
        raise ValueError("coupling midpoint temperature must exceed ambient")
    if g <= 0.0 or width <= 0.0:
        raise ValueError("thermal_gain and width must be positive")
    if hi <= lo or lo < 0.0:
        raise ValueError("require coupling_high > coupling_low >= 0")

    kc = 0.5 * (hi + lo)
    state = coupled_power_fractions(kc, absorption, length)
    if state.absorbed_fraction <= 0.0 or state.pump_fraction <= 0.0:
        raise ValueError("midpoint state must have positive absorption and residual")

    A_k = _central_derivative(
        lambda kval: coupled_power_fractions(
            kval, absorption, length
        ).absorbed_fraction,
        kc,
    )
    R_k = _central_derivative(
        lambda kval: coupled_power_fractions(
            kval, absorption, length
        ).pump_fraction,
        kc,
    )
    k_T = -(hi - lo) / (4.0 * width)
    delta_T = Tc - Tamb
    P_c = delta_T / (g * state.absorbed_fraction)

    loop_gain = -g * P_c * A_k * k_T
    residual_elasticity = -kc * R_k / state.pump_fraction
    absorption_elasticity = kc * A_k / state.absorbed_fraction
    constitutive_sharpness = -delta_T * k_T / kc
    log_slope = (
        residual_elasticity
        * constitutive_sharpness
        / (1.0 + absorption_elasticity * constitutive_sharpness)
    )

    return MidpointMetrics(
        input_power=float(P_c),
        coupling=float(kc),
        residual_fraction=float(state.pump_fraction),
        absorbed_fraction=float(state.absorbed_fraction),
        loop_gain=float(loop_gain),
        log_slope=float(log_slope),
        residual_elasticity=float(residual_elasticity),
        absorption_elasticity=float(absorption_elasticity),
        constitutive_sharpness=float(constitutive_sharpness),
    )



def logistic_coupling_derivative(
    temperature: float,
    high: float,
    low: float,
    midpoint: float,
    width: float,
) -> float:
    hi = float(high)
    lo = float(low)
    w = float(width)
    if hi < lo or lo < 0.0:
        raise ValueError("require high >= low >= 0")
    if w <= 0.0:
        raise ValueError("width must be positive")
    if hi == lo:
        return 0.0

    k = logistic_coupling(temperature, hi, lo, midpoint, w)
    f = (k - lo) / (hi - lo)
    return -(hi - lo) * f * (1.0 - f) / w


def residual_power_derivative_at_temperature(
    temperature: float,
    ambient_temperature: float,
    absorption: float,
    length: float,
    coupling_high: float,
    coupling_low: float,
    coupling_midpoint_temperature: float,
    coupling_temperature_width: float,
) -> float:
    T = float(temperature)
    Tamb = float(ambient_temperature)
    if T < Tamb:
        raise ValueError("temperature must be >= ambient_temperature")

    k = logistic_coupling(
        T,
        coupling_high,
        coupling_low,
        coupling_midpoint_temperature,
        coupling_temperature_width,
    )
    state = coupled_power_fractions(k, absorption, length)
    if state.absorbed_fraction <= 0.0:
        return state.pump_fraction

    R_k = _central_derivative(
        lambda kval: coupled_power_fractions(
            kval, absorption, length
        ).pump_fraction,
        k,
    )
    A_k = _central_derivative(
        lambda kval: coupled_power_fractions(
            kval, absorption, length
        ).absorbed_fraction,
        k,
    )
    k_T = logistic_coupling_derivative(
        T,
        coupling_high,
        coupling_low,
        coupling_midpoint_temperature,
        coupling_temperature_width,
    )
    delta_T = T - Tamb
    denominator = (
        1.0
        - delta_T
        * (A_k / state.absorbed_fraction)
        * k_T
    )
    return float(
        state.pump_fraction
        + delta_T * R_k * k_T / denominator
    )
