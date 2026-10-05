// Builds config/pollster-history.json: each pollster's historical directional miss in D-vs-R races (2016-2024),
// from 538's raw_polls.csv (CC BY 4.0). bias > 0 means the pollster's polls were more Democratic than the result.
// Run occasionally: node scripts/pollster-history.mjs
import fs from "node:fs";

const url = "https://raw.githubusercontent.com/fivethirtyeight/data/master/pollster-ratings/raw_polls.csv";
const text = await (await fetch(url)).text();
const lines = text.trim().split(/\r?\n/);
const split = (l) => { const o = []; let c = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { o.push(c); c = ""; } else c += ch; } o.push(c); return o; };
const head = split(lines[0]);
const col = Object.fromEntries(head.map((h, i) => [h, i]));
const acc = {};
for (const l of lines.slice(1)) {
  const r = split(l);
  if (+r[col.cycle] < 2016) continue;
  if (r[col.cand1_party] !== "DEM" || r[col.cand2_party] !== "REP") continue;
  const err = +r[col.margin_poll] - +r[col.margin_actual];
  if (!Number.isFinite(err)) continue;
  const id = r[col.pollster_rating_id];
  const a = (acc[id] ||= { name: r[col.pollster], n: 0, sum: 0, abs: 0 });
  a.n++; a.sum += err; a.abs += Math.abs(err);
}
const out = {};
for (const [id, a] of Object.entries(acc)) out[id] = { name: a.name, n: a.n, bias: +(a.sum / (a.n + 5)).toFixed(2), raw: +(a.sum / a.n).toFixed(2), absErr: +(a.abs / a.n).toFixed(2) };
fs.writeFileSync(new URL("../config/pollster-history.json", import.meta.url), JSON.stringify(out));
console.log(`${Object.keys(out).length} pollsters with 2016-2024 D-vs-R polls`);
