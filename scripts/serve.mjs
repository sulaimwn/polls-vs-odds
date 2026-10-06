// Minimal static server for local preview: node scripts/serve.mjs [port]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml" };
const port = +process.argv[2] || 8080;
const docRoot = process.argv[3] ? path.resolve(root, process.argv[3]) : root;
http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  let file = path.join(docRoot, url);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!file.startsWith(docRoot) || !fs.existsSync(file)) { res.writeHead(404); return res.end("Not found"); }
  res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`http://localhost:${port}`));
