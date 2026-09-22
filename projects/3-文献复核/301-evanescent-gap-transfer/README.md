# PUB-P301｜Evanescent gap-transfer benchmark

## Purpose

This project independently checks whether a nanometre-scale coupling cliff can arise from **planar frustrated total internal reflection (FTIR)** alone in a symmetric high-index / low-index / high-index dielectric gap.

The calculation is intentionally generic and public. It does not encode private geometry, unpublished experiment data, external private project identifiers, or reverse mappings.

## Public reproduction target

The quantitative target is taken from the public model in:

F. Li et al., **Thermally induced coupling dynamics in distributed side-coupled cladding-pumped fiber amplifiers toward 20 kW operation**, *Optics & Laser Technology* 204 (2026) 116468.  
DOI: https://doi.org/10.1016/j.optlastec.2026.116468

That paper uses the phenomenological logistic-type relation

\`\`\`math
k(w)=\frac{k_0}{1+\exp[(w-w_c)/s]}
\`\`\`

with nominal \(w_c=0.3495~\mu\mathrm{m}\) and \(s=0.0016~\mu\mathrm{m}\). Therefore the normalized coupling changes from

\`\`\`math
\frac{e}{1+e}\approx 0.7311
\quad\text{to}\quad
\frac{1}{1+e}\approx 0.2689
\`\`\`

across a total gap change of \(3.2~\mathrm{nm}\). This is equivalent to the finite-interval logarithmic sensitivity

\`\`\`math
S_{\mathrm{target}}
=
\frac{\left|\Delta\ln k\right|}{\Delta w}
=
312.5~\mu\mathrm{m}^{-1}.
\`\`\`

The project checks this **local gap sensitivity only**. It does not attempt to reproduce the full amplifier, thermal FEM, or 20 kW experiment.

## Method

The first stage uses the exact 2×2 characteristic-matrix solution for the three-layer stack

\`\`\`math
n_h\;|\;n_g,w\;|\;n_h,
\`\`\`

with both TE and TM polarization. The incident and exit media are identical and lossless.

The declared nominal scan uses:

- wavelength: \(1.018~\mu\mathrm{m}\);
- reference gap center: \(0.3495~\mu\mathrm{m}\);
- half-width: \(0.0016~\mu\mathrm{m}\);
- nominal high-index medium: \(n_h=1.45\);
- gap-index scan: \(n_g=1.33,1.35,1.38,1.40,1.42,1.44\);
- all TIR incidence angles from the critical angle to \(89.9^\circ\).

A deliberately broad stress scan also covers \(n_h=1.44\)–1.46 and \(n_g=1.00\) to \(n_h-0.001\).

## Validated result

GitHub Actions run: https://github.com/FenLynn/gpt-pub/actions/runs/35757458900

- 5 numerical tests passed.
- Target sensitivity: \(312.5~\mu\mathrm{m}^{-1}\).
- Nominal-scan maximum: \(8.4161~\mu\mathrm{m}^{-1}\).
- Nominal maximum restricted to \(T_{\mathrm{mid}}\ge0.1\): \(7.4222~\mu\mathrm{m}^{-1}\).
- Broad stress-scan maximum: \(13.4008~\mu\mathrm{m}^{-1}\), but at \(T_{\mathrm{mid}}\approx2.10\times10^{-7}\).

Thus the target is 37.13× above the unrestricted nominal maximum, 42.10× above the nominal strong-transfer comparison, and still 23.32× above the deliberately broad stress-scan maximum.

The CI artifact \`p301-gap-transfer-results\` contains the complete CSV/JSON/SVG outputs. The validated summary is also frozen in \`results/benchmark_summary.json\`.

## Scope of conclusion

**部分复现** — the declared passive, smooth, planar, fixed-contact-topology Maxwell model is successfully reproduced and is **not sufficiently gap-sensitive** to generate the reference 3.2 nm logistic transition by local FTIR alone.

This does **not** establish that a complete multimode side-coupled fiber cannot show a sharp effective coupling transition. A longitudinal effective coupling coefficient can additionally depend on contact topology, encounter fraction, bending, mode/ray population, and other transport physics not represented by the planar local benchmark.

## Files

- \`src/ftir.py\` — exact TE/TM characteristic-matrix implementation.
- \`src/run_benchmark.py\` — parameter scan and result generation.
- \`tests/test_ftir.py\` — zero-gap, energy-conservation, monotonicity, and target-definition checks.
- \`config/benchmark.json\` — declared public inputs.
- \`results/benchmark_summary.json\` — small validated reference summary.
- \`results/README.md\` — interpretation and evidence.
- project CI workflow — independent rerun and Artifact generation.
