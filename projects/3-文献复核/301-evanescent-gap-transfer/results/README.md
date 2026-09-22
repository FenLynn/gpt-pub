# Benchmark results

## Latest evidence

- GitHub Actions run: https://github.com/FenLynn/gpt-pub/actions/runs/35758669720
- validated head: `fb8c9d84470b9c9e9b5ad02264390afd3ca09a2a`
- tests: **7 passed**
- Artifact: `p301-gap-transfer-results`
- Artifact ID: `10709190547`
- Artifact SHA-256: `4088249f33a5ecac73325c3e6c0f89f6e34a5714bb9410d0a8d805f661df64e0`

## Reference target

The public logistic model requires

```math
S_{target}=312.5~\mu\mathrm{m}^{-1}
```

over the 3.2 nm reference interval.

## A. Local transmission

Declared nominal scan:

- maximum \(|\Delta\ln T|/\Delta w\): **8.4161104 µm⁻¹**;
- maximum with \(T_{mid}\ge0.1\): **7.4222386 µm⁻¹**;
- target / nominal max: **37.131×**;
- target / strong-transfer max: **42.103×**.

Broad stress scan:

- maximum: **13.4008477 µm⁻¹**;
- target / broad maximum: **23.319×**;
- location: \(n_h=1.46\), \(n_g=1.00\), TM, 89.9°;
- \(T_{mid}=2.0951\times10^{-7}\).

## B. Exact repeated-encounter leakage rate

For repeated identical encounters,

```math
k_{ray}=\nu_{hit}[-\ln R].
```

Because \(\nu_{hit}\) is independent of gap in this fixed-geometry subproblem, the relevant coupling-rate gap sensitivity is that of \(-\ln R\).

Declared nominal scan:

- maximum \(|\Delta\ln[-\ln R]|/\Delta w\): **8.4162004 µm⁻¹**;
- maximum with \(T_{mid}\ge0.1\): **7.8274463 µm⁻¹**;
- target / nominal max: **37.131×**;
- target / strong-transfer max: **39.924×**.

Broad stress scan:

- maximum: **13.4008483 µm⁻¹**;
- target / broad maximum: **23.319×**;
- same extreme boundary state as the local-transmission maximum.

## Interpretation

Replacing the weak-transfer proxy \(T\) with the exact repeated-encounter factor \(-\ln R\) changes the relevant sensitivity only modestly in the useful-transfer region and negligibly at the broad-scan maximum. Therefore **repeated identical encounters with a fixed encounter rate do not create the missing 20–40× sensitivity**.

This is a deliberately narrow result. It does not model a changing contact arc, changing encounter fraction, bending-induced geometry change, or longitudinal evolution of the ray/mode population. Those state-dependent effects remain candidate mechanisms for a sharp effective longitudinal coupling coefficient.
