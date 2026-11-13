import { readFile } from 'node:fs/promises';

// Browser mocks use the installed engine versions without loading dictionaries.
async function version(file, name) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const match = source.match(new RegExp(`export const ${name} = "([^"]+)"`));
  if (!match) throw new Error(`Missing reading version: ${name}`);
  return match[1];
}
const [japanese, multilingual] = await Promise.all([
  version('../../src/rebuild/lyrics/versions.ts', 'JAPANESE_READING_VERSION'),
  version('../../src/rebuild/lyrics/language.ts', 'READING_VERSION'),
]);
export const fixtureReadingEngine = language => language === 'ja' ? japanese : `${multilingual}:${language}`;
