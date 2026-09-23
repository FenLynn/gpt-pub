"""Reduced thermal-optical closed loop with an optional interface transition.

The optical input is a monotone table q(T), where q=k*L is the dimensionless
coupling strength supplied by the existing curved-gap Maxwell kernel.

For the smooth branch:
    theta = H * p * A[q(theta)]
where A=1-P_res is the absorbed fraction from the coupled-power model.

If q(theta) is non-increasing and A(q) is non-decreasing, the right-hand side
is non-increasing in theta.  Hence the scalar steady state is unique.

An optional irreversible interface event is represented by a second optical
table and a critical free-opening threshold.  The transition itself is not
an optical fit; it is a state switch whose threshold can be supplied by a
cohesive/Griffith criterion.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from curved_gap import curved_phase_space_kernel
from distributed_power import residual_power


@dataclass(frozen=True)
class OpticalTable:
    temperature: np.ndarray
    coupling_length: np.ndarray

    def __post_init__(self) -> None:
        t = np.asarray(self.temperature, dtype=float)
        q = np.asarray(self.coupling_length, dtype=float)
        if t.ndim != 1 or q.ndim != 1 or len(t) != len(q) or len(t) < 2:
            raise ValueError("temperature and coupling_length must be equal 1D grids")
        if np.any(np.diff(t) <= 0.0):
            raise ValueError("temperature grid must be strictly increasing")
        if np.any(q < 0.0):
            raise ValueError("coupling_length must be non-negative")

    def at(self, temperature: float) -> float:
        t = np.asarray(self.temperature, dtype=float)
        q = np.asarray(self.coupling_length, dtype=float)
        value = float(temperature)
        if value < t[0] or value > t[-1]:
            raise ValueError("temperature outside optical table")
        return float(np.interp(value, t, q))


def build_curved_optical_table(
    temperature: np.ndarray,
    beta_max_rad: float,
    index_ratio: float,
    radius_optical: float,
    gap0_optical: float,
    gap_per_temperature: float,
    coupling_scale: float,
    extra_gap_optical: float = 0.0,
    n_beta: int = 32,
    n_impact: int = 32,
    n_phi: int = 64,
) -> OpticalTable:
    """Map temperature to q=k*L using the curved Maxwell kernel."""
    temps = np.asarray(temperature, dtype=float)
    if temps.ndim != 1 or len(temps) < 2 or np.any(np.diff(temps) <= 0.0):
        raise ValueError("temperature must be a strictly increasing 1D grid")
    scale = float(coupling_scale)
    if scale < 0.0:
        raise ValueError("coupling_scale must be non-negative")

    values = []
    for temp in temps:
        gap = (
            float(gap0_optical)
            + float(gap_per_temperature) * float(temp)
            + float(extra_gap_optical)
        )
        values.append(
            scale
            * curved_phase_space_kernel(
                float(beta_max_rad),
                float(index_ratio),
                float(radius_optical),
                gap,
                n_beta=n_beta,
                n_impact=n_impact,
                n_phi=n_phi,
            )
        )
    return OpticalTable(temps.copy(), np.asarray(values, dtype=float))


def absorbed_fraction(coupling_length: float, absorption_length: float) -> float:
    return 1.0 - residual_power(coupling_length, absorption_length)


def _balance(
    temperature: float,
    pump_drive: float,
    thermal_gain: float,
    absorption_length: float,
    table: OpticalTable,
) -> float:
    absorbed = absorbed_fraction(table.at(temperature), absorption_length)
    return temperature - float(thermal_gain) * float(pump_drive) * absorbed


def smooth_equilibrium(
    pump_drive: float,
    thermal_gain: float,
    absorption_length: float,
    table: OpticalTable,
    tolerance: float = 1e-9,
    max_iterations: int = 100,
) -> tuple[float, float, float]:
    """Return temperature rise, residual fraction, and q for the unique branch."""
    p = float(pump_drive)
    h = float(thermal_gain)
    if p < 0.0 or h < 0.0 or absorption_length < 0.0:
        raise ValueError("drives and absorption_length must be non-negative")
    if tolerance <= 0.0:
        raise ValueError("tolerance must be positive")

    tgrid = np.asarray(table.temperature, dtype=float)
    lo = float(tgrid[0])
    hi = float(tgrid[-1])
    flo = _balance(lo, p, h, absorption_length, table)
    fhi = _balance(hi, p, h, absorption_length, table)

    if abs(flo) <= tolerance:
        temp = lo
    else:
        if flo > 0.0 or fhi < 0.0:
            raise ValueError("optical table does not bracket the thermal equilibrium")
        for _ in range(int(max_iterations)):
            mid = 0.5 * (lo + hi)
            fm = _balance(mid, p, h, absorption_length, table)
            if abs(fm) <= tolerance or (hi - lo) <= tolerance:
                lo = hi = mid
                break
            if fm > 0.0:
                hi = mid
            else:
                lo = mid
        temp = 0.5 * (lo + hi)

    q = table.at(temp)
    residual = residual_power(q, absorption_length)
    return float(temp), float(residual), float(q)


def critical_opening(stiffness: float, fracture_energy: float) -> float:
    """Return sqrt(2*G/K) for a scalar cohesive spring."""
    k = float(stiffness)
    g = float(fracture_energy)
    if k <= 0.0 or g < 0.0:
        raise ValueError("stiffness must be positive and fracture_energy non-negative")
    return float(np.sqrt(2.0 * g / k))


def irreversible_ramp(
    pump_drive: np.ndarray,
    thermal_gain: float,
    absorption_length: float,
    undamaged: OpticalTable,
    damaged: OpticalTable,
    opening_per_temperature: float,
    preload_opening: float,
    critical_free_opening: float,
) -> dict[str, np.ndarray]:
    """Quasistatic pump ramp with an irreversible interface state switch."""
    pumps = np.asarray(pump_drive, dtype=float)
    if pumps.ndim != 1 or np.any(pumps < 0.0):
        raise ValueError("pump_drive must be a non-negative 1D array")
    if np.any(np.diff(pumps) < 0.0):
        raise ValueError("irreversible_ramp requires non-decreasing pump_drive")

    slope = float(opening_per_temperature)
    bias = float(preload_opening)
    threshold = float(critical_free_opening)
    if slope < 0.0 or threshold < 0.0:
        raise ValueError("opening slope and critical opening must be non-negative")

    temperature = np.empty_like(pumps)
    residual = np.empty_like(pumps)
    coupling = np.empty_like(pumps)
    damage = np.zeros_like(pumps, dtype=bool)

    failed = False
    onset_index = -1

    for i, pump in enumerate(pumps):
        table = damaged if failed else undamaged
        temp, res, q = smooth_equilibrium(
            pump,
            thermal_gain,
            absorption_length,
            table,
        )

        if not failed:
            free_opening = bias + slope * temp
            if free_opening >= threshold:
                failed = True
                onset_index = i
                temp, res, q = smooth_equilibrium(
                    pump,
                    thermal_gain,
                    absorption_length,
                    damaged,
                )

        temperature[i] = temp
        residual[i] = res
        coupling[i] = q
        damage[i] = failed

    return {
        "pump_drive": pumps,
        "temperature": temperature,
        "residual": residual,
        "coupling_length": coupling,
        "damaged": damage,
        "onset_index": np.asarray(onset_index, dtype=int),
    }
