/**
 * Host-side grouping for `embedding_backward_csr`: the positions of each vocab
 * row, as a compressed sparse row index. `rowStart[v] .. rowStart[v + 1]` is the
 * slice of `positions` holding every position whose id is `v`, in order — so
 * the kernel's sum per row is deterministic. Out-of-range ids are left out.
 * O(N + vocab).
 */
export function buildCsr(ids: Int32Array, vocab: number): { rowStart: Int32Array; positions: Int32Array } {
  const rowStart = new Int32Array(vocab + 1);
  for (const id of ids) if (id >= 0 && id < vocab) rowStart[id + 1]! += 1;
  for (let v = 0; v < vocab; v++) rowStart[v + 1]! += rowStart[v]!;
  const positions = new Int32Array(rowStart[vocab]!);
  const cursor = rowStart.slice(0, vocab);
  ids.forEach((id, n) => {
    if (id >= 0 && id < vocab) positions[cursor[id]!++] = n;
  });
  return { rowStart, positions };
}
