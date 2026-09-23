from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / "src"))

from power_flow import (  # noqa: E402
    mean_transfer_kernel,
    radial_diffusion_matrix,
    solve_power_flow,
)
from transport import dimensionless_transfer_kernel  # noqa: E402


def test_radial_mixing_conserves_weight_and_uniform_state():
    _, volumes, L = radial_diffusion_matrix(80)
    ones = np.ones(80)
    assert np.allclose(L @ ones, 0.0, atol=2e-12)
    assert np.allclose(volumes @ L, 0.0, atol=2e-12)


def test_angle_reduced_kernel_matches_full_phase_space_integral():
    beta_max = np.deg2rad(10.0)
    reduced = mean_transfer_kernel(
        beta_max, 0.9, 0.1, n_cells=240, n_impact=128
    )
    full = dimensionless_transfer_kernel(
        beta_max, 0.9, 0.1, n_beta=128, n_impact=128
    )
    assert np.isclose(reduced, full, rtol=2e-5)


def test_zero_mixing_matches_independent_channel_solution():
    beta_max = np.deg2rad(10.0)
    zeta = np.array([0.0, 1.0, 5.0, 20.0])
    result = solve_power_flow(
        beta_max,
        0.9,
        0.1,
        mixing_mu=0.0,
        zeta=zeta,
        n_cells=100,
        n_impact=96,
    )
    volumes = result["volumes"]
    q = result["q"]
    norm = np.sum(volumes)

    expected_power = np.array(
        [np.sum(volumes * np.exp(-q * z)) / norm for z in zeta]
    )
    expected_kernel = np.array(
        [
            np.sum(volumes * q * np.exp(-q * z))
            / np.sum(volumes * np.exp(-q * z))
            for z in zeta
        ]
    )
    assert np.allclose(result["power"], expected_power, rtol=2e-10, atol=1e-12)
    assert np.allclose(result["kernel"], expected_kernel, rtol=2e-10, atol=1e-12)


def test_zero_mixing_effective_kernel_decreases():
    result = solve_power_flow(
        np.deg2rad(10.0),
        0.9,
        0.1,
        mixing_mu=0.0,
        zeta=np.array([0.0, 1.0, 5.0, 10.0, 20.0, 50.0]),
        n_cells=100,
        n_impact=96,
    )
    assert np.all(np.diff(result["kernel"]) < 0.0)


def test_mixing_suppresses_selective_depletion():
    zeta = np.array([0.0, 10.0, 20.0, 50.0])
    weak = solve_power_flow(
        np.deg2rad(10.0),
        0.9,
        0.1,
        mixing_mu=0.0,
        zeta=zeta,
        n_cells=100,
        n_impact=96,
    )
    mixed = solve_power_flow(
        np.deg2rad(10.0),
        0.9,
        0.1,
        mixing_mu=0.1,
        zeta=zeta,
        n_cells=100,
        n_impact=96,
    )
    weak_drop = weak["kernel"][0] - weak["kernel"][-1]
    mixed_drop = mixed["kernel"][0] - mixed["kernel"][-1]
    assert 0.0 < mixed_drop < weak_drop


def test_strong_mixing_approaches_single_exponential_rate():
    zeta = np.array([0.0, 5.0, 20.0, 50.0])
    result = solve_power_flow(
        np.deg2rad(10.0),
        0.9,
        0.1,
        mixing_mu=5.0,
        zeta=zeta,
        n_cells=100,
        n_impact=96,
    )
    relative_span = (
        np.max(result["kernel"]) - np.min(result["kernel"])
    ) / result["kernel"][0]
    assert relative_span < 2e-3


def test_power_derivative_matches_effective_kernel():
    z0 = 7.0
    h = 1e-3
    result = solve_power_flow(
        np.deg2rad(10.0),
        0.9,
        0.1,
        mixing_mu=0.03,
        zeta=np.array([z0 - h, z0, z0 + h]),
        n_cells=100,
        n_impact=96,
    )
    derivative = -(
        np.log(result["power"][2]) - np.log(result["power"][0])
    ) / (2.0 * h)
    assert np.isclose(derivative, result["kernel"][1], rtol=2e-7)
