/** Reproduce the separately licensed Dakshina initial-letter data. */
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const inputIndex = args.indexOf("--input");
const input = resolve(repo, inputIndex >= 0 ? args[inputIndex + 1] : ".local/tamil-dakshina");
const check = args.includes("--check");
const names = ["dev", "test", "train"].map(partition => `ta.translit.sampled.${partition}.tsv`);
// Official v1.0 archive members; reject altered or partial TSVs before deriving
// data. Hashes and archive paths are also emitted as distributable evidence.
const sourceHashes = {
  "ta.translit.sampled.dev.tsv": "c5bb92e01c7a2a1d1b8d18463d690519a8100fa14dbde7b38ea3e366df7a0bf8",
  "ta.translit.sampled.test.tsv": "062fdc82d1d8cb035edfc92895e794de2b8491c287ba285cabe22930a8ea2c3c",
  "ta.translit.sampled.train.tsv": "085760e523562b46103b16cfb60a0fd2c5c703bc93e57d9ed2e949e428d172b1",
};
const words = new Map();
const inputs = {};
let annotations = 0, attestations = 0;
for (const name of names) {
  const raw = await readFile(resolve(input, name));
  const lines = raw.toString("utf8").trimEnd().split(/\r?\n/);
  const sha256 = createHash("sha256").update(raw).digest("hex");
  if (sha256 !== sourceHashes[name]) throw new Error(`Official Dakshina v1.0 source hash differs: ${name}`);
  inputs[name] = { archivePath: `dakshina_dataset_v1.0/ta/lexicons/${name}`, sha256, bytes: raw.length, rows: lines.length };
  for (const [index, line] of lines.entries()) {
    const fields = line.split("\t");
    const [native, roman, count] = fields;
    if (fields.length !== 3 || !/^\d+$/.test(count) || Number(count) <= 0) throw new Error(`Malformed ${name}:${index + 1}`);
    const word = native.trim().normalize("NFC"), form = roman.trim().toLowerCase(), votes = Number(count);
    if (!words.has(word)) words.set(word, new Map());
    const forms = words.get(word);
    forms.set(form, (forms.get(form) || 0) + votes);
    annotations++; attestations += votes;
  }
}

// These coarse forms validate annotation identity only. They never generate
// displayed readings or discard vowel length, retroflexion or nasal place.
const consonants = { க:"k", ங:"n", ச:"c", ஞ:"n", ட:"t", ண:"n", த:"t", ந:"n", ப:"p", ம:"m", ய:"y", ர:"r", ல:"l", வ:"v", ழ:"l", ள:"l", ற:"r", ன:"n", ஜ:"c", ஶ:"c", ஷ:"c", ஸ:"c", ஹ:"h" };
const vowels = { அ:"a", ஆ:"a", இ:"i", ஈ:"i", உ:"u", ஊ:"u", எ:"e", ஏ:"e", ஐ:"ai", ஒ:"o", ஓ:"o", ஔ:"au" };
const signs = { "ா":"a", "ி":"i", "ீ":"i", "ு":"u", "ூ":"u", "ெ":"e", "ே":"e", "ை":"ai", "ொ":"o", "ோ":"o", "ௌ":"au", "்":"" };
const allowed = { ச:["c", "s", "j"], க:["k", "g"], ப:["p", "b"], ட:["ṭ", "ḍ"], த:["t", "d"] };
const folds = { g:"k", d:"t", b:"p", s:"c", j:"c", w:"v", q:"k", z:"c" };
const digraphs = { zh:"l", ch:"c", sh:"c", th:"t", dh:"t", ph:"p", bh:"p", kh:"k", gh:"k", ny:"n", gn:"n" };
const vowelPairs = { aa:"a", ii:"i", uu:"u", ae:"e", oa:"o", ee:"i", oo:"u" };

function nativeForm(word) {
  let output = "";
  for (let index = 0; index < word.length;) {
    const letter = word[index];
    if (consonants[letter] !== undefined) {
      const sign = signs[word[index + 1]], vowel = sign === undefined ? "a" : sign;
      output += (letter === "ப" && word[index - 1] === "ஃ" ? "f" : consonants[letter]) + vowel;
      index += sign === undefined ? 1 : 2;
    } else if (vowels[letter] !== undefined) {
      output += vowels[letter]; index++;
    } else if (letter === "ஃ" && word[index + 1] === "ப") index++;
    else return;
  }
  return output;
}
function romanForm(form) {
  if (!/^[a-z]+$/.test(form)) return;
  let output = "";
  for (let index = 0; index < form.length;) {
    const pair = form.slice(index, index + 2);
    if (digraphs[pair] !== undefined) { output += digraphs[pair]; index += 2; }
    else if (vowelPairs[pair] !== undefined) { output += vowelPairs[pair]; index += 2; }
    else { output += folds[form[index]] || form[index]; index++; }
  }
  return output;
}
function aligned(word, native, form) {
  let roman = romanForm(form);
  if (roman === undefined) return false;
  if (/ன்\u0bb1|ந்\u0bb1/u.test(word)) roman = roman.replace(/ntr/g, "nr");
  if (word.includes("ற்ற")) roman = roman.replace(/ttr/g, "rr").replace(/tr/g, "rr");
  return roman === native;
}
function initialClass(head, form) {
  if (head === "ச") return form.startsWith("sh") ? "unknown" : form.startsWith("s") ? "s" : form.startsWith("c") ? "c" : form.startsWith("j") ? "j" : "unknown";
  if (head === "க") return /^[kg]/.test(form) ? form[0] : "unknown";
  if (head === "ப") return form.startsWith("ph") ? "unknown" : /^[pb]/.test(form) ? form[0] : "unknown";
  if (head === "ட") return form.startsWith("th") ? "unknown" : form.startsWith("t") ? "ṭ" : form.startsWith("d") ? "ḍ" : "unknown";
  return form.startsWith("th") ? "unknown" : /^[td]/.test(form) ? form[0] : "unknown";
}

const entries = {}, evidence = {};
let candidateWords = 0, approvedWords = 0, alignedForms = 0, rejectedForms = 0;
for (const [word, forms] of [...words].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
  const choices = allowed[word[0]];
  if (!choices || !/^[\u0b80-\u0bff]+$/u.test(word) || word.startsWith(word[0] + "்")) continue;
  const native = nativeForm(word);
  if (native === undefined) continue;
  candidateWords++;
  const classes = new Map();
  let total = 0;
  for (const [form, votes] of forms) {
    total += votes;
    if (!aligned(word, native, form)) { rejectedForms++; continue; }
    alignedForms++;
    const initial = initialClass(word[0], form);
    classes.set(initial, (classes.get(initial) || 0) + votes);
  }
  const initial = choices.find(choice => classes.get(choice) === total);
  // Unknown and rejected annotations remain in total. A majority among only
  // surviving rows is insufficient: all original attestations must agree.
  if (!initial || total < 3) continue;
  approvedWords++;
  if (initial === choices[0]) continue;
  entries[word] = initial;
  evidence[word] = { initial, attestations: total, romanizations: Object.fromEntries([...forms].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) };
}

const metadata = {
  schema: "tamil-initials-v1",
  dataset: "Dakshina v1.0 (2020)",
  authors: "Brian Roark, Lawrence Wolf-Sonkin, Christo Kirov, Sabrina J. Mielke, Cibu Johny, Işın Demirşahin and Keith Hall",
  source: "https://github.com/google-research-datasets/dakshina",
  archive: "https://storage.googleapis.com/gresearch/dakshina/dakshina_dataset_v1.0.tar",
  paper: "https://aclanthology.org/2020.lrec-1.294/",
  license: "CC-BY-SA-4.0", licenseURL: "https://creativecommons.org/licenses/by-sa/4.0/",
  licenseFile: "CC-BY-SA-4.0.txt",
  adaptation: "Exact NFC words reduced to preferred initial consonant only. Whole-word coarse vowel/consonant alignment validates human annotations; all original attestations must agree with at least three votes. No stemming, majority lookup or complete Roman-output substitution.",
  validation: "Coarse vowel identity (length ignored for validation only); aa/ii/uu/ae/oa, ee→i, oo→u; conventional consonant digraphs and stop voicing folded for validation only; explicit Tamil alveolar clusters may match ttr/ndr. Unknown and rejected votes remain in the denominator.",
  reproducibility: "node scripts/rebuild-tamil-lexicon.mjs --input .local/tamil-dakshina --check",
  inputs,
  counts: { nativeWords: words.size, annotationRows: annotations, attestations, candidateWords, approvedWords, changedInitials: Object.keys(entries).length, alignedForms, rejectedForms },
  evidence,
};
const output = resolve(repo, "src/rebuild/lyrics/data");
await mkdir(output, { recursive: true });
for (const [name, data] of [["tamil-initials.json", entries], ["tamil-initials.meta.json", metadata]]) {
  const text = JSON.stringify(data, null, 2) + "\n", target = resolve(output, name);
  if (check) {
    if (await readFile(target, "utf8") !== text) throw new Error(`Generated Tamil data differs: ${name}`);
  } else await writeFile(target, text);
}
console.log(JSON.stringify({ checked: check, ...metadata.counts }));
