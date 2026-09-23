from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class DistributedResponse:
    state_derivative: np.ndarray
    residual_power_derivative: float


def distributed_response_from_jacobian(
    input_power: float,
    heat_per_power: np.ndarray,
    heat_state_jacobian: np.ndarray,
    residual_fraction: float,
    residual_state_gradient: np.ndarray,
) -> DistributedResponse:
    p = float(input_power)
    h = np.asarray(heat_per_power, dtype=float)
    jh = np.asarray(heat_state_jacobian, dtype=float)
    grad = np.asarray(residual_state_gradient, dtype=float)
    r = float(residual_fraction)

    if p < 0.0:
        raise ValueError("input_power must be non-negative")
    if h.ndim != 1 or grad.ndim != 1 or h.shape != grad.shape:
        raise ValueError("heat_per_power and residual gradient must be equal 1D arrays")
    if jh.shape != (len(h), len(h)):
        raise ValueError("heat_state_jacobian has incompatible shape")
    if not (
        np.all(np.isfinite(h))
        and np.all(np.isfinite(jh))
        and np.all(np.isfinite(grad))
        and np.isfinite(r)
    ):
        raise ValueError("all inputs must be finite")

    system = np.eye(len(h), dtype=float) - p * jh
    state_derivative = np.linalg.solve(system, h)
    derivative = r + p * float(grad @ state_derivative)

    return DistributedResponse(
        state_derivative=state_derivative,
        residual_power_derivative=float(derivative),
    )


def linear_negative_feedback_state(
    input_power: float,
    drive: np.ndarray,
    feedback_matrix: np.ndarray,
) -> np.ndarray:
    p = float(input_power)
    b = np.asarray(drive, dtype=float)
    m = np.asarray(feedback_matrix, dtype=float)
    if p < 0.0:
        raise ValueError("input_power must be non-negative")
    if b.ndim != 1 or m.shape != (len(b), len(b)):
        raise ValueError("incompatible drive / feedback dimensions")
    return p * np.linalg.solve(
        np.eye(len(b), dtype=float) + p * m,
        b,
    )


def linear_negative_feedback_derivative(
    input_power: float,
    drive: np.ndarray,
    feedback_matrix: np.ndarray,
) -> np.ndarray:
    p = float(input_power)
    b = np.asarray(drive, dtype=float)
    m = np.asarray(feedback_matrix, dtype=float)
    if p < 0.0:
        raise ValueError("input_power must be non-negative")
    if b.ndim != 1 or m.shape != (len(b), len(b)):
        raise ValueError("incompatible drive / feedback dimensions")
    a = np.eye(len(b), dtype=float) + p * m
    return np.linalg.solve(a, b - m @ linear_negative_feedback_state(p, b, m))


def feedback_suppression_factor(
    input_power: float,
    feedback_matrix: np.ndarray,
) -> float:
    p = float(input_power)
    m = np.asarray(feedback_matrix, dtype=float)
    if p < 0.0:
        raise ValueError("input_power must be non-negative")
    if m.ndim != 2 or m.shape[0] != m.shape[1]:
        raise ValueError("feedback_matrix must be square")
    if not np.allclose(m, m.T, rtol=1e-12, atol=1e-12):
        raise ValueError("suppression bound requires a symmetric matrix")
    eigenvalues = np.linalg.eigvalsh(m)
    if eigenvalues[0] < -1e-12:
        raise ValueError("suppression bound requires positive semidefinite feedback")
    inverse = np.linalg.inv(np.eye(len(m)) + p * m)
    return float(np.linalg.norm(inverse, ord=2))
