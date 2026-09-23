import math
from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / "src"))

from phenomenological_closure import (  # noqa: E402
    coupled_power_fractions,
    drive_from_temperature,
    logistic_coupling,
    midpoint_metrics,
    solve_temperature,
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


def test_zero_coupling_keeps_all_power_in_pump_channel():
    state = coupled_power_fractions(0.0, absorption=0.5, length=5.0)
    assert state.pump_fraction == 1.0
    assert state.active_fraction == 0.0
    assert state.absorbed_fraction == 0.0


def test_zero_absorption_conserves_total_power():
    state = coupled_power_fractions(0.7, absorption=0.0, length=3.0)
    assert np.isclose(
        state.pump_fraction + state.active_fraction,
        1.0,
        rtol=1e-12,
        atol=1e-12,
    )
    assert abs(state.absorbed_fraction) < 1e-12


def test_parametric_temperature_matches_root_solution():
    T = 100.0
    P, state, k = drive_from_temperature(temperature=T, **BASE)
    solved = solve_temperature(input_power=P, **BASE)
    assert np.isclose(solved, T, rtol=0.0, atol=1e-9)
    assert np.isclose(
        k,
        0.5 * (BASE["coupling_high"] + BASE["coupling_low"]),
        rtol=0.0,
        atol=1e-14,
    )
    assert state.absorbed_fraction > 0.0


def test_midpoint_power_formula_matches_parametric_curve():
    metrics = midpoint_metrics(**BASE)
    P, state, _ = drive_from_temperature(
        temperature=BASE["coupling_midpoint_temperature"],
        **BASE,
    )
    assert np.isclose(metrics.input_power, P, rtol=1e-12, atol=1e-12)
    assert np.isclose(
        metrics.residual_fraction,
        state.pump_fraction,
        rtol=1e-12,
        atol=1e-12,
    )


def test_midpoint_log_slope_matches_finite_difference():
    metrics = midpoint_metrics(**BASE)
    P0 = metrics.input_power
    eps = 1e-5

    def residual_fraction(P):
        T = solve_temperature(input_power=P, **BASE)
        k = logistic_coupling(
            T,
            BASE["coupling_high"],
            BASE["coupling_low"],
            BASE["coupling_midpoint_temperature"],
            BASE["coupling_temperature_width"],
        )
        return coupled_power_fractions(
            k, BASE["absorption"], BASE["length"]
        ).pump_fraction

    plus = residual_fraction(P0 * (1.0 + eps))
    minus = residual_fraction(P0 * (1.0 - eps))
    numerical = (
        math.log(plus) - math.log(minus)
    ) / (
        math.log(P0 * (1.0 + eps)) - math.log(P0 * (1.0 - eps))
    )
    assert np.isclose(numerical, metrics.log_slope, rtol=2e-6, atol=2e-7)


def test_exact_temperature_scale_nonidentifiability():
    lam = 1.7
    scaled = dict(BASE)
    scaled["coupling_temperature_width"] *= lam
    scaled["coupling_midpoint_temperature"] = (
        BASE["ambient_temperature"]
        + lam
        * (
            BASE["coupling_midpoint_temperature"]
            - BASE["ambient_temperature"]
        )
    )
    scaled["thermal_gain"] *= lam

    for x in np.linspace(-2.0, 2.0, 9):
        T1 = (
            BASE["coupling_midpoint_temperature"]
            + BASE["coupling_temperature_width"] * x
        )
        T2 = (
            scaled["coupling_midpoint_temperature"]
            + scaled["coupling_temperature_width"] * x
        )
        P1, state1, k1 = drive_from_temperature(temperature=T1, **BASE)
        P2, state2, k2 = drive_from_temperature(
            temperature=T2, **scaled
        )
        assert np.isclose(P1, P2, rtol=2e-12, atol=2e-10)
        assert np.isclose(k1, k2, rtol=1e-13, atol=1e-13)
        assert np.isclose(
            state1.pump_fraction,
            state2.pump_fraction,
            rtol=2e-12,
            atol=2e-12,
        )


def test_loop_gain_is_nonnegative_for_decreasing_coupling():
    metrics = midpoint_metrics(**BASE)
    assert metrics.loop_gain >= 0.0
    assert metrics.residual_elasticity > 0.0
    assert metrics.absorption_elasticity > 0.0
    assert metrics.log_slope > 0.0
