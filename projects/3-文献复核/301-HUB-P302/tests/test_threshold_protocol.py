from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / "src"))

from threshold_protocol import (  # noqa: E402
    from_absolute_derivative,
    from_log_slope,
    threshold_metrics,
    normalized_degradation_metrics,
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



def test_log_slope_is_invariant_to_multiplicative_residual_scaling():
    p = 9.0
    r = 0.018
    rp = 0.0032
    base = threshold_metrics(p, r, rp)
    for scale in [0.4, 2.5, 7.0]:
        scaled = threshold_metrics(p, scale * r, scale * rp)
        assert np.isclose(
            scaled.residual_fraction_log_slope,
            base.residual_fraction_log_slope,
            rtol=1e-14,
            atol=1e-14,
        )
        assert np.isclose(
            scaled.residual_power_derivative,
            scale * base.residual_power_derivative,
            rtol=1e-14,
            atol=1e-14,
        )


def test_excess_absolute_derivative_is_invariant_to_additive_baseline():
    p = 9.0
    r = 0.018
    rp = 0.0032
    base = threshold_metrics(p, r, rp)
    base_excess = base.residual_power_derivative - base.residual_fraction

    for offset in [0.01, 0.03, 0.08]:
        shifted = threshold_metrics(p, r + offset, rp)
        shifted_excess = (
            shifted.residual_power_derivative - shifted.residual_fraction
        )
        assert np.isclose(
            shifted_excess,
            base_excess,
            rtol=1e-14,
            atol=1e-14,
        )


def test_absolute_derivative_is_invariant_to_horizontal_power_scaling():
    # R(P) = r0 + a (P/q)^2. At matched normalized coordinate p=P/q,
    # D = R + P dR/dP is independent of q.
    r0 = 0.015
    a = 0.004
    normalized_power = 1.7

    metrics = []
    for q in [0.5, 2.0, 8.0]:
        p = q * normalized_power
        r = r0 + a * normalized_power**2
        rp = 2.0 * a * normalized_power / q
        metrics.append(threshold_metrics(p, r, rp))

    d0 = metrics[0].residual_power_derivative
    s0 = metrics[0].residual_fraction_log_slope
    for item in metrics[1:]:
        assert np.isclose(item.residual_power_derivative, d0, rtol=1e-14)
        assert np.isclose(item.residual_fraction_log_slope, s0, rtol=1e-14)



def test_affine_normalized_metrics_ignore_vertical_offset_and_scale():
    p = 8.0
    rlo = 0.02
    rhi = 0.12
    r = 0.065
    rp = 0.009

    base = normalized_degradation_metrics(
        input_power=p,
        residual_fraction=r,
        residual_fraction_derivative=rp,
        low_plateau=rlo,
        high_plateau=rhi,
    )

    for offset, scale in [(0.03, 2.5), (-0.01, 0.7), (0.2, 4.0)]:
        transformed = normalized_degradation_metrics(
            input_power=p,
            residual_fraction=offset + scale * r,
            residual_fraction_derivative=scale * rp,
            low_plateau=offset + scale * rlo,
            high_plateau=offset + scale * rhi,
        )
        assert np.isclose(
            transformed.normalized_residual,
            base.normalized_residual,
            rtol=1e-14,
            atol=1e-14,
        )
        assert np.isclose(
            transformed.log_power_derivative,
            base.log_power_derivative,
            rtol=1e-14,
            atol=1e-14,
        )


def test_affine_normalized_metrics_ignore_horizontal_scale_at_matched_coordinate():
    # u(p) = logistic-like normalized response at matched x=P/q.
    x = 1.4
    rlo = 0.02
    rhi = 0.12
    span = rhi - rlo

    def u(xval):
        return xval**2 / (1.0 + xval**2)

    def du_dx(xval):
        return 2.0 * xval / (1.0 + xval**2) ** 2

    metrics = []
    for q in [0.5, 2.0, 8.0]:
        p = q * x
        r = rlo + span * u(x)
        rp = span * du_dx(x) / q
        metrics.append(
            normalized_degradation_metrics(
                input_power=p,
                residual_fraction=r,
                residual_fraction_derivative=rp,
                low_plateau=rlo,
                high_plateau=rhi,
            )
        )

    u0 = metrics[0].normalized_residual
    psi0 = metrics[0].log_power_derivative
    for item in metrics[1:]:
        assert np.isclose(item.normalized_residual, u0, rtol=1e-14)
        assert np.isclose(item.log_power_derivative, psi0, rtol=1e-14)
