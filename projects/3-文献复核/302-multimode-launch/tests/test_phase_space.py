import math

from scipy.integrate import quad

from src.phase_space import (
    angular_mean_sec,
    angular_mean_tan,
    channel_residual,
    first_crossover_length,
    fit_apparent_coupling,
    impact_cdf,
    impact_pdf,
    mean_collision_shape,
    mean_transfer_factor,
    mean_absorption_factor,
    beta_for_equal_transfer,
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


def test_apparent_coupling_can_reverse_launch_ranking_with_length():
    core_ratio = 0.3
    absorption = 5.0 * core_ratio**2

    short_z = 0.2
    k_full_short = fit_apparent_coupling(
        residual_fraction(1.0, short_z, 1.0, 5.0, core_ratio), absorption, short_z
    )
    k_under_short = fit_apparent_coupling(
        residual_fraction(0.84, short_z, 1.0, 5.0, core_ratio), absorption, short_z
    )
    assert k_under_short < k_full_short

    long_z = 5.0
    k_full_long = fit_apparent_coupling(
        residual_fraction(1.0, long_z, 1.0, 5.0, core_ratio), absorption, long_z
    )
    k_under_long = fit_apparent_coupling(
        residual_fraction(0.84, long_z, 1.0, 5.0, core_ratio), absorption, long_z
    )
    assert k_under_long > k_full_long
    assert k_under_long / k_full_long > 1.15


def test_separable_launch_factors():
    beta = math.radians(18.5)
    c = 0.3
    assert mean_transfer_factor(0.84, beta) < mean_transfer_factor(1.0, beta)
    assert mean_absorption_factor(0.84, beta, c) > mean_absorption_factor(1.0, beta, c)


def test_spatial_underfill_can_be_compensated_by_larger_angular_fill():
    beta_ref = math.radians(18.5)
    beta_test = beta_for_equal_transfer(1.0, beta_ref, 0.84)
    assert abs(mean_transfer_factor(0.84, beta_test) / mean_transfer_factor(1.0, beta_ref) - 1.0) < 1e-11
    na_ratio = math.sin(beta_test) / math.sin(beta_ref)
    assert abs(na_ratio - 1.1197156342419028) < 2e-10
