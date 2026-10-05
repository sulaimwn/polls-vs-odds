// Renders og.png (1200x630), the link-preview card, from the latest numbers. Run after update.mjs.
import fs from "node:fs";
import sharp from "sharp";

const root = new URL("../", import.meta.url);
const L = JSON.parse(fs.readFileSync(new URL("data/latest.json", root)));
const F = "'Libre Franklin', 'Franklin Gothic Medium', Arial, Helvetica, 'DejaVu Sans', sans-serif";
const DEM = "#1f5fd1", REP = "#cf3131";

function card(x, title, p) {
  const lead = p >= 0.5 ? "D" : "R", pl = Math.max(p, 1 - p);
  const who = lead === "D" ? "Democrats" : "Republicans", col = lead === "D" ? DEM : REP;
  return `<g transform="translate(${x},190)">
    <rect width="510" height="320" rx="16" fill="#ffffff" stroke="#dfe2e7" stroke-width="2"/>
    <text x="36" y="64" font-family="${F}" font-weight="700" font-size="30" fill="#464b55">${title}</text>
    <text x="32" y="200" font-family="${F}" font-weight="900" font-size="130" fill="${col}">${Math.round(pl * 100)}%</text>
    <text x="36" y="250" font-family="${F}" font-weight="600" font-size="28" fill="#15171c">chance for ${who}</text>
    <rect x="36" y="272" width="438" height="14" rx="7" fill="${REP}"/>
    <rect x="36" y="272" width="${438 * p}" height="14" rx="7" fill="${DEM}"/>
  </g>`;
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#f4f5f7"/>
  <rect x="70" y="62" width="34" height="24" rx="3" fill="${DEM}"/><rect x="87" y="62" width="17" height="24" fill="${REP}"/>
  <text x="120" y="84" font-family="${F}" font-weight="800" font-size="28" fill="#15171c">Polls vs. Odds</text>
  <text x="70" y="152" font-family="${F}" font-weight="800" font-size="54" fill="#15171c">What voters say. What bettors bet.</text>
  ${card(70, "House", L.house.p.D)}
  ${card(620, "Senate", L.senate.p.D)}
  <text x="70" y="570" font-family="${F}" font-size="26" fill="#464b55">pollsvsodds.com · Polls vs. prediction markets, for every 2026 race.</text>
</svg>`;
await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(new URL("og.png", root).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
console.log("wrote og.png");
