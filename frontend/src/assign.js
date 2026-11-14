// Maximum-weight assignment (Hungarian algorithm, O(n³)): w[i][j] = score of row i with column j.
// Returns for each row the column it gets, or -1.
export function assign(w) {
  const nr = w.length, nc = nr ? w[0].length : 0, n = Math.max(nr, nc);
  if (!n) return [];
  const max = Math.max(0, ...w.flat());
  const cost = (i, j) => (i < nr && j < nc ? max - w[i][j] : max); // padding: as good as no pair
  const u = new Float64Array(n + 1), v = new Float64Array(n + 1), p = new Int32Array(n + 1), way = new Int32Array(n + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(Infinity), used = new Uint8Array(n + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost(i0 - 1, j - 1) - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const out = new Array(nr).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j] - 1 < nr && j - 1 < nc && w[p[j] - 1][j - 1] > 0) out[p[j] - 1] = j - 1;
  return out;
}
