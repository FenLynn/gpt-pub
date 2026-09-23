from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / "src"))

from phenomenological_identifiability import (  # noqa: E402
    log_sensitivity_audit,
    physical_residual_fraction,
    residual_fraction_at_input_scale,
    solve_x_for_input_scale,
)
from phenomenological_map import dimensionless_state  # noqa: E402


PARAMS = dict(
    absorption=17.5,
    coupling_high=7.0,
    coupling_low=0.1,
    ambient_offset=8.0,
)


def test_input_scale_inversion_matches_parametric_state():
    for x in [-4.0, -1.0, 0.0, 1.0, 3.0]:
        state = dimensionless_state(x=x, **PARAMS)
        recovered = solve_x_for_input_scale(
            state.input_scale, **PARAMS
        )
        assert np.isclose(recovered, x, rtol=0.0, atol=2e-10)
        residual = residual_fraction_at_input_scale(
            state.input_scale, **PARAMS
        )
        assert np.isclose(
            residual, state.residual_fraction, rtol=2e-12, atol=2e-12
        )


def test_power_axis_rescaling_preserves_curve():
    q = 120.0
    scale = 2.7
    for P in [30.0, 100.0, 300.0, 900.0, 1800.0]:
        y1 = physical_residual_fraction(
            input_power=P,
            power_scale=q,
            **PARAMS,
        )
        y2 = physical_residual_fraction(
            input_power=P * scale,
            power_scale=q * scale,
            **PARAMS,
        )
        assert np.isclose(y1, y2, rtol=2e-12, atol=2e-12)


def test_log_sensitivity_audit_has_expected_shape_and_finite_values():
    audit = log_sensitivity_audit(
        input_powers=np.array(
            [20.0, 50.0, 100.0, 200.0, 400.0, 800.0, 1600.0]
        ),
        power_scale=120.0,
        **PARAMS,
    )
    assert audit.matrix.shape == (7, 5)
    assert audit.singular_values.shape == (5,)
    assert np.all(np.isfinite(audit.matrix))
    assert np.all(np.isfinite(audit.singular_values))
    assert audit.singular_values[0] >= audit.singular_values[-1] >= 0.0
    assert audit.condition_number >= 1.0
