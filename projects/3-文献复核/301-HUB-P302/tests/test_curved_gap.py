from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / "src"))

from curved_gap import (  # noqa: E402
    arc_transfer_average,
    curved_phase_space_kernel,
    local_curved_gap,
    thermal_mismatch_gap_scale,
)
from ftir import slab_rt  # noqa: E402


def test_curved_gap_geometry_at_contact_and_quadratic_limit():
    rho = 100.0
    phi = np.array([0.0, 1e-4, 2e-4])
    gap = local_curved_gap(phi, rho, 0.0)
    assert gap[0] == 0.0
    expected = rho * phi[1:] ** 2
    assert np.allclose(gap[1:], expected, rtol=1e-8)


def test_nonpenetration_clamp_creates_finite_zero_gap_arc():
    rho = 100.0
    delta = -0.01
    phi_c = np.arccos(1.0 + delta / (2.0 * rho))
    values = local_curved_gap(
        np.array([0.0, 0.5 * phi_c, 1.5 * phi_c]), rho, delta
    )
    assert values[0] == 0.0
    assert values[1] == 0.0
    assert values[2] > 0.0


def test_zero_gap_planar_transmission_has_zero_first_derivative():
    theta = np.deg2rad(80.0)
    eta = 0.9
    h = 1e-5
    t0, _ = slab_rt(1.0, eta, 1.0, theta, 0.0, "TE")
    t1, _ = slab_rt(1.0, eta, 1.0, theta, h, "TE")
    t2, _ = slab_rt(1.0, eta, 1.0, theta, 2.0 * h, "TE")
    assert np.isclose(t0, 1.0, atol=1e-13)
    first = (t1 - t0) / h
    second_first = (t2 - t0) / (2.0 * h)
    assert abs(first) < 2e-3
    assert abs(second_first) < 4e-3


def test_arc_transfer_is_continuous_through_contact_loss():
    theta = np.deg2rad(80.0)
    vals = [
        float(arc_transfer_average(theta, 0.9, 100.0, d, n_phi=256))
        for d in (-1e-4, 0.0, 1e-4)
    ]
    left_slope = (vals[1] - vals[0]) / 1e-4
    right_slope = (vals[2] - vals[1]) / 1e-4
    scale = max(1.0, abs(left_slope), abs(right_slope))
    assert abs(left_slope - right_slope) / scale < 2e-2


def test_curved_kernel_decreases_smoothly_with_opening():
    values = [
        curved_phase_space_kernel(
            np.deg2rad(10.0),
            0.9,
            100.0,
            d,
            n_beta=36,
            n_impact=36,
            n_phi=96,
        )
        for d in (-0.02, 0.0, 0.02, 0.1, 0.3)
    ]
    assert np.all(np.diff(values) < 0.0)
    assert np.all(np.asarray(values) > 0.0)


def test_large_radius_tangent_kernel_scales_near_inverse_sqrt_radius():
    radii = np.array([50.0, 100.0, 200.0, 400.0])
    values = np.array([
        curved_phase_space_kernel(
            np.deg2rad(10.0),
            0.9,
            rho,
            0.0,
            n_beta=36,
            n_impact=36,
            n_phi=128,
        )
        for rho in radii
    ])
    scaled = values * np.sqrt(radii)
    assert (np.max(scaled) - np.min(scaled)) / np.mean(scaled) < 0.18


def test_affine_thermal_mismatch_scale():
    value = thermal_mismatch_gap_scale(
        100.0, 80e-6, 0.55e-6, 100.0
    )
    assert np.isclose(value, 1.589, rtol=1e-12)
