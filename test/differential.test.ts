import { describe, expect, it } from 'vitest';
import { BTree } from '../src/index';
import {
  DEGREES,
  collect,
  expectPublicState,
  lessNumber,
  lowerBound,
  numberTree,
  range,
  seededRandom,
  shuffled,
} from './helpers';

describe('sorted-array insertion and deletion differential', () => {
  const modes = ['ascending', 'descending', 'seeded random'] as const;

  for (const degree of DEGREES) {
    for (const mode of modes) {
      it(`degree ${degree}: ${mode} insertion and deletion match a sorted array`, () => {
        const sorted = range(97);
        const order = mode === 'ascending'
          ? sorted
          : mode === 'descending'
            ? [...sorted].reverse()
            : shuffled(sorted, 0x51a7 + degree);
        const tree = new BTree<number>(degree, lessNumber);
        const mirror: number[] = [];

        order.forEach((value, position) => {
          const context = `degree=${degree}, mode=${mode}, insert #${position} (${value})`;
          expect(tree.get(value), `${context}: absent before insert`).toBeUndefined();
          expect(tree.has(value), `${context}: has before insert`).toBe(false);
          expect(tree.replaceOrInsert(value), context).toBeUndefined();
          mirror.splice(lowerBound(mirror, value), 0, value);
          expectPublicState(tree, mirror, context);
          expect(tree.get(value), `${context}: get after insert`).toBe(value);
          expect(tree.has(value), `${context}: has after insert`).toBe(true);

          if (position % 11 === 0) {
            expect(tree.replaceOrInsert(value), `${context}: duplicate insert`).toBe(value);
            expectPublicState(tree, mirror, `${context}: after duplicate insert`);
          }
        });

        order.forEach((value, position) => {
          const context = `degree=${degree}, mode=${mode}, delete #${position} (${value})`;
          const index = lowerBound(mirror, value);
          expect(mirror[index], `${context}: mirror precondition`).toBe(value);
          expect(tree.delete(value), context).toBe(value);
          mirror.splice(index, 1);
          expectPublicState(tree, mirror, context);
          expect(tree.delete(value), `${context}: repeated delete`).toBeUndefined();
          expect(tree.get(value), `${context}: get after delete`).toBeUndefined();
          expect(tree.has(value), `${context}: has after delete`).toBe(false);
        });

        expectPublicState(tree, [], `${mode}: fully drained`);
      });
    }
  }
});

describe('min/max and extreme deletion', () => {
  for (const degree of DEGREES) {
    it(`degree ${degree}: deleteMin and deleteMax drain in sorted order`, () => {
      const sorted = range(101, -50);
      const insertionOrder = shuffled(sorted, 0x3e7e + degree);
      const minTree = numberTree(degree, insertionOrder);
      const maxTree = numberTree(degree, insertionOrder);
      const minMirror = [...sorted];
      const maxMirror = [...sorted];

      while (minMirror.length > 0) {
        const expected = minMirror.shift();
        const context = `degree=${degree}, deleteMin(${expected})`;
        expect(minTree.deleteMin(), context).toBe(expected);
        expectPublicState(minTree, minMirror, context);
      }
      expect(minTree.deleteMin()).toBeUndefined();

      while (maxMirror.length > 0) {
        const expected = maxMirror.pop();
        const context = `degree=${degree}, deleteMax(${expected})`;
        expect(maxTree.deleteMax(), context).toBe(expected);
        expectPublicState(maxTree, maxMirror, context);
      }
      expect(maxTree.deleteMax()).toBeUndefined();
    });
  }
});

describe('fixed-seed mixed-operation differential', () => {
  for (const degree of DEGREES) {
    it(`degree ${degree}: inserts, replacements, deletes, extrema, lookups, ranges, and clear`, () => {
      const random = seededRandom(0x6d3a91 + degree);
      const tree = new BTree<number>(degree, lessNumber);
      const mirror: number[] = [];
      const keySpace = 211;
      const operations = 1400;

      for (let step = 0; step < operations; step += 1) {
        let description = '';

        if (step === 700) {
          tree.clear();
          mirror.length = 0;
          description = 'forced clear';
        } else {
          const key = Math.floor(random() * keySpace);
          const other = Math.floor(random() * keySpace);
          const action = random();
          const index = lowerBound(mirror, key);
          const exists = mirror[index] === key;

          if (action < 0.44) {
            const expected = exists ? key : undefined;
            description = `replaceOrInsert(${key})`;
            expect(tree.replaceOrInsert(key), description).toBe(expected);
            if (!exists) {
              mirror.splice(index, 0, key);
            }
          } else if (action < 0.67) {
            description = `delete(${key})`;
            expect(tree.delete(key), description).toBe(exists ? key : undefined);
            if (exists) {
              mirror.splice(index, 1);
            }
          } else if (action < 0.75) {
            description = 'deleteMin()';
            const expected = mirror.length === 0 ? undefined : mirror[0];
            expect(tree.deleteMin(), description).toBe(expected);
            if (mirror.length > 0) {
              mirror.shift();
            }
          } else if (action < 0.83) {
            description = 'deleteMax()';
            const expected = mirror.length === 0
              ? undefined
              : mirror[mirror.length - 1];
            expect(tree.deleteMax(), description).toBe(expected);
            if (mirror.length > 0) {
              mirror.pop();
            }
          } else if (action < 0.91) {
            description = `get/has(${key})`;
            expect(tree.get(key), description).toBe(exists ? key : undefined);
            expect(tree.has(key), description).toBe(exists);
          } else {
            description = `ranges(${key}, ${other})`;
            expect(
              collect<number>((visitor) => tree.ascendRange(key, other, visitor)),
              `${description}: ascendRange`,
            ).toEqual(mirror.filter((item) => item >= key && item < other));
            expect(
              collect<number>((visitor) => tree.descendRange(key, other, visitor)),
              `${description}: descendRange`,
            ).toEqual(
              [...mirror]
                .reverse()
                .filter((item) => item <= key && item > other),
            );
          }
        }

        expectPublicState(
          tree,
          mirror,
          `degree=${degree}, seed=0x6d3a91+${degree}, step=${step}: ${description}`,
        );
      }

      let drainStep = 0;
      while (mirror.length > 0) {
        const fromMin = random() < 0.5;
        const expected = fromMin ? mirror.shift() : mirror.pop();
        const description = `final drain #${drainStep}: ${fromMin ? 'deleteMin' : 'deleteMax'}`;
        const actual = fromMin ? tree.deleteMin() : tree.deleteMax();
        expect(actual, description).toBe(expected);
        expectPublicState(tree, mirror, `degree=${degree}, ${description}`);
        drainStep += 1;
      }

      expect(tree.deleteMin()).toBeUndefined();
      expect(tree.deleteMax()).toBeUndefined();
    });
  }
});
