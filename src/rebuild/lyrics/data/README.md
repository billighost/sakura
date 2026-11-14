# Tamil initial-letter data

`tamil-initials.json` and `tamil-initials.meta.json` are adapted from the
[Google Research Dakshina v1.0 dataset](https://github.com/google-research-datasets/dakshina)
and are separately licensed under
[Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
The implementation code outside these data files is separate from this license.
The complete license is included in [CC-BY-SA-4.0.txt](CC-BY-SA-4.0.txt).

Credit: Brian Roark, Lawrence Wolf-Sonkin, Christo Kirov, Sabrina J. Mielke,
Cibu Johny, Işın Demirşahin and Keith Hall, “Processing South Asian Languages
Written in the Latin Script: the Dakshina Dataset,” LREC 2020,
[pages 2413–2423](https://aclanthology.org/2020.lrec-1.294/).

The adaptation retains only an exact native word and its preferred initial
consonant. It requires at least three unanimous human attestations and alignment
of the complete word's coarse vowel and consonant sequence. Rejected or unknown
annotations still count against agreement. The remaining word is read from its
Tamil spelling, preserving vowel length, nasals and other letter distinctions.
These are preferred reading variants, not a guarantee of one pronunciation
across dialects or singers. The source-checked choices in `tamilReading.ts`
take precedence. No stems or complete word readings are generated from the data.

The map contains 1,123 changed initial choices. The metadata records the source
TSV hashes and archive member paths, every selected word's votes and the adaptation
rules. The generator verifies all three official source hashes before deriving
the map. Extract the three Tamil lexicons from the
[official v1.0 archive](https://storage.googleapis.com/gresearch/dakshina/dakshina_dataset_v1.0.tar)
into a local folder
and reproduce or verify the files with:

```sh
node scripts/rebuild-tamil-lexicon.mjs --input .local/tamil-dakshina
node scripts/rebuild-tamil-lexicon.mjs --input .local/tamil-dakshina --check
```

The generator reads local TSVs. Runtime requests use only the compact static
lookup; they do not download the dataset or consult a remote service.

## Individually reviewed choices

`tamil-reviewed-initials.json` records additional exact native forms whose
preferred initial is established by a printed Roman token. Its metadata distinguishes
44 forms corroborated by dictionary IPA or a second lyric publisher from three
published preferred variants for which no independent IPA or second-source
corroboration is established. Two explicitly reviewed c/ch variants are also
protected. The metadata credits the source publishers and Wiktionary contributors
with URLs and capture hashes. These factual lexical choices and source evidence
are separately provided under CC-BY-SA 4.0, using the included license. Full lyric
quotations are omitted.

Each inflected form is reviewed and listed separately; the engine does not derive
new forms from its lemma. Explicit reviewed c/ch variants retain priority alongside
the reviewed s/g/b/d choices. This map takes precedence over the generated Dakshina
data, and the source-reviewed entries already in `tamilReading.ts` take precedence
over both maps. Only the compact initial map is imported by the server engine.
