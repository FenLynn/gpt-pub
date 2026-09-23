from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / "src"))

from ftir import (  # noqa: E402
    critical_angle_rad,
    logistic_target_sensitivity,
    repeated_encounter_rate_factor_from_reflectance,
    slab_rt,
)


def test_zero_gap_is_identity():
    for pol in ("TE", "TM"):
        for theta_deg in (0.0, 30.0, 75.0, 85.0):
            t, r = slab_rt(1.45, 1.38, 1.018, np.deg2rad(theta_deg), 0.0, pol)
            assert np.isclose(t, 1.0, atol=1e-12)
            assert np.isclose(r, 0.0, atol=1e-12)


def test_lossless_energy_conservation_propagating_and_tir():
    for pol in ("TE", "TM"):
        for theta_deg in (20.0, 60.0, 75.0, 85.0):
            t, r = slab_rt(1.45, 1.38, 1.018, np.deg2rad(theta_deg), 0.35, pol)
            assert np.isclose(t + r, 1.0, atol=2e-12)
            assert 0.0 <= t <= 1.0
            assert 0.0 <= r <= 1.0


def test_tir_transmission_decreases_with_gap():
    theta = np.deg2rad(80.0)
    assert theta > critical_angle_rad(1.45, 1.38)
    gaps = np.linspace(0.0, 0.8, 101)
    for pol in ("TE", "TM"):
        t, _ = slab_rt(1.45, 1.38, 1.018, theta, gaps, pol)
        assert np.all(np.diff(t) <= 1e-12)


def test_reference_logistic_target():
    assert np.isclose(logistic_target_sensitivity(0.0016), 312.5)


def test_reference_planar_ftir_is_far_below_target():
    n_high = 1.45
    n_gap = 1.38
    tc = critical_angle_rad(n_high, n_gap)
    theta = np.linspace(tc + 1e-8, np.deg2rad(89.9), 20001)
    w0 = 0.3495
    s = 0.0016
    for pol in ("TE", "TM"):
        tm, _ = slab_rt(n_high, n_gap, 1.018, theta, w0 - s, pol)
        tp, _ = slab_rt(n_high, n_gap, 1.018, theta, w0 + s, pol)
        sensitivity = np.abs(np.log(tp / tm)) / (2 * s)
        assert np.max(sensitivity) < 10.0


def test_repeated_encounter_rate_factor_is_exact():
    r = np.array([0.2, 0.5, 0.9])
    g = repeated_encounter_rate_factor_from_reflectance(r)
    encounters = 7.25
    assert np.allclose(np.exp(-encounters * g), r**encounters)


def test_weak_transfer_rate_factor_reduces_to_transmission():
    t = np.array([1e-6, 1e-5, 1e-4])
    r = 1.0 - t
    g = repeated_encounter_rate_factor_from_reflectance(r)
    assert np.allclose(g, t, rtol=6e-5, atol=0.0)
