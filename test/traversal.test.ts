import { describe, expect, it } from 'vitest';
import { BTree } from '../src/index';
import {
  DEGREES,
  type Traversal,
  collect,
  lessNumber,
  numberTree,
  range,
  shuffled,
} from './helpers';

function makeTraversalTree(degree: number): {
  tree: BTree<number>;
  sorted: number[];
} {
  // Large enough to cross leaf/parent/sibling boundaries even at degree 32.
  const count = Math.max(65, 8 * degree + 1);
  const sorted = range(count, -Math.floor(count / 2) * 2, 2);
  return {
    tree: numberTree(degree, shuffled(sorted, 0x7a9e1 + degree)),
    sorted,
  };
}

function emptyTreeTraversals(tree: BTree<number>): Array<[string, Traversal<number>]> {
  return [
    ['ascend', (visitor) => tree.ascend(visitor)],
    ['ascendRange', (visitor) => tree.ascendRange(-10, 10, visitor)],
    ['ascendLessThan', (visitor) => tree.ascendLessThan(10, visitor)],
    ['ascendGreaterOrEqual', (visitor) => tree.ascendGreaterOrEqual(-10, visitor)],
    ['descend', (visitor) => tree.descend(visitor)],
    ['descendRange', (visitor) => tree.descendRange(10, -10, visitor)],
    ['descendLessOrEqual', (visitor) => tree.descendLessOrEqual(10, visitor)],
    ['descendGreaterThan', (visitor) => tree.descendGreaterThan(-10, visitor)],
  ];
}

describe('empty traversals', () => {
  for (const degree of DEGREES) {
    it(`degree ${degree}: no method visits a missing or emptied root`, () => {
      const missingRoot = new BTree<number>(degree, lessNumber);
      const emptiedRoot = numberTree(degree, [0]);
      expect(emptiedRoot.delete(0)).toBe(0);

      for (const [treeName, tree] of [
        ['missing root', missingRoot],
        ['emptied root', emptiedRoot],
      ] as const) {
        for (const [methodName, traverse] of emptyTreeTraversals(tree)) {
          expect(
            collect(traverse),
            `${treeName}: ${methodName} must not visit anything`,
          ).toEqual([]);
        }
      }
    });
  }
});

describe('traversal boundaries and interval semantics', () => {
  for (const degree of DEGREES) {
    it(`degree ${degree}: full and one-sided traversals honor inclusive/exclusive pivots`, () => {
      const { tree, sorted } = makeTraversalTree(degree);
      const reversed = [...sorted].reverse();
      const min = sorted[0]!;
      const max = sorted[sorted.length - 1]!;
      const pivots = [min - 2, min, min + 1, -1, 0, 1, max - 1, max, max + 2];

      expect(collect<number>((visitor) => tree.ascend(visitor))).toEqual(sorted);
      expect(collect<number>((visitor) => tree.descend(visitor))).toEqual(reversed);

      for (const pivot of pivots) {
        const context = `degree=${degree}, pivot=${pivot}`;
        expect(
          collect<number>((visitor) => tree.ascendLessThan(pivot, visitor)),
          `${context}: ascendLessThan is (-Infinity, pivot)`,
        ).toEqual(sorted.filter((item) => item < pivot));
        expect(
          collect<number>((visitor) => tree.ascendGreaterOrEqual(pivot, visitor)),
          `${context}: ascendGreaterOrEqual is [pivot, +Infinity)`,
        ).toEqual(sorted.filter((item) => item >= pivot));
        expect(
          collect<number>((visitor) => tree.descendLessOrEqual(pivot, visitor)),
          `${context}: descendLessOrEqual is (-Infinity, pivot]`,
        ).toEqual(reversed.filter((item) => item <= pivot));
        expect(
          collect<number>((visitor) => tree.descendGreaterThan(pivot, visitor)),
          `${context}: descendGreaterThan is (pivot, +Infinity)`,
        ).toEqual(reversed.filter((item) => item > pivot));
      }
    });

    it(`degree ${degree}: both range methods cover exact, empty, and reversed intervals`, () => {
      const { tree, sorted } = makeTraversalTree(degree);
      const reversed = [...sorted].reverse();
      const min = sorted[0]!;
      const max = sorted[sorted.length - 1]!;
      const bounds = [min - 2, min, min + 1, -1, 0, 1, max - 1, max, max + 2];

      for (const first of bounds) {
        for (const second of bounds) {
          const context = `degree=${degree}, bounds=${first},${second}`;
          expect(
            collect<number>((visitor) => tree.ascendRange(first, second, visitor)),
            `${context}: ascendRange must be [greaterOrEqual, lessThan)`,
          ).toEqual(sorted.filter((item) => item >= first && item < second));

          expect(
            collect<number>((visitor) => tree.descendRange(first, second, visitor)),
            `${context}: descendRange must be (greaterThan, lessOrEqual]`,
          ).toEqual(reversed.filter((item) => item <= first && item > second));
        }
      }
    });
  }
});

describe('visitor early stop', () => {
  for (const degree of DEGREES) {
    it(`degree ${degree}: every method stops at every yielded position`, () => {
      const { tree, sorted } = makeTraversalTree(degree);
      const reversed = [...sorted].reverse();
      const min = sorted[0]!;
      const max = sorted[sorted.length - 1]!;
      const centralAscending = sorted.filter((item) => item >= -11 && item < 11);
      const centralDescending = reversed.filter((item) => item <= 11 && item > -11);
      const cases: Array<{
        name: string;
        expected: number[];
        traverse: Traversal<number>;
      }> = [
        {
          name: 'ascend',
          expected: sorted,
          traverse: (visitor) => tree.ascend(visitor),
        },
        {
          name: 'ascendRange (full)',
          expected: sorted,
          traverse: (visitor) => tree.ascendRange(min - 1, max + 1, visitor),
        },
        {
          name: 'ascendRange (partial)',
          expected: centralAscending,
          traverse: (visitor) => tree.ascendRange(-11, 11, visitor),
        },
        {
          name: 'ascendLessThan',
          expected: sorted,
          traverse: (visitor) => tree.ascendLessThan(max + 1, visitor),
        },
        {
          name: 'ascendGreaterOrEqual',
          expected: sorted,
          traverse: (visitor) => tree.ascendGreaterOrEqual(min, visitor),
        },
        {
          name: 'descend',
          expected: reversed,
          traverse: (visitor) => tree.descend(visitor),
        },
        {
          name: 'descendRange (full)',
          expected: reversed,
          traverse: (visitor) => tree.descendRange(max + 1, min - 1, visitor),
        },
        {
          name: 'descendRange (partial)',
          expected: centralDescending,
          traverse: (visitor) => tree.descendRange(11, -11, visitor),
        },
        {
          name: 'descendLessOrEqual',
          expected: reversed,
          traverse: (visitor) => tree.descendLessOrEqual(max, visitor),
        },
        {
          name: 'descendGreaterThan',
          expected: reversed,
          traverse: (visitor) => tree.descendGreaterThan(min - 1, visitor),
        },
      ];

      for (const { name, expected, traverse } of cases) {
        expect(collect(traverse), `${name}: full traversal`).toEqual(expected);

        for (let stopAfter = 1; stopAfter <= expected.length; stopAfter += 1) {
          const actual: number[] = [];
          traverse((item) => {
            actual.push(item);
            return actual.length < stopAfter;
          });
          expect(
            actual,
            `${name}: visitor returned false at item ${stopAfter}`,
          ).toEqual(expected.slice(0, stopAfter));
        }
      }
    });
  }
});
