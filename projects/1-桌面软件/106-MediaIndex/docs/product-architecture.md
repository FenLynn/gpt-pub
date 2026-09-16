# P106｜MediaIndex Product Architecture

## 1. Product target

MediaIndex is no longer only an acceptance harness.

The product target is:

> Given one incoming image or video, determine whether the same source media already exists in a large, messy inventory, and return where it is stored.

The existing inventory remains read-only by default. MediaIndex builds a sidecar index and never reorganizes the user's folders unless a future explicit feature is added.

## 2. External delivery

User-facing delivery remains one Windows x64 EXE:

```text
MediaIndex.exe
```

Internal architecture keeps the algorithm process isolated:

```text
MediaIndex.exe
  WinForms shell
      ↓ embedded resource
MediaIndex.Worker.exe
      ↓ extracted on demand
%LOCALAPPDATA%\FenLynn\MediaIndex\Runtime
```

The user does not install or manage Python or a separate .NET runtime.

This follows the same general principle already proven in P103/P105:

- simple external delivery
- internal process isolation for heavy work

## 3. v0.1.0 Preview scope

The first product preview focuses on persistent image indexing and image lookup.

### User flow

```text
choose image library
→ build/update persistent index once
→ drag or choose query image
→ search
→ return ranked source paths
```

The acceptance tool remains available as a diagnostic surface, but it is no longer the primary product UI.

### Current result classes

```text
Exact
Confirmed
Probable
Candidate
```

These are evidence classes, not generic semantic similarity ratings.

## 4. Persistent image index

Each selected image library receives a deterministic index directory under:

```text
%LOCALAPPDATA%\FenLynn\MediaIndex\Indexes\<library-id>\
```

Current files:

```text
index.sqlite3
region_hashes.npy
image_ids.npy
```

### SQLite metadata

`index.sqlite3` currently stores:

- image ID
- relative path
- file size
- mtime
- dimensions
- region-hash payload
- lazy SHA-256 when exact verification requires it
- index metadata

The original library path is stored once as index metadata.

### Dense hash matrix

`region_hashes.npy` stores the pHash region matrix in compact uint64 form.

`image_ids.npy` maps matrix rows back to SQLite IDs.

This separation is intentional:

- SQLite is convenient for metadata and incremental updates.
- NumPy mmap-like arrays are much more suitable for high-throughput popcount retrieval than SQL row-by-row distance computation.

## 5. Incremental update

A rebuild does not recompute unchanged files.

Reuse key:

```text
relative path
+ file size
+ mtime_ns
```

Changed or new files are decoded and re-indexed.

Missing files are removed from the active index.

Current CI explicitly verifies that a second rebuild reuses every unchanged file.

## 6. Exact duplicate path

The index does not hash the full bytes of every large inventory file during the initial scan.

Instead:

1. visual retrieval creates a small candidate set
2. candidates with the same byte size as the Query become exact-hash candidates
3. SHA-256 is computed lazily
4. successful source hashes are persisted in SQLite

This avoids forcing a full cryptographic read of every large file only to support the rare exact-byte lookup.

## 7. Current image candidate retrieval

v0.1.0 uses the persisted selected-region pHash matrix.

For each indexed image it evaluates:

```text
query-global vs source-regions
+
source-global vs query-regions
```

and keeps the best crop-tolerant Hamming evidence.

This is much cheaper than the earlier 201-region exhaustive scheme.

The preview keeps a wider candidate set, then sends only a small subset to deep verification.

## 8. Deep image verification

Current deep chain:

```text
persistent pHash candidate retrieval
→ selected online candidates
→ SIFT
→ Lowe ratio
→ RANSAC homography
→ content consistency / NCC
→ low-confidence template fallback
```

If a candidate reaches conservative high-confidence verification, verifier evidence decides the ranking.

If none reaches high confidence, the system avoids letting noisy SIFT inlier counts dominate. It uses the crop-tolerant pHash shortlist plus low-resolution grayscale/edge template fallback.

This change came directly from the user's v0.0.2 real Round1 acceptance result:

```text
Top50 = 100%
Top1 = 85%
```

After the fallback correction, the same user set reached:

```text
Top50 = 100%
Top1 = 100%
```

## 9. Offline volume behavior

A persistent index remains usable even if the source drive is temporarily offline.

In that state MediaIndex can still:

- return pHash candidate paths
- show the stored relative location
- identify which indexed library contains the candidate

It cannot perform source-pixel SIFT/NCC/template verification until the original file is online again.

This is a deliberate requirement for large multi-drive inventories.

## 10. Hard-negative gate

The Windows build is not allowed to publish only because easy transformed positives pass.

The CI now also contains a known hard-negative suite, including:

- same synthetic scene from different camera/parallax views
- same poster/template with different central content
- repeated texture with different phase
- low-texture look-alike content

The build fails if any of those is promoted to the high-confidence same-source class.

This does not prove that all real-world negatives are solved. It prevents known regressions in the most dangerous failure direction.

## 11. Scaling boundary of v0.1.0

v0.1.0 is a product preview, not the final 500k-media engine.

The persistent matrix removes the worst problem of the Acceptance harness, which rescanned and re-extracted every library image for every run.

However, the preview still has an important gap:

> the final scalable local-feature Lane B is not yet persisted as a production inverted index.

Current candidate retrieval is therefore strongest for:

- recompression
- resize
- moderate crop
- watermark
- common same-source transformations

The previously validated visual-word / local-feature Lane B remains part of the target architecture for very strong arbitrary crops and correlated large libraries.

## 12. Target image product chain

The target production chain remains:

```text
exact / metadata
→ persistent pHash Lane A
→ persistent local-feature Lane B
→ union candidate budget
→ cheap rerank
→ deep SIFT/RANSAC/content verifier
→ low-texture fallback
→ Exact / Confirmed / Probable / Candidate / Not found
```

v0.1.0 establishes the product shell and persistent Lane A. Lane B is the next index-level implementation milestone rather than another throwaway validation script.

## 13. Video integration

Video is not discarded.

The validated target remains:

```text
Tier V0
~1 fps lightweight temporal anchors

Tier V1
sparse timestamp-preserving local-feature keyframes

Tier V2
sparse verifier cache / source decode

Audio Lane C
compact audio fingerprint sequence

temporal layer
constant / affine / piecewise correspondence
```

The main application will use the same library/index abstraction for image and video stores, but video persistence must be time-layered rather than copying the full image signature to every sampled frame.

## 14. Product phases after v0.1.0

### P1

Persistent image Lane A and actual path-returning query UI.

### P2

Persistent local-feature Lane B, large-library candidate union, query latency optimization.

### P3

Real-library incremental indexing at 10k to 500k scale, drive identity, offline-volume lifecycle.

### P4

Persistent video Tier V0 and clip lookup.

### P5

Video Tier V1, Audio Lane C, Composite and piecewise temporal matching.

### P6

Unified MediaIndex stable product.

The acceptance harness remains available throughout these phases as the regression/diagnostic page rather than the main user workflow.
