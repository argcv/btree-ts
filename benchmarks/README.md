# Benchmarks

A small, deterministic workload matrix for this package. It contains no external implementation, historical baseline, or nested fixture data.

## Run

```sh
npm run bench
npm run bench:smoke
npm run test:bench
```

Custom run:

```sh
node benchmarks/run.mjs --sizes 1000,100000 --operations 100000 --repeat 3 --degree 32
```

Defaults: sizes 1000 and 100000, 100000 target operations per case, one repetition, and degree 32. Smoke mode uses 1000 entries and 2000 operations. Sizes must be at least 16.

## Workloads

| Group | Cases |
| --- | --- |
| Insert | sequential, random |
| Get | hit, miss |
| Delete | random, minimum, maximum |
| Ascend | full, early 16, middle range |
| Descend | full, early 16, middle range |
| Clone | clone only, clone followed by replacement |

These fifteen cases separate operation type, input order, lookup outcome, traversal direction, traversal length, and copy-on-write behavior.

## Measurement

Each size uses the same deterministic integer datasets for every repetition. Stored keys are even; miss keys are odd. Random permutations are generated locally with fixed seeds.

Tree construction and mutation fixture rebuilding are outside the timed region. Point operations use the requested operation count directly. Traversals derive their scan count from the requested visited-item target. Every result reports `ns/op`, `ops/s`, operations, visited items, and a checksum.

The test file checks dataset integrity, all fifteen cases, checksums, partial mutation batches, and custom degrees. It makes no performance assertions.
