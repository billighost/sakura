// Simulation test for request coalescing

// Global map simulating globalThis.pendingDownloads
const pendingDownloads = new Map();

// Mock DB state
let dbHasTrack = false;
let downloadCalls = 0;

// Mock database query
async function mockQueryOne(title, artist) {
  if (dbHasTrack) {
    return {
      id: "track-uuid-12345",
      title: "Blank Space",
      artistName: "Taylor Swift",
      duration: 231,
      audioUrl: "/api/stream/telegram/123",
      albumId: null,
      coverUrl: null,
      telegramMessageId: "123"
    };
  }
  return null;
}

// Simulates the API download handler for a request
async function handleDownloadRequest(requestId, title, artist) {
  const cacheKey = `${artist.toLowerCase().trim()} - ${title.toLowerCase().trim()}`;
  const searchQuery = `${artist} - ${title}`;

  console.log(`[Request ${requestId}] Received for "${searchQuery}"`);

  // 1. Try to find the track in database first
  const existingTrack = await mockQueryOne(title, artist);
  if (existingTrack) {
    console.log(`[Request ${requestId}] DB cache hit!`);
    return existingTrack;
  }

  // 2. Check if request coalescing is active
  if (pendingDownloads.has(cacheKey)) {
    console.log(`[Request ${requestId}] Coalescing active! Waiting for active download promise...`);
    await pendingDownloads.get(cacheKey);
    // After resolved, read from DB
    const newTrack = await mockQueryOne(title, artist);
    console.log(`[Request ${requestId}] Coalesced result retrieved:`, newTrack ? "SUCCESS" : "FAILED");
    return newTrack;
  }

  // 3. We are the first downloader. Create and register the promise:
  console.log(`[Request ${requestId}] First downloader! Registering active promise and starting download...`);
  let resolveDownload = () => {};
  let rejectDownload = () => {};
  const downloadPromise = new Promise((resolve, reject) => {
    resolveDownload = resolve;
    rejectDownload = reject;
  });
  pendingDownloads.set(cacheKey, downloadPromise);

  try {
    // Simulate real download (takes 1.5 seconds)
    downloadCalls++;
    await new Promise(r => setTimeout(r, 1500));

    // Simulate database insertion of the downloaded track
    dbHasTrack = true;

    // Resolve the coalescing promise and clean up
    resolveDownload();
    pendingDownloads.delete(cacheKey);

    console.log(`[Request ${requestId}] Download and DB write complete.`);
    return await mockQueryOne(title, artist);
  } catch (error) {
    rejectDownload(error);
    pendingDownloads.delete(cacheKey);
    throw error;
  }
}

async function run() {
  console.log("Simulating 5 concurrent requests for 'Taylor Swift - Blank Space' arriving at the same time...");
  
  const startTime = Date.now();
  const requests = [
    handleDownloadRequest(1, "Blank Space", "Taylor Swift"),
    handleDownloadRequest(2, "Blank Space", "Taylor Swift"),
    handleDownloadRequest(3, "Blank Space", "Taylor Swift"),
    handleDownloadRequest(4, "Blank Space", "Taylor Swift"),
    handleDownloadRequest(5, "Blank Space", "Taylor Swift")
  ];

  const results = await Promise.all(requests);
  const duration = Date.now() - startTime;

  console.log("\nAll requests completed!");
  console.log(`Time elapsed: ${duration}ms (Expected ~1500ms if coalesced)`);
  console.log(`Actual Telegram download calls made: ${downloadCalls} (Expected: 1)`);
  
  let allMatched = true;
  results.forEach((res, i) => {
    if (!res || res.title !== "Blank Space") {
      allMatched = false;
      console.error(`Request ${i + 1} result is invalid:`, res);
    }
  });

  if (downloadCalls === 1 && allMatched && duration < 2000) {
    console.log("\nPASS ✅ Request coalescing works beautifully!");
  } else {
    console.error("\nFAIL ❌ Validation criteria not met!");
    process.exit(1);
  }
}

run().catch(console.error);
