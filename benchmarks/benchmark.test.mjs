import test from 'node:test';
import assert from 'node:assert/strict';
import { CASES, makeDataset, runBenchmarks } from './run.mjs';

function byCase(rows) {
  return new Map(rows.map((row) => [row.case, row]));
}

test('datasets are deterministic, complete, and disjoint by parity', () => {
  const first = makeDataset(32);
  const second = makeDataset(32);
  assert.deepEqual(first, second);
  for (const name of ['random', 'hits', 'deletes']) {
    assert.deepEqual(first[name].slice().sort((a, b) => a - b), first.sequential);
  }
  assert.deepEqual(first.misses.slice().sort((a, b) => a - b), first.sequential.map((value) => value + 1));
  assert(first.sequential.every((value) => value % 2 === 0));
  assert(first.misses.every((value) => value % 2 === 1));
});

test('the workload matrix covers fifteen independent operations', () => {
  assert.equal(CASES.length, 15);
  assert.equal(new Set(CASES).size, CASES.length);
  const rows = runBenchmarks({ sizes: [32], operations: 64, repeat: 1, degree: 2 });
  assert.equal(rows.length, CASES.length);
  for (const row of rows) {
    assert.equal(row.n, 32);
    assert.equal(row.operations > 0, true);
    assert.equal(row.visited, 64);
    assert.equal(Number.isFinite(row.nsPerOp), true);
    assert.equal(row.opsPerSec > 0, true);
  }

  const rowsByCase = byCase(rows);
  const expectedChecksums = {
    insertSequential: 1984,
    insertRandom: 1984,
    getHit: 1984,
    getMiss: 64,
    deleteRandom: 1984,
    deleteMin: 1984,
    deleteMax: 1984,
    ascendFull: 1984,
    ascendEarly: 960,
    ascendRange: 1984,
    descendFull: 1984,
    descendEarly: 3008,
    descendRange: 1984,
    clone: 2048,
    cloneWrite: 1984,
  };
  for (const [caseName, checksum] of Object.entries(expectedChecksums)) {
    assert.equal(rowsByCase.get(caseName).checksum, checksum, caseName);
  }
});

test('partial mutation batches and custom degrees are supported', () => {
  const rows = runBenchmarks({ sizes: [16], operations: 17, repeat: 2, degree: 3 });
  assert.equal(rows.length, CASES.length * 2);
  assert.equal(rows.every((row) => row.operations > 0 && Number.isFinite(row.checksum)), true);
});
