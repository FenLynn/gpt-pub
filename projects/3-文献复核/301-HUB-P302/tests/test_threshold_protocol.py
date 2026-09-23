from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / "src"))

from threshold_protocol import (  # noqa: E402
    from_absolute_derivative,
    from_log_slope,
    threshold_metrics,
)


def test_protocol_identities_are_exact():
    metrics = threshold_metrics(
        input_power=8.0,
        residual_fraction=0.03,
        residual_fraction_derivative=0.006,
    )
    assert np.isclose(
        metrics.residual_power_derivative,
        0.03 + 8.0 * 0.006,
    )
    assert np.isclose(
        metrics.residual_fraction_log_slope,
        8.0 * 0.006 / 0.03,
    )


def test_li_2026_nominal_threshold_conversion():
    # Li 2026 nominal simulation:
    # P = 13.25 kW, R = 5.93%, dR/dP = 0.8%/kW.
    metrics = threshold_metrics(
        input_power=13.25,
        residual_fraction=0.0593,
        residual_fraction_derivative=0.008,
    )
    assert np.isclose(
        metrics.residual_power_derivative,
        0.1653,
        rtol=0.0,
        atol=1e-12,
    )
    assert np.isclose(
        metrics.residual_fraction_log_slope,
        13.25 * 0.008 / 0.0593,
        rtol=0.0,
        atol=1e-12,
    )


def test_round_trip_from_absolute_derivative():
    original = threshold_metrics(10.0, 0.012, 0.0013)
    recovered = from_absolute_derivative(
        10.0,
        0.012,
        original.residual_power_derivative,
    )
    assert np.isclose(
        recovered.residual_fraction_derivative,
        original.residual_fraction_derivative,
    )
    assert np.isclose(
        recovered.residual_fraction_log_slope,
        original.residual_fraction_log_slope,
    )


def test_round_trip_from_log_slope():
    original = threshold_metrics(10.0, 0.012, 0.0013)
    recovered = from_log_slope(
        10.0,
        0.012,
        original.residual_fraction_log_slope,
    )
    assert np.isclose(
        recovered.residual_fraction_derivative,
        original.residual_fraction_derivative,
    )
    assert np.isclose(
        recovered.residual_power_derivative,
        original.residual_power_derivative,
    )


def test_liu_absolute_threshold_implies_residual_fraction_below_threshold_for_positive_growth():
    p = 9.0
    r = 0.015
    metrics = from_absolute_derivative(
        input_power=p,
        residual_fraction=r,
        residual_power_derivative=0.025,
    )
    assert metrics.residual_fraction_derivative > 0.0
    assert r < 0.025



def test_2023_baseline_exceeds_liu_absolute_threshold():
    # Li et al. 2023 report a low-power residual ratio near 4.05%.
    # If the ratio is locally flat, dP_res/dP equals that baseline ratio,
    # already above the 2.5% absolute-derivative convention used in Liu 2024.
    baseline = threshold_metrics(
        input_power=5.0,
        residual_fraction=0.0405,
        residual_fraction_derivative=0.0,
    )
    assert np.isclose(baseline.residual_power_derivative, 0.0405)
    assert baseline.residual_power_derivative > 0.025
    assert np.isclose(baseline.residual_fraction_log_slope, 0.0)


def test_fixed_absolute_threshold_is_not_baseline_invariant():
    low_baseline = from_absolute_derivative(
        input_power=8.0,
        residual_fraction=0.015,
        residual_power_derivative=0.025,
    )
    high_baseline = from_absolute_derivative(
        input_power=8.0,
        residual_fraction=0.0405,
        residual_power_derivative=0.025,
    )
    assert low_baseline.residual_fraction_derivative > 0.0
    assert high_baseline.residual_fraction_derivative < 0.0
