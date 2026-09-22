# PUB-P301｜Evanescent gap-transfer benchmark

## Purpose

This project independently checks whether a nanometre-scale coupling cliff can arise from **planar frustrated total internal reflection (FTIR)** alone in a symmetric high-index / low-index / high-index dielectric gap, and whether repeated identical ray encounters can amplify that local response into the required longitudinal coupling-rate sensitivity.

The calculation is intentionally generic and public. It does not encode private geometry, unpublished experiment data, external private project identifiers, or reverse mappings.

## Public reproduction target

The quantitative target is taken from the public model in:

F. Li et al., **Thermally induced coupling dynamics in distributed side-coupled cladding-pumped fiber amplifiers toward 20 kW operation**, *Optics & Laser Technology* 204 (2026) 116468.  
DOI: https://doi.org/10.1016/j.optlastec.2026.116468

That paper uses the phenomenological logistic-type relation

```math
k(w)=\frac{k_0}{1+\exp[(w-w_c)/s]}
```

with nominal \(w_c=0.3495~\mu\mathrm{m}\) and \(s=0.0016~\mu\mathrm{m}\). Across \(w_c-s\) to \(w_c+s\), the normalized coupling changes from \(e/(1+e)\) to \(1/(1+e)\) over only \(3.2~\mathrm{nm}\). The corresponding finite-interval logarithmic sensitivity is

```math
S_{\mathrm{target}}
=
\frac{|\Delta\ln k|}{\Delta w}
=
312.5~\mu\mathrm{m}^{-1}.
```

The project checks this **gap sensitivity**, not the full amplifier, thermal FEM, or 20 kW experiment.

## Physics models

### 1. Exact local Maxwell transfer

The first model uses the exact TE/TM 2×2 characteristic-matrix solution of

```math
n_h\;|\;n_g,w\;|\;n_h .
```

The nominal scan uses:

- wavelength: \(1.018~\mu\mathrm{m}\);
- gap center: \(0.3495~\mu\mathrm{m}\);
- half-width: \(0.0016~\mu\mathrm{m}\);
- nominal high-index medium: \(n_h=1.45\);
- gap indices: \(n_g=1.33,1.35,1.38,1.40,1.42,1.44\);
- all TIR incidence angles from the critical angle to \(89.9^\circ\).

A deliberately broad stress scan also covers \(n_h=1.44\)–1.46 and \(n_g=1.00\) to \(n_h-0.001\).

### 2. Exact repeated-encounter leakage rate

If an identical ray hits the same coupling interface \(\nu_{\mathrm{hit}}\) times per unit axial length and the source-guide power reflectance of each encounter is \(R\), then

```math
P(z)=P(0)R^{\nu_{\mathrm{hit}}z}
=
P(0)\exp[-\nu_{\mathrm{hit}}(-\ln R)z].
```

Therefore the exact per-ray longitudinal leakage rate is

```math
k_{\mathrm{ray}}
=
\nu_{\mathrm{hit}}g,
\qquad
g=-\ln R.
```

This removes the weak-transfer approximation \(g\approx T\) and tests whether repeated encounters themselves create a much sharper gap dependence.

## Validated evidence

Latest validation:

- Actions run: https://github.com/FenLynn/gpt-pub/actions/runs/35758669720
- validated head: `fb8c9d84470b9c9e9b5ad02264390afd3ca09a2a`
- tests: **7 passed**
- Artifact ID: `10709190547`
- Artifact SHA-256: `4088249f33a5ecac73325c3e6c0f89f6e34a5714bb9410d0a8d805f661df64e0`

## Validated results

| Metric | Nominal max | Nominal max with \(T_{mid}\ge0.1\) | Broad stress max | Target / nominal |
|---|---:|---:|---:|---:|
| local transmission \(T\) | 8.4161 µm⁻¹ | 7.4222 µm⁻¹ | 13.4008 µm⁻¹ | 37.13× |
| exact repeated-encounter factor \(-\ln R\) | 8.4162 µm⁻¹ | 7.8274 µm⁻¹ | 13.4008 µm⁻¹ | 37.13× |

The target is \(312.5~\mu\mathrm{m}^{-1}\). Even after replacing the weak-transfer proxy \(T\) by the exact repeated-encounter factor \(-\ln R\), the nominal sensitivity remains about **37× too small**. The deliberately broad stress-scan maximum remains about **23× below** the target and occurs only at the extreme boundary where \(T_{mid}\approx2.10\times10^{-7}\).

## Scope of conclusion

**部分复现 / mechanism falsification check:** within the declared passive, smooth, planar, fixed-contact-topology model:

1. local FTIR transmission is far too weakly gap-sensitive to reproduce the reference 3.2 nm logistic transition;
2. exact repeated identical encounters do **not** supply the missing sensitivity—the \(-\ln R\) rate factor has essentially the same finite-interval gap sensitivity in the relevant scan.

This does **not** establish that a complete multimode side-coupled fiber cannot show a sharp effective coupling transition. It instead narrows the missing physics to mechanisms that change the effective encounter weights or geometry with state, such as contact topology/contact fraction, bending/prestress, or evolution of the multimode/ray population.

## Files

- `src/ftir.py` — exact TE/TM Maxwell stack and repeated-encounter rate factor.
- `src/run_benchmark.py` — declared scans and result generation.
- `tests/test_ftir.py` — seven numerical/physics regression checks.
- `config/benchmark.json` — public benchmark inputs.
- `results/benchmark_summary.json` — validated reference numbers and evidence.
- `results/README.md` — interpretation and scope.
- project CI workflow — bounded independent rerun and Artifact generation.
