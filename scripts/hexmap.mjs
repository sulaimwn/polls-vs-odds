// Builds data/hexmap.json: a cartogram with one hexagon per House district, grouped by state and kept roughly in place.
// States start at their map centroids, are spread apart (Dorling-style) so each has room for its seat count, then
// grow hex clusters outward from those centres. Run once: node scripts/hexmap.mjs
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const geo = JSON.parse(fs.readFileSync(new URL("data/states.json", root)));
const latest = JSON.parse(fs.readFileSync(new URL("data/latest.json", root)));

const seats = {};
for (const d of latest.districts) (seats[d.st] ||= []).push(d);
for (const st in seats) seats[st].sort((a, b) => a.n - b.n);

const R = 15.5; // hex radius (pointy-top)
const HW = Math.sqrt(3) * R;
const toPix = (q, r) => [HW * (q + r / 2), 1.5 * R * r];
function toHex(x, y) {
  const q = ((Math.sqrt(3) / 3) * x - y / 3) / R, r = ((2 / 3) * y) / R;
  let rx = Math.round(q), rz = Math.round(r), ry = Math.round(-q - r);
  const dx = Math.abs(rx - q), dz = Math.abs(rz - r), dy = Math.abs(ry + q + r);
  if (dx > dy && dx > dz) rx = -ry - rz; else if (dy <= dz) rz = -rx - ry;
  return [rx, rz];
}
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

// 1) Dorling relaxation of state centres (circle area ~ seat count)
const nodes = geo.states.filter((s) => seats[s.abbr]).map((s) => {
  const n = seats[s.abbr].length;
  let [x, y] = [s.cx, s.cy];
  if (s.abbr === "AK") [x, y] = [150, 500];
  if (s.abbr === "HI") [x, y] = [300, 545];
  return { st: s.abbr, n, x, y, ox: x, oy: y, rad: Math.sqrt((n * 2.598 * R * R) / Math.PI) * 1.08 };
});
// spread slightly about the centre first so the dense northeast has room
const cx0 = 487, cy0 = 300;
for (const a of nodes) { a.x = cx0 + (a.x - cx0) * 1.06; a.y = cy0 + (a.y - cy0) * 1.06; a.ox = a.x; a.oy = a.y; }
for (let it = 0; it < 600; it++) {
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j];
    let dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || 0.01;
    const min = a.rad + b.rad + 2;
    if (d < min) { const push = (min - d) / 2; dx /= d; dy /= d; const wa = b.n / (a.n + b.n), wb = a.n / (a.n + b.n); a.x -= dx * push * wa * 2; a.y -= dy * push * wa * 2; b.x += dx * push * wb * 2; b.y += dy * push * wb * 2; }
  }
  for (const a of nodes) { a.x += (a.ox - a.x) * 0.03; a.y += (a.oy - a.y) * 0.03; }
}

// 2) Grow hex clusters, biggest states first
const taken = new Map();
const key = (q, r) => `${q},${r}`;
const out = [];
for (const node of nodes.slice().sort((a, b) => b.n - a.n)) {
  const dist = (q, r) => { const [x, y] = toPix(q, r); return Math.hypot(x - node.x, y - node.y); };
  let [q0, r0] = toHex(node.x, node.y);
  if (taken.has(key(q0, r0))) { // nearest free cell
    let best = null;
    for (let dq = -12; dq <= 12; dq++) for (let dr = -12; dr <= 12; dr++) { const q = q0 + dq, r = r0 + dr; if (!taken.has(key(q, r)) && (!best || dist(q, r) < dist(...best))) best = [q, r]; }
    [q0, r0] = best;
  }
  const cluster = [[q0, r0]];
  taken.set(key(q0, r0), node.st);
  while (cluster.length < node.n) {
    let best = null, bs = Infinity;
    for (const [q, r] of cluster) for (const [dq, dr] of DIRS) {
      const c = [q + dq, r + dr];
      if (taken.has(key(...c))) continue;
      const same = DIRS.filter(([a, b]) => taken.get(key(c[0] + a, c[1] + b)) === node.st).length;
      const s = dist(...c) - same * R * 0.9;
      if (s < bs) { bs = s; best = c; }
    }
    if (!best) break;
    cluster.push(best);
    taken.set(key(...best), node.st);
  }
  // assign districts in reading order (top-left to bottom-right)
  const cells = cluster.map(([q, r]) => ({ q, r, xy: toPix(q, r) })).sort((a, b) => a.xy[1] - b.xy[1] || a.xy[0] - b.xy[0]);
  cells.forEach((c, i) => out.push({ id: seats[node.st][i].id, st: node.st, q: c.q, r: c.r, x: +c.xy[0].toFixed(1), y: +c.xy[1].toFixed(1) }));
}

// 3) State borders: hex edges whose neighbour belongs to another state (or is empty)
const corner = (x, y, i) => { const a = (Math.PI / 180) * (60 * i - 30); return [x + R * Math.cos(a), y + R * Math.sin(a)]; };
// pointy-top corner i..i+1 faces neighbour direction index:
const EDGE_DIR = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
let borders = "";
for (const h of out) for (let i = 0; i < 6; i++) {
  const [dq, dr] = EDGE_DIR[i];
  const nb = taken.get(key(h.q + dq, h.r + dr));
  if (nb === h.st) continue;
  const [x1, y1] = corner(h.x, h.y, i), [x2, y2] = corner(h.x, h.y, i + 1);
  borders += `M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`;
}
const xs = out.map((h) => h.x), ys = out.map((h) => h.y);
const pad = R * 1.6;
const vb = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + 2 * pad, Math.max(...ys) - Math.min(...ys) + 2 * pad].map((v) => +v.toFixed(1));
const labels = Object.entries(Object.groupBy(out, (h) => h.st)).map(([st, hs]) => {
  const mx = hs.reduce((a, h) => a + h.x, 0) / hs.length, my = hs.reduce((a, h) => a + h.y, 0) / hs.length;
  const c = hs.reduce((a, h) => (Math.hypot(h.x - mx, h.y - my) < Math.hypot(a.x - mx, a.y - my) ? h : a), hs[0]);
  return { st, x: c.x, y: c.y, n: hs.length };
});
fs.writeFileSync(new URL("data/hexmap.json", root), JSON.stringify({ R, viewBox: vb, hexes: out.map(({ q, r, ...h }) => h), borders, labels }));
console.log(`placed ${out.length} hexes, viewBox ${vb.join(" ")}`);
