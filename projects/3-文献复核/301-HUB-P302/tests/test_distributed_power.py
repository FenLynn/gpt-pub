from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / "src"))

from distributed_power import (  # noqa: E402
    log_sensitivity_to_coupling,
    output_state,
    residual_power,
    scan_observable_amplification,
)


def test_zero_coupling_leaves_all_power_in_input_guide():
    state = output_state(0.0, 10.0)
    assert np.allclose(state, [1.0, 0.0], atol=1e-13)


def test_zero_absorption_conserves_total_power():
    for q in (0.01, 0.1, 1.0, 10.0, 100.0):
        assert np.isclose(residual_power(q, 0.0), 1.0, atol=1e-12)


def test_residual_power_is_bounded():
    for a in (0.1, 1.0, 10.0, 100.0):
        for q in (0.001, 0.1, 1.0, 10.0, 100.0):
            r = residual_power(q, a)
            assert 0.0 < r <= 1.0 + 1e-12


def test_log_sensitivity_matches_direct_finite_difference():
    q = 3.0
    a = 8.0
    h = 1e-4
    direct = abs(
        np.log(residual_power(q * np.exp(h), a))
        - np.log(residual_power(q * np.exp(-h), a))
    ) / (2.0 * h)
    got = log_sensitivity_to_coupling(q, a, step=h)
    assert np.isclose(got, direct, rtol=1e-12)


def test_observable_system_level_gain_remains_order_unity():
    a_values = np.logspace(-2, 2, 48)
    q_values = np.logspace(-3, 2, 120)
    gain, state = scan_observable_amplification(
        a_values, q_values, minimum_residual=0.1
    )
    assert gain < 2.5
    assert state[2] >= 0.1


def test_gain_can_grow_only_in_very_small_residual_tail():
    a_values = np.logspace(-2, 2, 48)
    q_values = np.logspace(-3, 2, 120)
    gain_visible, _ = scan_observable_amplification(
        a_values, q_values, minimum_residual=0.1
    )
    gain_tail, _ = scan_observable_amplification(
        a_values, q_values, minimum_residual=1e-3
    )
    assert gain_tail > gain_visible
