# Benchmark results

## Evidence

- GitHub Actions run: https://github.com/FenLynn/gpt-pub/actions/runs/35757458900
- validated head: `8f86d8f13b2c773746ec40a026ff7f1ae98f2bd2`
- tests: **5 passed**
- Artifact: `p301-gap-transfer-results`, ID `10707953306`
- Artifact SHA-256: `28bc49cb277ee8e3e4b7f04c59f70a1536d58989e87d5a93c62bbdab6f1ef2f6`

## Result

The reference 3.2 nm transition requires

[
S_{mathrm{target}}=312.5~mumathrm{m}^{-1}.
]

For the declared nominal dielectric-index scan, the exact planar Maxwell model gives a maximum finite-interval logarithmic sensitivity of

[
S_{mathrm{FTIR,max}}=8.4161~mumathrm{m}^{-1},
]

so the target is **37.13× larger**. Restricting the comparison to points with center-gap transmission (T_{mathrm{mid}}ge 0.1) gives

[
S_{mathrm{FTIR,max},Tge0.1}=7.4222~mumathrm{m}^{-1},
]

or a **42.10×** gap to the target.

The deliberately broad stress scan reaches

[
13.4008~mumathrm{m}^{-1},
]

still **23.32× below** the target. That maximum occurs at the deliberately extreme boundary (n_h=1.46), (n_g=1.00), TM, (89.9^circ), where center transmission is only (2.10	imes10^{-7}), so it does not represent a useful strong-transfer state.

## Scope of the conclusion

**Partial reproduction / mechanism check:** within the declared passive, smooth, planar, fixed-contact-topology dielectric-gap model, local FTIR transmission is far too weakly dependent on a 3.2 nm gap change to reproduce the reference logistic transition.

This result does **not** claim that a complete multimode side-coupled fiber cannot exhibit a sharp effective coupling transition. The effective longitudinal coupling coefficient can additionally depend on contact geometry, encounter fraction, bending, mode/ray population and other transport physics not included in this local benchmark.
