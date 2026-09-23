import math

import numpy as np
from scipy.integrate import quad

from src.robustness import (
    calibrated_absorption_profile,
    dimensionless_residual,
    launch_difference,
    occupied_phase_space_fraction,
    selectivity_boundary,
    small_signal_cladding_absorption,
)
from src.phase_space import impact_pdf


def test_occupied_phase_space_fraction():
    assert abs(occupied_phase_space_fraction(0.84, 1.0) - 0.7056) < 1e-14
    assert abs(occupied_phase_space_fraction(0.84, 0.5) - 0.1764) < 1e-14


def test_absorption_profile_has_unit_full_fill_mean():
    core_ratio = 0.12
    for uniform_fraction in (0.0, 0.3, 0.7, 1.0):
        value, _ = quad(
            lambda x: impact_pdf(x, 1.0)
            * calibrated_absorption_profile(
                np.array([x]),
                core_ratio,
                uniform_fraction,
            )[0],
            0.0,
            1.0,
            epsabs=1e-9,
            epsrel=1e-9,
            limit=300,
        )
        assert abs(value - 1.0) < 3e-8


def test_small_signal_cladding_absorption():
    alpha = small_signal_cladding_absorption(
        0.12,
        2.18e-24,
        4.0e25,
    )
    assert abs(alpha - 1.25568) < 1e-12


def test_selective_and_uniform_absorption_give_opposite_launch_ordering():
    args = dict(
        test_fill=0.84,
        reference_fill=1.0,
        coupling_depth=10.0,
        absorption_depth=6.2784,
        core_ratio=0.12,
        mixing_depth=0.0,
        bins=72,
    )
    selective = launch_difference(
        uniform_absorption_fraction=0.0,
        **args,
    )
    uniform = launch_difference(
        uniform_absorption_fraction=1.0,
        **args,
    )
    assert selective < 0.0
    assert uniform > 0.0


def test_selectivity_boundary_in_canonical_case():
    boundary = selectivity_boundary(
        0.84,
        1.0,
        10.0,
        6.2784,
        0.12,
        0.0,
        bins=72,
    )
    assert boundary is not None
    assert 0.65 < boundary < 0.80


def test_strong_mixing_suppresses_launch_difference():
    args = dict(
        coupling_depth=10.0,
        absorption_depth=6.2784,
        core_ratio=0.12,
        uniform_absorption_fraction=0.0,
        bins=72,
    )
    weak = abs(
        dimensionless_residual(0.84, mixing_depth=0.0, **args)
        - dimensionless_residual(1.0, mixing_depth=0.0, **args)
    )
    strong = abs(
        dimensionless_residual(0.84, mixing_depth=40.0, **args)
        - dimensionless_residual(1.0, mixing_depth=40.0, **args)
    )
    assert strong < 0.08 * weak
