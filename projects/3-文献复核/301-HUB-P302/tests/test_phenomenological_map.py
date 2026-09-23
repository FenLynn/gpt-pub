from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / "src"))

from phenomenological_closure import (  # noqa: E402
    drive_from_temperature,
    residual_power_derivative_at_temperature,
)
from phenomenological_map import (  # noqa: E402
    ambient_derivative,
    dimensionless_state,
    first_turning_point,
    high_temperature_derivative_limit,
)


PHYSICAL = dict(
    ambient_temperature=25.0,
    thermal_gain=0.08,
    absorption=0.5,
    length=5.0,
    coupling_high=1.0,
    coupling_low=0.01,
    coupling_midpoint_temperature=100.0,
    coupling_temperature_width=8.0,
)

DIMLESS = dict(
    absorption=PHYSICAL["absorption"] * PHYSICAL["length"],
    coupling_high=PHYSICAL["coupling_high"] * PHYSICAL["length"],
    coupling_low=PHYSICAL["coupling_low"] * PHYSICAL["length"],
    ambient_offset=(
        PHYSICAL["coupling_midpoint_temperature"]
        - PHYSICAL["ambient_temperature"]
    )
    / PHYSICAL["coupling_temperature_width"],
)


def test_dimensionless_state_matches_physical_closure():
    for x in [-3.0, -1.0, 0.0, 0.8, 2.0]:
        T = (
            PHYSICAL["coupling_midpoint_temperature"]
            + PHYSICAL["coupling_temperature_width"] * x
        )
        P, physical_state, _ = drive_from_temperature(
            temperature=T, **PHYSICAL
        )
        derivative = residual_power_derivative_at_temperature(
            temperature=T,
            ambient_temperature=PHYSICAL["ambient_temperature"],
            absorption=PHYSICAL["absorption"],
            length=PHYSICAL["length"],
            coupling_high=PHYSICAL["coupling_high"],
            coupling_low=PHYSICAL["coupling_low"],
            coupling_midpoint_temperature=PHYSICAL[
                "coupling_midpoint_temperature"
            ],
            coupling_temperature_width=PHYSICAL[
                "coupling_temperature_width"
            ],
        )
        reduced = dimensionless_state(x=x, **DIMLESS)
        assert np.isclose(
            reduced.input_scale,
            P * PHYSICAL["thermal_gain"]
            / PHYSICAL["coupling_temperature_width"],
            rtol=2e-11,
            atol=2e-11,
        )
        assert np.isclose(
            reduced.residual_fraction,
            physical_state.pump_fraction,
            rtol=2e-12,
            atol=2e-12,
        )
        assert np.isclose(
            reduced.residual_power_derivative,
            derivative,
            rtol=2e-9,
            atol=2e-10,
        )


def test_ambient_derivative_equals_ambient_residual_fraction():
    state = dimensionless_state(x=-DIMLESS["ambient_offset"], **DIMLESS)
    d0 = ambient_derivative(**DIMLESS)
    assert np.isclose(d0, state.residual_fraction, rtol=1e-13, atol=1e-13)
    assert state.input_scale == 0.0


def test_high_temperature_derivative_limit_is_low_coupling_residual():
    limit = high_temperature_derivative_limit(
        DIMLESS["absorption"], DIMLESS["coupling_low"]
    )
    state = dimensionless_state(x=30.0, **DIMLESS)
    assert np.isclose(
        state.residual_power_derivative,
        limit,
        rtol=2e-9,
        atol=2e-9,
    )


def test_first_turning_point_hits_threshold():
    d0 = ambient_derivative(**DIMLESS)
    dinf = high_temperature_derivative_limit(
        DIMLESS["absorption"], DIMLESS["coupling_low"]
    )
    threshold = 0.5 * (d0 + dinf)
    tp = first_turning_point(
        derivative_threshold=threshold,
        **DIMLESS,
    )
    assert tp is not None
    assert not tp.at_ambient_boundary
    assert np.isclose(tp.derivative, threshold, rtol=0.0, atol=5e-11)


def test_boundary_threshold_returns_zero_power():
    d0 = ambient_derivative(**DIMLESS)
    tp = first_turning_point(
        derivative_threshold=d0 * 0.9,
        **DIMLESS,
    )
    assert tp is not None
    assert tp.at_ambient_boundary
    assert tp.input_scale == 0.0


def test_unreachable_large_threshold_returns_none():
    tp = first_turning_point(
        derivative_threshold=10.0,
        **DIMLESS,
    )
    assert tp is None


def test_turning_power_obeys_temperature_scale_law():
    d0 = ambient_derivative(**DIMLESS)
    dinf = high_temperature_derivative_limit(
        DIMLESS["absorption"], DIMLESS["coupling_low"]
    )
    threshold = 0.5 * (d0 + dinf)
    tp = first_turning_point(
        derivative_threshold=threshold,
        **DIMLESS,
    )
    assert tp is not None

    scale1 = (
        PHYSICAL["coupling_temperature_width"]
        / PHYSICAL["thermal_gain"]
    )
    lam = 2.3
    scale2 = (
        PHYSICAL["coupling_temperature_width"] * lam
        / (PHYSICAL["thermal_gain"] * lam)
    )
    assert np.isclose(scale1, scale2, rtol=1e-14, atol=1e-14)

    p1 = scale1 * tp.input_scale
    p2 = scale2 * tp.input_scale
    assert np.isclose(p1, p2, rtol=1e-14, atol=1e-14)
