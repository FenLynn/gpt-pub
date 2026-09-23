from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / "src"))

from transport import (  # noqa: E402
    channel_quadrature,
    depletion_curve,
    dimensionless_transfer_kernel,
    mean_tan_beta,
    zero_gap_kernel,
)


def test_mean_tan_small_angle_limit():
    for beta_max in (1e-3, 2e-3, 5e-3):
        ratio = mean_tan_beta(beta_max) / beta_max
        assert np.isclose(ratio, 2.0 / 3.0, rtol=2e-5)


def test_zero_gap_kernel_matches_numerical_maxwell_limit():
    for deg in (5.0, 10.0, 20.0, 30.0):
        beta_max = np.deg2rad(deg)
        analytic = zero_gap_kernel(beta_max)
        numeric = dimensionless_transfer_kernel(
            beta_max, 0.9, 0.0, n_beta=48, n_impact=48
        )
        assert np.isclose(numeric, analytic, rtol=2e-11, atol=1e-13)


def test_finite_gap_kernel_is_bounded_by_zero_gap():
    beta_max = np.deg2rad(15.0)
    upper = zero_gap_kernel(beta_max)
    for eta in (0.7, 0.9, 0.95):
        for xi in (0.02, 0.1, 0.3):
            value = dimensionless_transfer_kernel(
                beta_max, eta, xi, n_beta=48, n_impact=48
            )
            assert 0.0 < value < upper


def test_gap_kernel_decreases_for_reference_grid():
    beta_max = np.deg2rad(10.0)
    values = [
        dimensionless_transfer_kernel(
            beta_max, 0.9, xi, n_beta=48, n_impact=48
        )
        for xi in (0.0, 0.05, 0.1, 0.2, 0.4)
    ]
    assert np.all(np.diff(values) < 0.0)


def test_channel_mean_matches_integrated_kernel():
    beta_max = np.deg2rad(10.0)
    weights, q = channel_quadrature(
        beta_max, 0.9, 0.1, n_beta=64, n_impact=64
    )
    expected = dimensionless_transfer_kernel(
        beta_max, 0.9, 0.1, n_beta=64, n_impact=64
    )
    assert np.isclose(np.sum(weights * q), expected, rtol=2e-7)


def test_selective_depletion_reduces_effective_kernel():
    beta_max = np.deg2rad(10.0)
    zeta = np.array([0.0, 1.0, 5.0, 10.0, 20.0])
    power, kernel, variance = depletion_curve(
        beta_max, 0.9, 0.1, zeta, n_beta=64, n_impact=64
    )
    assert np.isclose(power[0], 1.0, atol=1e-12)
    assert np.all(np.diff(power) < 0.0)
    assert np.all(np.diff(kernel) < 0.0)
    assert np.all(variance > 0.0)


def test_depletion_derivative_equals_negative_variance():
    beta_max = np.deg2rad(10.0)
    z0 = 7.0
    h = 1e-3
    _, km, _ = depletion_curve(
        beta_max, 0.9, 0.1, np.array([z0 - h]), n_beta=72, n_impact=72
    )
    _, kp, _ = depletion_curve(
        beta_max, 0.9, 0.1, np.array([z0 + h]), n_beta=72, n_impact=72
    )
    _, _, var = depletion_curve(
        beta_max, 0.9, 0.1, np.array([z0]), n_beta=72, n_impact=72
    )
    derivative = (kp[0] - km[0]) / (2.0 * h)
    assert np.isclose(derivative, -var[0], rtol=3e-5, atol=1e-9)
