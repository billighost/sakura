// Local simulation script to verify button selection scoring and ranking logic

function scoreButtons(buttons, targetDuration) {
  let selectedIndex = 0;
  let bestScore = -999999;
  const scored = [];

  for (let i = 0; i < buttons.length; i++) {
    const btn = buttons[i];
    const text = btn.text.toLowerCase();
    let score = 0;

    // 1. Avoid previews/snippets
    const isPreview = text.includes("preview") || text.includes("30s") || text.includes("30 sec") || text.includes("clip");
    if (isPreview) {
      score -= 1000;
    }

    // 2. Parse duration from button text if present, e.g. "Artist - Title [03:45]"
    const durationRegex = /(?:\[|\()(\d{1,2}):(\d{2})(?:\]|\))/;
    const match = btn.text.match(durationRegex);
    if (match) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const duration = min * 60 + sec;

      if (targetDuration && targetDuration > 0) {
        const diff = Math.abs(duration - targetDuration);
        if (diff <= 5) {
          score += 200; // Perfect/near perfect match
        } else if (diff <= 15) {
          score += 100;
        } else if (diff > 45 && targetDuration > 45 && duration < 45) {
          // Target is full length but this is a short preview clip
          score -= 500;
        } else {
          score -= diff; // Small penalty proportional to duration mismatch
        }
      } else {
        // Avoid very short durations by default unless they are expected
        if (duration < 45) {
          score -= 300;
        }
      }
    }

    // 3. Prefer high quality (e.g. 320kbps, flac)
    if (text.includes("320") || text.includes("flac") || text.includes("kbps")) {
      score += 10;
    }

    scored.push({ index: i, text: btn.text, score });

    if (score > bestScore) {
      bestScore = score;
      selectedIndex = i;
    }
  }

  return { selectedIndex, bestScore, scored };
}

// Test cases
const testCases = [
  {
    name: "Taylor Swift - Blank Space (Target: 231s / 3:51)",
    targetDuration: 231,
    buttons: [
      { text: "1. Blank Space (Preview) [0:30]" },
      { text: "2. Blank Space [3:51]" },
      { text: "3. Blank Space (320kbps) [3:51]" },
      { text: "4. Blank Space [4:15]" }
    ],
    expectedIndex: 2 // index 2 is option 3 (320kbps)
  },
  {
    name: "Ed Sheeran - Shape of You (Target: 233s / 3:53)",
    targetDuration: 233,
    buttons: [
      { text: "1. Shape of You [3:53]" },
      { text: "2. Shape of You [3:53] (Preview)" },
      { text: "3. Shape of You (30s clip) [0:30]" }
    ],
    expectedIndex: 0 // index 0 is full track
  },
  {
    name: "Short Track (Target: 35s)",
    targetDuration: 35,
    buttons: [
      { text: "1. Short Song [0:35]" },
      { text: "2. Short Song [3:00]" }
    ],
    expectedIndex: 0 // should choose exact match despite being short
  },
  {
    name: "No Target Duration",
    targetDuration: undefined,
    buttons: [
      { text: "1. Song [0:30]" },
      { text: "2. Song [3:30]" }
    ],
    expectedIndex: 1 // should choose the longer one to avoid preview penalty
  }
];

let failed = false;
testCases.forEach((tc) => {
  const result = scoreButtons(tc.buttons, tc.targetDuration);
  console.log(`\nTest Case: ${tc.name}`);
  console.log("Results:");
  result.scored.forEach(s => {
    console.log(`  Index ${s.index}: "${s.text}" -> Score: ${s.score}`);
  });
  console.log(`Selected: Index ${result.selectedIndex} ("${tc.buttons[result.selectedIndex].text}")`);
  if (result.selectedIndex === tc.expectedIndex) {
    console.log("PASS ✅");
  } else {
    console.error(`FAIL ❌ - Expected index ${tc.expectedIndex} but got ${result.selectedIndex}`);
    failed = true;
  }
});

if (failed) {
  process.exit(1);
} else {
  console.log("\nAll simulation tests passed! 🎉");
}
