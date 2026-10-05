// Builds data/states.json: pre-projected SVG paths for every state (975x610 Albers USA viewBox).
// Run once: node scripts/geo.mjs
import fs from "node:fs";
import { geoPath } from "d3-geo";
import { feature, mesh } from "topojson-client";

const topo = JSON.parse(fs.readFileSync(new URL("./states-albers-10m.json", import.meta.url)));
const FIPS = {
  "01": ["AL", "Alabama"], "02": ["AK", "Alaska"], "04": ["AZ", "Arizona"], "05": ["AR", "Arkansas"], "06": ["CA", "California"],
  "08": ["CO", "Colorado"], "09": ["CT", "Connecticut"], "10": ["DE", "Delaware"], "11": ["DC", "District of Columbia"], "12": ["FL", "Florida"],
  "13": ["GA", "Georgia"], "15": ["HI", "Hawaii"], "16": ["ID", "Idaho"], "17": ["IL", "Illinois"], "18": ["IN", "Indiana"],
  "19": ["IA", "Iowa"], "20": ["KS", "Kansas"], "21": ["KY", "Kentucky"], "22": ["LA", "Louisiana"], "23": ["ME", "Maine"],
  "24": ["MD", "Maryland"], "25": ["MA", "Massachusetts"], "26": ["MI", "Michigan"], "27": ["MN", "Minnesota"], "28": ["MS", "Mississippi"],
  "29": ["MO", "Missouri"], "30": ["MT", "Montana"], "31": ["NE", "Nebraska"], "32": ["NV", "Nevada"], "33": ["NH", "New Hampshire"],
  "34": ["NJ", "New Jersey"], "35": ["NM", "New Mexico"], "36": ["NY", "New York"], "37": ["NC", "North Carolina"], "38": ["ND", "North Dakota"],
  "39": ["OH", "Ohio"], "40": ["OK", "Oklahoma"], "41": ["OR", "Oregon"], "42": ["PA", "Pennsylvania"], "44": ["RI", "Rhode Island"],
  "45": ["SC", "South Carolina"], "46": ["SD", "South Dakota"], "47": ["TN", "Tennessee"], "48": ["TX", "Texas"], "49": ["UT", "Utah"],
  "50": ["VT", "Vermont"], "51": ["VA", "Virginia"], "53": ["WA", "Washington"], "54": ["WV", "West Virginia"], "55": ["WI", "Wisconsin"],
  "56": ["WY", "Wyoming"],
};
const path = geoPath().digits(1);
const states = feature(topo, topo.objects.states).features
  .filter((f) => FIPS[f.id] && f.id !== "11")
  .map((f) => {
    const [abbr, name] = FIPS[f.id];
    const [cx, cy] = path.centroid(f);
    const [[x0, y0], [x1, y1]] = path.bounds(f);
    return { abbr, name, d: path(f), cx: +cx.toFixed(1), cy: +cy.toFixed(1), w: +(x1 - x0).toFixed(1), h: +(y1 - y0).toFixed(1) };
  });
const nation = path(feature(topo, topo.objects.nation));
const borders = path(mesh(topo, topo.objects.states, (a, b) => a !== b));
fs.writeFileSync(new URL("../data/states.json", import.meta.url), JSON.stringify({ viewBox: [0, 0, 975, 610], states, nation, borders }));
console.log(`wrote ${states.length} states`);
