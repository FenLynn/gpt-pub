import math

from scipy.integrate import quad

from src.phase_space import (
    angular_mean_sec,
    angular_mean_tan,
    channel_residual,
    first_crossover_length,
    impact_cdf,
    impact_pdf,
    mean_collision_shape,
    mean_core_overlap,
    nonabsorbing_floor,
    residual_fraction,
)


def test_impact_pdf_normalization():
    for fill in (1.0, 0.84, 0.8, 0.5):
        value, _ = quad(lambda x: impact_pdf(x, fill), 0.0, fill)
        assert abs(value - 1.0) < 1e-10


def test_impact_cdf_matches_quadrature():
    fill = 0.84
    cut = 0.3
    value, _ = quad(lambda x: impact_pdf(x, fill), 0.0, cut)
    assert abs(value - impact_cdf(cut, fill)) < 1e-10


def test_full_fill_collision_factor():
    assert abs(mean_collision_shape(1.0) - 4.0 / math.pi) < 1e-12


def test_underfill_reduces_mean_collision_factor():
    full = mean_collision_shape(1.0)
    under = mean_collision_shape(0.84)
    assert under < full
    assert abs(under / full - 0.8856069698734197) < 2e-12


def test_full_fill_mean_core_overlap_is_area_ratio():
    for c in (0.1, 0.2, 0.3, 0.5):
        assert abs(mean_core_overlap(1.0, c) - c * c) < 2e-10


def test_underfill_increases_mean_core_overlap():
    for c in (0.15, 0.2, 0.3, 0.4):
        assert mean_core_overlap(0.84, c) > mean_core_overlap(1.0, c)


def test_angular_moments_small_angle_limits():
    beta = 1e-3
    assert abs(angular_mean_tan(beta) / (2.0 * beta / 3.0) - 1.0) < 2e-6
    assert abs(angular_mean_sec(beta) - (1.0 + beta * beta / 4.0)) < 1e-12


def test_zero_absorption_channel_limit():
    q = 0.7
    z = 1.3
    expected = 0.5 * (1.0 + math.exp(-2.0 * q * z))
    assert abs(channel_residual(q, 0.0, z) - expected) < 1e-13


def test_nonabsorbing_floor_decreases_with_underfill():
    c = 0.3
    assert nonabsorbing_floor(0.84, c) < nonabsorbing_floor(1.0, c)


def test_short_length_underfill_has_more_residual_in_baseline():
    c = 0.3
    z = 1e-4
    r_under = residual_fraction(0.84, z, 1.0, 5.0, c)
    r_full = residual_fraction(1.0, z, 1.0, 5.0, c)
    assert r_under > r_full


def test_longer_length_underfill_can_have_less_residual():
    c = 0.3
    z = 5.0
    r_under = residual_fraction(0.84, z, 1.0, 5.0, c)
    r_full = residual_fraction(1.0, z, 1.0, 5.0, c)
    assert r_under < r_full


def test_crossover_exists_for_canonical_case():
    root = first_crossover_length(0.84, 1.0, 1.0, 5.0, 0.3, z_min=1e-4, z_max=20.0)
    assert root is not None
    assert abs(root - 1.079041593657417) < 2e-7
