import math

from scipy.integrate import quad

from src.phase_space import (
    angular_mean_sec,
    asymmetric_initial_moments,
    asymmetric_channel_active,
    asymmetric_channel_passive,
    asymmetric_equilibrium,
    infer_asymmetric_rates,
    reverse_equilibrium_transfer_fractions,
    short_length_moment_tomography,
    symmetric_initial_moments,
    symmetric_mixture_plateau,
    weighted_dark_fraction,
    weighted_nonabsorbing_residual,
    angular_mean_tan,
    channel_residual,
    first_crossover_length,
    fit_apparent_coupling,
    impact_cdf,
    impact_pdf,
    mean_collision_shape,
    mean_transfer_factor,
    mean_absorption_factor,
    mean_absorption_transfer_product,
    beta_for_equal_transfer,
    bgk_residual_fraction,
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


def test_bgk_zero_mixing_matches_independent_channel_quadrature():
    args = dict(length=2.0, q0=1.0, a0=5.0, core_ratio=0.3)
    exact = residual_fraction(0.84, **args)
    discrete = bgk_residual_fraction(0.84, mixing=0.0, bins=320, **args)
    assert abs(discrete - exact) < 2e-3


def test_strong_mixing_erases_most_launch_memory():
    args = dict(length=5.0, q0=1.0, a0=5.0, core_ratio=0.3, bins=200)
    d0 = abs(
        bgk_residual_fraction(0.84, mixing=0.0, **args)
        - bgk_residual_fraction(1.0, mixing=0.0, **args)
    )
    dstrong = abs(
        bgk_residual_fraction(0.84, mixing=20.0, **args)
        - bgk_residual_fraction(1.0, mixing=20.0, **args)
    )
    assert dstrong < 0.08 * d0


def test_asymmetric_channel_conserves_power():
    q12 = 2.0
    q21 = 0.5
    for z in (0.0, 0.2, 1.0, 5.0):
        p1 = asymmetric_channel_passive(q12, q21, z)
        p2 = asymmetric_channel_active(q12, q21, z)
        assert abs((p1 + p2) - 1.0) < 1e-13


def test_symmetric_channel_has_half_half_plateau():
    p1, p2 = asymmetric_equilibrium(1.7, 1.7)
    assert abs(p1 - 0.5) < 1e-14
    assert abs(p2 - 0.5) < 1e-14


def test_asymmetric_plateau_encodes_directionality():
    q12 = 4.0
    q21 = 1.0
    p1, p2 = asymmetric_equilibrium(q12, q21)
    assert abs(p1 - 0.2) < 1e-14
    assert abs(p2 - 0.8) < 1e-14
    assert abs(asymmetric_channel_passive(q12, q21, 20.0) - p1) < 1e-12


def test_plateau_and_transient_rate_recover_directional_rates():
    q12 = 3.2
    q21 = 0.8
    plateau, _ = asymmetric_equilibrium(q12, q21)
    inferred_q12, inferred_q21 = infer_asymmetric_rates(plateau, q12 + q21)
    assert abs(inferred_q12 - q12) < 1e-14
    assert abs(inferred_q21 - q21) < 1e-14


def test_symmetric_launch_changes_transient_not_plateau():
    # Two different symmetric microscopic rates represent different launch-weighted
    # transient populations; both retain the same 50/50 nonabsorbing equilibrium.
    slow = asymmetric_channel_passive(0.8, 0.8, 0.5)
    fast = asymmetric_channel_passive(1.4, 1.4, 0.5)
    assert slow != fast
    assert abs(asymmetric_channel_passive(0.8, 0.8, 20.0) - 0.5) < 1e-12
    assert abs(asymmetric_channel_passive(1.4, 1.4, 20.0) - 0.5) < 1e-12


def test_fixed_directional_rates_require_reverse_plateau_complementarity():
    f12, f21 = reverse_equilibrium_transfer_fractions(3.0, 1.0)
    assert abs(f12 + f21 - 1.0) < 1e-14
    assert abs(f12 - 0.75) < 1e-14
    assert abs(f21 - 0.25) < 1e-14


def test_dark_channels_shift_symmetric_plateau():
    import numpy as np
    rates = np.array([0.0, 1.0, 2.0])
    weights = np.array([0.2, 0.3, 0.5])
    assert abs(weighted_dark_fraction(rates, weights) - 0.2) < 1e-14
    assert abs(symmetric_mixture_plateau(rates, weights) - 0.6) < 1e-14
    assert abs(weighted_nonabsorbing_residual(rates, weights, 50.0) - 0.6) < 1e-12


def test_no_dark_channels_recover_half_half_plateau():
    import numpy as np
    rates = np.array([0.4, 1.0, 2.0])
    weights = np.array([0.2, 0.3, 0.5])
    assert abs(symmetric_mixture_plateau(rates, weights) - 0.5) < 1e-14


def test_symmetric_initial_derivatives_encode_rate_variance():
    import numpy as np
    rates = np.array([0.5, 1.0, 2.0])
    weights = np.array([0.2, 0.3, 0.5])
    mean, second, variance = symmetric_initial_moments(rates, weights)
    assert abs(mean - np.average(rates, weights=weights)) < 1e-14
    assert abs(second - np.average(rates**2, weights=weights)) < 1e-14
    assert abs(variance - np.average((rates - mean)**2, weights=weights)) < 1e-14


def test_asymmetric_matched_population_recovers_total_rate_variance():
    import numpy as np
    q12 = np.array([0.5, 1.0, 2.0])
    q21 = np.array([0.2, 0.8, 1.0])
    weights = np.array([0.25, 0.25, 0.5])
    m12, m21, var_s = asymmetric_initial_moments(q12, q21, weights)
    s = q12 + q21
    assert abs(m12 - np.average(q12, weights=weights)) < 1e-14
    assert abs(m21 - np.average(q21, weights=weights)) < 1e-14
    assert abs(var_s - np.average((s - np.average(s, weights=weights))**2, weights=weights)) < 1e-14


def test_short_length_moment_tomography_matches_weighted_moments():
    import numpy as np
    q12 = np.array([0.4, 1.0, 1.8])
    q21 = np.array([0.3, 0.7, 1.2])
    absorption = np.array([2.0, 0.5, 3.0])
    weights = np.array([0.2, 0.3, 0.5])
    mean_q, curvature, aq = short_length_moment_tomography(
        q12, q21, absorption, weights
    )
    assert abs(mean_q - np.average(q12, weights=weights)) < 1e-14
    assert abs(curvature - np.average(q12 * (q12 + q21), weights=weights)) < 1e-14
    assert abs(aq - np.average(absorption * q12, weights=weights)) < 1e-14


def test_total_power_quadratic_loss_is_absorption_coupling_moment():
    # For one channel: P_total(L)=1-0.5*a*q12*L^2+O(L^3).
    q12 = 1.2
    q21 = 0.8
    absorption = 3.0
    import numpy as np
    mean_q, curvature, aq = short_length_moment_tomography(
        np.array([q12]),
        np.array([q21]),
        np.array([absorption]),
        np.array([1.0]),
    )
    assert abs(mean_q - q12) < 1e-14
    assert abs(curvature - q12 * (q12 + q21)) < 1e-14
    assert abs(aq - absorption * q12) < 1e-14


def test_underfill_can_reduce_transfer_but_increase_absorption_transfer_cross_moment():
    core_ratio = 0.12
    transfer_ratio = mean_collision_shape(0.84) / mean_collision_shape(1.0)
    cross_ratio = (
        mean_absorption_transfer_product(0.84, core_ratio)
        / mean_absorption_transfer_product(1.0, core_ratio)
    )
    assert abs(transfer_ratio - 0.8856069698734197) < 2e-12
    assert abs(cross_ratio - 1.189573298555148) < 2e-10
    assert transfer_ratio < 1.0
    assert cross_ratio > 1.0
