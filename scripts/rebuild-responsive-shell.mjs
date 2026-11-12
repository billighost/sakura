import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "@playwright/test";

const base = process.env.SAKURA_TEST_URL || "http://localhost:3000";
const session = JSON.parse(await fs.readFile(".local/rebuild-test-account.json", "utf8"));
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const cookie = session.cookie.split("; ").map((value) => {
  const separator = value.indexOf("=");
  return {
    name: value.slice(0, separator),
    value: value.slice(separator + 1),
    url: base,
  };
});
const report = [];
const shellTrack = {
  id: "00000000-0000-4000-8000-000000000099",
  title: "Responsive shell fixture",
  artists: ["Sakura"],
  artistId: null,
  albumId: null,
  albumTitle: "Viewport checks",
  durationMs: 180_000,
  coverUrl: null,
  versionLabel: "Original recording",
  reference: { provider: "deezer", id: "99" },
  references: [{ provider: "deezer", id: "99" }],
};

async function openHome(viewport, withTrack = false, openingSeen = true) {
  const context = await browser.newContext({
    viewport,
    reducedMotion: "no-preference",
    serviceWorkers: "block",
  });
  await context.addCookies(cookie);
  await context.addInitScript(({ accountId, openingSeen }) => {
    localStorage.setItem("sakura-v2-active-account", accountId);
    localStorage.setItem("sakura-v2-preferences:" + accountId, JSON.stringify({ settings: { theme: "light", openingAnimation: openingSeen ? 0 : 1 }, pending: false, savedAt: Date.now() }));
    if (openingSeen) sessionStorage.setItem("sakura-ink-opening", "1");
    else sessionStorage.removeItem("sakura-ink-opening");
    localStorage.removeItem("sakura-sidebar-mode");
    if (!openingSeen) {
      const capture = () => {
        if (window.__sakuraOpeningFirstFrame) return;
        const opening = document.querySelector('[data-sakura-opening][aria-label="Sakura opening"]');
        if (!(opening instanceof HTMLElement)) return;
        requestAnimationFrame(() => {
          const rect = opening.getBoundingClientRect();
          const style = getComputedStyle(opening);
          window.__sakuraOpeningFirstFrame = {
            display: style.display,
            opacity: Number(style.opacity),
            pending: document.documentElement.dataset.sakuraOpening,
            rootDisplay: document.documentElement.style.getPropertyValue("--sakura-opening-display"),
            inlineStyle: opening.getAttribute("style"),
            coversViewport: rect.left <= 0 && rect.top <= 0 && rect.right >= innerWidth && rect.bottom >= innerHeight,
          };
        });
      };
      new MutationObserver(capture).observe(document, { childList: true, subtree: true });
    }
  }, { accountId: session.accountId, openingSeen });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/v2/{profile,bootstrap}", (route) =>
    route.fulfill({
      json: {
        profile: {
          id: session.accountId,
          username: session.username,
          email: session.email,
          avatarUrl: null,
        },
        stats: {},
        topArtists: [],
        onboarding: { onboarded: true, seedArtists: [], seedGenres: [] },
      },
    }),
  );
  await page.route("**/api/v2/library/state", route => route.fulfill({json:{favoriteStates:{}}}));
  await page.route("**/api/v2/settings", (route) =>
    route.fulfill({
      json: {
        theme: "light",
        privateSession: true,
        discovery: 50,
        reducedMotion: false,
        openingAnimation: openingSeen ? 0 : 1,
        seedArtists: [],
        seedGenres: [],
        onboarded: true,
      },
    }),
  );
  await page.route("**/api/v2/home", (route) =>
    route.fulfill({
      json: {
        featured: [],
        liked: [],
        mixes: [],
        playlists: [],
        recent: [],
        needsOnboarding: false,
      },
    }),
  );
  await page.route("**/api/v2/listening-session", async (route) => {
    if (route.request().method() === "GET") {
      const now = Date.now();
      const session = withTrack
        ? {
            state: {
              queue: [{ entryId: "responsive-shell-entry", track: shellTrack }],
              currentEntryId: "responsive-shell-entry",
              positionMs: 0,
              sleepUntil: null,
            },
            revision: 1,
            deviceId: "00000000-0000-4000-8000-000000000099",
            updatedAt: now,
          }
        : null;
      await route.fulfill({ json: { session, serverTime: now } });
      return;
    }
    await route.fulfill({ json: { accepted: true, session: null, serverTime: Date.now() } });
  });
  const listeningSession = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" && response.url().includes("/api/v2/listening-session"),
  );
  await page.goto(base + "/home", { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.locator("#music-main").waitFor();
  await listeningSession;
  return { context, page, errors };
}

try {
  {
    const viewport = { width: 1100, height: 700 };
    const { context, page, errors } = await openHome(viewport, false, false);
    const opening = page.getByRole("status", { name: "Sakura opening" });
    await opening.waitFor();
    const firstFrame = await page.evaluate(() => window.__sakuraOpeningFirstFrame);
    assert.ok(firstFrame, "the opening should be measurable on the first animation frame");
    assert.equal(firstFrame.display, "flex", `the opening should render before the app shell can flash: ${JSON.stringify(firstFrame)}`);
    assert.ok(firstFrame.opacity > 0.9, "the opening should begin fully opaque");
    assert.equal(firstFrame.coversViewport, true, "the opening should cover the complete viewport");
    assert.deepEqual(errors, []);
    report.push({ variant: "opening-first-paint", ...firstFrame });
    await page.keyboard.press("Escape");
    await context.close();
  }

  {
    const viewport = { width: 390, height: 844 };
    const { context, page, errors } = await openHome(viewport);
    const navigation = page.getByRole("navigation", { name: "Mobile navigation" });
    await navigation.waitFor();
    const geometry = await page.evaluate(() => {
      const nav = document.querySelector("nav[aria-label='Mobile navigation']");
      const workspace = document.querySelector("aside")?.parentElement;
      if (!(nav instanceof HTMLElement) || !(workspace instanceof HTMLElement)) {
        throw new Error("Responsive shell elements were not found");
      }
      const navRect = nav.getBoundingClientRect();
      const workspaceRect = workspace.getBoundingClientRect();
      return {
        viewportHeight: window.innerHeight,
        navTop: navRect.top,
        navBottom: navRect.bottom,
        workspaceBottom: workspaceRect.bottom,
        playerBars: document.querySelectorAll("[class*='playerBar']").length,
        pageScrollWidth: document.documentElement.scrollWidth,
      };
    });
    assert.equal(geometry.playerBars, 0, "the no-track state must not render a mini player");
    assert.ok(
      Math.abs(geometry.navBottom - geometry.viewportHeight) <= 1,
      "mobile navigation must be flush with the dynamic viewport bottom",
    );
    assert.ok(
      Math.abs(geometry.workspaceBottom - geometry.navTop) <= 1,
      "the workspace must end where the mobile navigation begins",
    );
    assert.ok(geometry.pageScrollWidth <= viewport.width, "the mobile shell must not overflow horizontally");
    assert.deepEqual(errors, []);
    report.push({ variant: "mobile-no-player", ...geometry });
    await context.close();
  }

  {
    const viewport = { width: 1100, height: 480 };
    const { context, page, errors } = await openHome(viewport, true);
    await page.getByRole("button", { name: "Open now playing" }).waitFor();
    const toggle = page.locator('button[aria-controls="sakura-sidebar-body"]');
    await toggle.waitFor();
    await page.locator("aside[data-collapsed='true']").waitFor();
    await page.waitForTimeout(500);
    assert.equal(await toggle.getAttribute("aria-label"), "Expand sidebar");
    const collapsed = await page.evaluate(() => {
      const sidebar = document.querySelector("aside");
      const body = document.querySelector("#sakura-sidebar-body");
      const stage = document.querySelector("#music-main");
      const player = document.querySelector("[class*='playerBar']");
      if (!(sidebar instanceof HTMLElement) || !(body instanceof HTMLElement) || !(stage instanceof HTMLElement) || !(player instanceof HTMLElement)) {
        throw new Error("Desktop shell elements were not found");
      }
      const sidebarRect = sidebar.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const playerRect = player.getBoundingClientRect();
      const libraryLinks = [...sidebar.querySelectorAll("section a")].filter((link) => link instanceof HTMLElement);
      const iconCenterDeltas = libraryLinks.map((link) => {
        const icon = link.querySelector("svg");
        if (!(icon instanceof SVGElement)) return Number.POSITIVE_INFINITY;
        const linkRect = link.getBoundingClientRect();
        const iconRect = icon.getBoundingClientRect();
        return Math.abs((linkRect.left + linkRect.right) / 2 - (iconRect.left + iconRect.right) / 2);
      });
      return {
        collapsed: sidebar.dataset.collapsed === "true",
        sidebarWidth: sidebarRect.width,
        sidebarBottom: sidebarRect.bottom,
        bodyClientHeight: body.clientHeight,
        bodyScrollHeight: body.scrollHeight,
        bodyOverflowY: getComputedStyle(body).overflowY,
        stageBottom: stageRect.bottom,
        playerTop: playerRect.top,
        playerBottom: playerRect.bottom,
        viewportHeight: window.innerHeight,
        libraryIconCenterDelta: Math.max(...iconCenterDeltas),
      };
    });
    assert.equal(collapsed.collapsed, true, "a short desktop viewport should collapse the sidebar");
    assert.ok(collapsed.sidebarWidth <= 77, "the collapsed sidebar should be icon-only");
    assert.equal(collapsed.bodyOverflowY, "auto", "sidebar content should scroll independently");
    assert.ok(
      collapsed.bodyScrollHeight > collapsed.bodyClientHeight,
      "a short sidebar should preserve overflowing destinations through scrolling",
    );
    assert.ok(collapsed.sidebarBottom <= collapsed.viewportHeight + 1, "the sidebar must remain in the viewport");
    assert.ok(collapsed.libraryIconCenterDelta <= 1, "collapsed lower-link icons should stay centered");
    assert.ok(
      collapsed.stageBottom <= collapsed.playerTop + 1,
      "the content stage must end above the mini player",
    );
    assert.ok(
      Math.abs(collapsed.playerBottom - collapsed.viewportHeight) <= 1,
      "the desktop mini player must remain fully inside the viewport",
    );

    await toggle.click();
    await page.waitForTimeout(500);
    const expanded = await page.locator("aside").evaluate((sidebar) => {
      const brand = sidebar.querySelector('a[aria-label="Sakura home"]');
      const wordmark = brand?.querySelector("span");
      const liked = sidebar.querySelector('a[aria-label="Liked songs"]');
      const likedIcon = liked?.querySelector("svg");
      const likedLabel = liked?.querySelector("span");
      if (!(brand instanceof HTMLElement) || !(wordmark instanceof HTMLElement) || !(liked instanceof HTMLElement) || !(likedIcon instanceof SVGElement) || !(likedLabel instanceof HTMLElement)) {
        throw new Error("Expanded sidebar details were not found");
      }
      const iconRect = likedIcon.getBoundingClientRect();
      const labelRect = likedLabel.getBoundingClientRect();
      return {
        collapsed: sidebar.dataset.collapsed,
        width: sidebar.getBoundingClientRect().width,
        brandClipped: brand.scrollWidth > brand.clientWidth + 1 || wordmark.scrollWidth > wordmark.clientWidth + 1,
        brandClientWidth: brand.clientWidth,
        brandScrollWidth: brand.scrollWidth,
        wordmarkClientWidth: wordmark.clientWidth,
        wordmarkScrollWidth: wordmark.scrollWidth,
        lowerLinkGap: labelRect.left - iconRect.right,
      };
    });
    assert.equal(expanded.collapsed, undefined, "the sidebar toggle should expose the expanded state");
    assert.ok(expanded.width > collapsed.sidebarWidth, "the sidebar should animate to its expanded width");
    assert.equal(expanded.brandClipped, false, `the Sakura wordmark must fit without clipping: ${JSON.stringify(expanded)}`);
    assert.ok(expanded.lowerLinkGap >= 0 && expanded.lowerLinkGap <= 20, "expanded lower-link labels should remain beside their icons");
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");

    await page.locator("#sakura-sidebar-body").evaluate((body) => {
      body.scrollTop = body.scrollHeight;
    });
    const profile = page.getByRole("link", { name: "Your listening profile" }).first();
    await profile.scrollIntoViewIfNeeded();
    const profileBottom = await profile.evaluate((element) => element.getBoundingClientRect().bottom);
    assert.ok(profileBottom <= viewport.height + 1, "the final sidebar destination must remain reachable");
    assert.deepEqual(errors, []);
    report.push({ variant: "short-desktop", collapsed, expanded, profileBottom });
    await context.close();
  }

  await fs.writeFile(
    ".local/rebuild-responsive-shell-report.json",
    JSON.stringify({ checkedAt: new Date().toISOString(), checks: report }, null, 2),
  );
  console.log(JSON.stringify({ variants: report.length, checks: report }));
} finally {
  await browser.close();
}
