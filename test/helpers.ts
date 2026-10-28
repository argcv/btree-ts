import { expect } from 'vitest';
import { BTree, type Less, type Visitor } from '../src/index';

export const DEGREES = [2, 3, 4, 32];

export const lessNumber: Less<number> = (a, b) => a < b;

export type Traversal<T> = (visitor: Visitor<T>) => void;

export function collect<T>(traverse: Traversal<T>): T[] {
  const result: T[] = [];
  traverse((item) => {
    result.push(item);
    return true;
  });
  return result;
}

export function range(count: number, start = 0, step = 1): number[] {
  return Array.from({ length: count }, (_, index) => start + index * step);
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

export function shuffled<T>(values: readonly T[], seed: number): T[] {
  const result = [...values];
  const random = seededRandom(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    const current = result[index]!;
    result[index] = result[other]!;
    result[other] = current;
  }
  return result;
}

export function numberTree(degree: number, values: readonly number[] = []): BTree<number> {
  const tree = new BTree<number>(degree, lessNumber);
  for (const value of values) {
    tree.replaceOrInsert(value);
  }
  return tree;
}

export function lowerBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (values[middle]! < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

/** Assert only public, observable state; the sorted array is the test mirror. */
export function expectPublicState<T>(
  tree: BTree<T>,
  expected: readonly T[],
  context = 'tree state',
): void {
  expect(tree.size, `${context}: size`).toBe(expected.length);
  expect(
    collect<T>((visitor) => tree.ascend(visitor)),
    `${context}: ascending items`,
  ).toEqual(expected);
  expect(
    collect<T>((visitor) => tree.descend(visitor)),
    `${context}: descending items`,
  ).toEqual([...expected].reverse());

  if (expected.length === 0) {
    expect(tree.min(), `${context}: min of empty tree`).toBeUndefined();
    expect(tree.max(), `${context}: max of empty tree`).toBeUndefined();
  } else {
    expect(tree.min(), `${context}: min`).toBe(expected[0]);
    expect(tree.max(), `${context}: max`).toBe(expected[expected.length - 1]);
  }

  expectInternalInvariants(tree, expected.length, context);
}


/** Test-only structural mirror; production does not expose its nodes. */
export interface NodeMirror<T> {
  readonly items: readonly T[];
  readonly children: readonly NodeMirror<T>[] | null;
}

export function rootMirror<T>(tree: BTree<T>): NodeMirror<T> | null {
  return (tree as unknown as { root: NodeMirror<T> | null }).root;
}

function invariant(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function expectInternalInvariants<T>(
  tree: BTree<T>,
  expectedSize: number,
  context: string,
): void {
  const root = rootMirror(tree);
  if (root === null) {
    invariant(expectedSize === 0, `${context}: null root with nonzero size`);
    return;
  }

  const seen = new Set<NodeMirror<T>>();
  let itemCount = 0;
  let leafDepth = -1;

  function visit(node: NodeMirror<T>, depth: number, isRoot: boolean): void {
    invariant(!seen.has(node), `${context}: node aliasing within one tree`);
    seen.add(node);
    invariant(node.items.length <= 2 * tree.degree - 1, `${context}: node overflow`);
    invariant(
      isRoot || node.items.length >= tree.degree - 1,
      `${context}: non-root node underflow`,
    );
    invariant(
      node.items.length > 0 || (isRoot && expectedSize === 0),
      `${context}: unexpected empty node`,
    );

    for (let index = 0; index < node.items.length; index += 1) {
      invariant(index in node.items, `${context}: sparse item array at ${index}`);
    }

    itemCount += node.items.length;
    if (node.children === null) {
      if (leafDepth === -1) {
        leafDepth = depth;
      } else {
        invariant(leafDepth === depth, `${context}: leaves have different depths`);
      }
      return;
    }

    for (let index = 0; index < node.children.length; index += 1) {
      invariant(index in node.children, `${context}: sparse child array at ${index}`);
    }
    invariant(
      node.children.length === node.items.length + 1,
      `${context}: children/items arity mismatch`,
    );
    for (const child of node.children) {
      visit(child, depth + 1, false);
    }
  }

  visit(root, 0, true);
  invariant(itemCount === expectedSize, `${context}: structural item count mismatch`);
}
