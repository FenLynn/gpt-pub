from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / "src"))

from thermoelastic_cell import solve_two_inclusion_cell  # noqa: E402


def test_uniform_alpha_has_zero_surface_gap_change():
    result = solve_two_inclusion_cell(
        nx=33,
        ny=25,
        matrix_young=2.0,
        inclusion_young=200.0,
        matrix_alpha=0.8,
        inclusion_alpha=0.8,
    )
    assert abs(result.surface_gap_change) < 5e-3


def test_matrix_expansion_pushes_inclusions_apart():
    result = solve_two_inclusion_cell(
        nx=41,
        ny=31,
        matrix_young=1.0,
        inclusion_young=1000.0,
        matrix_alpha=1.0,
        inclusion_alpha=0.01,
    )
    assert result.surface_gap_change > 0.0
    assert np.isfinite(result.transfer_factor)


def test_solution_is_left_right_symmetric():
    result = solve_two_inclusion_cell(
        nx=41,
        ny=31,
        matrix_young=1.0,
        inclusion_young=500.0,
        matrix_alpha=1.0,
        inclusion_alpha=0.02,
    )
    assert np.isclose(
        result.left_center_displacement,
        -result.right_center_displacement,
        rtol=0.08,
        atol=2e-3,
    )


def test_transfer_factor_is_dimensionless_under_uniform_scaling():
    coarse = solve_two_inclusion_cell(
        radius=1.0,
        half_width=4.0,
        half_height=3.0,
        nx=41,
        ny=31,
        matrix_young=1.0,
        inclusion_young=300.0,
        matrix_alpha=1.0,
        inclusion_alpha=0.02,
    )
    scaled = solve_two_inclusion_cell(
        radius=2.0,
        half_width=8.0,
        half_height=6.0,
        nx=41,
        ny=31,
        matrix_young=1.0,
        inclusion_young=300.0,
        matrix_alpha=1.0,
        inclusion_alpha=0.02,
    )
    assert np.isclose(
        coarse.transfer_factor,
        scaled.transfer_factor,
        rtol=2e-6,
        atol=2e-6,
    )


def test_transfer_factor_converges_with_mesh_refinement():
    a = solve_two_inclusion_cell(
        nx=33,
        ny=25,
        matrix_young=1.0,
        inclusion_young=1000.0,
        matrix_alpha=1.0,
        inclusion_alpha=0.01,
    )
    b = solve_two_inclusion_cell(
        nx=49,
        ny=37,
        matrix_young=1.0,
        inclusion_young=1000.0,
        matrix_alpha=1.0,
        inclusion_alpha=0.01,
    )
    scale = max(abs(a.transfer_factor), abs(b.transfer_factor), 1e-8)
    assert abs(a.transfer_factor - b.transfer_factor) / scale < 0.35
