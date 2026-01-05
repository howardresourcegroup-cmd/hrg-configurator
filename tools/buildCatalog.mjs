import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dataDir = path.join(root, "data");

const categories = ["cpu","gpu","motherboard","ram","storage","psu","case","cooler"];

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf8").trim();
  if (!raw) return null;
  return JSON.parse(raw);
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function main() {
  const catalog = {};
  for (const cat of categories) {
    const file = path.join(dataDir, `${cat}.json`);
    const arr = readJson(file);
    catalog[cat] = Array.isArray(arr) ? arr : [];
  }

  // keep your existing profiles.json separate (engine loads it independently)
  const out = path.join(dataDir, "catalog.json");
  writeJson(out, catalog);

  console.log(`✅ Wrote ${out}`);
  for (const cat of categories) console.log(`  ${cat}: ${catalog[cat].length}`);
}

main();
