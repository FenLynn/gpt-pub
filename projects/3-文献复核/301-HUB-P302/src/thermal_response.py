from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ThermalResponse:
    input_power: float
    residual_log_slope: float
    residual_power_derivative: float
    residual_thermal_elasticity: float
    absorption_thermal_elasticity: float


def thermal_response_from_fractions(
    temperature: float,
    ambient_temperature: float,
    thermal_gain: float,
    residual_fraction: float,
    absorbed_fraction: float,
    residual_temperature_derivative: float,
    absorption_temperature_derivative: float,
) -> ThermalResponse:
    T = float(temperature)
    Ta = float(ambient_temperature)
    g = float(thermal_gain)
    R = float(residual_fraction)
    A = float(absorbed_fraction)
    Rt = float(residual_temperature_derivative)
    At = float(absorption_temperature_derivative)

    if T < Ta:
        raise ValueError("temperature must be >= ambient_temperature")
    if g <= 0.0:
        raise ValueError("thermal_gain must be positive")
    if R <= 0.0 or A <= 0.0:
        raise ValueError("residual and absorbed fractions must be positive")

    rise = T - Ta
    input_power = rise / (g * A)
    xi_r = rise * Rt / R
    xi_a = -rise * At / A
    denominator = 1.0 + xi_a
    if denominator <= 0.0:
        raise ValueError("thermal branch derivative is non-positive")

    log_slope = xi_r / denominator
    absolute_derivative = R * (1.0 + log_slope)

    return ThermalResponse(
        input_power=float(input_power),
        residual_log_slope=float(log_slope),
        residual_power_derivative=float(absolute_derivative),
        residual_thermal_elasticity=float(xi_r),
        absorption_thermal_elasticity=float(xi_a),
    )



def thermal_gain_log_conditioning(
    temperature: float,
    ambient_temperature: float,
    residual_fraction: float,
    absorbed_fraction: float,
    residual_temperature_derivative: float,
    absorption_temperature_derivative: float,
) -> float:
    T = float(temperature)
    Ta = float(ambient_temperature)
    R = float(residual_fraction)
    A = float(absorbed_fraction)
    Rt = float(residual_temperature_derivative)
    At = float(absorption_temperature_derivative)

    if T <= Ta:
        raise ValueError("conditioning requires temperature above ambient")
    if R <= 0.0 or A <= 0.0:
        raise ValueError("fractions must be positive")

    rise = T - Ta
    xi_r = rise * Rt / R
    xi_a = -rise * At / A
    if xi_r == 0.0:
        return float("inf")
    return float((1.0 + xi_a) / xi_r)
