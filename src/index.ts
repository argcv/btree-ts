// Copyright 2014-2022 Google Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Modified from google/btree's btree_generic.go for TypeScript.

export type Less<T> = (a: T, b: T) => boolean;
export type Visitor<T> = (item: T) => boolean;

class CowContext {}

class BTreeNode<T> {
  constructor(
    readonly owner: CowContext,
    public items: T[] = [],
    public children: BTreeNode<T>[] | null = null,
  ) {}

  get leaf(): boolean {
    return this.children === null;
  }
}

function rejectUndefined(value: unknown): void {
  if (value === undefined) {
    throw new TypeError('BTree items and pivots must not be undefined');
  }
}

export class BTree<T> {
  private root: BTreeNode<T> | null = null;
  private _size = 0;
  private cow: CowContext;
  private readonly _degree: number;
  private readonly less: Less<T>;

  constructor(degree: number, less: Less<T>) {
    if (!Number.isSafeInteger(degree) || degree < 2) {
      throw new RangeError('BTree degree must be a safe integer greater than or equal to 2');
    }
    this._degree = degree;
    this.less = less;
    this.cow = new CowContext();
  }

  get size(): number {
    return this._size;
  }

  get degree(): number {
    return this._degree;
  }

  get(item: T): T | undefined {
    rejectUndefined(item);
    let node = this.root;
    while (node !== null) {
      const index = this.lowerBound(node.items, item);
      if (this.foundAt(node.items, index, item)) {
        return node.items[index]!;
      }
      if (node.leaf) {
        return undefined;
      }
      node = node.children![index]!;
    }
    return undefined;
  }

  has(item: T): boolean {
    return this.get(item) !== undefined;
  }

  replaceOrInsert(item: T): T | undefined {
    rejectUndefined(item);
    if (this.root === null) {
      this.root = new BTreeNode(this.cow, [item]);
      this._size = 1;
      return undefined;
    }

    let root = this.mutableFor(this.root);
    this.root = root;
    if (root.items.length === this.maxItems) {
      root = new BTreeNode(this.cow, [], [root]);
      this.root = root;
      this.split(root, 0);
    }

    const previous = this.insert(root, item);
    if (previous === undefined) {
      this._size += 1;
    }
    return previous;
  }

  delete(item: T): T | undefined {
    rejectUndefined(item);
    if (this.root === null) {
      return undefined;
    }

    const root = this.mutableFor(this.root);
    this.root = root;
    const previous = this.remove(root, item);
    if (previous === undefined) {
      return undefined;
    }

    this._size -= 1;
    this.shrinkRoot(root);
    return previous;
  }

  min(): T | undefined {
    let node = this.root;
    if (node === null) {
      return undefined;
    }
    while (!node.leaf) {
      node = node.children![0]!;
    }
    return node.items[0]!;
  }

  max(): T | undefined {
    let node = this.root;
    if (node === null) {
      return undefined;
    }
    while (!node.leaf) {
      node = node.children![node.children!.length - 1]!;
    }
    return node.items[node.items.length - 1]!;
  }

  deleteMin(): T | undefined {
    return this.deleteExtreme(true);
  }

  deleteMax(): T | undefined {
    return this.deleteExtreme(false);
  }

  clear(): void {
    this.root = null;
    this._size = 0;
  }

  clone(): BTree<T> {
    const copy = new BTree<T>(this._degree, this.less);
    copy.root = this.root;
    copy._size = this._size;

    // Nodes from the old context are now shared, so neither tree may mutate them.
    this.cow = new CowContext();
    copy.cow = new CowContext();
    return copy;
  }

  ascend(visitor: Visitor<T>): void {
    if (this.root !== null) {
      this.ascendAll(this.root, visitor);
    }
  }

  ascendRange(greaterOrEqual: T, lessThan: T, visitor: Visitor<T>): void {
    rejectUndefined(greaterOrEqual);
    rejectUndefined(lessThan);
    if (this.root !== null) {
      this.ascendBounded(this.root, greaterOrEqual, lessThan, visitor);
    }
  }

  ascendLessThan(pivot: T, visitor: Visitor<T>): void {
    rejectUndefined(pivot);
    if (this.root !== null) {
      this.ascendBounded(this.root, undefined, pivot, visitor);
    }
  }

  ascendGreaterOrEqual(pivot: T, visitor: Visitor<T>): void {
    rejectUndefined(pivot);
    if (this.root !== null) {
      this.ascendBounded(this.root, pivot, undefined, visitor);
    }
  }

  descend(visitor: Visitor<T>): void {
    if (this.root !== null) {
      this.descendBounded(this.root, undefined, undefined, visitor);
    }
  }

  descendRange(lessOrEqual: T, greaterThan: T, visitor: Visitor<T>): void {
    rejectUndefined(lessOrEqual);
    rejectUndefined(greaterThan);
    if (this.root !== null) {
      this.descendBounded(this.root, lessOrEqual, greaterThan, visitor);
    }
  }

  descendLessOrEqual(pivot: T, visitor: Visitor<T>): void {
    rejectUndefined(pivot);
    if (this.root !== null) {
      this.descendBounded(this.root, pivot, undefined, visitor);
    }
  }

  descendGreaterThan(pivot: T, visitor: Visitor<T>): void {
    rejectUndefined(pivot);
    if (this.root !== null) {
      this.descendBounded(this.root, undefined, pivot, visitor);
    }
  }

  private get maxItems(): number {
    return 2 * this._degree - 1;
  }

  private get minItems(): number {
    return this._degree - 1;
  }

  private equivalent(a: T, b: T): boolean {
    return !this.less(a, b) && !this.less(b, a);
  }

  private lowerBound(items: T[], item: T): number {
    let low = 0;
    let high = items.length;
    while (low < high) {
      const middle = low + ((high - low) >>> 1);
      if (this.less(items[middle]!, item)) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low;
  }

  private upperBound(items: T[], item: T): number {
    let low = 0;
    let high = items.length;
    while (low < high) {
      const middle = low + ((high - low) >>> 1);
      if (this.less(item, items[middle]!)) {
        high = middle;
      } else {
        low = middle + 1;
      }
    }
    return low;
  }

  /** The index must come from lowerBound, which excludes less(candidate, item). */
  private foundAt(items: T[], index: number, item: T): boolean {
    return index < items.length && !this.less(item, items[index]!);
  }

  private mutableFor(node: BTreeNode<T>): BTreeNode<T> {
    if (node.owner === this.cow) {
      return node;
    }
    return new BTreeNode(this.cow, node.items.slice(), node.children?.slice() ?? null);
  }

  private split(parent: BTreeNode<T>, index: number): void {
    const children = parent.children!;
    const left = this.mutableFor(children[index]!);
    children[index] = left;

    const rightItems = left.items.splice(this._degree);
    const median = left.items.pop() as T;
    const rightChildren = left.leaf ? null : left.children!.splice(this._degree);
    const right = new BTreeNode(this.cow, rightItems, rightChildren);

    parent.items.splice(index, 0, median);
    children.splice(index + 1, 0, right);
  }

  /** Insert into a mutable, non-full subtree. */
  private insert(node: BTreeNode<T>, item: T): T | undefined {
    while (true) {
      let index = this.lowerBound(node.items, item);
      if (this.foundAt(node.items, index, item)) {
        const previous = node.items[index]!;
        node.items[index] = item;
        return previous;
      }
      if (node.leaf) {
        node.items.splice(index, 0, item);
        return undefined;
      }

      const child = this.mutableFor(node.children![index]!);
      node.children![index] = child;
      if (child.items.length === this.maxItems) {
        this.split(node, index);
        const median = node.items[index]!;
        if (this.equivalent(item, median)) {
          node.items[index] = item;
          return median;
        }
        if (this.less(median, item)) {
          index += 1;
        }
      }
      node = node.children![index]!;
    }
  }

  private deleteExtreme(minimum: boolean): T | undefined {
    if (this.root === null) {
      return undefined;
    }

    const root = this.mutableFor(this.root);
    this.root = root;
    const previous = minimum ? this.popMin(root) : this.popMax(root);
    this._size -= 1;
    this.shrinkRoot(root);
    return previous;
  }

  private shrinkRoot(root: BTreeNode<T>): void {
    if (root.items.length !== 0) {
      return;
    }
    if (root.leaf) {
      this.root = null;
      return;
    }

    const replacement = root.children![0]!;
    root.children = null;
    this.root = replacement;
  }

  /** Remove the minimum from a mutable subtree without comparing keys. */
  private popMin(node: BTreeNode<T>): T {
    if (node.leaf) {
      return node.items.shift() as T;
    }

    const child = this.mutableFor(node.children![0]!);
    node.children![0] = child;
    const previous = this.popMin(child);
    this.rebalanceAfterDelete(node, 0);
    return previous;
  }

  /** Remove the maximum from a mutable subtree without comparing keys. */
  private popMax(node: BTreeNode<T>): T {
    if (node.leaf) {
      return node.items.pop() as T;
    }

    const children = node.children!;
    const index = children.length - 1;
    const child = this.mutableFor(children[index]!);
    children[index] = child;
    const previous = this.popMax(child);
    this.rebalanceAfterDelete(node, index);
    return previous;
  }

  /**
   * Remove from a mutable subtree. Any underflow is repaired by the parent on
   * return, which lets every internal hit use its predecessor.
   */
  private remove(node: BTreeNode<T>, item: T): T | undefined {
    const index = this.lowerBound(node.items, item);
    if (this.foundAt(node.items, index, item)) {
      if (node.leaf) {
        return node.items.splice(index, 1)[0] as T;
      }

      const previous = node.items[index]!;
      const left = this.mutableFor(node.children![index]!);
      node.children![index] = left;
      node.items[index] = this.popMax(left);
      this.rebalanceAfterDelete(node, index);
      return previous;
    }

    if (node.leaf) {
      return undefined;
    }
    const child = this.mutableFor(node.children![index]!);
    node.children![index] = child;
    const previous = this.remove(child, item);
    if (previous !== undefined) {
      this.rebalanceAfterDelete(node, index);
    }
    return previous;
  }

  private rebalanceAfterDelete(parent: BTreeNode<T>, index: number): void {
    const children = parent.children!;
    let child = children[index]!;
    if (child.items.length >= this.minItems) {
      return;
    }

    // Only the global root may shrink. An empty internal child must instead
    // borrow or merge here so every branch keeps the same height.
    child = this.mutableFor(child);
    children[index] = child;

    if (index > 0) {
      const left = children[index - 1]!;
      if (left.items.length > this.minItems) {
        const mutableLeft = this.mutableFor(left);
        children[index - 1] = mutableLeft;
        child.items.unshift(parent.items[index - 1]!);
        parent.items[index - 1] = mutableLeft.items.pop() as T;
        if (!mutableLeft.leaf) {
          child.children!.unshift(mutableLeft.children!.pop() as BTreeNode<T>);
        }
        return;
      }
    }

    if (index + 1 < children.length) {
      const right = children[index + 1]!;
      if (right.items.length > this.minItems) {
        const mutableRight = this.mutableFor(right);
        children[index + 1] = mutableRight;
        child.items.push(parent.items[index]!);
        parent.items[index] = mutableRight.items.shift() as T;
        if (!mutableRight.leaf) {
          child.children!.push(mutableRight.children!.shift() as BTreeNode<T>);
        }
        return;
      }
    }

    this.merge(parent, index > 0 ? index - 1 : 0);
  }

  /** Merge the separator and right sibling into the left child. */
  private merge(parent: BTreeNode<T>, leftIndex: number): void {
    const children = parent.children!;
    const left = this.mutableFor(children[leftIndex]!);
    const right = this.mutableFor(children[leftIndex + 1]!);
    const separator = parent.items[leftIndex]!;

    left.items.push(separator);
    for (const item of right.items) {
      left.items.push(item);
    }
    if (right.children !== null) {
      const leftChildren = left.children!;
      for (const child of right.children) {
        leftChildren.push(child);
      }
    }

    parent.items.splice(leftIndex, 1);
    children.splice(leftIndex + 1, 1);
    children[leftIndex] = left;

    right.items.length = 0;
    right.children = null;
  }

  private ascendAll(node: BTreeNode<T>, visitor: Visitor<T>): boolean {
    if (node.leaf) {
      for (const item of node.items) {
        if (!visitor(item)) {
          return false;
        }
      }
      return true;
    }

    for (let index = 0; index < node.items.length; index += 1) {
      if (!this.ascendAll(node.children![index]!, visitor)) {
        return false;
      }
      if (!visitor(node.items[index]!)) {
        return false;
      }
    }
    return this.ascendAll(node.children![node.children!.length - 1]!, visitor);
  }

  /** Ascending bounds are [lower, upper); undefined means unbounded. */
  private ascendBounded(
    node: BTreeNode<T>,
    lower: T | undefined,
    upper: T | undefined,
    visitor: Visitor<T>,
  ): boolean {
    const start = lower === undefined ? 0 : this.lowerBound(node.items, lower);
    if (node.leaf) {
      for (let index = start; index < node.items.length; index += 1) {
        const item = node.items[index]!;
        if (upper !== undefined && !this.less(item, upper)) {
          return true;
        }
        if (!visitor(item)) {
          return false;
        }
      }
      return true;
    }

    for (let index = start; index <= node.items.length; index += 1) {
      if (!this.ascendBounded(node.children![index]!, lower, upper, visitor)) {
        return false;
      }
      if (index === node.items.length) {
        return true;
      }

      const item = node.items[index]!;
      if (upper !== undefined && !this.less(item, upper)) {
        return true;
      }
      if (!visitor(item)) {
        return false;
      }
    }
    return true;
  }

  /** Descending bounds are (lower, upper]; undefined means unbounded. */
  private descendBounded(
    node: BTreeNode<T>,
    upper: T | undefined,
    lower: T | undefined,
    visitor: Visitor<T>,
  ): boolean {
    const start = upper === undefined ? node.items.length : this.upperBound(node.items, upper);
    if (node.leaf) {
      for (let index = start - 1; index >= 0; index -= 1) {
        const item = node.items[index]!;
        if (lower !== undefined && !this.less(lower, item)) {
          return true;
        }
        if (!visitor(item)) {
          return false;
        }
      }
      return true;
    }

    for (let index = start; index >= 0; index -= 1) {
      if (!this.descendBounded(node.children![index]!, upper, lower, visitor)) {
        return false;
      }
      if (index === 0) {
        return true;
      }

      const item = node.items[index - 1]!;
      if (lower !== undefined && !this.less(lower, item)) {
        return true;
      }
      if (!visitor(item)) {
        return false;
      }
    }
    return true;
  }
}
