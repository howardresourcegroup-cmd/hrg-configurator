let CATALOG = null;
let LAST_BUILDS = null;

const $ = (id) => document.getElementById(id);

function money(n) { return `$${Math.round(n)}`; }

async function loadCatalog() {
  const res = await fetch("data/catalog.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load catalog.json (${res.status})`);
  return await res.json();
}

// Simple scoring helpers
function gpuScore(gpu, resolution) {
  return resolution === 1440 ? gpu.gamingScore1440 : gpu.gamingScore1080;
}

function pickBestWithin(items, predicate, scoreFn, maxPrice) {
  const candidates = items.filter(predicate).filter(x => x.price <= maxPrice);
  candidates.sort((a, b) => (scoreFn(b) / b.price) - (scoreFn(a) / a.price));
  return candidates[0] || null;
}

function estimateSystemWatts(cpu, gpu) {
  const base = 110; // board/ram/ssd/fans
  const cpuW = cpu?.tdp ?? 65;
  const gpuW = gpu?.tdp ?? 0;
  // mild headroom to reflect transient/boost behavior
  return Math.ceil((base + cpuW + gpuW) * 1.25);
}

function chooseRam(useCase, ramType) {
  const wantGb = (useCase === "general" || useCase === "roblox") ? 16 : 32;
  const options = CATALOG.ram
    .filter(r => r.ramType === ramType)
    .sort((a, b) => a.price - b.price);

  // Pick smallest >= want
  return options.find(r => r.gb >= wantGb) || options[0] || null;
}

function chooseStorage(budget) {
  // simple: bigger budget gets 2TB
  const sorted = [...CATALOG.storage].sort((a, b) => a.price - b.price);
  return budget >= 1200 ? (sorted.find(s => s.gb >= 2000) || sorted[0]) : sorted[0];
}

function chooseCooler(cpuTier, caseCoolerMax) {
  const sorted = [...CATALOG.cooler].sort((a, b) => a.price - b.price);
  // higher tier CPU gets better cooler
  let cooler = cpuTier >= 3 ? sorted.find(c => c.id === "cooler_dual") : sorted.find(c => c.id === "cooler_tower") || sorted[0];
  if (cooler && cooler.heightMm > caseCoolerMax) {
    // fallback to shorter option
    cooler = sorted.find(c => c.heightMm <= caseCoolerMax) || sorted[0];
  }
  return cooler;
}

function generateSingleBuild({ budget, useCase, resolution, preference }) {
  // Preference controls how much we bias GPU vs CPU
  const profile = {
    value:   { gpuBudgetPct: 0.40, cpuTierCap: 3 },
    balanced:{ gpuBudgetPct: 0.48, cpuTierCap: 4 },
    max:     { gpuBudgetPct: 0.55, cpuTierCap: 5 }
  }[preference];

  // Step 1: pick GPU
  const gpuMax = budget * profile.gpuBudgetPct;
  const gpu = pickBestWithin(
    CATALOG.gpu,
    g => true,
    g => gpuScore(g, resolution),
    gpuMax
  ) || [...CATALOG.gpu].sort((a,b)=>a.price-b.price)[0];

  // Step 2: pick CPU (cap tier based on preference + useCase)
  const cpuMax = budget * (useCase === "general" ? 0.18 : 0.25);
  const cpuTierCap = Math.min(profile.cpuTierCap, (useCase === "minecraft" ? 4 : 5));

  const cpuCandidates = CATALOG.cpu.filter(c => c.tier <= cpuTierCap && c.price <= cpuMax);
  cpuCandidates.sort((a,b)=> (b.gamingScore/b.price) - (a.gamingScore/a.price));
  const cpu = cpuCandidates[0] || [...CATALOG.cpu].sort((a,b)=>a.price-b.price)[0];

  // Step 3: motherboard must match socket + ram type
  const ramType = (cpu.socket === "AM5") ? "DDR5" : "DDR4";
  const mbMax = budget * 0.14;

  const mb = pickBestWithin(
    CATALOG.motherboard,
    m => m.socket === cpu.socket && m.ramType === ramType,
    m => (m.m2Slots * 10) + (m.usbCHeader ? 8 : 0) + (m.formFactor === "ATX" ? 3 : 0),
    mbMax
  ) || CATALOG.motherboard.find(m => m.socket === cpu.socket && m.ramType === ramType);

  const ram = chooseRam(useCase, ramType);
  const storage = chooseStorage(budget);

  // Step 4: choose case based on board form factor and GPU length
  const caseMax = budget * 0.10;
  const caseOptions = CATALOG.case
    .filter(c => c.supports.includes(mb.formFactor))
    .filter(c => c.gpuMaxMm >= gpu.lengthMm)
    .sort((a, b) => a.price - b.price);

  const chosenCase = caseOptions.find(c => c.price <= caseMax) || caseOptions[0] || CATALOG.case[0];

  // Step 5: cooler must fit case
  const cooler = chooseCooler(cpu.tier, chosenCase.coolerMaxMm);

  // Step 6: PSU wattage must clear estimated needs
  const estWatts = estimateSystemWatts(cpu, gpu);
  const psu = [...CATALOG.psu]
    .filter(p => p.watts >= Math.ceil(estWatts * 1.35)) // extra headroom
    .sort((a,b)=>a.price-b.price)[0]
    || [...CATALOG.psu].sort((a,b)=>b.watts-a.watts)[0];

  const parts = { cpu, gpu, motherboard: mb, ram, storage, psu, case: chosenCase, cooler };

  const total = Object.values(parts).reduce((sum, p) => sum + (p?.price ?? 0), 0);

  const warnings = [];
  if (total > budget) warnings.push(`Over budget by ${money(total - budget)} (you can tweak prices in data/catalog.json).`);
  if (estWatts > psu.watts * 0.70) warnings.push(`PSU may run warm under load (est. ${estWatts}W vs ${psu.watts}W). Consider higher wattage for quieter operation.`);
  if (gpu.lengthMm > chosenCase.gpuMaxMm) warnings.push(`GPU clearance risk: GPU ${gpu.lengthMm}mm vs case max ${chosenCase.gpuMaxMm}mm.`);
  if (cooler.heightMm > chosenCase.coolerMaxMm) warnings.push(`Cooler clearance risk: cooler ${cooler.heightMm}mm vs case max ${chosenCase.coolerMaxMm}mm.`);

  const reasons = [];
  reasons.push(`GPU picked for best ${resolution}p value in this budget.`);
  reasons.push(`CPU matched to keep FPS smooth without overspending.`);
  if (mb.usbCHeader) reasons.push(`Board includes internal USB-C header.`);
  reasons.push(`PSU sized with headroom (est. ${estWatts}W).`);

  return { preference, budget, useCase, resolution, parts, total, estWatts, warnings, reasons };
}

function generateBuilds({ budget, useCase, resolution }) {
  return [
    generateSingleBuild({ budget, useCase, resolution, preference: "value" }),
    generateSingleBuild({ budget, useCase, resolution, preference: "balanced" }),
    generateSingleBuild({ budget, useCase, resolution, preference: "max" })
  ];
}

function renderBuildCard(build) {
  const { parts, total, warnings, reasons, preference, estWatts } = build;

  const prefLabel = preference === "value" ? "Value"
    : preference === "balanced" ? "Balanced"
    : "Max";

  const warnHtml = warnings.length
    ? `<div class="warn"><strong>Warnings</strong><ul>${warnings.map(w => `<li>${w}</li>`).join("")}</ul></div>`
    : `<div class="ok"><strong>Compatibility</strong><div>Pass (with current catalog rules)</div></div>`;

  const whyHtml = `<div class="muted" style="margin-top:10px;">
    <strong>Why these parts:</strong>
    <ul>${reasons.map(r => `<li>${r}</li>`).join("")}</ul>
  </div>`;

  return `
    <div class="buildCard">
      <div class="kv">
        <h3 style="margin:0;">${prefLabel}</h3>
        <span class="badge">${money(total)} • ~${estWatts}W</span>
      </div>
      <div class="kv"><span>CPU</span><span>${parts.cpu.name}</span></div>
      <div class="kv"><span>GPU</span><span>${parts.gpu.name}</span></div>
      <div class="kv"><span>Motherboard</span><span>${parts.motherboard.name}</span></div>
      <div class="kv"><span>RAM</span><span>${parts.ram.name}</span></div>
      <div class="kv"><span>Storage</span><span>${parts.storage.name}</span></div>
      <div class="kv"><span>PSU</span><span>${parts.psu.name}</span></div>
      <div class="kv"><span>Case</span><span>${parts.case.name}</span></div>
      <div class="kv"><span>Cooler</span><span>${parts.cooler.name}</span></div>
      ${warnHtml}
      ${whyHtml}
    </div>
  `;
}

function encodeBuilds(builds) {
  const payload = {
    v: 1,
    builds: builds.map(b => ({
      preference: b.preference,
      budget: b.budget,
      useCase: b.useCase,
      resolution: b.resolution,
      total: b.total,
      estWatts: b.estWatts,
      parts: Object.fromEntries(Object.entries(b.parts).map(([k, v]) => [k, { id: v.id, name: v.name, price: v.price }]))
    }))
  };
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}

function decodeBuilds(str) {
  const json = decodeURIComponent(escape(atob(str)));
  return JSON.parse(json);
}

function bootFromShareLink() {
  const hash = window.location.hash || "";
  const match = hash.match(/#b=([^&]+)/);
  if (!match) return null;
  try {
    return decodeBuilds(match[1]);
  } catch {
    return null;
  }
}

async function main() {
  const status = $("status");
  const results = $("results");
  const btnGenerate = $("btnGenerate");
  const btnShare = $("btnShare");

  try {
    CATALOG = await loadCatalog();
    status.textContent = "Catalog loaded ✅";
  } catch (e) {
    status.textContent = `Catalog failed to load: ${e.message}`;
    return;
  }

  // If opened via share link, show it (read-only)
  const shared = bootFromShareLink();
  if (shared?.builds?.length) {
    status.textContent = "Loaded shared builds ✅";
    results.innerHTML = shared.builds.map(b => `
      <div class="buildCard">
        <div class="kv"><h3 style="margin:0;">${b.preference.toUpperCase()}</h3><span class="badge">${money(b.total)} • ~${b.estWatts}W</span></div>
        ${Object.entries(b.parts).map(([k,v]) => `<div class="kv"><span>${k}</span><span>${v.name}</span></div>`).join("")}
        <div class="ok"><strong>Shared link</strong><div>This is a snapshot. Generate new builds to update.</div></div>
      </div>
    `).join("");
    btnShare.disabled = true;
    return;
  }

  btnGenerate.addEventListener("click", () => {
    const budget = Number($("budget").value);
    const useCase = $("useCase").value;
    const resolution = Number($("resolution").value);

    LAST_BUILDS = generateBuilds({ budget, useCase, resolution });
    results.innerHTML = LAST_BUILDS.map(renderBuildCard).join("");
    btnShare.disabled = false;
    status.textContent = "Builds generated ✅";
  });

  btnShare.addEventListener("click", async () => {
    if (!LAST_BUILDS) return;
    const encoded = encodeBuilds(LAST_BUILDS);
    const url = `${window.location.origin}${window.location.pathname}#b=${encoded}`;
    try {
      await navigator.clipboard.writeText(url);
      status.textContent = "Share link copied ✅";
    } catch {
      status.textContent = "Could not copy automatically — share link is in the URL bar ✅";
      window.location.hash = `b=${encoded}`;
    }
  });
}

main();
