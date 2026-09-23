from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / "src"))

from distributed_feedback import (  # noqa: E402
    distributed_response_from_jacobian,
    feedback_suppression_factor,
    linear_negative_feedback_derivative,
    linear_negative_feedback_state,
)


def _finite_difference_state(power, drive, matrix):
    h = 1e-5 * max(1.0, power)
    return (
        linear_negative_feedback_state(power + h, drive, matrix)
        - linear_negative_feedback_state(power - h, drive, matrix)
    ) / (2.0 * h)


def test_linear_state_derivative_matches_finite_difference():
    drive = np.array([1.0, 0.7, 1.3])
    matrix = np.array(
        [
            [0.30, 0.05, 0.02],
            [0.05, 0.20, 0.03],
            [0.02, 0.03, 0.40],
        ]
    )
    for power in [0.2, 1.0, 4.0]:
        analytic = linear_negative_feedback_derivative(
            power, drive, matrix
        )
        numerical = _finite_difference_state(power, drive, matrix)
        assert np.allclose(
            analytic, numerical, rtol=2e-9, atol=2e-10
        )


def test_general_resolvent_identity_matches_linear_model():
    drive = np.array([1.0, 0.7])
    matrix = np.array([[0.25, 0.04], [0.04, 0.35]])
    gradient = np.array([0.02, 0.05])
    power = 2.5
    state = linear_negative_feedback_state(power, drive, matrix)

    # h(x) = drive - M x, so J_h = -M.
    heat = drive - matrix @ state
    residual = 0.03 + float(gradient @ state)
    response = distributed_response_from_jacobian(
        input_power=power,
        heat_per_power=heat,
        heat_state_jacobian=-matrix,
        residual_fraction=residual,
        residual_state_gradient=gradient,
    )

    state_prime = linear_negative_feedback_derivative(
        power, drive, matrix
    )
    expected = residual + power * float(gradient @ state_prime)
    assert np.allclose(
        response.state_derivative,
        state_prime,
        rtol=2e-12,
        atol=2e-12,
    )
    assert np.isclose(
        response.residual_power_derivative,
        expected,
        rtol=2e-12,
        atol=2e-12,
    )


def test_scalar_limit_recovers_one_over_one_plus_loop_gain():
    power = 3.0
    feedback = 0.4
    factor = feedback_suppression_factor(
        power, np.array([[feedback]])
    )
    assert np.isclose(
        factor,
        1.0 / (1.0 + power * feedback),
        rtol=2e-14,
        atol=2e-14,
    )


def test_symmetric_positive_feedback_operator_suppresses_norm():
    matrix = np.array(
        [
            [0.4, 0.1, 0.0],
            [0.1, 0.3, 0.05],
            [0.0, 0.05, 0.2],
        ]
    )
    for power in [0.0, 0.5, 2.0, 10.0]:
        factor = feedback_suppression_factor(power, matrix)
        assert factor <= 1.0 + 1e-12
        assert factor > 0.0
