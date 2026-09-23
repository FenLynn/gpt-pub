"""Small-strain 2D thermoelastic reference cell.

The solver uses constant-strain triangular elements under plane-stress
kinematics.  Two circular inclusions are embedded in a rectangular matrix.
All quantities can be dimensionless; only ratios matter for the reported
surface-gap transfer factor.

This is a mechanics utility.  It does not encode optical or project-specific
interpretation.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.sparse import coo_matrix, csr_matrix
from scipy.sparse.linalg import spsolve


@dataclass(frozen=True)
class CellResult:
    nodes: np.ndarray
    displacement: np.ndarray
    left_center_displacement: float
    right_center_displacement: float
    surface_gap_change: float
    transfer_factor: float


def _plane_stress_matrix(young: float, poisson: float) -> np.ndarray:
    e = float(young)
    nu = float(poisson)
    if e <= 0.0:
        raise ValueError("young modulus must be positive")
    if not (-0.99 < nu < 0.49):
        raise ValueError("poisson ratio outside supported range")
    scale = e / (1.0 - nu * nu)
    return scale * np.array(
        [
            [1.0, nu, 0.0],
            [nu, 1.0, 0.0],
            [0.0, 0.0, 0.5 * (1.0 - nu)],
        ],
        dtype=float,
    )


def structured_triangles(
    half_width: float,
    half_height: float,
    nx: int,
    ny: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Create a symmetric rectangular triangular mesh."""
    if half_width <= 0.0 or half_height <= 0.0:
        raise ValueError("half dimensions must be positive")
    if nx < 9 or ny < 9:
        raise ValueError("nx and ny must be >= 9")

    xs = np.linspace(-float(half_width), float(half_width), int(nx))
    ys = np.linspace(-float(half_height), float(half_height), int(ny))
    xx, yy = np.meshgrid(xs, ys, indexing="xy")
    nodes = np.column_stack([xx.ravel(), yy.ravel()])

    elements: list[tuple[int, int, int]] = []
    for j in range(ny - 1):
        for i in range(nx - 1):
            n00 = j * nx + i
            n10 = n00 + 1
            n01 = n00 + nx
            n11 = n01 + 1
            if (i + j) % 2 == 0:
                elements.extend([(n00, n10, n11), (n00, n11, n01)])
            else:
                elements.extend([(n00, n10, n01), (n10, n11, n01)])
    return nodes, np.asarray(elements, dtype=int)


def _triangle_B(coords: np.ndarray) -> tuple[np.ndarray, float]:
    x1, y1 = coords[0]
    x2, y2 = coords[1]
    x3, y3 = coords[2]
    twice_area = (
        x1 * (y2 - y3)
        + x2 * (y3 - y1)
        + x3 * (y1 - y2)
    )
    if abs(twice_area) < 1e-14:
        raise ValueError("degenerate triangle")
    area = 0.5 * abs(twice_area)
    orientation = 1.0 if twice_area > 0.0 else -1.0
    b = orientation * np.array([y2 - y3, y3 - y1, y1 - y2])
    c = orientation * np.array([x3 - x2, x1 - x3, x2 - x1])
    B = np.array(
        [
            [b[0], 0.0, b[1], 0.0, b[2], 0.0],
            [0.0, c[0], 0.0, c[1], 0.0, c[2]],
            [c[0], b[0], c[1], b[1], c[2], b[2]],
        ],
        dtype=float,
    ) / (2.0 * area)
    return B, area


def _nearest_node(nodes: np.ndarray, target: tuple[float, float]) -> int:
    delta = nodes - np.asarray(target, dtype=float)
    return int(np.argmin(np.sum(delta * delta, axis=1)))


def solve_two_inclusion_cell(
    radius: float = 1.0,
    center_gap: float = 0.0,
    half_width: float = 4.0,
    half_height: float = 3.0,
    nx: int = 61,
    ny: int = 47,
    matrix_young: float = 1.0,
    matrix_poisson: float = 0.35,
    matrix_alpha: float = 1.0,
    inclusion_young: float = 1000.0,
    inclusion_poisson: float = 0.17,
    inclusion_alpha: float = 0.01,
    delta_temperature: float = 1.0,
) -> CellResult:
    """Solve a free-expansion reference cell with two circular inclusions.

    Minimal constraints remove rigid translation and rotation only:
    the lower-left corner is fixed in x/y and the lower-right corner in y.

    The reported surface-gap change is center-separation change minus the
    free radial expansion of both inclusions.  The transfer factor is

        C = Delta(gap) / [2*r*(alpha_matrix-alpha_inclusion)*DeltaT].

    It is geometry- and boundary-condition-dependent by construction.
    """
    r = float(radius)
    gap = float(center_gap)
    if r <= 0.0 or gap < 0.0:
        raise ValueError("radius must be positive and center_gap non-negative")
    center_offset = r + 0.5 * gap
    if center_offset + r >= half_width:
        raise ValueError("inclusions do not fit inside half_width")
    if r >= half_height:
        raise ValueError("inclusions do not fit inside half_height")

    nodes, elements = structured_triangles(
        half_width, half_height, nx, ny
    )
    ndof = 2 * len(nodes)

    Dm = _plane_stress_matrix(matrix_young, matrix_poisson)
    Di = _plane_stress_matrix(inclusion_young, inclusion_poisson)
    eth_m = float(matrix_alpha) * float(delta_temperature) * np.array(
        [1.0, 1.0, 0.0]
    )
    eth_i = float(inclusion_alpha) * float(delta_temperature) * np.array(
        [1.0, 1.0, 0.0]
    )

    rows: list[int] = []
    cols: list[int] = []
    vals: list[float] = []
    force = np.zeros(ndof, dtype=float)

    left_center = np.array([-center_offset, 0.0])
    right_center = np.array([center_offset, 0.0])

    for tri in elements:
        coords = nodes[tri]
        centroid = np.mean(coords, axis=0)
        in_left = np.sum((centroid - left_center) ** 2) <= r * r
        in_right = np.sum((centroid - right_center) ** 2) <= r * r
        inclusion = bool(in_left or in_right)
        D = Di if inclusion else Dm
        eth = eth_i if inclusion else eth_m

        B, area = _triangle_B(coords)
        ke = area * (B.T @ D @ B)
        fe = area * (B.T @ D @ eth)

        dofs = np.array(
            [
                2 * tri[0], 2 * tri[0] + 1,
                2 * tri[1], 2 * tri[1] + 1,
                2 * tri[2], 2 * tri[2] + 1,
            ],
            dtype=int,
        )
        force[dofs] += fe
        rr, cc = np.meshgrid(dofs, dofs, indexing="ij")
        rows.extend(rr.ravel().tolist())
        cols.extend(cc.ravel().tolist())
        vals.extend(ke.ravel().tolist())

    K = coo_matrix((vals, (rows, cols)), shape=(ndof, ndof)).tocsr()

    lower_left = _nearest_node(nodes, (-half_width, -half_height))
    lower_right = _nearest_node(nodes, (half_width, -half_height))
    fixed = np.array(
        [2 * lower_left, 2 * lower_left + 1, 2 * lower_right + 1],
        dtype=int,
    )
    free_mask = np.ones(ndof, dtype=bool)
    free_mask[fixed] = False
    free = np.flatnonzero(free_mask)

    u = np.zeros(ndof, dtype=float)
    Kff: csr_matrix = K[free][:, free]
    u[free] = spsolve(Kff, force[free])
    displacement = u.reshape((-1, 2))

    left_node = _nearest_node(nodes, (-center_offset, 0.0))
    right_node = _nearest_node(nodes, (center_offset, 0.0))
    ux_left = float(displacement[left_node, 0])
    ux_right = float(displacement[right_node, 0])

    center_separation_change = ux_right - ux_left
    free_diameter_change = (
        2.0 * r * float(inclusion_alpha) * float(delta_temperature)
    )
    surface_gap_change = center_separation_change - free_diameter_change

    denominator = (
        2.0
        * r
        * (float(matrix_alpha) - float(inclusion_alpha))
        * float(delta_temperature)
    )
    if abs(denominator) < 1e-15:
        transfer = np.nan
    else:
        transfer = surface_gap_change / denominator

    return CellResult(
        nodes=nodes,
        displacement=displacement,
        left_center_displacement=ux_left,
        right_center_displacement=ux_right,
        surface_gap_change=float(surface_gap_change),
        transfer_factor=float(transfer),
    )
