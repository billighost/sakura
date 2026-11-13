/** Accent-insensitive Latin search; preserve vowels/marks in every other script. */
export function foldLatinAccents(value:string) {
  if (/^[\x00-\x7f]*$/.test(value)) return value;
  // Normalize a complete Latin span once. Marks belonging to every other
  // script remain intact, including vowels that are part of the spelling.
  return value.normalize("NFKC").replace(/(?:\p{Script=Latin}\p{M}*)+/gu,span=>span.normalize("NFKD").replace(/\p{M}/gu,""));
}
