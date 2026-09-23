from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / "src"))

from closed_loop import (  # noqa: E402
    OpticalTable,
    build_curved_optical_table,
    critical_opening,
    irreversible_ramp,
    smooth_equilibrium,
)


def synthetic_tables():
    temperature = np.linspace(0.0, 200.0, 401)
    undamaged = OpticalTable(
        temperature,
        2.0 * np.exp(-0.012 * temperature),
    )
    damaged = OpticalTable(
        temperature,
        0.22 * np.exp(-0.012 * temperature),
    )
    return undamaged, damaged


def test_cohesive_critical_opening_identity():
    value = critical_opening(8.0, 1.0)
    assert np.isclose(value, 0.5)


def test_smooth_equilibrium_is_single_valued_and_path_independent():
    undamaged, _ = synthetic_tables()
    pumps = np.linspace(0.0, 3.0, 31)
    forward = np.array([
        smooth_equilibrium(p, 80.0, 3.0, undamaged)[0]
        for p in pumps
    ])
    reverse = np.array([
        smooth_equilibrium(p, 80.0, 3.0, undamaged)[0]
        for p in pumps[::-1]
    ])[::-1]
    assert np.allclose(forward, reverse, atol=1e-9)
    assert np.all(np.diff(forward) >= 0.0)


def test_smooth_negative_feedback_has_no_jump_on_fine_ramp():
    undamaged, _ = synthetic_tables()
    pumps = np.linspace(0.0, 3.0, 301)
    residual = np.array([
        smooth_equilibrium(p, 80.0, 3.0, undamaged)[1]
        for p in pumps
    ])
    assert np.max(np.abs(np.diff(residual))) < 0.01


def test_irreversible_transition_creates_output_jump():
    undamaged, damaged = synthetic_tables()
    pumps = np.linspace(0.0, 3.0, 301)
    result = irreversible_ramp(
        pumps,
        thermal_gain=80.0,
        absorption_length=3.0,
        undamaged=undamaged,
        damaged=damaged,
        opening_per_temperature=0.01,
        preload_opening=0.0,
        critical_free_opening=0.5,
    )
    onset = int(result["onset_index"])
    assert 0 < onset < len(pumps)
    jump = result["residual"][onset] - result["residual"][onset - 1]
    assert jump > 0.15
    assert np.all(result["damaged"][onset:])


def test_preload_moves_transition_to_lower_pump():
    undamaged, damaged = synthetic_tables()
    pumps = np.linspace(0.0, 3.0, 301)
    common = dict(
        thermal_gain=80.0,
        absorption_length=3.0,
        undamaged=undamaged,
        damaged=damaged,
        opening_per_temperature=0.01,
        critical_free_opening=0.5,
    )
    straight = irreversible_ramp(
        pumps, preload_opening=0.0, **common
    )
    biased = irreversible_ramp(
        pumps, preload_opening=0.15, **common
    )
    assert int(biased["onset_index"]) < int(straight["onset_index"])


def test_actual_curved_kernel_table_decreases_with_temperature():
    table = build_curved_optical_table(
        np.linspace(0.0, 100.0, 6),
        beta_max_rad=np.deg2rad(10.0),
        index_ratio=0.9,
        radius_optical=100.0,
        gap0_optical=0.0,
        gap_per_temperature=0.001,
        coupling_scale=1200.0,
        n_beta=24,
        n_impact=24,
        n_phi=48,
    )
    assert np.all(np.diff(table.coupling_length) < 0.0)


def test_actual_smooth_closed_loop_is_unique():
    table = build_curved_optical_table(
        np.linspace(0.0, 180.0, 19),
        beta_max_rad=np.deg2rad(10.0),
        index_ratio=0.9,
        radius_optical=100.0,
        gap0_optical=0.0,
        gap_per_temperature=0.001,
        coupling_scale=1500.0,
        n_beta=24,
        n_impact=24,
        n_phi=48,
    )
    result = [
        smooth_equilibrium(p, 80.0, 3.0, table)
        for p in np.linspace(0.0, 3.0, 16)
    ]
    temps = np.array([x[0] for x in result])
    assert np.all(np.diff(temps) >= 0.0)


def test_smooth_negative_feedback_suppresses_thermal_slope():
    undamaged, _ = synthetic_tables()
    gain = 80.0
    absorption_length = 3.0
    pump = 1.4
    step = 1e-4

    tm = smooth_equilibrium(
        pump - step, gain, absorption_length, undamaged
    )[0]
    t0, residual0, _ = smooth_equilibrium(
        pump, gain, absorption_length, undamaged
    )
    tp = smooth_equilibrium(
        pump + step, gain, absorption_length, undamaged
    )[0]

    closed_loop_slope = (tp - tm) / (2.0 * step)
    frozen_absorption_slope = gain * (1.0 - residual0)

    assert t0 > 0.0
    assert closed_loop_slope > 0.0
    assert closed_loop_slope < frozen_absorption_slope
