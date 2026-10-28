import { describe, expect, it } from 'vitest';
import { BTree } from '../src/index';
import {
  DEGREES,
  expectPublicState,
  lessNumber,
  lowerBound,
  numberTree,
  range,
  rootMirror,
  shuffled,
} from './helpers';

interface Entry {
  key: number;
  payload: string;
}

const byKey = (a: Entry, b: Entry) => a.key < b.key;

type DeleteStep =
  | { kind: 'item'; value: number }
  | { kind: 'min' }
  | { kind: 'max' };

function applyDeleteStep(
  tree: BTree<number>,
  mirror: number[],
  step: DeleteStep,
  context: string,
): void {
  if (step.kind === 'item') {
    const index = lowerBound(mirror, step.value);
    expect(mirror[index], `${context}: mirror precondition`).toBe(step.value);
    expect(tree.delete(step.value), context).toBe(step.value);
    mirror.splice(index, 1);
    return;
  }

  const expected = step.kind === 'min' ? mirror.shift() : mirror.pop();
  const actual = step.kind === 'min' ? tree.deleteMin() : tree.deleteMax();
  expect(actual, context).toBe(expected);
}

const deletionScenarios: Array<{
  name: string;
  steps: (sorted: number[], degree: number) => DeleteStep[];
}> = [
  {
    name: 'ascending item deletes (right-borrow, merge, and root-shrink stress)',
    steps: (sorted) => sorted.map<DeleteStep>((value) => ({ kind: 'item', value })),
  },
  {
    name: 'descending item deletes (left-borrow, merge, and root-shrink stress)',
    steps: (sorted) => [...sorted]
      .reverse()
      .map<DeleteStep>((value) => ({ kind: 'item', value })),
  },
  {
    name: 'seeded interior deletes (both borrow directions and merge stress)',
    steps: (sorted, degree) => shuffled(sorted, 0xc10e + degree)
      .map<DeleteStep>((value) => ({ kind: 'item', value })),
  },
  {
    name: 'alternating extreme deletes (deleteMin/deleteMax root-shrink stress)',
    steps: (sorted) => sorted.map<DeleteStep>((_, index) => ({
      kind: index % 2 === 0 ? 'min' : 'max',
    })),
  },
];

describe('clone copy-on-write isolation', () => {
  for (const degree of DEGREES) {
    it(`degree ${degree}: insert/split and equivalent-key replacement writes are bidirectionally isolated`, () => {
      for (const mutateClone of [true, false]) {
        const direction = mutateClone ? 'write clone' : 'write original';
        const count = Math.max(40, 2 * degree + 1);
        const originals = range(count).map((key) => ({
          key,
          payload: `original-${key}`,
        }));
        const original = new BTree<Entry>(degree, byKey);
        for (const index of shuffled(range(count), 0x1a2b3c + degree)) {
          original.replaceOrInsert(originals[index]!);
        }
        const clone = original.clone();
        const mutable = mutateClone ? clone : original;
        const stable = mutateClone ? original : clone;
        const mutableMirror = [...originals];

        expect(clone).not.toBe(original);
        expect(clone.degree).toBe(degree);
        expectPublicState(original, originals, `${direction}: original snapshot`);
        expectPublicState(clone, originals, `${direction}: clone snapshot`);
        for (const key of range(count)) {
          expect(clone.get({ key, payload: 'probe' })).toBe(originals[key]);
        }

        const replacementIndexes = [0, Math.floor(count / 2), count - 1];
        for (const key of replacementIndexes) {
          const replacement = { key, payload: `replacement-${direction}-${key}` };
          const probe = { key, payload: 'equivalent-key probe' };
          expect(
            mutable.replaceOrInsert(replacement),
            `${direction}: replace key ${key}`,
          ).toBe(originals[key]);
          mutableMirror[key] = replacement;

          expect(mutable.get(probe)).toBe(replacement);
          expect(stable.get(probe)).toBe(originals[key]);
          expect(mutable.size).toBe(count);
          expect(stable.size).toBe(count);
          expectPublicState(mutable, mutableMirror, `${direction}: replacement ${key}`);
          expectPublicState(stable, originals, `${direction}: stable after replacement ${key}`);
        }

        // Double the key set to force node splits on the mutated side only.
        for (const key of range(count, count)) {
          const inserted = { key, payload: `inserted-${direction}-${key}` };
          expect(mutable.replaceOrInsert(inserted)).toBeUndefined();
          mutableMirror.push(inserted);
          expect(stable.has({ key, payload: 'probe' })).toBe(false);
          expectPublicState(mutable, mutableMirror, `${direction}: split insert ${key}`);
          expectPublicState(stable, originals, `${direction}: stable after split insert ${key}`);
        }
      }
    });
  }

  for (const degree of DEGREES) {
    for (const scenario of deletionScenarios) {
      it(`degree ${degree}: ${scenario.name} remain isolated in both directions`, () => {
        for (const mutateClone of [true, false]) {
          const direction = mutateClone ? 'write clone' : 'write original';
          const count = Math.max(97, 8 * degree + 1);
          const sorted = range(count, -Math.floor(count / 2));
          const original = numberTree(
            degree,
            shuffled(sorted, 0xb0770 + degree),
          );
          const clone = original.clone();
          const mutable = mutateClone ? clone : original;
          const stable = mutateClone ? original : clone;
          const mutableMirror = [...sorted];
          const steps = scenario.steps(sorted, degree);

          expectPublicState(stable, sorted, `${direction}: initial stable snapshot`);
          steps.forEach((step, index) => {
            const context = `${direction}, degree=${degree}, step #${index}`;
            applyDeleteStep(mutable, mutableMirror, step, context);
            expectPublicState(mutable, mutableMirror, `${context}: mutated tree`);
            expectPublicState(stable, sorted, `${context}: unchanged tree`);
          });

          expectPublicState(mutable, [], `${direction}: drained mutated tree`);
          expectPublicState(stable, sorted, `${direction}: final unchanged snapshot`);
        }
      });
    }
  }

  it('degree 2: a shared right-donor merge is isolated in both directions', () => {
    const sorted = range(7, 1);
    for (const mutateClone of [true, false]) {
      const direction = mutateClone ? 'write clone' : 'write original';
      const original = numberTree(2, sorted);
      const clone = original.clone();
      const mutable = mutateClone ? clone : original;
      const stable = mutateClone ? original : clone;

      // This deletion merges with a shared right donor after the clone.
      expect(mutable.delete(1)).toBe(1);
      expectPublicState(mutable, sorted.slice(1), direction);
      expectPublicState(stable, sorted, `${direction}: unchanged donor snapshot`);

      expect(stable.delete(7)).toBe(7);
      expectPublicState(stable, sorted.slice(0, -1), `${direction}: second write`);
      expectPublicState(mutable, sorted.slice(1), `${direction}: first snapshot remains`);
    }
  });


  for (const degree of DEGREES) {
    it(`degree ${degree}: clear and reuse on either side do not mutate the other`, () => {
      for (const mutateClone of [true, false]) {
        const direction = mutateClone ? 'clear clone' : 'clear original';
        const sorted = range(Math.max(65, 4 * degree + 1));
        const original = numberTree(degree, shuffled(sorted, 0xc1ea + degree));
        const clone = original.clone();
        const mutable = mutateClone ? clone : original;
        const stable = mutateClone ? original : clone;

        mutable.clear();
        expectPublicState(mutable, [], `${direction}: cleared side`);
        expectPublicState(stable, sorted, `${direction}: stable side`);

        const reused = shuffled(range(40, 1000), 0x2e5e + degree);
        const reuseMirror: number[] = [];
        for (const value of reused) {
          expect(mutable.replaceOrInsert(value)).toBeUndefined();
          reuseMirror.splice(lowerBound(reuseMirror, value), 0, value);
        }
        expectPublicState(mutable, reuseMirror, `${direction}: reused side`);
        expectPublicState(stable, sorted, `${direction}: stable after reuse`);

        stable.clear();
        expectPublicState(stable, [], `${direction}: other side cleared later`);
        expectPublicState(mutable, reuseMirror, `${direction}: reused side remains intact`);
      }
    });

    it(`degree ${degree}: clones of an empty tree also have independent write lifetimes`, () => {
      const original = new BTree<number>(degree, lessNumber);
      const clone = original.clone();
      expect(clone.degree).toBe(degree);
      expectPublicState(original, []);
      expectPublicState(clone, []);

      clone.replaceOrInsert(1);
      original.replaceOrInsert(-1);
      expectPublicState(original, [-1]);
      expectPublicState(clone, [1]);

      original.clear();
      expectPublicState(original, []);
      expectPublicState(clone, [1]);
    });
  }

  it('shares nodes lazily and isolates alternating writes across clone generations', () => {
    const sorted = range(40).map((value) => value * 2);
    const original = numberTree(3, shuffled(sorted, 0x5a4e));
    const sharedRoot = rootMirror(original);
    const clone = original.clone();
    const grandclone = clone.clone();
    const trees = [original, clone, grandclone];
    const mirrors = trees.map(() => [...sorted]);

    expect(rootMirror(clone)).toBe(sharedRoot);
    expect(rootMirror(grandclone)).toBe(sharedRoot);

    original.replaceOrInsert(-1);
    mirrors[0]!.splice(lowerBound(mirrors[0]!, -1), 0, -1);
    expect(rootMirror(original)).not.toBe(sharedRoot);
    expect(rootMirror(clone)).toBe(sharedRoot);
    expect(rootMirror(grandclone)).toBe(sharedRoot);

    clone.replaceOrInsert(79);
    mirrors[1]!.splice(lowerBound(mirrors[1]!, 79), 0, 79);
    expect(rootMirror(clone)).not.toBe(sharedRoot);
    expect(rootMirror(grandclone)).toBe(sharedRoot);

    expect(grandclone.replaceOrInsert(40)).toBe(40);
    expect(rootMirror(grandclone)).not.toBe(sharedRoot);

    for (let step = 0; step < 120; step += 1) {
      const owner = step % trees.length;
      const tree = trees[owner]!;
      const mirror = mirrors[owner]!;
      const key = step - 20;
      const index = lowerBound(mirror, key);
      const exists = mirror[index] === key;
      expect(tree.replaceOrInsert(key)).toBe(exists ? key : undefined);
      if (!exists) {
        mirror.splice(index, 0, key);
      }
      trees.forEach((candidate, index) => {
        expectPublicState(candidate, mirrors[index]!, `alternating insert ${step}, tree ${index}`);
      });
    }

    for (let step = 0; step < 120; step += 1) {
      const owner = step % trees.length;
      const tree = trees[owner]!;
      const mirror = mirrors[owner]!;
      const key = step - 20;
      const index = lowerBound(mirror, key);
      expect(mirror[index]).toBe(key);
      expect(tree.delete(key)).toBe(key);
      mirror.splice(index, 1);
      trees.forEach((candidate, index) => {
        expectPublicState(candidate, mirrors[index]!, `alternating delete ${step}, tree ${index}`);
      });
    }
  });
});

