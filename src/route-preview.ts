export interface RouteBend { at: number; angle: number; hairpin: boolean }
/** 以彎前後各約 12m 的方向找明顯急彎，合併相距 40m 內的同一個彎。 */
export function routeBends(path: [number, number][], cum: number[]): RouteBend[] {
  const bends: RouteBend[] = [];
  for (let i = 1; i < path.length - 1; i++) {
    let a = i - 1, b = i + 1;
    while (a > 0 && cum[i] - cum[a] < 12) a--;
    while (b < path.length - 1 && cum[b] - cum[i] < 12) b++;
    const ax = path[i][0] - path[a][0], az = path[i][1] - path[a][1];
    const bx = path[b][0] - path[i][0], bz = path[b][1] - path[i][1];
    const length = Math.hypot(ax, az) * Math.hypot(bx, bz);
    if (length < 0.01) continue;
    const angle = Math.acos(Math.max(-1, Math.min(1, (ax * bx + az * bz) / length))) * 180 / Math.PI;
    if (angle < 50) continue;
    const bend = { at: cum[i], angle, hairpin: angle >= 130 }, previous = bends.at(-1);
    if (previous && bend.at - previous.at < 40) { if (angle > previous.angle) bends[bends.length - 1] = bend; }
    else bends.push(bend);
  }
  return bends;
}

export function routePreview(path: [number, number][]) {
  if (!path.length) return { points: '', start: [80, 40], end: [80, 40] };
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of path) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const scale = Math.min(140 / Math.max(1, maxX - minX), 64 / Math.max(1, maxZ - minZ));
  const point = (p: [number, number]) => [80 + (p[0] - (minX + maxX) / 2) * scale, 40 + (p[1] - (minZ + maxZ) / 2) * scale];
  return { points: path.map((p) => point(p).map((v) => v.toFixed(1)).join(',')).join(' '), start: point(path[0]), end: point(path[path.length - 1]) };
}
