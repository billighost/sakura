/** Accent-insensitive Latin search; preserve vowels/marks in every other script. */
export function foldLatinAccents(value:string) {
  return value.normalize("NFKC").replace(/\p{Script=Latin}\p{M}*/gu,span=>span.normalize("NFKD").replace(/\p{M}/gu,""));
}
