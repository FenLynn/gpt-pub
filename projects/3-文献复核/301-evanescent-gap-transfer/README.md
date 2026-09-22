# PUB-P301｜Evanescent gap-transfer benchmark

## Purpose

This project independently tests whether a nanometre-scale coupling cliff can arise from **planar frustrated total internal reflection (FTIR)** alone in a symmetric high-index / low-index / high-index dielectric gap.

The calculation is intentionally generic and public. It does not encode any private geometry, experiment, project identifier, or unpublished parameter set.

## Reproduction target

The primary benchmark asks whether a normalized coupling law that changes from

[
rac{e}{1+e}approx 0.7311
quad	ext{to}quad
rac{1}{1+e}approx 0.2689
]

across a total gap change of (3.2,mathrm{nm}) can be reproduced by exact Maxwell transmission through a passive dielectric gap near a (1,mumathrm{m}) wavelength.

This target is equivalent to an average logarithmic sensitivity

[
S_{mathrm{target}}
=
rac{left|ln(0.2689/0.7311)ight|}{3.2,mathrm{nm}}
=
312.5,mumathrm{m}^{-1}.
]

## Method

The first stage uses the exact 2x2 characteristic-matrix solution for a three-layer stack:

[
n_h ;|; n_g,;w ;|; n_h,
]

with both TE and TM polarization. The incident and exit media are identical, so the power transmission reduces to (|t|^2).

The public scan uses:

- wavelength: (1.018,mumathrm{m});
- reference gap center: (0.3495,mumathrm{m});
- half-width: (0.0016,mumathrm{m});
- high-index medium: nominal (n_h=1.45);
- low-index gap scan: (n_g=1.33,1.35,1.38,1.40,1.42,1.44);
- all TIR incidence angles from the critical angle to (89.9^circ).

A deliberately broader stress test also scans (n_h=1.44)–1.46 and (n_g=1.00) to (n_h-0.001).

## Acceptance criterion

The planar-FTIR hypothesis is considered sufficient only if its exact Maxwell solution can approach the target logarithmic sensitivity without relying on numerically negligible transmission.

Otherwise the result is recorded as evidence that an additional mechanism is required (for example contact-topology change, mechanical separation, or redistribution of the multimode phase-space population). The benchmark itself does **not** choose among those mechanisms.

## Files

- `src/ftir.py` — exact TE/TM characteristic-matrix implementation.
- `src/run_benchmark.py` — parameter scan and result generation.
- `tests/test_ftir.py` — zero-gap, energy-conservation, monotonicity and target-definition checks.
- `config/benchmark.json` — public benchmark inputs.
- `results/` — small committed reference results.
- CI workflow — independent rerun and artifact generation.

## Status

**实现待核验** — project initialized; the first numerical benchmark and CI evidence are being added on this branch.
