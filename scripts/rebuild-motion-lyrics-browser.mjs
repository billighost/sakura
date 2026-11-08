/** Production UI regressions with an existing authenticated session and explicit, isolated media fixtures. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium, expect} from '@playwright/test';

const base = process.env.SAKURA_TEST_URL || 'http://localhost:3000';
const session = JSON.parse(await fs.readFile('.local/rebuild-test-account.json', 'utf8'));
const authenticated = await fetch(base + '/api/v2/profile', {headers: {Cookie: session.cookie}});
assert.equal(authenticated.ok, true, 'The existing private test account must have a valid session.');
const tracks = Array.from({length: 8}, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 501).padStart(12, '0')}`,
  title: index ? `Motion fixture song ${index + 1}` : 'The paper score',
  artists: ['Browser regression fixture'], durationMs: 180000, coverUrl: null,
  albumTitle: 'A deterministic listening room', versionLabel: 'Original recording',
  reference: {provider: 'deezer', id: String(index + 501)},
  references: [{provider: 'deezer', id: String(index + 501)}],
}));
const lines = Array.from({length: 80}, (_, index) => ({
  text: `The words on this paper score, line ${index + 1}`,
  start: index * 2, end: (index + 1) * 2,
}));
const rate = 8000, count = rate * 180, audio = Buffer.alloc(44 + count * 2);
audio.write('RIFF', 0); audio.writeUInt32LE(36 + count * 2, 4); audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(rate, 24); audio.writeUInt32LE(rate * 2, 28);
audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36);
audio.writeUInt32LE(count * 2, 40);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
const checks = [];
let latestPage;

async function room({width = 1440, reduced = false, opening = false, blockedStorage = false} = {}) {
  const context = await browser.newContext({viewport: {width, height: 900}, reducedMotion: reduced ? 'reduce' : 'no-preference'});
  await context.addCookies(session.cookie.split('; ').map(part => {
    const separator = part.indexOf('=');
    return {name: part.slice(0, separator), value: part.slice(separator + 1), url: base};
  }));
  await context.addInitScript(({opening, blockedStorage}) => {
    if (blockedStorage) Object.defineProperty(window, 'sessionStorage', {get() {throw new DOMException('Test storage restriction', 'SecurityError');}});
    else if (!opening) sessionStorage.setItem('sakura-ink-opening', '1');
    const AudioBase = window.Audio;
    window.Audio = function(...args) {const element = new AudioBase(...args); window.__motionAudio = element; return element;};
    window.Audio.prototype = AudioBase.prototype;
    window.__dialogAnimations = [];
    document.addEventListener('animationstart', event => {
      if (event.target instanceof Element && event.target.hasAttribute('data-dialog-appearance') && !event.pseudoElement)
        window.__dialogAnimations.push({appearance: event.target.getAttribute('data-dialog-appearance'), name: event.animationName});
    }, true);
    const animate = Element.prototype.animate;
    window.__routeEntrances = 0;
    Element.prototype.animate = function(...args) {
      if (this.hasAttribute('data-route-path')) window.__routeEntrances++;
      return animate.apply(this, args);
    };
  }, {opening, blockedStorage});
  const page = await context.newPage(); latestPage = page;
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let libraryHeld = false, releaseLibrary;
  const libraryGate = new Promise(resolve => {releaseLibrary = resolve;});
  const requests = {home: 0, library: 0};
  await page.route('**/api/v2/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    // Authentication is real. All product fixtures and mutations remain inside this browser.
    if (path === '/api/v2/profile') return route.continue();
    if (path === '/api/v2/settings') return route.fulfill({json: {theme: 'light', privateSession: true, reducedMotion: reduced, onboarded: true, seedArtists: [], seedGenres: []}});
    if (path === '/api/v2/home') {requests.home++; return route.fulfill({json: {featured: tracks, mixes: [], recent: [], needsOnboarding: false}});}
    if (path === '/api/v2/library') {
      if (url.searchParams.get('kind') === 'all') {requests.library++; if (libraryHeld) await libraryGate;}
      return route.fulfill({json: {recordings: tracks, playlists: [], nextCursor: null}});
    }
    if (path === '/api/v2/recordings/resolve') {
      const input = request.postDataJSON();
      const track = tracks.find(item => item.reference.id === input.reference?.id) || tracks[0];
      return route.fulfill({json: {status: 'resolved', recording: {recordingId: track.id, metadata: {title: track.title, artists: track.artists, durationMs: track.durationMs}, references: track.references}, playback: {url: '/fixture-motion.wav', assetId: 'fixture-motion', sizeBytes: audio.length}}});
    }
    if (path === '/api/v2/lyrics') return route.fulfill({json: {status: 'matched', provider: 'explicit browser fixture', providerTrackId: 501, schemaVersion: 'verified-lyrics-v1', timing: 'synced', lines}});
    if (path === '/api/v2/mixes') return route.fulfill({json: {mixes: []}});
    if (path === '/api/v2/bloom') return route.fulfill({json: {items: [], schedule: {timeZone: 'Africa/Lagos'}}});
    if (path === '/api/v2/readings') return route.fulfill({status: 503, json: {error: 'The reading engine is checked separately.'}});
    return route.fulfill({json: {}});
  });
  await page.route('**/fixture-motion.wav', route => {
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
    if (!range) return route.fulfill({body: audio, contentType: 'audio/wav', headers: {'Accept-Ranges': 'bytes', 'Content-Length': String(audio.length)}});
    const start = Number(range[1]), end = Math.min(audio.length - 1, range[2] ? Number(range[2]) : audio.length - 1);
    if (start >= audio.length) return route.fulfill({status: 416, headers: {'Content-Range': `bytes */${audio.length}`}});
    return route.fulfill({status: 206, body: audio.subarray(start, end + 1), contentType: 'audio/wav',
      headers: {'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${audio.length}`, 'Content-Length': String(end - start + 1)}});
  });
  return {context, page, errors, requests, holdLibrary() {libraryHeld = true;}, releaseLibrary};
}

async function navigate(page, name, path) {
  await page.locator('nav[aria-label="Main navigation"]').getByRole('link', {name, exact: true}).click();
  await expect(page.locator('[data-route-path]')).toHaveAttribute('data-route-path', path);
}

async function settled(dialog) {
  await expect(dialog).toHaveAttribute('data-dialog-phase', 'open', {timeout: 5000});
}

async function inspect(dialog, appearance, width, reduced) {
  await expect(dialog).toHaveAttribute('data-dialog-appearance', appearance);
  const entrance = await dialog.evaluate(element => ({
    animation: getComputedStyle(element).animationName === 'none'
      ? window.__dialogAnimations.filter(item => item.appearance === element.dataset.dialogAppearance).at(-1)?.name || 'none'
      : getComputedStyle(element).animationName,
    phase: element.dataset.dialogPhase,
  }));
  await settled(dialog);
  const geometry = await dialog.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return {left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
      overflows: element.scrollWidth > element.clientWidth + 1,
      locked: document.body.style.overflow === 'hidden', focused: element.contains(document.activeElement)};
  });
  assert.ok(geometry.left >= -1 && geometry.right <= width + 1, `${appearance} fits viewport width`);
  assert.ok(geometry.top >= -1 && geometry.bottom <= 901, `${appearance} fits viewport height`);
  assert.equal(geometry.overflows, false, `${appearance} avoids horizontal overflow`);
  assert.equal(geometry.locked, true); assert.equal(geometry.focused, true);
  if (reduced) assert.equal(entrance.animation, 'none');
  else assert.notEqual(entrance.animation, 'none', `${appearance} has an artistic entrance`);
  return {appearance, ...entrance, ...geometry};
}

async function closeDialog(page, appearance, remaining, reduced) {
  const dialog = page.locator(`dialog[open][data-dialog-appearance="${appearance}"]`);
  // Read the short exit in the browser, avoiding protocol latency swallowing its entire duration.
  const exit = await dialog.evaluate(async element => {
    element.querySelector('button[aria-label="Close"]').click();
    const result = {phase: element.dataset.dialogPhase, open: element.open};
    await new Promise(resolve => setTimeout(resolve, 50));
    return {...result, retained: element.isConnected && element.open};
  });
  if (!reduced) {
    assert.equal(exit.phase, 'closing');
    assert.equal(exit.open, true, 'The native modal stays open throughout exit');
    assert.equal(exit.retained, true, 'The modal retains its content during exit');
  }
  await dialog.waitFor({state: 'detached'});
  await expect(page.locator('dialog[open]')).toHaveCount(remaining);
  if (remaining) {
    assert.equal(await page.locator('dialog[open]').last().evaluate(element => element.contains(document.activeElement)), true, 'Focus returns into the underlying modal');
    assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
  } else assert.equal(await page.evaluate(() => document.body.style.overflow), '');
}

async function scrollCurrentIntoReadingArea(dialog) {
  await dialog.locator('[data-player-scroll]').evaluate(scroll => {
    const current = scroll.querySelector('[data-lyric-index][aria-current="true"]');
    if (!current) throw new Error('No active lyric to restore');
    const currentRect = current.getBoundingClientRect(), scrollRect = scroll.getBoundingClientRect();
    scroll.scrollTo({top: scroll.scrollTop + currentRect.top - scrollRect.top - scroll.clientHeight * .4 + currentRect.height / 2, behavior: 'instant'});
  });
}

async function captureFailure(page) {
  console.error(JSON.stringify(await page.evaluate(() => ({
    sliders: Array.from(document.querySelectorAll('input[type=range]')).map(element => ({label: element.getAttribute('aria-label'), value: element.value})),
    current: Array.from(document.querySelectorAll('[data-lyric-index][aria-current]')).map(element => ({index: element.dataset.lyricIndex, current: element.getAttribute('aria-current')})),
    selected: Array.from(document.querySelectorAll('[data-lyric-index][aria-pressed=true]')).map(element => element.dataset.lyricIndex),
    following: document.querySelector('[data-lyrics-follow]')?.dataset.lyricsFollow,
    audio: window.__motionAudio && {time: window.__motionAudio.currentTime, duration: window.__motionAudio.duration, ready: window.__motionAudio.readyState, paused: window.__motionAudio.paused, seeking: window.__motionAudio.seeking,
      seekable: Array.from({length: window.__motionAudio.seekable.length}, (_, index) => [window.__motionAudio.seekable.start(index), window.__motionAudio.seekable.end(index)]), error: window.__motionAudio.error?.message},
  })).catch(() => ({diagnosticUnavailable: true}))));
  await page.screenshot({path: '.local/rebuild-motion-lyrics-failure.png'}).catch(() => {});
}

try {
  await fs.mkdir('.local', {recursive: true});
  for (const {width, reduced} of [{width: 1440, reduced: false}, {width: 390, reduced: true}]) {
    const test = await room({width, reduced}), {page} = test;
    try {
      await page.goto(base + '/home');
      await page.getByRole('button', {name: 'Find my soundtrack', exact: true}).click({timeout: 60000});
      await page.getByRole('button', {name: 'Open now playing', exact: true}).click();
      const player = page.locator('dialog[open][data-dialog-appearance="player"]');
      const appearances = [await inspect(player, 'player', width, reduced)];
      await page.waitForFunction(() => window.__motionAudio?.readyState >= 2 && Number.isFinite(window.__motionAudio.duration), {}, {timeout: 30000});
      await player.getByRole('button', {name: 'Pause', exact: true}).click();
      await player.getByRole('button', {name: 'Up next', exact: true}).click();
      const queue = page.locator('dialog[open][data-dialog-appearance="queue"]');
      appearances.push(await inspect(queue, 'queue', width, reduced));
      await expect(page.locator('dialog[open]')).toHaveCount(2);
      await closeDialog(page, 'queue', 1, reduced);
      await player.getByRole('button', {name: 'Lyrics', exact: true}).click();
      const lyrics = page.locator('dialog[open][data-dialog-appearance="lyrics"]');
      appearances.push(await inspect(lyrics, 'lyrics', width, reduced));
      const view = lyrics.locator('[data-lyrics-follow]');
      const scroll = lyrics.locator('[data-player-scroll]');
      await page.waitForTimeout(700);
      await lyrics.locator('[data-lyric-index="1"]').click();
      await expect(lyrics.locator('[data-lyric-index="1"]')).toHaveAttribute('aria-current', 'true');
      await page.waitForTimeout(700);
      const browseBox = await scroll.boundingBox();
      await page.mouse.move(browseBox.x + browseBox.width * .7, browseBox.y + browseBox.height * .5);
      await page.mouse.wheel(0, 1200);
      await expect(view).toHaveAttribute('data-lyrics-follow', 'false');
      await lyrics.locator('[data-lyric-index="10"]').click();
      await expect(lyrics.locator('[data-lyric-index="10"]')).toHaveAttribute('aria-current', 'true');
      await expect(view).toHaveAttribute('data-lyrics-follow', 'true');
      await page.waitForTimeout(700);
      const scrollBox = await scroll.boundingBox();
      await page.mouse.move(scrollBox.x + scrollBox.width * .7, scrollBox.y + scrollBox.height * .5);
      await page.mouse.wheel(0, 1200);
      await expect(view).toHaveAttribute('data-lyrics-follow', 'false');
      await page.waitForTimeout(350);
      await expect(view).toHaveAttribute('data-lyrics-follow', 'false');
      await scrollCurrentIntoReadingArea(lyrics);
      await expect(view).toHaveAttribute('data-lyrics-follow', 'true');
      await lyrics.getByRole('button', {name: 'Play', exact: true}).click();
      await expect.poll(async () => Number(await lyrics.locator('[data-lyric-index][aria-current="true"]').getAttribute('data-lyric-index')), {timeout: 8000}).toBeGreaterThan(10);
      await lyrics.getByRole('button', {name: 'Pause', exact: true}).click();
      await page.waitForTimeout(700);
      await expect(view).toHaveAttribute('data-lyrics-follow', 'true');
      assert.equal(await scroll.evaluate(element => {
        const line = element.querySelector('[data-lyric-index][aria-current="true"]'), controls = element.querySelector('[data-lyrics-controls]');
        const rect = line.getBoundingClientRect(), viewport = element.getBoundingClientRect();
        const centre = (rect.top + rect.bottom) / 2;
        return centre > viewport.top + 12 && centre < Math.min(viewport.bottom, controls.getBoundingClientRect().top) - 12;
      }), true, 'Resumed playback keeps subsequent verses inside the reading area');
      // Keyboard browsing pauses follow too; native scrolling back resumes without a button.
      await scroll.evaluate(element => {element.tabIndex = 0; element.focus();});
      await page.keyboard.press('PageDown');
      await expect(view).toHaveAttribute('data-lyrics-follow', 'false');
      await page.waitForTimeout(350);
      await scrollCurrentIntoReadingArea(lyrics);
      await expect(view).toHaveAttribute('data-lyrics-follow', 'true');
      await lyrics.getByRole('button', {name: 'Select lyric lines', exact: true}).click();
      await lyrics.locator('[data-lyric-index="10"]').click();
      await scrollCurrentIntoReadingArea(lyrics);
      await page.waitForTimeout(350);
      await expect(view).toHaveAttribute('data-lyrics-follow', 'false');
      await expect(lyrics.locator('[data-lyric-index="10"]')).toHaveAttribute('aria-pressed', 'true');
      await lyrics.getByRole('button', {name: 'Share 1 lines', exact: true}).click();
      const share = page.locator('dialog[open][data-dialog-appearance="share"]');
      appearances.push(await inspect(share, 'share', width, reduced));
      await expect(share.locator('img')).toBeVisible({timeout: 30000});
      await closeDialog(page, 'share', 1, reduced);
      await player.getByRole('button', {name: 'Lyrics', exact: true}).click();
      await settled(lyrics);
      await lyrics.getByRole('button', {name: 'Select lyric lines', exact: true}).click();
      await lyrics.locator('[data-lyric-index="11"]').click();
      await lyrics.getByRole('button', {name: 'Next song', exact: true}).click();
      await expect(lyrics.getByRole('heading', {name: tracks[1].title, exact: true})).toBeVisible();
      await expect(lyrics.getByRole('button', {name: 'Select lines', exact: true})).toBeVisible();
      await expect(view).toHaveAttribute('data-lyrics-follow', 'true');
      assert.equal(await lyrics.locator('[data-lyric-index][aria-pressed="true"]').count(), 0, 'A new track resets selected lyrics');
      await expect(lyrics.getByRole('slider', {name: 'Playback position in lyrics', exact: true})).toBeVisible();
      await page.screenshot({path: `.local/rebuild-motion-lyrics-${width}.png`});
      await closeDialog(page, 'lyrics', 1, reduced);
      await closeDialog(page, 'player', 0, reduced);
      if (!reduced) assert.equal(new Set(appearances.map(item => item.animation)).size, 4, 'Each player overlay has its own entrance');
      assert.deepEqual(test.errors, []);
      checks.push({scope: 'overlays and synced lyrics', width, reduced, appearances, manualReturnResumes: true, subsequentVersesFollow: true, keyboardReturnResumes: true, selectionDoesNotFollow: true, newTrackResets: true});
      console.log(JSON.stringify({completed: 'overlays and synced lyrics', width, reduced}));
    } catch (error) {await captureFailure(page); throw error;}
    finally {test.releaseLibrary(); await test.context.close();}
  }

  const navigation = await room();
  try {
    const {page} = navigation;
    await page.goto(base + '/home');
    await expect(page.getByRole('button', {name: 'Find my soundtrack', exact: true})).toBeEnabled({timeout: 60000});
    await page.evaluate(() => {window.__originalRouteFrame = document.querySelector('[data-route-path]');});
    const homeScroll = await page.locator('#music-main').evaluate(element => {element.scrollTop = 120; return Math.round(element.scrollTop);});
    assert.ok(homeScroll > 0, 'Home fixture has enough content to test scroll restoration');
    navigation.holdLibrary();
    await navigate(page, 'Your library', '/library');
    await expect(page.getByLabel('Loading music').filter({visible: true}).first()).toBeVisible();
    navigation.releaseLibrary();
    const search = page.getByRole('searchbox', {name: 'Find in your library', exact: true}).filter({visible: true});
    await search.fill('paper score');
    await navigate(page, 'Home', '/home');
    await expect.poll(() => page.locator('#music-main').evaluate(element => Math.round(element.scrollTop))).toBe(homeScroll);
    await navigate(page, 'Your library', '/library');
    await expect(search).toHaveValue('paper score');
    assert.equal(await page.evaluate(() => window.__originalRouteFrame === document.querySelector('[data-route-path]')), true, 'Navigation keeps the router frame stable');
    assert.equal(navigation.requests.library, 1, 'Quickly revisiting the library uses its cached resource');
    for (let iteration = 0; iteration < 3; iteration++) {
      await navigate(page, 'Home', '/home');
      await navigate(page, 'Your library', '/library');
    }
    await expect(search).toHaveValue('paper score');
    await navigate(page, 'Home', '/home');
    await page.waitForTimeout(450);
    const entrances = await page.evaluate(() => window.__routeEntrances);
    await page.getByRole('button', {name: 'Find my soundtrack', exact: true}).click();
    await page.getByRole('button', {name: 'Open now playing', exact: true}).click();
    const player = page.locator('dialog[open][data-dialog-appearance="player"]'); await settled(player);
    await player.getByRole('button', {name: 'Next song', exact: true}).click();
    await closeDialog(page, 'player', 0, false);
    assert.equal(await page.evaluate(() => window.__routeEntrances), entrances, 'Playback and overlay changes never replay the page entrance');
    assert.equal(navigation.requests.home, 1);
    assert.deepEqual(navigation.errors, []);
    checks.push({scope: 'rapid cached navigation', stableFrame: true, localStatePreserved: true, scrollRestored: true, pendingShowsLoading: true, repeatedEntrances: false, requests: navigation.requests});
  } catch (error) {await captureFailure(navigation.page); throw error;}
  finally {navigation.releaseLibrary(); await navigation.context.close();}

  for (const blockedStorage of [false, true]) {
    const opening = await room({opening: true, blockedStorage});
    try {
      const {page} = opening;
      await page.goto(base + '/home');
      const intro = page.getByRole('status', {name: 'Sakura opening', exact: true});
      await expect(intro).toBeVisible({timeout: 15000});
      await intro.getByRole('button', {name: 'Skip', exact: true}).click();
      await expect(intro).toHaveCount(0);
      await navigate(page, 'Your library', '/library');
      await navigate(page, 'Home', '/home');
      await page.waitForTimeout(600);
      await expect(intro).toHaveCount(0);
      await page.evaluate(() => window.dispatchEvent(new Event('sakura-replay-opening')));
      await expect(intro).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(intro).toHaveCount(0);
      assert.deepEqual(opening.errors, []);
      checks.push({scope: 'session opening', blockedStorage, automaticPlaysOnce: true, explicitReplayWorks: true});
    } finally {opening.releaseLibrary(); await opening.context.close();}
  }
  await fs.writeFile('.local/rebuild-motion-lyrics-report.json', JSON.stringify({checkedAt: new Date().toISOString(), scope: 'Existing test authentication; browser-only catalog/media/API fixtures; no product writes', checks}, null, 2));
  console.log(JSON.stringify({passed: checks.length, checks: checks.map(({appearances, ...check}) => check)}));
} catch (error) {
  console.error(error.stack || error);
  await latestPage?.screenshot({path: '.local/rebuild-motion-lyrics-failure.png'}).catch(() => {});
  console.error(JSON.stringify({completed: checks.map(({appearances, ...check}) => check)}));
  process.exitCode = 1;
} finally {await browser.close();}
