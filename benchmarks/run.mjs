import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BTree } from '../dist/index.js';

export const CASES = Object.freeze([
  'insertSequential',
  'insertRandom',
  'getHit',
  'getMiss',
  'deleteRandom',
  'deleteMin',
  'deleteMax',
  'ascendFull',
  'ascendEarly',
  'ascendRange',
  'descendFull',
  'descendEarly',
  'descendRange',
  'clone',
  'cloneWrite',
]);

const DEFAULTS = Object.freeze({
  sizes: [1000, 100000],
  operations: 100000,
  repeat: 1,
  degree: 32,
});

let resultSink = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function positiveInteger(value, name) {
  const number = Number(value);
  assert(Number.isSafeInteger(number) && number > 0, `${name} must be a positive safe integer`);
  return number;
}

function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function permutation(size, seed) {
  const values = Array.from({ length: size }, (_, index) => index);
  const random = randomGenerator(seed);
  for (let index = size - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [values[index], values[other]] = [values[other], values[index]];
  }
  return values;
}

export function makeDataset(size) {
  positiveInteger(size, 'size');
  assert(size >= 16, 'size must be at least 16');
  const sequential = Array.from({ length: size }, (_, index) => index * 2);
  const scale = (values) => values.map((value) => value * 2);
  return {
    size,
    sequential,
    random: scale(permutation(size, 11)),
    hits: scale(permutation(size, 23)),
    misses: permutation(size, 37).map((value) => value * 2 + 1),
    deletes: scale(permutation(size, 41)),
  };
}

function newTree(degree) {
  return new BTree(degree, (a, b) => a < b);
}

function buildTree(values, degree) {
  const tree = newTree(degree);
  for (const value of values) tree.replaceOrInsert(value);
  assert(tree.size === values.length, 'fixture size mismatch');
  return tree;
}

function result(caseName, size, operations, visited, elapsedNs, checksum) {
  resultSink = (resultSink + checksum) >>> 0;
  const nsPerOp = elapsedNs / operations;
  return {
    case: caseName,
    n: size,
    operations,
    visited,
    elapsedNs,
    nsPerOp,
    opsPerSec: 1e9 / nsPerOp,
    checksum,
  };
}

function runInsert(caseName, dataset, degree, operations) {
  const input = caseName === 'insertSequential' ? dataset.sequential : dataset.random;
  let completed = 0;
  let elapsedNs = 0;
  let checksum = 0;
  while (completed < operations) {
    const tree = newTree(degree);
    const count = Math.min(dataset.size, operations - completed);
    const started = process.hrtime.bigint();
    for (let index = 0; index < count; index += 1) {
      const value = input[index];
      assert(tree.replaceOrInsert(value) === undefined, 'unexpected replacement');
      checksum += value;
    }
    elapsedNs += Number(process.hrtime.bigint() - started);
    assert(tree.size === count, 'insert size mismatch');
    completed += count;
  }
  return result(caseName, dataset.size, operations, operations, elapsedNs, checksum);
}

function runGet(caseName, dataset, degree, operations) {
  const tree = buildTree(dataset.random, degree);
  const input = caseName === 'getHit' ? dataset.hits : dataset.misses;
  const hit = caseName === 'getHit';
  let checksum = 0;
  const started = process.hrtime.bigint();
  for (let index = 0; index < operations; index += 1) {
    const key = input[index % dataset.size];
    const value = tree.get(key);
    if (hit) {
      assert(value === key, 'missing hit key');
      checksum += value;
    } else {
      assert(value === undefined, 'unexpected miss hit');
      checksum += 1;
    }
  }
  const elapsedNs = Number(process.hrtime.bigint() - started);
  return result(caseName, dataset.size, operations, operations, elapsedNs, checksum);
}

function deletionOrder(caseName, dataset) {
  if (caseName === 'deleteRandom') return dataset.deletes;
  if (caseName === 'deleteMin') return dataset.sequential;
  return dataset.sequential.slice().reverse();
}

function runDelete(caseName, dataset, degree, operations) {
  const input = deletionOrder(caseName, dataset);
  let completed = 0;
  let elapsedNs = 0;
  let checksum = 0;
  while (completed < operations) {
    const tree = buildTree(dataset.random, degree);
    const count = Math.min(dataset.size, operations - completed);
    const started = process.hrtime.bigint();
    for (let index = 0; index < count; index += 1) {
      const expected = input[index];
      const value = caseName === 'deleteRandom'
        ? tree.delete(expected)
        : caseName === 'deleteMin'
          ? tree.deleteMin()
          : tree.deleteMax();
      assert(value === expected, 'delete result mismatch');
      checksum += value;
    }
    elapsedNs += Number(process.hrtime.bigint() - started);
    assert(tree.size === dataset.size - count, 'delete size mismatch');
    completed += count;
  }
  return result(caseName, dataset.size, operations, operations, elapsedNs, checksum);
}

function traversalInput(caseName, dataset) {
  const quarter = Math.floor(dataset.size / 4);
  const threeQuarters = Math.floor((dataset.size * 3) / 4);
  const middle = dataset.sequential.slice(quarter, threeQuarters);
  if (caseName === 'ascendFull') return { expected: dataset.sequential, lower: undefined, upper: undefined, early: false };
  if (caseName === 'ascendEarly') return { expected: dataset.sequential.slice(0, 16), lower: undefined, upper: undefined, early: true };
  if (caseName === 'ascendRange') {
    return {
      expected: middle,
      lower: dataset.sequential[quarter],
      upper: dataset.sequential[threeQuarters],
      early: false,
    };
  }
  if (caseName === 'descendFull') return { expected: dataset.sequential.slice().reverse(), lower: undefined, upper: undefined, early: false };
  if (caseName === 'descendEarly') return { expected: dataset.sequential.slice().reverse().slice(0, 16), lower: undefined, upper: undefined, early: true };
  return {
    expected: middle.slice().reverse(),
    lower: dataset.sequential[threeQuarters - 1],
    upper: dataset.sequential[quarter - 1],
    early: false,
  };
}

function visitRange(tree, caseName, input, visitor) {
  if (caseName === 'ascendFull' || caseName === 'ascendEarly') {
    tree.ascend(visitor);
  } else if (caseName === 'ascendRange') {
    tree.ascendRange(input.lower, input.upper, visitor);
  } else if (caseName === 'descendFull' || caseName === 'descendEarly') {
    tree.descend(visitor);
  } else {
    tree.descendRange(input.lower, input.upper, visitor);
  }
}

function runTraversal(caseName, dataset, degree, targetVisited) {
  const tree = buildTree(dataset.random, degree);
  const input = traversalInput(caseName, dataset);
  const operations = Math.max(1, Math.ceil(targetVisited / input.expected.length));
  let checksum = 0;
  const started = process.hrtime.bigint();
  for (let operation = 0; operation < operations; operation += 1) {
    let index = 0;
    visitRange(tree, caseName, input, (value) => {
      assert(value === input.expected[index], 'traversal order mismatch');
      checksum += value;
      index += 1;
      return !input.early || index < input.expected.length;
    });
    assert(index === input.expected.length, 'traversal count mismatch');
  }
  const elapsedNs = Number(process.hrtime.bigint() - started);
  return result(caseName, dataset.size, operations, operations * input.expected.length, elapsedNs, checksum);
}

function runClone(caseName, dataset, degree, operations) {
  const tree = buildTree(dataset.random, degree);
  const write = caseName === 'cloneWrite';
  let checksum = 0;
  const started = process.hrtime.bigint();
  for (let index = 0; index < operations; index += 1) {
    const copy = tree.clone();
    if (write) {
      const key = dataset.hits[index % dataset.size];
      const previous = copy.replaceOrInsert(key);
      assert(previous === key, 'clone replacement mismatch');
      checksum += previous;
    } else {
      checksum += copy.size;
    }
  }
  const elapsedNs = Number(process.hrtime.bigint() - started);
  assert(tree.size === dataset.size, 'clone changed the source size');
  return result(caseName, dataset.size, operations, operations, elapsedNs, checksum);
}

export function runCase(caseName, dataset, degree, operations) {
  assert(CASES.includes(caseName), `unknown case ${caseName}`);
  if (caseName.startsWith('insert')) return runInsert(caseName, dataset, degree, operations);
  if (caseName.startsWith('get')) return runGet(caseName, dataset, degree, operations);
  if (caseName.startsWith('delete')) return runDelete(caseName, dataset, degree, operations);
  if (caseName.startsWith('ascend') || caseName.startsWith('descend')) {
    return runTraversal(caseName, dataset, degree, operations);
  }
  return runClone(caseName, dataset, degree, operations);
}

export function runBenchmarks(options = {}) {
  const sizes = options.sizes ?? DEFAULTS.sizes;
  const operations = positiveInteger(options.operations ?? DEFAULTS.operations, 'operations');
  const repeat = positiveInteger(options.repeat ?? DEFAULTS.repeat, 'repeat');
  const degree = positiveInteger(options.degree ?? DEFAULTS.degree, 'degree');
  assert(degree >= 2, 'degree must be at least 2');
  assert(Array.isArray(sizes) && sizes.length > 0, 'sizes must not be empty');
  const results = [];
  for (let iteration = 1; iteration <= repeat; iteration += 1) {
    for (const size of sizes) {
      const dataset = makeDataset(positiveInteger(size, 'size'));
      for (const caseName of CASES) {
        results.push({ repeat: iteration, ...runCase(caseName, dataset, degree, operations) });
      }
    }
  }
  return results;
}

function parseArguments(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  if (argv.includes('--smoke')) {
    return { sizes: [1000], operations: 2000, repeat: 1, degree: 32 };
  }
  const options = { ...DEFAULTS };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    assert(value !== undefined, `missing value for ${argument}`);
    if (argument === '--sizes') {
      options.sizes = value.split(',').map((entry) => positiveInteger(entry, 'size'));
    } else if (argument === '--operations') {
      options.operations = positiveInteger(value, 'operations');
    } else if (argument === '--repeat') {
      options.repeat = positiveInteger(value, 'repeat');
    } else if (argument === '--degree') {
      options.degree = positiveInteger(value, 'degree');
    } else {
      throw new Error(`unknown argument ${argument}`);
    }
    index += 1;
  }
  return options;
}

function printResults(results) {
  console.log('case\tn\trepeat\toperations\tvisited\tns/op\tops/s');
  for (const row of results) {
    console.log([
      row.case,
      row.n,
      row.repeat,
      row.operations,
      row.visited,
      row.nsPerOp.toFixed(2),
      row.opsPerSec.toFixed(2),
    ].join('\t'));
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node benchmarks/run.mjs [--smoke] [--sizes 1000,100000] [--operations 100000] [--repeat 1] [--degree 32]');
  } else {
    printResults(runBenchmarks(options));
    assert(Number.isSafeInteger(resultSink), 'invalid result sink');
  }
}
