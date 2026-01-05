import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dataDir = path.join(root, "data");

const requiredByCategory = {
  cpu: ["id","brand","model","socket","memoryType","cores","threads","tdpW","tier"],
  gpu: ["id","brand","model","vramGB","tdpW","lengthMM","tier"],
  motherboard: ["id","brand","model","socket","chipset","formFactor","memoryType","m2Slots","tier"],
  ram: ["id","brand","model","type","capacityGB","sticks","speedMT","latencyCL","tier"],
  storage: ["id","brand","model","type","capacityGB","tier"],
  psu: ["id","brand","model","wattage","efficiency","modular","qualityTier"],
  case: ["id","brand","model","supports","gpuMaxMm","coolerMaxMm","tier"],
  cooler: ["id","brand","model","type","heightMm","tier"]
};

function readJson(p) {
  const raw = fs.readFileSync(p, "utf8").trim();
  return raw ? JSON.parse(raw) : [];
}

function main() {
  let ok = true;
  for (const [cat, required] of Object.entries(requiredByCategory)) {
    const file = path.join(dataDir, `${cat}.json`);
    if (!fs.existsSync(file)) continue;
    const arr = readJson(file);
    if (!Array.isArray(arr)) { console.error(`❌ ${cat}.json is not an array`); ok = false; continue; }

    const ids = new Set();
    arr.forEach((item, i) => {
      for (const k of required) {
        if (item?.[k] === undefined || item?.[k] === null || item?.[k] === "") {
          console.error(`❌ ${cat}[${i}] missing ${k} (id=${item?.id ?? "?"})`);
          ok = false;
        }
      }
      if (item?.id) {
        if (ids.has(item.id)) { console.error(`❌ ${cat} duplicate id: ${item.id}`); ok = false; }
        ids.add(item.id);
      }
    });

    console.log(`✅ ${cat}: ${arr.length} items checked`);
  }

  if (!ok) process.exit(1);
}

main();
