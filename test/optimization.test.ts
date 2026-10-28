import { describe, expect, it } from 'vitest';
import { BTree } from '../src/index';
import {
  DEGREES,
  expectPublicState,
  lowerBound as sortedLowerBound,
  type NodeMirror,
  type Traversal,
  numberTree,
  range,
  rootMirror,
  seededRandom,
  shuffled,
} from './helpers';

interface PrivateBounds<T> {
  lowerBound(items: T[], item: T): number;
  upperBound(items: T[], item: T): number;
  foundAt(items: T[], index: number, item: T): boolean;
}

function privateBounds<T>(tree: BTree<T>): PrivateBounds<T> {
  return tree as unknown as PrivateBounds<T>;
}

function virtualSortedArray(length: number): {
  items: number[];
  accessed: number[];
} {
  const accessed: number[] = [];
  const items = new Proxy([] as number[], {
    get(target, property, receiver) {
      if (property === 'length') {
        return length;
      }
      if (typeof property === 'string' && property !== '') {
        const index = Number(property);
        if (
          Number.isSafeInteger(index)
          && index >= 0
          && index < length
          && String(index) === property
        ) {
          accessed.push(index);
          return index;
        }
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  return { items, accessed };
}

interface Entry {
  readonly id: number;
  readonly scope: string;
  readonly bucket: number;
  readonly ordinal: number;
  readonly revision: number;
  readonly payload: string;
}

const SCOPES = ['east', 'north', 'west'] as const;

function makeEntry(id: number, revision: number): Entry {
  const scope = SCOPES[id % SCOPES.length]!;
  const bucket = Math.floor(id / SCOPES.length) % 5;
  const ordinal = Math.floor(id / (SCOPES.length * 5));
  return {
    id,
    scope,
    bucket,
    ordinal,
    revision,
    payload: `${scope}/${bucket}/${ordinal}#${revision}`,
  };
}

function compareEntries(a: Entry, b: Entry): number {
  if (a.scope !== b.scope) {
    return a.scope < b.scope ? -1 : 1;
  }
  if (a.bucket !== b.bucket) {
    return a.bucket - b.bucket;
  }
  return a.ordinal - b.ordinal;
}

const lessEntry = (a: Entry, b: Entry): boolean => compareEntries(a, b) < 0;

function sortedEntries(mirror: ReadonlyMap<number, Entry>): Entry[] {
  return [...mirror.values()].sort(compareEntries);
}

function treeHeight<T>(tree: BTree<T>): number {
  let height = 0;
  let node = rootMirror(tree);
  while (node !== null) {
    height += 1;
    node = node.children?.[0] ?? null;
  }
  return height;
}

function expectStorageLayout<T>(tree: BTree<T>, context: string): void {
  const root = rootMirror(tree);
  if (root === null) {
    expect(tree.size, `${context}: null root size`).toBe(0);
    return;
  }

  const pending: NodeMirror<T>[] = [root];
  let leafCount = 0;
  while (pending.length > 0) {
    const node = pending.pop()!;
    const children = node.children;
    if (children === null) {
      expect(node.children, `${context}: leaf children`).toBeNull();
      leafCount += 1;
      continue;
    }

    expect(Array.isArray(children), `${context}: internal child array`).toBe(true);
    expect(
      children.length,
      `${context}: internal child arity`,
    ).toBe(node.items.length + 1);
    for (let index = 0; index < children.length; index += 1) {
      expect(index in children, `${context}: dense child index ${index}`).toBe(true);
      expect(children[index], `${context}: child ${index}`).toBeDefined();
      pending.push(children[index]!);
    }
  }
  expect(leafCount, `${context}: leaves present`).toBeGreaterThan(0);
}

describe('large virtual array bounds', () => {
  const lengths = [
    2 ** 31 - 1,
    2 ** 31,
    2 ** 31 + 1,
    2 ** 32 - 1,
  ];
  const maximumLength = 2 ** 32 - 1;

  it('lowerBound uses overflow-safe high midpoints without allocating large arrays', () => {
    const tree = new BTree<number>(2, (a, b) => a < b);
    const bounds = privateBounds(tree);

    for (const length of lengths) {
      for (const target of [length - 2, length]) {
        const { items, accessed } = virtualSortedArray(length);
        const context = `length=${length}, target=${target}`;
        expect(items.length, `${context}: virtual length`).toBe(length);
        expect(bounds.lowerBound(items, target), context).toBe(target);
        expect(accessed.length, `${context}: logarithmic probe count`).toBeLessThan(64);
        if (target === length) {
          expect(accessed.at(-1), `${context}: final high probe`).toBe(length - 1);
        }
        if (length === maximumLength) {
          expect(accessed[1], `${context}: second high midpoint`).toBe(3_221_225_471);
          expect(
            accessed.some((index) => index > 2 ** 31),
            `${context}: accessed an index above 2^31`,
          ).toBe(true);
        }
      }
    }
  });

  it('upperBound uses overflow-safe high midpoints without allocating large arrays', () => {
    const tree = new BTree<number>(2, (a, b) => a < b);
    const bounds = privateBounds(tree);

    for (const length of lengths) {
      for (const target of [length - 2, length]) {
        const { items, accessed } = virtualSortedArray(length);
        const expected = target === length ? length : target + 1;
        const context = `length=${length}, target=${target}`;
        expect(items.length, `${context}: virtual length`).toBe(length);
        expect(bounds.upperBound(items, target), context).toBe(expected);
        expect(accessed.length, `${context}: logarithmic probe count`).toBeLessThan(64);
        expect(accessed.at(-1), `${context}: final high probe`).toBe(length - 1);
        if (length === maximumLength) {
          expect(accessed[1], `${context}: second high midpoint`).toBe(3_221_225_471);
          expect(
            accessed.some((index) => index > 2 ** 31),
            `${context}: accessed an index above 2^31`,
          ).toBe(true);
        }
      }
    }
  });
});

describe('foundAt and comparator-equivalent object identities', () => {
  it('uses the lowerBound invariant and one reverse comparison for an equivalent key', () => {
    let comparisons = 0;
    const tree = new BTree<Entry>(2, (a, b) => {
      comparisons += 1;
      return lessEntry(a, b);
    });
    const bounds = privateBounds(tree);
    const items = range(40)
      .filter((id) => id !== 15)
      .map((id) => makeEntry(id, 1))
      .sort(compareEntries);

    const hitProbe = makeEntry(14, 900);
    const hitIndex = bounds.lowerBound(items, hitProbe);
    expect(items[hitIndex]?.id).toBe(14);
    comparisons = 0;
    expect(bounds.foundAt(items, hitIndex, hitProbe)).toBe(true);
    expect(comparisons).toBe(1);

    const missProbe = makeEntry(15, 901);
    const missIndex = bounds.lowerBound(items, missProbe);
    expect(missIndex).toBeLessThan(items.length);
    comparisons = 0;
    expect(bounds.foundAt(items, missIndex, missProbe)).toBe(false);
    expect(comparisons).toBe(1);

    comparisons = 0;
    expect(bounds.foundAt(items, items.length, missProbe)).toBe(false);
    expect(comparisons).toBe(0);
  });

  for (const degree of DEGREES) {
    it(`degree ${degree}: seeded operations return stored objects through equivalent probes`, () => {
      const random = seededRandom(0x51f0a7 + degree);
      const tree = new BTree<Entry>(degree, lessEntry);
      const mirror = new Map<number, Entry>();
      const keySpace = 193;
      const operations = 2_000;
      let insertions = 0;
      let replacements = 0;
      let deletions = 0;
      let lookups = 0;

      for (let step = 0; step < operations; step += 1) {
        const id = Math.floor(random() * keySpace);
        const action = random();
        const expected = mirror.get(id);
        const context = `degree=${degree}, step=${step}, id=${id}`;

        if (action < 0.48) {
          const inserted = makeEntry(id, step + 1);
          expect(tree.replaceOrInsert(inserted), `${context}: replace result`).toBe(expected);
          mirror.set(id, inserted);
          if (expected === undefined) {
            insertions += 1;
          } else {
            replacements += 1;
          }
          expect(
            tree.get(makeEntry(id, -1)),
            `${context}: get replacement identity`,
          ).toBe(inserted);
        } else if (action < 0.76) {
          expect(
            tree.delete(makeEntry(id, -2)),
            `${context}: delete identity`,
          ).toBe(expected);
          if (expected !== undefined) {
            mirror.delete(id);
            deletions += 1;
          }
          expect(tree.get(makeEntry(id, -3)), `${context}: deleted lookup`).toBeUndefined();
        } else {
          expect(tree.get(makeEntry(id, -4)), `${context}: get identity`).toBe(expected);
          expect(tree.has(makeEntry(id, -5)), `${context}: has`).toBe(expected !== undefined);
          lookups += 1;
        }
        expect(tree.size, `${context}: size`).toBe(mirror.size);

        if (step % 160 === 0 || step === operations - 1) {
          expectPublicState(tree, sortedEntries(mirror), `${context}: checkpoint`);
        }
      }

      expect(insertions).toBeGreaterThan(0);
      expect(replacements).toBeGreaterThan(0);
      expect(deletions).toBeGreaterThan(0);
      expect(lookups).toBeGreaterThan(0);

      const drainOrder = shuffled([...mirror.keys()], 0xd14e7e + degree);
      for (const id of drainOrder) {
        const expected = mirror.get(id)!;
        expect(
          tree.delete(makeEntry(id, -6)),
          `degree=${degree}: drain delete id=${id}`,
        ).toBe(expected);
        mirror.delete(id);
        if (mirror.size % 32 === 0) {
          expectPublicState(tree, sortedEntries(mirror), `degree=${degree}: drain checkpoint`);
        }
      }
      expectPublicState(tree, [], `degree=${degree}: drained object tree`);
      expectStorageLayout(tree, `degree=${degree}: drained object layout`);
    });
  }
});

describe('comparison-free extreme deletion', () => {
  for (const degree of DEGREES) {
    it(`degree ${degree}: empty, singleton, and root-shrinking trees compare zero times`, () => {
      let comparisons = 0;
      const countingLess = (a: Entry, b: Entry): boolean => {
        comparisons += 1;
        return lessEntry(a, b);
      };
      const empty = new BTree<Entry>(degree, countingLess);
      const singletonMin = new BTree<Entry>(degree, countingLess);
      const singletonMax = new BTree<Entry>(degree, countingLess);
      const minTree = new BTree<Entry>(degree, countingLess);
      const maxTree = new BTree<Entry>(degree, countingLess);
      const singleMinEntry = makeEntry(1_001, 1);
      const singleMaxEntry = makeEntry(1_002, 1);
      singletonMin.replaceOrInsert(singleMinEntry);
      singletonMax.replaceOrInsert(singleMaxEntry);

      const entries = range(97)
        .map((id) => makeEntry(id, 1))
        .sort(compareEntries);
      for (const entry of shuffled(entries, 0xe317 + degree)) {
        minTree.replaceOrInsert(entry);
        maxTree.replaceOrInsert(entry);
      }
      expect(minTree.size).toBe(entries.length);
      expect(maxTree.size).toBe(entries.length);
      expect(treeHeight(minTree)).toBeGreaterThan(1);
      expect(treeHeight(maxTree)).toBeGreaterThan(1);

      comparisons = 0;
      expect(empty.deleteMin()).toBeUndefined();
      expect(empty.deleteMax()).toBeUndefined();
      expect(singletonMin.deleteMin()).toBe(singleMinEntry);
      expect(singletonMin.deleteMax()).toBeUndefined();
      expect(singletonMax.deleteMax()).toBe(singleMaxEntry);
      expect(singletonMax.deleteMin()).toBeUndefined();
      expectPublicState(empty, [], `degree=${degree}: empty extremes`);
      expectPublicState(singletonMin, [], `degree=${degree}: singleton min`);
      expectPublicState(singletonMax, [], `degree=${degree}: singleton max`);
      expect(comparisons).toBe(0);

      const drain = (tree: BTree<Entry>, minimum: boolean): void => {
        const remaining = [...entries];
        const direction = minimum ? 'min' : 'max';
        let previousHeight = treeHeight(tree);
        let rootShrinks = 0;
        let deletions = 0;

        while (remaining.length > 0) {
          const expected = minimum ? remaining.shift()! : remaining.pop()!;
          const actual = minimum ? tree.deleteMin() : tree.deleteMax();
          const context = `degree=${degree}, ${direction} drain #${deletions}`;
          expect(actual, `${context}: stored identity`).toBe(expected);
          expect(tree.size, `${context}: size`).toBe(remaining.length);
          expect(comparisons, `${context}: comparator count`).toBe(0);

          const height = treeHeight(tree);
          if (previousHeight > 1 && height < previousHeight) {
            rootShrinks += 1;
          }
          if (height !== previousHeight || deletions % 16 === 0) {
            expectPublicState(tree, remaining, `${context}: structural checkpoint`);
          }
          previousHeight = height;
          deletions += 1;
        }

        expectPublicState(tree, [], `degree=${degree}: ${direction} drained`);
        expect(rootShrinks, `degree=${degree}: ${direction} root shrinks`).toBeGreaterThan(0);
        expect(tree.deleteMin()).toBeUndefined();
        expect(tree.deleteMax()).toBeUndefined();
        expect(comparisons).toBe(0);
      };

      drain(minTree, true);
      drain(maxTree, false);
    });
  }
});

describe('range comparison regressions', () => {
  it('preserves exact bound checks and early-stop work on originals and clones', () => {
    const expectedComparisons: Record<number, number[]> = {
      2: [16, 14, 9, 9, 8, 10, 1, 1],
      3: [14, 11, 13, 13, 10, 8, 1, 1],
      4: [15, 12, 9, 9, 9, 9, 1, 1],
      32: [9, 7, 11, 11, 10, 10, 1, 1],
    };
    const expectedVisits = [16, 16, 1, 1, 0, 0, 1, 1];

    for (const degree of DEGREES) {
      let comparisons = 0;
      const tree = new BTree<number>(degree, (a, b) => {
        comparisons += 1;
        return a < b;
      });
      const count = Math.max(65, 8 * degree + 1);
      const sorted = range(count, -Math.floor(count / 2) * 2, 2);
      for (const value of shuffled(sorted, 0x7a9e1 + degree)) {
        tree.replaceOrInsert(value);
      }
      const min = sorted[0]!;
      const max = sorted.at(-1)!;
      const makeCases = (candidate: BTree<number>): Array<{
        name: string;
        traverse: Traversal<number>;
        limit?: number;
      }> => [
        {
          name: 'ascend early 16 from min',
          traverse: (visitor) => candidate.ascendGreaterOrEqual(min, visitor),
          limit: 16,
        },
        {
          name: 'descend early 16 from max',
          traverse: (visitor) => candidate.descendLessOrEqual(max, visitor),
          limit: 16,
        },
        {
          name: 'ascend middle one',
          traverse: (visitor) => candidate.ascendRange(-1, 1, visitor),
        },
        {
          name: 'descend middle one',
          traverse: (visitor) => candidate.descendRange(1, -1, visitor),
        },
        {
          name: 'ascend empty reversed',
          traverse: (visitor) => candidate.ascendRange(10, -10, visitor),
        },
        {
          name: 'descend empty reversed',
          traverse: (visitor) => candidate.descendRange(-10, 10, visitor),
        },
        {
          name: 'ascend early one with inclusive end',
          traverse: (visitor) => candidate.ascendLessThan(max + 1, visitor),
          limit: 1,
        },
        {
          name: 'descend early one with inclusive start',
          traverse: (visitor) => candidate.descendGreaterThan(min - 1, visitor),
          limit: 1,
        },
      ];

      for (const [generation, candidate] of [
        ['original', tree],
        ['clone', tree.clone()],
      ] as const) {
        makeCases(candidate).forEach(({ name, traverse, limit: stopAt }, index) => {
          comparisons = 0;
          const visited: number[] = [];
          const limit = stopAt ?? Number.POSITIVE_INFINITY;
          traverse((item) => {
            visited.push(item);
            return visited.length < limit;
          });
          const context = `degree=${degree}, ${generation}, ${name}`;
          expect(comparisons, `${context}: comparisons`).toBe(expectedComparisons[degree]![index]);
          expect(visited.length, `${context}: visits`).toBe(expectedVisits[index]);
        });
      }
    }
  });
});

describe('nullable leaves and dense internal children', () => {
  it('preserves exact shapes through right-donor borrow, merge, left borrow, and root shrink', () => {
    const initial = range(7, 1);
    const tree = numberTree(2, initial);
    const snapshot = tree.clone();
    expect(rootMirror(snapshot)).toBe(rootMirror(tree));
    expectStorageLayout(tree, 'initial rebalancing tree');

    // The middle child underflows and borrows from its shared right sibling.
    expect(tree.delete(3)).toBe(3);
    expect(rootMirror(tree)).toMatchObject({
      items: [2, 5],
      children: [
        { items: [1], children: null },
        { items: [4], children: null },
        { items: [6, 7], children: null },
      ],
    });
    expectStorageLayout(tree, 'after right-donor borrow');
    expectPublicState(snapshot, initial, 'unchanged right-donor snapshot');

    // Both siblings are minimal, so the next underflow merges to the left.
    expect(tree.delete(1)).toBe(1);
    expect(rootMirror(tree)).toMatchObject({
      items: [5],
      children: [
        { items: [2, 4], children: null },
        { items: [6, 7], children: null },
      ],
    });
    expectStorageLayout(tree, 'after merge');

    expect(tree.delete(6)).toBe(6);
    expect(tree.delete(7)).toBe(7);
    expect(rootMirror(tree)).toMatchObject({
      items: [4],
      children: [
        { items: [2], children: null },
        { items: [5], children: null },
      ],
    });
    expectStorageLayout(tree, 'after left-donor borrow');

    const oldRoot = rootMirror(tree)!;
    const replacement = oldRoot.children![0]!;
    expect(tree.delete(2)).toBe(2);
    expect(rootMirror(tree)).toBe(replacement);
    expect(rootMirror(tree)).toMatchObject({ items: [4, 5], children: null });
    expect(oldRoot.items).toEqual([]);
    expect(oldRoot.children).toBeNull();
    expectStorageLayout(tree, 'after root shrink');
    expectPublicState(tree, [4, 5], 'root-shrunk rebalancing tree');

    expect(tree.deleteMin()).toBe(4);
    expect(tree.deleteMax()).toBe(5);
    expectPublicState(tree, [], 'drained rebalancing tree');
    for (const expected of initial) {
      expect(snapshot.deleteMin()).toBe(expected);
    }
    expectPublicState(snapshot, [], 'drained stable snapshot');
  });

  it('survives 20,000 seeded mixed operations across interleaved clone generations', () => {
    const random = seededRandom(0x20c10e5);
    const initial = range(192, -96);
    const trees: BTree<number>[] = [
      numberTree(2, shuffled(initial, 0x1a71a1)),
    ];
    const mirrors: number[][] = [[...initial]];
    const cloneSteps = new Set([250, 3_000, 9_000]);
    const operations = 20_000;
    let insertions = 0;
    let replacements = 0;
    let deletions = 0;
    let extremeDeletes = 0;
    let lookups = 0;

    const checkAll = (context: string): void => {
      trees.forEach((tree, index) => {
        expectPublicState(tree, mirrors[index]!, `${context}: generation ${index}`);
        expectStorageLayout(tree, `${context}: generation ${index} layout`);
      });
    };

    checkAll('initial mixed-operation state');
    for (let step = 0; step < operations; step += 1) {
      if (cloneSteps.has(step)) {
        const parentIndex = trees.length - 1;
        const parent = trees[parentIndex]!;
        const child = parent.clone();
        expect(rootMirror(child), `step ${step}: shared clone root`).toBe(rootMirror(parent));
        trees.push(child);
        mirrors.push([...mirrors[parentIndex]!]);
        checkAll(`step ${step}: clone generation ${parentIndex + 1}`);
      }

      const owner = Math.floor(random() * trees.length);
      const tree = trees[owner]!;
      const mirror = mirrors[owner]!;
      const key = Math.floor(random() * 320) - 160;
      const action = random();
      const index = sortedLowerBound(mirror, key);
      const exists = mirror[index] === key;
      const context = `step=${step}, generation=${owner}, key=${key}`;

      if (action < 0.45) {
        expect(tree.replaceOrInsert(key), `${context}: replace result`).toBe(
          exists ? key : undefined,
        );
        if (exists) {
          replacements += 1;
        } else {
          mirror.splice(index, 0, key);
          insertions += 1;
        }
      } else if (action < 0.67) {
        expect(tree.delete(key), `${context}: delete result`).toBe(exists ? key : undefined);
        if (exists) {
          mirror.splice(index, 1);
          deletions += 1;
        }
      } else if (action < 0.745) {
        const expected = mirror.length === 0 ? undefined : mirror[0];
        expect(tree.deleteMin(), `${context}: deleteMin`).toBe(expected);
        if (mirror.length > 0) {
          mirror.shift();
          extremeDeletes += 1;
        }
      } else if (action < 0.82) {
        const expected = mirror.length === 0 ? undefined : mirror.at(-1);
        expect(tree.deleteMax(), `${context}: deleteMax`).toBe(expected);
        if (mirror.length > 0) {
          mirror.pop();
          extremeDeletes += 1;
        }
      } else {
        expect(tree.get(key), `${context}: get`).toBe(exists ? key : undefined);
        expect(tree.has(key), `${context}: has`).toBe(exists);
        lookups += 1;
      }
      expect(tree.size, `${context}: mutated size`).toBe(mirror.length);
      trees.forEach((candidate, generation) => {
        expect(candidate.size, `${context}: size of generation ${generation}`).toBe(
          mirrors[generation]!.length,
        );
      });

      if (step % 160 === 0 || step === operations - 1) {
        checkAll(`step ${step}: mixed-operation checkpoint`);
      }
    }

    expect(trees).toHaveLength(4);
    expect(insertions).toBeGreaterThan(0);
    expect(replacements).toBeGreaterThan(0);
    expect(deletions).toBeGreaterThan(0);
    expect(extremeDeletes).toBeGreaterThan(0);
    expect(lookups).toBeGreaterThan(0);
    checkAll('after 20,000 mixed operations');

    let drainStep = 0;
    let rootShrinks = 0;
    while (mirrors.some((mirror) => mirror.length > 0)) {
      for (let owner = 0; owner < trees.length; owner += 1) {
        const tree = trees[owner]!;
        const mirror = mirrors[owner]!;
        if (mirror.length === 0) {
          continue;
        }
        const previousHeight = treeHeight(tree);
        const minimum = random() < 0.5;
        const expected = minimum ? mirror.shift()! : mirror.pop()!;
        const actual = minimum ? tree.deleteMin() : tree.deleteMax();
        const context = `drain #${drainStep}, generation=${owner}`;
        expect(actual, `${context}: extreme identity`).toBe(expected);
        expect(tree.size, `${context}: size`).toBe(mirror.length);
        const height = treeHeight(tree);
        if (previousHeight > 1 && height < previousHeight) {
          rootShrinks += 1;
        }
        if (drainStep % 32 === 0 || height !== previousHeight) {
          expectPublicState(tree, mirror, `${context}: drain checkpoint`);
          expectStorageLayout(tree, `${context}: drain layout`);
        }
        drainStep += 1;
      }
    }

    expect(rootShrinks).toBeGreaterThan(0);
    trees.forEach((tree, generation) => {
      expectPublicState(tree, [], `drained generation ${generation}`);
      expectStorageLayout(tree, `drained generation ${generation} layout`);
      expect(tree.deleteMin()).toBeUndefined();
      expect(tree.deleteMax()).toBeUndefined();
    });
  }, 20_000);
});
