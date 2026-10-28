import { describe, expect, it } from 'vitest';
import { BTree } from '../src/index';
import {
  DEGREES,
  collect,
  expectPublicState,
  lessNumber,
  numberTree,
  range,
  shuffled,
} from './helpers';

describe('constructor and empty-tree contract', () => {
  for (const degree of DEGREES) {
    it(`supports degree ${degree} and starts empty`, () => {
      const tree = new BTree<number>(degree, lessNumber);

      expect(tree.degree).toBe(degree);
      expect(tree.size).toBe(0);
      expect(tree.get(0)).toBeUndefined();
      expect(tree.has(0)).toBe(false);
      expect(tree.delete(0)).toBeUndefined();
      expect(tree.deleteMin()).toBeUndefined();
      expect(tree.deleteMax()).toBeUndefined();
      expectPublicState(tree, []);
    });
  }

  const invalidDegrees = [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    2.5,
    -3.5,
    Number.MAX_SAFE_INTEGER + 1,
    Number.MIN_SAFE_INTEGER - 1,
    1,
    0,
    -1,
    -32,
  ];

  for (const degree of invalidDegrees) {
    it(`rejects invalid degree ${String(degree)}`, () => {
      expect(() => new BTree<number>(degree, lessNumber)).toThrow(RangeError);
    });
  }

  it('keeps min/max singleton behavior distinct from an absent result', () => {
    const minTree = numberTree(2, [0]);
    expect(minTree.min()).toBe(0);
    expect(minTree.max()).toBe(0);
    expect(minTree.deleteMin()).toBe(0);
    expectPublicState(minTree, []);
    expect(minTree.deleteMin()).toBeUndefined();
    expect(minTree.deleteMax()).toBeUndefined();

    const maxTree = numberTree(2, [0]);
    expect(maxTree.deleteMax()).toBe(0);
    expectPublicState(maxTree, []);
    expect(maxTree.deleteMin()).toBeUndefined();
    expect(maxTree.deleteMax()).toBeUndefined();
  });
});

describe('valid falsy and null items', () => {
  it('stores 0 without confusing it with an absent item', () => {
    const tree = new BTree<number>(2, lessNumber);
    expect(tree.replaceOrInsert(0)).toBeUndefined();
    expect(tree.size).toBe(1);
    expect(tree.get(0)).toBe(0);
    expect(tree.has(0)).toBe(true);
    expect(tree.min()).toBe(0);
    expect(tree.max()).toBe(0);
    expect(tree.delete(0)).toBe(0);
    expect(tree.size).toBe(0);
  });

  it('stores false without confusing it with an absent item', () => {
    const tree = new BTree<boolean>(2, (a, b) => Number(a) < Number(b));
    expect(tree.replaceOrInsert(false)).toBeUndefined();
    expect(tree.get(false)).toBe(false);
    expect(tree.has(false)).toBe(true);
    expect(tree.min()).toBe(false);
    expect(tree.max()).toBe(false);
    expect(tree.delete(false)).toBe(false);
    expect(tree.size).toBe(0);
  });

  it("stores '' without confusing it with an absent item", () => {
    const tree = new BTree<string>(2, (a, b) => a < b);
    expect(tree.replaceOrInsert('')).toBeUndefined();
    expect(tree.get('')).toBe('');
    expect(tree.has('')).toBe(true);
    expect(tree.min()).toBe('');
    expect(tree.max()).toBe('');
    expect(tree.delete('')).toBe('');
    expect(tree.size).toBe(0);
  });

  it('stores null without confusing it with an absent item', () => {
    const tree = new BTree<null>(2, () => false);
    expect(tree.replaceOrInsert(null)).toBeUndefined();
    expect(tree.size).toBe(1);
    expect(tree.get(null)).toBeNull();
    expect(tree.has(null)).toBe(true);
    expect(tree.min()).toBeNull();
    expect(tree.max()).toBeNull();
    expect(tree.replaceOrInsert(null)).toBeNull();
    expect(tree.size).toBe(1);
    expect(tree.delete(null)).toBeNull();
    expect(tree.size).toBe(0);
    expect(tree.get(null)).toBeUndefined();
  });
});

describe('undefined item and pivot rejection', () => {
  const missing = undefined as unknown as number;
  const visit = () => true;
  const calls: Array<readonly [string, (tree: BTree<number>) => unknown]> = [
    ['get(item)', (tree) => tree.get(missing)],
    ['has(item)', (tree) => tree.has(missing)],
    ['replaceOrInsert(item)', (tree) => tree.replaceOrInsert(missing)],
    ['delete(item)', (tree) => tree.delete(missing)],
    ['ascendRange(greaterOrEqual, lessThan) lower bound', (tree) =>
      tree.ascendRange(missing, 20, visit)],
    ['ascendRange(greaterOrEqual, lessThan) upper bound', (tree) =>
      tree.ascendRange(10, missing, visit)],
    ['ascendLessThan(pivot)', (tree) => tree.ascendLessThan(missing, visit)],
    ['ascendGreaterOrEqual(pivot)', (tree) =>
      tree.ascendGreaterOrEqual(missing, visit)],
    ['descendRange(lessOrEqual, greaterThan) upper bound', (tree) =>
      tree.descendRange(missing, 10, visit)],
    ['descendRange(lessOrEqual, greaterThan) lower bound', (tree) =>
      tree.descendRange(20, missing, visit)],
    ['descendLessOrEqual(pivot)', (tree) =>
      tree.descendLessOrEqual(missing, visit)],
    ['descendGreaterThan(pivot)', (tree) =>
      tree.descendGreaterThan(missing, visit)],
  ];

  for (const [name, invoke] of calls) {
    it(`${name} throws TypeError on both empty and populated trees`, () => {
      for (const values of [[], [10, 20, 30]]) {
        const tree = numberTree(2, values);
        expect(() => invoke(tree)).toThrow(TypeError);
        expectPublicState(tree, values);
      }
    });
  }
});

describe('comparator-equivalent object keys', () => {
  interface Entry {
    key: number;
    payload: string;
  }

  const byKey = (a: Entry, b: Entry) => a.key < b.key;

  for (const degree of DEGREES) {
    it(`degree ${degree}: replacement and deletion use the actual stored objects`, () => {
      const keys = range(40);
      const originals = keys.map((key) => ({ key, payload: `original-${key}` }));
      const tree = new BTree<Entry>(degree, byKey);

      for (const index of shuffled(keys, 0x0b1ec7 + degree)) {
        expect(tree.replaceOrInsert(originals[index]!)).toBeUndefined();
      }
      expect(tree.size).toBe(keys.length);

      const replacements = keys.map((key) => ({ key, payload: `replacement-${key}` }));
      for (const index of shuffled(keys, 0xabc123 + degree)) {
        const probe = { key: index, payload: 'probe' };
        expect(tree.replaceOrInsert(replacements[index]!)).toBe(originals[index]!);
        expect(tree.size).toBe(keys.length);
        expect(tree.get(probe)).toBe(replacements[index]!);
        expect(tree.has(probe)).toBe(true);
      }

      let deleted = 0;
      for (const index of shuffled(keys, 0xde1e7e + degree)) {
        const probe = { key: index, payload: 'delete probe' };
        expect(tree.get(probe)).toBe(replacements[index]!);
        expect(tree.delete(probe)).toBe(replacements[index]!);
        expect(tree.get(probe)).toBeUndefined();
        expect(tree.has(probe)).toBe(false);
        deleted += 1;
        expect(tree.size).toBe(keys.length - deleted);
      }
      expectPublicState(tree, []);
    });
  }
  it('degree 2: equivalent replacement survives full child and full root pre-splits', () => {
    for (const { count, key } of [{ count: 7, key: 6 }, { count: 9, key: 4 }]) {
      const originals = range(count, 1).map((value) => ({
        key: value,
        payload: `original-${value}`,
      }));
      const tree = new BTree<Entry>(2, byKey);
      for (const original of originals) {
        expect(tree.replaceOrInsert(original)).toBeUndefined();
      }

      const replacement = { key, payload: `replacement-after-split-${count}` };
      expect(tree.replaceOrInsert(replacement)).toBe(originals[key - 1]);
      const expected = [...originals];
      expected[key - 1] = replacement;
      expect(tree.size).toBe(count);
      expect(tree.get({ key, payload: 'probe' })).toBe(replacement);
      expectPublicState(tree, expected);
    }
  });

});

describe('clear and reuse', () => {
  for (const degree of DEGREES) {
    it(`degree ${degree}: clear is idempotent and the same instance is reusable`, () => {
      const tree = numberTree(degree, shuffled(range(80), 0xc1ea2 + degree));
      tree.clear();
      expect(tree.degree).toBe(degree);
      expectPublicState(tree, []);
      expect(tree.get(10)).toBeUndefined();
      expect(tree.has(10)).toBe(false);
      expect(tree.delete(10)).toBeUndefined();

      tree.clear();
      expectPublicState(tree, []);

      const reused = [5, -1, 8, 0, 5, -7, 8];
      const mirror: number[] = [];
      for (const item of reused) {
        const previous = mirror.includes(item) ? item : undefined;
        expect(tree.replaceOrInsert(item)).toBe(previous);
        if (!mirror.includes(item)) {
          mirror.push(item);
          mirror.sort((a, b) => a - b);
        }
        expectPublicState(tree, mirror);
      }

      expect(collect<number>((visitor) => tree.ascend(visitor))).toEqual(mirror);
      tree.clear();
      expectPublicState(tree, []);
    });
  }
});
