# Nature-sized gallery · Visual QA

## Scope

FigureStudio includes **14 synthetic editable sample figures** in a dedicated **Nature Gallery** folder. They are test charts, not reproductions of published Nature artwork, not genuine experimental measurements, and not a journal acceptance certification.

- Browser review shortcut: `/gpt-pub/p108/?gallery=1` opens the first Nature Gallery graph immediately.
- Normal project workflow and old `.sfig` 0.1–0.5 compatibility remain intact. “New Project” creates the gallery; importing an existing project does not overwrite its datasets.
- Every sample's **X and Y axis titles are English** without LaTeX delimiters, allowing the supported XY examples to exercise the real SVG renderer.
- Preset: **89 mm**, Arial, 6.5 pt, axis stroke 0.58 pt, primary line 0.82 pt. These are starting defaults; every relevant editable override remains available.
- Example N14: **183 mm × 72 mm**, testing independent exact physical width and height inputs. Custom size is preserved in both preview and SVG/PNG export.

## 14 comparison cases

| Case | Contents | Renderer |
|---|---|---|
| N01 | Emission spectrum with model fit | Precision SVG |
| N02 | Zoomed peak; manual X range and tick spacing | Precision SVG |
| N03 | Two kinetic trajectories | Precision SVG |
| N04 | Two series of scatter markers | Precision SVG |
| N05 | Measurement points with Y error bars | Precision SVG |
| N06 | Connected experimental-style points | Precision SVG |
| N07 | Logarithmic Y axis decay | Precision SVG |
| N08 | Dual Y: output power and efficiency | Precision SVG |
| N09 | Offset spectra (5 traces) | Precision SVG |
| N10 | Waterfall spectra with X/Y offsets | Precision SVG |
| N11 | Spatial intensity heatmap | Original Plotly fallback |
| N12 | Field intensity contours | Original Plotly fallback |
| N13 | Stacked bar chart | Original Plotly fallback |
| N14 | Wide 183 mm double-column kinetic lines | Precision SVG |

Each sample remains a normal editable `FigureSpec` and links to a `DataSheet`. None uses a separate shortcut renderer or fixed raster asset.

## Source-based publication targets

Use the current official sources when setting final figure appearance:

- [Nature final submission](https://www.nature.com/nature/for-authors/final-submission): usual one/two-column 89/183 mm; 5–7 pt regular figure text; lines and strokes roughly 0.25–1 pt at final size; panel lettering convention.
- [Nature Research figure guide](https://research-figure-guide.nature.com/figures/building-and-exporting-figure-panels/): fixed print widths, maximum figure height, consistent spacing and legibility.
- [Nature initial submission](https://www.nature.com/nature/for-authors/initial-submission): editable vector files, suitable contrast and accessibility.

These numbers are **publication-oriented defaults**, not immutable limits: the inspector permits custom mm/pt values for scientific readability and other journals. In particular, complex 3D, field maps, and dense curves may require different layouts. Maintain data fidelity: SVG path joins are rounded for display, but measured sample values are never spline-filtered without an explicit calculation.

## Verification

`npm run build` and `npm run test:gallery` form the normal P108 CI gate. The gallery smoke test builds all 14 `buildLayout/buildTraces` cases, SSR-renders the 11 Precision SVG cases, checks exact physical size, English titles, finite geometry and availability of source columns. Three fallback cases still retain complete property controls in Plotly.

User visual review should compare **at actual print scale**, not only at fit-to-window scale. Verify thin line display, axis labels, tick density, legend collision, clipping, colors, and exported editable vector text. Browser-specific font rendering and interaction speed require separate real-browser verification.
