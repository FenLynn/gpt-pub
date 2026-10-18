from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path

from phase_space import (
    first_crossover_length,
    mean_collision_shape,
    mean_core_overlap,
    nonabsorbing_floor,
    residual_fraction,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    args = parser.parse_args()

    with open(args.config, 'r', encoding='utf-8') as fh:
        cfg = json.load(fh)

    output_root = Path(os.environ.get('OUTPUT_ROOT', 'output'))
    output_root.mkdir(parents=True, exist_ok=True)

    q0 = float(cfg['q0'])
    a0 = float(cfg['a0'])
    length = float(cfg['length'])
    fills = [float(v) for v in cfg['fills']]
    core_ratios = [float(v) for v in cfg['core_ratios']]

    rows = []
    for core_ratio in core_ratios:
        for fill in fills:
            rows.append({
                'fill': fill,
                'core_ratio': core_ratio,
                'mean_collision': mean_collision_shape(fill),
                'mean_core_overlap': mean_core_overlap(fill, core_ratio),
                'residual': residual_fraction(fill, length, q0, a0, core_ratio),
                'floor': nonabsorbing_floor(fill, core_ratio),
            })

    with open(output_root / 'scan.csv', 'w', newline='', encoding='utf-8') as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    crossover_rows = []
    reference = float(cfg['reference_fill'])
    test_fill = float(cfg['test_fill'])
    for core_ratio in core_ratios:
        crossover_rows.append({
            'reference_fill': reference,
            'test_fill': test_fill,
            'core_ratio': core_ratio,
            'crossover_length': first_crossover_length(
                test_fill, reference, q0, a0, core_ratio,
                z_min=float(cfg.get('z_min', 1e-5)),
                z_max=float(cfg.get('z_max', 1e2)),
            ),
        })

    with open(output_root / 'crossover.csv', 'w', newline='', encoding='utf-8') as fh:
        writer = csv.DictWriter(fh, fieldnames=list(crossover_rows[0].keys()))
        writer.writeheader()
        writer.writerows(crossover_rows)


if __name__ == '__main__':
    main()
