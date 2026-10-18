from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / "src"))

from distributed_feedback import (  # noqa: E402
    distributed_response_from_jacobian,
    feedback_suppression_factor,
    implicit_fixed_point_response,
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



def test_general_fixed_point_response_matches_direct_finite_difference():
    # x = H(P,x) = tanh(B x + c P), componentwise.
    B = np.array([[0.10, 0.03], [0.02, 0.08]])
    c = np.array([0.4, 0.25])
    grad = np.array([0.03, 0.05])
    explicit = 0.002

    def solve_state(power):
        x = np.zeros(2)
        for _ in range(200):
            new = np.tanh(B @ x + c * power)
            if np.linalg.norm(new - x) < 1e-14:
                return new
            x = new
        raise RuntimeError("fixed point did not converge")

    def residual_fraction(power):
        x = solve_state(power)
        return 0.02 + explicit * power + float(grad @ x)

    power = 1.7
    x = solve_state(power)
    argument = B @ x + c * power
    sech2 = 1.0 - np.tanh(argument) ** 2
    jx = np.diag(sech2) @ B
    hp = sech2 * c
    residual = residual_fraction(power)

    response = implicit_fixed_point_response(
        input_power=power,
        fixed_point_state_jacobian=jx,
        fixed_point_power_derivative=hp,
        residual_fraction=residual,
        residual_state_gradient=grad,
        residual_explicit_power_derivative=explicit,
    )

    h = 1e-5
    numerical_state = (
        solve_state(power + h) - solve_state(power - h)
    ) / (2.0 * h)
    numerical_absolute = (
        (power + h) * residual_fraction(power + h)
        - (power - h) * residual_fraction(power - h)
    ) / (2.0 * h)

    assert np.allclose(
        response.state_derivative,
        numerical_state,
        rtol=2e-8,
        atol=2e-9,
    )
    assert np.isclose(
        response.residual_power_derivative,
        numerical_absolute,
        rtol=2e-8,
        atol=2e-9,
    )


def test_linear_per_power_formula_is_special_case_of_general_fixed_point():
    power = 2.0
    drive = np.array([1.0, 0.6])
    matrix = np.array([[0.3, 0.05], [0.05, 0.2]])
    gradient = np.array([0.04, 0.02])
    state = linear_negative_feedback_state(power, drive, matrix)

    # H(P,x) = P (drive - M x)
    jx = -power * matrix
    hp = drive - matrix @ state
    residual = 0.01 + float(gradient @ state)

    general = implicit_fixed_point_response(
        input_power=power,
        fixed_point_state_jacobian=jx,
        fixed_point_power_derivative=hp,
        residual_fraction=residual,
        residual_state_gradient=gradient,
    )
    special = distributed_response_from_jacobian(
        input_power=power,
        heat_per_power=hp,
        heat_state_jacobian=-matrix,
        residual_fraction=residual,
        residual_state_gradient=gradient,
    )

    assert np.allclose(
        general.state_derivative,
        special.state_derivative,
        rtol=2e-13,
        atol=2e-13,
    )
    assert np.isclose(
        general.residual_power_derivative,
        special.residual_power_derivative,
        rtol=2e-13,
        atol=2e-13,
    )
