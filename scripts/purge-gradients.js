/**
 * One-shot gradient purge.
 *
 * Keeps the two gradient forms the design language sanctions:
 *   - readability scrims over artwork (one colour, ramping opacity)
 *   - skeleton shimmer sweeps (the ramp encodes "loading")
 *
 * Removes every decorative one: 135deg pink→purple button/card fills, radial
 * hero blobs, and two-hue washes behind headers. Those are the tells.
 *
 * Reports every rule that matched nothing, so a silent no-op can't hide.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "src");

/** Every .css under src, except globals.css which is hand-authored. */
function cssFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) cssFiles(p, out);
    else if (entry.name.endsWith(".css") && entry.name !== "globals.css") out.push(p);
  }
  return out;
}

/**
 * A match is protected if it's a loading shimmer. These are the only ramps
 * that survive the 90deg/135deg rules, and they must survive: the sweep IS
 * the loading affordance.
 */
function isShimmer(decl) {
  return /skeleton|shimmer/i.test(decl);
}

const RULES = [
  {
    name: "radial hero blobs (multi-declaration background block)",
    re: /background:\s*\n\s*radial-gradient\([\s\S]*?;/g,
    to: "background: var(--surface-1);",
  },
  {
    name: "single-line radial background",
    re: /background:\s*radial-gradient\([^;]*\);/g,
    to: "background: var(--surface-1);",
  },
  {
    name: "decorative 135deg ramps",
    re: /background:\s*linear-gradient\(\s*135deg,[^;]*\);/g,
    to: "background: var(--accent);",
  },
  {
    name: "decorative 90deg ramps",
    re: /background:\s*linear-gradient\(\s*90deg,[^;]*\);/g,
    to: "background: var(--accent);",
  },
  {
    name: "header fade mask -> single-colour scrim",
    re: /background:\s*linear-gradient\(\s*180deg,\s*transparent[^;]*var\(--sakura-bg\)[^;]*\);/g,
    to: "background: linear-gradient(180deg, transparent, var(--bg));",
  },
  {
    name: "hero colour wash -> single-colour scrim",
    re: /background:\s*linear-gradient\(\s*180deg,\s*(?:rgba\(0,\s*0,\s*0,\s*0\.05\)|var\(--bg,[^)]*\))\s*0%,\s*var\(--sakura-bg\)\s*92%\);/g,
    to: "background: linear-gradient(180deg, var(--hero-tint, transparent), var(--bg) 88%);",
  },
];

let touched = 0;
let protectedCount = 0;
const matchCounts = Object.fromEntries(RULES.map((r) => [r.name, 0]));

for (const file of cssFiles(ROOT)) {
  const before = fs.readFileSync(file, "utf8");
  let after = before;

  for (const rule of RULES) {
    after = after.replace(rule.re, (m) => {
      if (isShimmer(m)) {
        protectedCount++;
        return m;
      }
      matchCounts[rule.name]++;
      return rule.to;
    });
  }

  if (after !== before) {
    fs.writeFileSync(file, after);
    touched++;
    console.log("  rewrote", path.relative(ROOT, file).replace(/\\/g, "/"));
  }
}

console.log("\nfiles rewritten:", touched);
console.log("shimmers protected:", protectedCount);
for (const [name, n] of Object.entries(matchCounts)) {
  console.log(`  ${n === 0 ? "!! NO MATCH" : String(n).padStart(3)}  ${name}`);
}
