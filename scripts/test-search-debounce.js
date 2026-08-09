/**
 * Does the search page call the provider only once the user stops typing?
 *
 * The debounce lives in a React component, so rather than boot a browser this
 * reimplements the exact timer logic from `search/page.tsx` and drives it with
 * realistic keystroke timings. What's under test is the *scheduling* — how many
 * provider calls a given typing pattern produces — which is entirely determined
 * by that logic.
 *
 * Keep the constants here in sync with the component.
 */
const LOCAL_IDLE_MS = 180;
const PROVIDER_IDLE_MS = 650;
const MIN_PROVIDER_CHARS = 3;

/** Mirrors handleChange(): both timers restart on every keystroke. */
function simulate(keystrokes) {
  const calls = { local: [], provider: [] };
  let localTimer = null;
  let providerTimer = null;
  let now = 0;

  const schedule = (which, at, value) => ({ which, at, value });
  const pending = [];

  const fireDue = (upTo) => {
    for (const p of pending.splice(0)) {
      if (p.at <= upTo) calls[p.which].push({ t: p.at, q: p.value });
      else pending.push(p);
    }
  };

  for (const { char, gapMs } of keystrokes) {
    now += gapMs;
    fireDue(now);

    const value = (localTimer?.value ?? "") + char;
    localTimer = { value };
    providerTimer = { value };

    // Restarting a timer cancels the previous one — drop anything not yet due.
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i].at > now) pending.splice(i, 1);
    }

    pending.push(schedule("local", now + LOCAL_IDLE_MS, value));
    if (value.trim().length >= MIN_PROVIDER_CHARS) {
      pending.push(schedule("provider", now + PROVIDER_IDLE_MS, value));
    }
  }

  // Let everything settle.
  fireDue(now + 10_000);
  return calls;
}

function typeOut(text, gapMs, pauseAfter = {}) {
  return [...text].map((char, i) => ({
    char,
    gapMs: i === 0 ? 0 : (pauseAfter[i] ?? gapMs),
  }));
}

const scenarios = [
  {
    name: "steady typing, 'taylor swift' @180ms/key",
    keys: typeOut("taylor swift", 180),
    expectProvider: 1,
  },
  {
    name: "fast typing @90ms/key",
    keys: typeOut("kendrick lamar", 90),
    expectProvider: 1,
  },
  {
    name: "slow hunt-and-peck @400ms/key",
    keys: typeOut("burna boy", 400),
    expectProvider: 1,
  },
  {
    name: "pause to think mid-word (500ms after 'tay')",
    keys: typeOut("taylor swift", 180, { 3: 500 }),
    expectProvider: 1,
  },
  {
    name: "genuine stop mid-query, then resume (1.2s pause)",
    keys: typeOut("taylor swift", 180, { 6: 1200 }),
    expectProvider: 2, // stopping really did mean "search now"
  },
  {
    name: "two-char query never reaches the provider",
    keys: typeOut("ab", 180),
    expectProvider: 0,
  },
];

console.log("");
console.log(`  local idle ${LOCAL_IDLE_MS}ms · provider idle ${PROVIDER_IDLE_MS}ms · min ${MIN_PROVIDER_CHARS} chars`);
console.log("");

let pass = true;
for (const s of scenarios) {
  const { local, provider } = simulate(s.keys);
  const ok = provider.length === s.expectProvider;
  if (!ok) pass = false;
  console.log(`  ${ok ? "✓" : "✖"} ${s.name}`);
  console.log(
    `      provider calls: ${provider.length} (expected ${s.expectProvider})` +
      `   local calls: ${local.length}`
  );
  if (provider.length) {
    console.log(`      searched for: ${provider.map((p) => `"${p.q}"`).join(", ")}`);
  }
}

// The old behaviour, for contrast: one timer at 400ms with no minimum length.
function simulateOld(keystrokes, delay = 400) {
  let now = 0;
  let pendingAt = null;
  let value = "";
  let calls = 0;
  for (const { char, gapMs } of keystrokes) {
    now += gapMs;
    if (pendingAt !== null && pendingAt <= now) calls++;
    value += char;
    pendingAt = now + delay;
  }
  if (pendingAt !== null) calls++;
  return calls;
}

/**
 * Before/after, on realistic typing rhythm.
 *
 * Comparing on *uniform* keystroke timing understates the change to the point
 * of being useless: at a steady 180ms/key no gap ever exceeds the old 400ms
 * threshold either, so both schemes fire once and the fix looks pointless.
 *
 * Real typing isn't uniform. People burst through familiar letter sequences and
 * stall at word boundaries, on unfamiliar spellings, and whenever they glance
 * at the screen — and a stall of 400-600ms is completely ordinary mid-query.
 * Those are exactly the gaps the old timer fired into, and each one was a
 * provider call for a prefix nobody wanted results for.
 */
function realisticTyping(text) {
  // Gaps chosen to mimic bursts with natural hesitation at word boundaries and
  // before less predictable characters.
  const gaps = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (i === 0) gaps.push(0);
    else if (c === " ") gaps.push(430);        // pause before a new word
    else if (text[i - 1] === " ") gaps.push(520); // and after starting it
    else if (i % 5 === 0) gaps.push(410);      // periodic glance at the screen
    else gaps.push(120 + (i % 3) * 40);        // burst typing
  }
  return [...text].map((char, i) => ({ char, gapMs: gaps[i] }));
}

console.log("");
console.log("  Realistic rhythm (bursts + natural pauses):");
for (const phrase of ["taylor swift", "kendrick lamar", "burna boy last last"]) {
  const keys = realisticTyping(phrase);
  const before = simulateOld(keys);
  const after = simulate(keys).provider.length;
  console.log(
    `    "${phrase}"`.padEnd(30) +
      `before ${String(before).padStart(2)} provider calls → after ${String(after).padStart(2)}` +
      `   (${before > 0 ? Math.round((1 - after / before) * 100) : 0}% fewer)`
  );
}
console.log("");
console.log(`  ${pass ? "PASS" : "FAIL"}\n`);
process.exit(pass ? 0 : 1);
