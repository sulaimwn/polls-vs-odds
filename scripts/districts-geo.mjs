// Builds data/districts.json (TopoJSON): all 435 House districts as drawn for the 2026 election, in the same
// Albers USA projection (975x610 pixels) as data/states.json, trimmed to the coastline and simplified.
//
// Sources
//   - Census TIGERweb "120th Congressional Districts" (Jan 1, 2026 vintage): covers the 2025 redraws (TX, CA, NC, OH, UT)
//     and every state that didn't change.
//   - Missouri: 119th-Congress lines (its 2025 map was suspended for 2026).
//   - Florida: enacted plan EOGPCRP2026 (config/maps/FL, from flsenate.gov).
//   - Louisiana: Act 2 of the 2026 Regular Session (config/maps/LA, from redist.legis.la.gov).
//   - Tennessee: state GIS service, May 2026 plan.
//   - Alabama: the 2023 legislature plan reinstated by the Supreme Court in June 2026.
// Run when district lines change: node scripts/districts-geo.mjs   (MINW=0.01 sets simplification, in square pixels)
import fs from "node:fs";
import { geoAlbersUsa, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import { topology } from "topojson-server";
import { presimplify, simplify } from "topojson-simplify";
import * as shapefile from "shapefile";
import polygonClipping from "polygon-clipping";

const root = new URL("../", import.meta.url);
const p = (u) => u.pathname.replace(/^\/([A-Za-z]:)/, "$1");
const TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer";
const FIPS = { "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY" };
const AT_LARGE = ["AK", "DE", "ND", "SD", "VT", "WY"];
const OVERRIDE = {
  MO: { tiger: 8, field: /^CD119$/ },
  FL: { dir: "config/maps/FL", field: "DISTRICT" },
  LA: { dir: "config/maps/LA", field: "DISTRICT_I" },
  TN: { url: "https://tnmap.tn.gov/arcgis/rest/services/ADMINISTRATIVE_BOUNDARIES/LEGISLATIVE_DISTRICTS/MapServer/2", field: "DISTRICT" },
  AL: { url: "https://services2.arcgis.com/Z4oonA9tfgNvnlIk/arcgis/rest/services/2023_CONG_LEGISLATIVE_PLAN/FeatureServer/0", field: null },
};

async function getJSON(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, { headers: { "User-Agent": "midterm-tracker/1.0" } }); if (r.ok) return await r.json(); throw new Error(`HTTP ${r.status}`); }
    catch (e) { if (i === tries - 1) throw e; await new Promise((s) => setTimeout(s, 1500 * (i + 1))); }
  }
}
const arcQuery = (layerUrl, where = "1=1") => getJSON(`${layerUrl}/query?where=${encodeURIComponent(where)}&outFields=*&returnGeometry=true&outSR=4326&maxAllowableOffset=0.0008&geometryPrecision=5&f=geojson`);
async function readShapefiles(dir) {
  const shp = fs.readdirSync(new URL(dir + "/", root)).find((f) => f.endsWith(".shp"));
  const base = p(new URL(`${dir}/${shp.slice(0, -4)}`, root));
  const src = await shapefile.open(base + ".shp", base + ".dbf");
  const out = [];
  for (let r = await src.read(); !r.done; r = await src.read()) out.push(r.value);
  return out;
}
function districtNumber(props, field) {
  if (field instanceof RegExp) { const k = Object.keys(props).find((x) => field.test(x)); return +props[k]; }
  if (field) return +props[field];
  const k = Object.keys(props).find((x) => /^(district|dist|cd1\d\d|district_i|districtn)/i.test(x));
  return +String(props[k]).replace(/\D/g, "");
}

// state land shapes in projected pixels (the clip target), from the same file the state map uses
const topoStates = JSON.parse(fs.readFileSync(new URL("scripts/states-albers-10m.json", root)));
const land = {};
for (const f of feature(topoStates, topoStates.objects.states).features) if (FIPS[f.id]) land[FIPS[f.id]] = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;

const projection = geoAlbersUsa().scale(1300).translate([487.5, 305]);
function projectRings(geom) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
  return polys.map((poly) => poly.map((ring) => ring.map((pt) => projection(pt)).filter(Boolean)).filter((r) => r.length >= 4)).filter((poly) => poly.length);
}
const path = geoPath();

const features = []; // { st, n, geom }
console.log("Fetching 120th Congress districts from Census TIGERweb…");
const tiger = await arcQuery(`${TIGER}/0`, "1=1");
for (const f of tiger.features) {
  const st = FIPS[f.properties.STATE];
  if (!st || OVERRIDE[st] || !/^\d+$/.test(f.properties.CD120)) continue; // "ZZ" = water areas with no district
  features.push({ st, n: +f.properties.CD120, geom: f.geometry });
}
for (const [st, o] of Object.entries(OVERRIDE)) {
  let list;
  if (o.tiger != null) list = (await arcQuery(`${TIGER}/${o.tiger}`, `STATE='${Object.keys(FIPS).find((k) => FIPS[k] === st)}'`)).features;
  else if (o.dir) list = await readShapefiles(o.dir);
  else list = (await arcQuery(o.url)).features;
  for (const f of list) features.push({ st, n: districtNumber(f.properties, o.field), geom: f.geometry });
  console.log(`  ${st}: ${list.length} districts from ${o.dir || o.url || "TIGER layer " + o.tiger}`);
}

// 1) project the raw districts (neighbours share exact borders here)
const raw = [];
for (const { st, n, geom } of features) {
  if (!geom || !land[st] || !Number.isFinite(n)) continue;
  const atLarge = AT_LARGE.includes(st);
  const id = atLarge ? `${st}-AL` : `${st}-${String(n).padStart(2, "0")}`;
  const polys = atLarge ? land[st] : projectRings(geom);
  if (polys.length) raw.push({ type: "Feature", properties: { id, st, n: atLarge ? 0 : n, atLarge }, geometry: { type: "MultiPolygon", coordinates: polys } });
}
// 2) simplify as a topology, so shared borders are simplified identically and neighbours never gap or overlap
const Q = 1e5; // quantization grid: ~0.01 px
let topo = topology({ d: { type: "FeatureCollection", features: raw } }, Q);
topo = presimplify(topo);
const pxPerUnit = 975 / Q; // MINW = smallest triangle (square pixels) a point must form with its neighbours to survive
topo = simplify(topo, Number(process.env.MINW || 0.01) / (pxPerUnit * pxPerUnit));
const simplified = feature(topo, topo.objects.d).features;

// 3) trim each district to the coastline (keeps districts out of the Great Lakes and ocean) and write SVG paths
const out = [];
const svgPath = geoPath().digits(1);
for (const f of simplified) {
  const { id, st, n, atLarge } = f.properties;
  let polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  if (!atLarge) {
    try { polys = polygonClipping.intersection(polys, land[st]); } catch (e) { console.warn(`  clip failed for ${id}: ${e.message}`); }
  }
  polys = polys.filter((poly) => poly[0]?.length >= 4);
  if (!polys.length) { console.warn(`  ${id}: empty after clipping`); continue; }
  const g = { type: "MultiPolygon", coordinates: polys };
  const [[x0, y0], [x1, y1]] = path.bounds(g);
  const biggest = polys.reduce((a, b) => (path.area({ type: "Polygon", coordinates: b }) > path.area({ type: "Polygon", coordinates: a }) ? b : a));
  const [cx, cy] = path.centroid({ type: "Polygon", coordinates: biggest });
  out.push({ id, st, n, d: svgPath(g), b: [x0, y0, x1, y1].map((v) => +v.toFixed(1)), c: [+cx.toFixed(1), +cy.toFixed(1)] });
}
out.sort((a, b) => a.id.localeCompare(b.id));
fs.writeFileSync(new URL("data/districts.json", root), JSON.stringify({ districts: out }));
const props = out;

const ids = new Set(props.map((d) => d.id));
const latest = JSON.parse(fs.readFileSync(new URL("data/latest.json", root)));
const missing = latest.districts.filter((d) => !ids.has(d.id)).map((d) => d.id);
const extra = [...ids].filter((id) => !latest.districts.some((d) => d.id === id));
console.log(`wrote ${props.length} districts (${(fs.statSync(new URL("data/districts.json", root)).size / 1024).toFixed(0)} KB). Missing vs forecast: ${missing.join(", ") || "none"}. Extra: ${extra.join(", ") || "none"}`);
