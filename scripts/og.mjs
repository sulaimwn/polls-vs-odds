// Renders og.png (1200x630), the link-preview card, from the latest numbers. Run after update.mjs.
import fs from "node:fs";
import sharp from "sharp";

const root = new URL("../", import.meta.url);
const L = JSON.parse(fs.readFileSync(new URL("data/latest.json", root)));
const F = "Arial, Helvetica, 'DejaVu Sans', sans-serif";
const DEM = "#4a7bff", REP = "#ff4d5e";

function block(x, title, p, seats) {
  const lead = p >= 0.5 ? "D" : "R", pl = lead === "D" ? p : 1 - p, col = lead === "D" ? "#9db6ff" : "#ff9ea8";
  const w = 500;
  return `<g transform="translate(${x},200)">
    <rect width="${w}" height="330" rx="26" fill="#121828" stroke="rgba(150,170,230,0.25)"/>
    <text x="34" y="62" font-family="${F}" font-weight="700" font-size="26" letter-spacing="5" fill="#eaeef8">${title}</text>
    <text x="34" y="104" font-family="${F}" font-weight="700" font-size="20" letter-spacing="2" fill="${col}">${lead === "D" ? "DEMOCRATS" : "REPUBLICANS"} WIN CONTROL</text>
    <text x="30" y="226" font-family="${F}" font-weight="900" font-size="132" letter-spacing="-4" fill="${col}">${Math.round(pl * 100)}%</text>
    <rect x="34" y="256" width="${w - 68}" height="16" rx="8" fill="${REP}"/>
    <rect x="34" y="256" width="${(w - 68) * p}" height="16" rx="8" fill="${DEM}"/>
    <rect x="${34 + (w - 68) / 2 - 1}" y="250" width="2" height="28" fill="#ffffff" opacity="0.7"/>
    <text x="34" y="306" font-family="${F}" font-size="19" fill="#9aa3bd">${seats}</text>
  </g>`;
}
const hE = Math.round(L.house.expected.combined);
const sNonR = (100 - L.senate.expectedR.combined).toFixed(0);
const date = new Date(L.updated).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="gl" cx="0.1" cy="0" r="0.8"><stop offset="0" stop-color="${DEM}" stop-opacity="0.35"/><stop offset="1" stop-color="${DEM}" stop-opacity="0"/></radialGradient>
    <radialGradient id="gr" cx="0.9" cy="0" r="0.8"><stop offset="0" stop-color="${REP}" stop-opacity="0.28"/><stop offset="1" stop-color="${REP}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#070912"/>
  <rect width="1200" height="630" fill="url(#gl)"/><rect width="1200" height="630" fill="url(#gr)"/>
  <circle cx="82" cy="78" r="22" fill="${DEM}"/><path d="M82 56a22 22 0 0 1 0 44z" fill="${REP}"/><circle cx="82" cy="78" r="8" fill="#070912"/>
  <text x="120" y="88" font-family="${F}" font-weight="800" font-size="28" letter-spacing="3" fill="#eaeef8">CONTROL ROOM /26</text>
  <text x="1130" y="88" text-anchor="end" font-family="${F}" font-weight="700" font-size="20" letter-spacing="2" fill="#ffb224">${L.daysOut} DAYS TO ELECTION DAY</text>
  <text x="70" y="160" font-family="${F}" font-weight="900" font-size="46" fill="#eaeef8">Who controls Congress in 2027?</text>
  ${block(70, "HOUSE", L.house.p.D, `Projected ${hE} D – ${435 - hE} R · 218 to win`)}
  ${block(630, "SENATE", L.senate.p.D, `Projected ${sNonR} D+I – ${100 - sNonR} R · 51 to win`)}
  <text x="70" y="590" font-family="${F}" font-size="20" fill="#9aa3bd">Polls + Polymarket + Kalshi, combined · updated ${date} · tap any state or district</text>
</svg>`;
await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(new URL("og.png", root).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
console.log("wrote og.png");
