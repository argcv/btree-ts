# @argcv/btree

A generic, in-memory B-tree for TypeScript and JavaScript. It provides ordered lookups and mutations, range scans, and O(1) lazy copy-on-write cloning, with no runtime dependencies.

Inspired by [https://github.com/google/btree](https://github.com/google/btree). This package contains TypeScript modifications of `google/btree`; see [License and notices](#license-and-notices).

## Requirements and installation

- Node.js 18 or newer
- ESM and CommonJS are both supported
- TypeScript declarations and source maps are included

```sh
npm install @argcv/btree
```

### ESM

```ts
import { BTree, type Less, type Visitor } from '@argcv/btree';
```

### CommonJS

```js
const { BTree } = require('@argcv/btree');
```

## Quick start

### Numbers

```ts
import { BTree } from '@argcv/btree';

const numbers = new BTree<number>(32, (a, b) => a < b);

numbers.replaceOrInsert(8);
numbers.replaceOrInsert(2);
numbers.replaceOrInsert(4);
numbers.replaceOrInsert(0);

console.log(numbers.size);       // 4
console.log(numbers.get(4));     // 4
console.log(numbers.get(99));    // undefined: not found
console.log(numbers.min());      // 0
console.log(numbers.max());      // 8

const ordered: number[] = [];
numbers.ascend((item) => {
  ordered.push(item);
  return true; // continue; return false to stop early
});
console.log(ordered);            // [0, 2, 4, 8]
```

### Objects with a key

The comparator defines key equality. If neither `less(a, b)` nor `less(b, a)` is true, `a` and `b` are equivalent keys in the tree.

```ts
import { BTree } from '@argcv/btree';

interface User {
  id: number;
  name: string;
}

const users = new BTree<User>(32, (a, b) => a.id < b.id);

users.replaceOrInsert({ id: 7, name: 'Ada' });

const grace = { id: 7, name: 'Grace' };
const previous = users.replaceOrInsert(grace);
console.log(previous?.name); // 'Ada': the previously stored object

// The probe only needs the fields used by the comparator. get returns the
// actual stored object, not the probe and not a copy of the stored value.
const stored = users.get({ id: 7, name: 'lookup' });
console.log(stored === grace); // true
```

`replaceOrInsert` replaces the complete stored object when an equivalent key already exists. Replace an object rather than mutating any field used by the comparator.

## Construction and ordering rules

```ts
export type Less<T> = (a: T, b: T) => boolean;
export type Visitor<T> = (item: T) => boolean;

const tree = new BTree<T>(degree, less);
```

- `degree` must be a safe integer greater than or equal to `2`.
- `less` must define a **strict weak ordering**. In particular, it must be irreflexive, asymmetric, and transitive, and comparator equivalence must be transitive.
- Comparator-equivalent values represent the same key: `!less(a, b) && !less(b, a)`.
- Fields used by `less` must remain immutable while a value is stored in the tree, including while its structure is shared with clones. Changing them can invalidate ordering and lookup behavior.
- To make the `T | undefined` miss result unambiguous, `undefined` is forbidden for every item or pivot argument and causes a `TypeError`. Other falsy values, including `0`, `false`, `''`, and `null`, are valid when supported by `T` and the comparator.

## API

### Properties and mutation/query methods

| Member | Description |
| --- | --- |
| `tree.size` | Number of stored items. |
| `tree.degree` | Degree supplied when the tree was constructed. |
| `get(pivot): T \| undefined` | Returns the actual stored object equivalent to `pivot`, or `undefined` when absent. |
| `has(pivot): boolean` | Tests whether an equivalent key exists. |
| `replaceOrInsert(item): T \| undefined` | Inserts `item`, or replaces the complete object at an equivalent key and returns the previously stored object. Returns `undefined` for a pure insertion. |
| `delete(pivot): T \| undefined` | Removes and returns the actual stored object equivalent to `pivot`, or `undefined` when absent. |
| `min(): T \| undefined` | Returns the smallest stored item, or `undefined` for an empty tree. |
| `max(): T \| undefined` | Returns the largest stored item, or `undefined` for an empty tree. |
| `deleteMin(): T \| undefined` | Removes and returns the smallest item, or `undefined` for an empty tree. |
| `deleteMax(): T \| undefined` | Removes and returns the largest item, or `undefined` for an empty tree. |
| `clear(): void` | Removes all items. |
| `clone(): BTree<T>` | Creates an O(1) lazy structural copy-on-write clone. Values are shallow-copied, not deep-cloned. |

### Traversal

Every visitor returns `true` to continue or `false` to stop early. In the range descriptions below, `x` denotes a stored key and all bounds use the tree's comparator.

| Method | Visited keys and order |
| --- | --- |
| `ascend(visitor)` | All keys, ascending. |
| `ascendRange(greaterOrEqual, lessThan, visitor)` | `[ge, lt)`: `ge <= x < lt`, ascending. |
| `ascendLessThan(pivot, visitor)` | `x < pivot`, ascending. |
| `ascendGreaterOrEqual(pivot, visitor)` | `x >= pivot`, ascending. |
| `descend(visitor)` | All keys, descending. |
| `descendRange(lessOrEqual, greaterThan, visitor)` | `(gt, le]`: `gt < x <= le`, descending. Note that the inclusive upper bound `le` is the first pivot argument. |
| `descendLessOrEqual(pivot, visitor)` | `x <= pivot`, descending. |
| `descendGreaterThan(pivot, visitor)` | `x > pivot`, descending. |

Traversals read the **live tree**, not a snapshot. Mutating the same tree from a traversal visitor is unsupported. No concurrency-safety guarantee is made.

## Complexity

Let `n` be the number of items and `k` the number of items visited by a traversal. Bounds below treat the B-tree degree as fixed and exclude the cost of user comparators and visitors.

| Operation | Time complexity |
| --- | --- |
| `get`, `has`, `replaceOrInsert`, `delete` | `O(log n)` |
| `min`, `max`, `deleteMin`, `deleteMax` | `O(log n)` |
| `clone` | `O(1)` |
| `ascend`, `descend` | `O(n)` |
| Range and pivot-bounded traversals | `O(log n + k)` |

A clone initially shares internal structure with its source. Later structural mutations copy the required nodes lazily; object payloads are never deep-cloned by `clone()`.

## Development and benchmarks

The commands in this section require a source checkout with development dependencies installed; benchmark files are not included in the published package.

```sh
npm run typecheck
npm test
npm run build
npm run check
npm run test:bench
```

`npm run check` runs type checking, unit tests, the build, and the Node benchmark tests. `prepack` runs the same check before packing.

All benchmark commands build first:

| Command | Benchmark invocation after `npm run build` |
| --- | --- |
| `npm run bench` | `node benchmarks/run.mjs` |
| `npm run bench:smoke` | `node benchmarks/run.mjs --smoke` |

The `benchmarks/` directory contains a deterministic fifteen-case workload matrix covering insertion, lookup, deletion, traversal, and copy-on-write cloning. See `benchmarks/README.md` in a source checkout for commands and measurement details. Benchmark files are not included in the published package.

## Published package contents

The npm manifest has `publishConfig.access` set to `public`, `sideEffects` set to `false`, and no runtime, peer, or optional dependencies. With development dependencies installed, inspect the tarball with:

```sh
npm pack --dry-run
```

The published package contains:

- `dist/`: ESM, CommonJS, TypeScript declarations, and source maps;
- `package.json` and this `README.md`;
- `LICENSE` and `NOTICE` for the Apache-2.0 license and attribution.

It does not intentionally publish `src/`, `test/`, `benchmarks/`, or development configuration files.

## License and notices

This package is a TypeScript modification of [google/btree](https://github.com/google/btree). It is distributed under the **Apache License 2.0**, the same license as the original google/btree source. See [LICENSE](LICENSE), [NOTICE](NOTICE), and the applicable source-file headers.

Original copyright notices include `Copyright 2014 Google Inc.` and `Copyright 2014-2022 Google Inc.`.

