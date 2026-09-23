from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / "src"))

from asymmetric_coupling import asymmetric_coupled_power_fractions  # noqa: E402
from phenomenological_closure import coupled_power_fractions  # noqa: E402


def test_symmetric_limit_matches_existing_solution():
    for k in [0.01, 0.2, 1.0, 5.0]:
        for a in [0.1, 1.0, 10.0]:
            for L in [0.2, 1.0, 4.0]:
                asym = asymmetric_coupled_power_fractions(k, k, a, L)
                sym = coupled_power_fractions(k, a, L)
                assert np.isclose(asym.pump_fraction, sym.pump_fraction, rtol=2e-12, atol=2e-12)
                assert np.isclose(asym.active_fraction, sym.active_fraction, rtol=2e-12, atol=2e-12)
                assert np.isclose(asym.absorbed_fraction, sym.absorbed_fraction, rtol=2e-12, atol=2e-12)


def test_zero_forward_coupling_keeps_input_in_pump_guide():
    state = asymmetric_coupled_power_fractions(
        coupling_forward=0.0,
        coupling_reverse=2.0,
        absorption=5.0,
        length=3.0,
    )
    assert state.pump_fraction == 1.0
    assert state.active_fraction == 0.0
    assert state.absorbed_fraction == 0.0


def test_zero_absorption_conserves_total_power():
    state = asymmetric_coupled_power_fractions(
        coupling_forward=0.7,
        coupling_reverse=0.2,
        absorption=0.0,
        length=4.0,
    )
    assert np.isclose(
        state.pump_fraction + state.active_fraction,
        1.0,
        rtol=2e-12,
        atol=2e-12,
    )
    assert abs(state.absorbed_fraction) < 2e-12


def test_defective_limit_is_finite_and_conservative_with_absorption():
    state = asymmetric_coupled_power_fractions(
        coupling_forward=1.0,
        coupling_reverse=0.0,
        absorption=1.0,
        length=2.0,
    )
    assert np.isfinite(state.pump_fraction)
    assert np.isfinite(state.active_fraction)
    assert np.isfinite(state.absorbed_fraction)
    assert np.isclose(
        state.pump_fraction + state.active_fraction + state.absorbed_fraction,
        1.0,
        rtol=2e-12,
        atol=2e-12,
    )


def test_length_rate_scaling_is_exact():
    base = asymmetric_coupled_power_fractions(0.7, 0.3, 1.2, 4.0)
    c = 3.4
    scaled = asymmetric_coupled_power_fractions(
        0.7 / c,
        0.3 / c,
        1.2 / c,
        4.0 * c,
    )
    assert np.isclose(base.pump_fraction, scaled.pump_fraction, rtol=2e-12, atol=2e-12)
    assert np.isclose(base.active_fraction, scaled.active_fraction, rtol=2e-12, atol=2e-12)
    assert np.isclose(base.absorbed_fraction, scaled.absorbed_fraction, rtol=2e-12, atol=2e-12)
