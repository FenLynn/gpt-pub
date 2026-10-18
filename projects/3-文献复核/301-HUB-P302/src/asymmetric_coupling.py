from __future__ import annotations

from dataclasses import dataclass
import math


@dataclass(frozen=True)
class AsymmetricOpticalState:
    pump_fraction: float
    active_fraction: float
    absorbed_fraction: float


def asymmetric_coupled_power_fractions(
    coupling_forward: float,
    coupling_reverse: float,
    absorption: float,
    length: float,
) -> AsymmetricOpticalState:
    k1 = float(coupling_forward)
    k2 = float(coupling_reverse)
    a = float(absorption)
    L = float(length)
    if min(k1, k2, a, L) < 0.0:
        raise ValueError("rates and length must be non-negative")
    if L == 0.0:
        return AsymmetricOpticalState(1.0, 0.0, 0.0)

    total = k1 + k2 + a
    disc2 = total * total - 4.0 * k1 * a
    if disc2 < -1e-14:
        raise RuntimeError("negative discriminant")
    disc = math.sqrt(max(0.0, disc2))

    if total == 0.0:
        return AsymmetricOpticalState(1.0, 0.0, 0.0)

    if disc < 1e-12 * max(1.0, total):
        # Defective limit: k2 = 0 and k1 = a > 0.
        e = math.exp(-0.5 * total * L)
        p1 = e
        p2 = k1 * L * e
        absorbed = 1.0 - p1 - p2
    else:
        lam_plus = -0.5 * total + 0.5 * disc
        lam_minus = -0.5 * total - 0.5 * disc
        ep = math.exp(lam_plus * L)
        em = math.exp(lam_minus * L)

        bias = (a + k2 - k1) / disc
        p1 = 0.5 * ((1.0 + bias) * ep + (1.0 - bias) * em)
        p2 = (k1 / disc) * (ep - em)
        absorbed = 1.0 - p1 - p2

    tol = 5e-13
    values = [p1, p2, absorbed]
    clean = []
    for value in values:
        if -tol < value < 0.0:
            value = 0.0
        if 1.0 < value < 1.0 + tol:
            value = 1.0
        clean.append(float(value))

    return AsymmetricOpticalState(
        pump_fraction=clean[0],
        active_fraction=clean[1],
        absorbed_fraction=clean[2],
    )
