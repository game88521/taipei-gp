
// ---------------------------------------------------------------- 路燈、路邊停的機車
// 都要避開車道、建築、賽道護牆；機車另外避開路口（行人要過馬路）
const lamps = [];
const parked = [];
{
  const degree = new Map();
  for (const w of netWays) for (const ni of new Set(w.n)) degree.set(ni, (degree.get(ni) || 0) + 1);
  const junctions = [];
  for (const [ni, d] of degree) if (d >= 2) junctions.push([netNodes[ni * 2], netNodes[ni * 2 + 1]]);
  const JG = 30, jgrid = new Map();
  for (const p of junctions) {
    const k = `${Math.floor(p[0] / JG)},${Math.floor(p[1] / JG)}`;
    if (!jgrid.has(k)) jgrid.set(k, []);
    jgrid.get(k).push(p);
  }
  const nearJunction = (x, z, r) => {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++)
      for (const p of jgrid.get(`${Math.floor(x / JG) + a},${Math.floor(z / JG) + b}`) || []) if (Math.hypot(p[0] - x, p[1] - z) < r) return true;
    return false;
  };
  const ok = (x, z) => !farFromTrack(x, z) && distToTrack(x, z) > TRACK_CLEAR && !inBuilding(x, z) && !onRoad(x, z);
  let seed2 = 11;
  const rnd2 = () => (seed2 = (seed2 * 16807) % 2147483647) / 2147483647;
  for (const w of netWays) {
    if (w.c > 2) continue;
    let carryL = 17, carryP = 20 + rnd2() * 30;
    for (let k = 0; k + 1 < w.n.length; k++) {
      const ax = netNodes[w.n[k] * 2], az = netNodes[w.n[k] * 2 + 1], bx = netNodes[w.n[k + 1] * 2], bz = netNodes[w.n[k + 1] * 2 + 1];
      const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz);
      if (l < 1) continue;
      const ux = dx / l, uz = dz / l, nx = -uz, nz = ux;
      // 路燈：每 34 m，兩側（另一側若是對向車道會被 onRoad 擋掉）；燈臂朝路中央
      let s = carryL;
      for (; s < l; s += 34) {
        for (const side of [-1, 1]) {
          const off = w.w / 2 + 1.4, x = ax + ux * s + nx * side * off, z = az + uz * s + nz * side * off;
          if (ok(x, z)) lamps.push(r1(x), r1(z), +Math.atan2(-nx * side, -nz * side).toFixed(3));
        }
      }
      carryL = s - l;
      // 機車：每 30~70 m 一排 5~10 台，斜停在路邊
      let p = carryP;
      for (; p < l; p += 30 + rnd2() * 40) {
        for (const side of [-1, 1]) {
          if (rnd2() < 0.45) continue;
          const off = w.w / 2 + 1.7;
          const cx = ax + ux * p + nx * side * off, cz = az + uz * p + nz * side * off;
          if (nearJunction(cx, cz, 14)) continue;
          const count = 5 + Math.floor(rnd2() * 6);
          // 車頭朝人行道、斜 70°
          const ang = Math.atan2(nx * side, nz * side) + side * 0.35;
          for (let q = 0; q < count; q++) {
            const t = (q - count / 2) * 0.78, x = cx + ux * t, z = cz + uz * t;
            if (ok(x, z)) parked.push(r1(x), r1(z), +ang.toFixed(2), Math.floor(rnd2() * 7));
          }
        }
      }
      carryP = p - l;
    }
  }
}
