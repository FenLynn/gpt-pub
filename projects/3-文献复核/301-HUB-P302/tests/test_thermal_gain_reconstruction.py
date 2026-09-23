from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / "src"))

from phenomenological_closure import (  # noqa: E402
    coupled_power_fractions,
    drive_from_temperature,
    logistic_coupling,
)
from thermal_gain_reconstruction import reconstruct_thermal_gain  # noqa: E402


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


def _reference(temperatures):
    residual = []
    absorbed = []
    for T in temperatures:
        k = logistic_coupling(
            T,
            BASE["coupling_high"],
            BASE["coupling_low"],
            BASE["coupling_midpoint_temperature"],
            BASE["coupling_temperature_width"],
        )
        state = coupled_power_fractions(
            k, BASE["absorption"], BASE["length"]
        )
        residual.append(state.pump_fraction)
        absorbed.append(state.absorbed_fraction)
    return np.asarray(residual), np.asarray(absorbed)


def test_reconstruction_recovers_constant_thermal_gain():
    temperatures = np.linspace(25.0, 170.0, 5001)
    reference_R, reference_A = _reference(temperatures)

    observed_T = np.array([45.0, 65.0, 85.0, 100.0, 115.0, 135.0, 155.0])
    powers = []
    observed_R = []
    for T in observed_T:
        P, state, _ = drive_from_temperature(temperature=T, **BASE)
        powers.append(P)
        observed_R.append(state.pump_fraction)

    reconstructed = reconstruct_thermal_gain(
        reference_temperatures=temperatures,
        reference_residual_fraction=reference_R,
        reference_absorbed_fraction=reference_A,
        ambient_temperature=BASE["ambient_temperature"],
        input_power=np.asarray(powers),
        observed_residual_fraction=np.asarray(observed_R),
    )

    assert np.allclose(
        reconstructed.inferred_temperature,
        observed_T,
        rtol=0.0,
        atol=2e-3,
    )
    assert np.allclose(
        reconstructed.thermal_gain,
        BASE["thermal_gain"],
        rtol=3e-4,
        atol=3e-6,
    )


def test_reconstruction_detects_power_dependent_gain():
    temperatures = np.linspace(25.0, 170.0, 5001)
    reference_R, reference_A = _reference(temperatures)

    observed_T = np.array([50.0, 75.0, 100.0, 125.0, 150.0])
    true_gain = np.array([0.06, 0.07, 0.08, 0.09, 0.10])
    powers = []
    observed_R = []
    for T, gain in zip(observed_T, true_gain):
        k = logistic_coupling(
            T,
            BASE["coupling_high"],
            BASE["coupling_low"],
            BASE["coupling_midpoint_temperature"],
            BASE["coupling_temperature_width"],
        )
        state = coupled_power_fractions(
            k, BASE["absorption"], BASE["length"]
        )
        P = (
            T - BASE["ambient_temperature"]
        ) / (gain * state.absorbed_fraction)
        powers.append(P)
        observed_R.append(state.pump_fraction)

    reconstructed = reconstruct_thermal_gain(
        reference_temperatures=temperatures,
        reference_residual_fraction=reference_R,
        reference_absorbed_fraction=reference_A,
        ambient_temperature=BASE["ambient_temperature"],
        input_power=np.asarray(powers),
        observed_residual_fraction=np.asarray(observed_R),
    )

    assert np.allclose(
        reconstructed.thermal_gain,
        true_gain,
        rtol=4e-4,
        atol=4e-6,
    )


def test_out_of_range_residual_is_rejected():
    temperatures = np.linspace(25.0, 170.0, 501)
    reference_R, reference_A = _reference(temperatures)

    try:
        reconstruct_thermal_gain(
            reference_temperatures=temperatures,
            reference_residual_fraction=reference_R,
            reference_absorbed_fraction=reference_A,
            ambient_temperature=BASE["ambient_temperature"],
            input_power=np.array([100.0]),
            observed_residual_fraction=np.array([2.0]),
        )
    except ValueError:
        pass
    else:
        raise AssertionError("out-of-range residual must be rejected")



def test_decreasing_residual_reference_is_supported():
    temperatures = np.linspace(25.0, 125.0, 1001)
    residual = 0.9 - 0.004 * (temperatures - 25.0)
    absorbed = 0.5 + 0.001 * (temperatures - 25.0)
    observed_T = np.array([35.0, 60.0, 90.0, 115.0])
    observed_R = 0.9 - 0.004 * (observed_T - 25.0)
    true_gain = 0.075
    observed_A = 0.5 + 0.001 * (observed_T - 25.0)
    powers = (observed_T - 25.0) / (true_gain * observed_A)

    reconstructed = reconstruct_thermal_gain(
        reference_temperatures=temperatures,
        reference_residual_fraction=residual,
        reference_absorbed_fraction=absorbed,
        ambient_temperature=25.0,
        input_power=powers,
        observed_residual_fraction=observed_R,
    )

    assert np.allclose(
        reconstructed.inferred_temperature,
        observed_T,
        rtol=0.0,
        atol=2e-10,
    )
    assert np.allclose(
        reconstructed.thermal_gain,
        true_gain,
        rtol=2e-12,
        atol=2e-12,
    )
