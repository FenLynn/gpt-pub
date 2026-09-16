# Crash-safe generation

## Goal

Persistent index updates must survive process termination, power loss, and partial writes.
The active index is never modified in place.

## Protocol

```text
CURRENT.json
     |
     v
active generation

new build
     |
private generation directory
     |
validate complete files
     |
fsync temporary manifest
     |
atomic replace CURRENT.json
```

## Rules

1. A generation directory is immutable after activation.
2. A failed build may leave an orphan generation, but it cannot become active.
3. The manifest is the only switch point.
4. Cleanup is performed only after a successful switch.
5. Readers always resolve through the current manifest.

## Implementation

Reference implementation:

```text
experiments/crash_safe_generation.py
experiments/ci_crash_safe_generation.py
```

The same mechanism is intended for:

- Lane A image index.
- Lane B postings.
- Future video generations.

## Failure cases covered

| Failure | Result |
| --- | --- |
| crash during new generation build | old generation remains active |
| missing postings or metadata | activation rejected |
| interrupted manifest update | previous manifest remains usable |
| stale generation directory | safe garbage collection candidate |
