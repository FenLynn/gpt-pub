from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / "src"))

from phenomenological_closure import (  # noqa: E402
    coupled_power_fractions,
    drive_from_temperature,
    logistic_coupling,
    residual_power_derivative_at_temperature,
)
from thermal_response import (  # noqa: E402
    thermal_gain_log_conditioning,
    thermal_response_from_fractions,
)


BASE = dict(
    ambient_temperature=25.0,
    thermal_gain=0.08,
    absorption=0.5,
    length=5.0,
    coupling_high=1.0,
    coupling_low=0.01,
    coupling_midpoint_temperature=100.0,
    coupling_temperature_width=8.0,
)


def _derivative(function, x):
    h = 1e-4
    return (function(x + h) - function(x - h)) / (2.0 * h)


def test_universal_response_matches_specific_logistic_closure():
    for T in [55.0, 85.0, 100.0, 120.0, 145.0]:
        P, state, _ = drive_from_temperature(temperature=T, **BASE)

        def fractions(temp):
            k = logistic_coupling(
                temp,
                BASE["coupling_high"],
                BASE["coupling_low"],
                BASE["coupling_midpoint_temperature"],
                BASE["coupling_temperature_width"],
            )
            return coupled_power_fractions(
                k, BASE["absorption"], BASE["length"]
            )

        Rt = _derivative(lambda temp: fractions(temp).pump_fraction, T)
        At = _derivative(lambda temp: fractions(temp).absorbed_fraction, T)
        universal = thermal_response_from_fractions(
            temperature=T,
            ambient_temperature=BASE["ambient_temperature"],
            thermal_gain=BASE["thermal_gain"],
            residual_fraction=state.pump_fraction,
            absorbed_fraction=state.absorbed_fraction,
            residual_temperature_derivative=Rt,
            absorption_temperature_derivative=At,
        )
        specific = residual_power_derivative_at_temperature(
            temperature=T,
            ambient_temperature=BASE["ambient_temperature"],
            absorption=BASE["absorption"],
            length=BASE["length"],
            coupling_high=BASE["coupling_high"],
            coupling_low=BASE["coupling_low"],
            coupling_midpoint_temperature=BASE["coupling_midpoint_temperature"],
            coupling_temperature_width=BASE["coupling_temperature_width"],
        )
        assert np.isclose(universal.input_power, P, rtol=2e-10, atol=2e-10)
        assert np.isclose(
            universal.residual_power_derivative,
            specific,
            rtol=2e-7,
            atol=2e-8,
        )


def test_ambient_boundary_has_zero_feedback_correction():
    response = thermal_response_from_fractions(
        temperature=25.0,
        ambient_temperature=25.0,
        thermal_gain=0.1,
        residual_fraction=0.02,
        absorbed_fraction=0.8,
        residual_temperature_derivative=0.01,
        absorption_temperature_derivative=-0.02,
    )
    assert response.input_power == 0.0
    assert response.residual_log_slope == 0.0
    assert response.residual_power_derivative == 0.02



def test_gain_conditioning_is_inverse_observable_log_slope():
    for T in [70.0, 90.0, 105.0, 125.0, 145.0]:
        def fractions(temp):
            k = logistic_coupling(
                temp,
                BASE["coupling_high"],
                BASE["coupling_low"],
                BASE["coupling_midpoint_temperature"],
                BASE["coupling_temperature_width"],
            )
            return coupled_power_fractions(
                k, BASE["absorption"], BASE["length"]
            )

        state = fractions(T)
        Rt = _derivative(lambda temp: fractions(temp).pump_fraction, T)
        At = _derivative(lambda temp: fractions(temp).absorbed_fraction, T)
        response = thermal_response_from_fractions(
            temperature=T,
            ambient_temperature=BASE["ambient_temperature"],
            thermal_gain=BASE["thermal_gain"],
            residual_fraction=state.pump_fraction,
            absorbed_fraction=state.absorbed_fraction,
            residual_temperature_derivative=Rt,
            absorption_temperature_derivative=At,
        )
        conditioning = thermal_gain_log_conditioning(
            temperature=T,
            ambient_temperature=BASE["ambient_temperature"],
            residual_fraction=state.pump_fraction,
            absorbed_fraction=state.absorbed_fraction,
            residual_temperature_derivative=Rt,
            absorption_temperature_derivative=At,
        )
        assert np.isclose(
            conditioning * response.residual_log_slope,
            1.0,
            rtol=2e-12,
            atol=2e-12,
        )
