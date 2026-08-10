#!/usr/bin/env python3
"""
Generate the Han reading table used by src/lib/transliterate.ts.

Why this exists: romanising Chinese and Japanese needs per-character readings,
and those are genuine lexical data — no algorithm derives "bei" from 北.
Everything else the transliterator handles (Cyrillic, Greek, Hangul, kana,
Arabic, Hebrew, Devanagari) is rule-based and lives in code.

Source is the Unicode Consortium's Unihan database, which is the authority the
dictionaries themselves cite. Fields taken:

  kMandarin    — Mandarin reading, one value per character, in the pinyin the
                 Unicode standard normalises to.
  kJapaneseOn  — Sino-Japanese readings, used in compounds.
  kJapaneseKun — native Japanese readings, used with okurigana.

Restricted to the CJK block that actually occurs in song lyrics, because
shipping all 98k assigned Han characters to romanise a chorus is indefensible.

Run:  python scripts/gen-han-readings.py
Out:  src/lib/data/hanReadings.ts
"""

import json
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ZIP = os.path.join(ROOT, "unihan.zip")
OUT = os.path.join(ROOT, "src", "lib", "data", "hanReadings.ts")

# CJK Unified Ideographs (URO). Covers effectively all modern Chinese and
# Japanese prose; Ext-B and beyond are historical/rare forms that would triple
# the payload for characters that will never appear in a lyric.
RANGE_START, RANGE_END = 0x4E00, 0x9FFF

# Field separator inside the packed reading strings. U+0001 never occurs in a
# reading, so it can't collide with the data.
SEP = chr(1)


def parse():
    mandarin, on, kun = {}, {}, {}

    with zipfile.ZipFile(ZIP) as z:
        with z.open("Unihan_Readings.txt") as f:
            for raw in f:
                line = raw.decode("utf-8")
                if line.startswith("#") or not line.strip():
                    continue
                parts = line.rstrip("\n").split("\t")
                if len(parts) < 3:
                    continue

                code = int(parts[0][2:], 16)
                if not (RANGE_START <= code <= RANGE_END):
                    continue

                field, value = parts[1], parts[2].strip()
                # Multiple readings are space-separated and ordered by
                # frequency; the first is the one to show when there is no
                # context to disambiguate with.
                first = value.split(" ")[0] if value else ""
                if not first:
                    continue

                if field == "kMandarin":
                    mandarin[code] = first.lower()
                elif field == "kJapaneseOn":
                    on[code] = first.lower()
                elif field == "kJapaneseKun":
                    kun[code] = first.lower()

    return mandarin, on, kun


HEADER = """/**
 * Han character readings — GENERATED, do not edit by hand.
 *
 * Source: Unicode Han Database (Unihan), fields kMandarin, kJapaneseOn and
 * kJapaneseKun, restricted to the CJK Unified Ideographs block
 * (U+4E00-U+9FFF).
 *
 * Regenerate with: python scripts/gen-han-readings.py
 *
 * Stored as parallel U+0001-delimited strings indexed by a shared codepoint
 * list, rather than as objects: the object form would parse into {count}
 * property slots at import, which is both slower and permanently resident.
 * These are four string allocations, split into Maps on first use. See
 * buildHanMap() in transliterate.ts.
 */

"""


def main():
    mandarin, on, kun = parse()

    # Japanese needs BOTH readings, because which one is correct depends on
    # context a per-character table cannot see:
    #
    #   on'yomi  — used in compounds, which is most kanji in most text.
    #   kun'yomi — used when the kanji stands as its own word, and in particular
    #              when followed by okurigana (trailing kana that inflect it):
    #              駆ける is "kakeru" from the kun reading KAKERU, not "kuru"
    #              from the on reading KU.
    #
    # Emitting both lets the runtime choose on the one signal available without
    # a morphological analyser: whether kana directly follow the character.
    # See `hanReading` in transliterate.ts.
    codes = sorted(set(mandarin) | set(on) | set(kun))

    chars = "".join(chr(c) for c in codes)
    zh = SEP.join(mandarin.get(c, "") for c in codes)
    ja_on = SEP.join(on.get(c, "") for c in codes)
    ja_kun = SEP.join(kun.get(c, "") for c in codes)

    def const(name: str, doc: str, value: str) -> str:
        return f"/** {doc} */\nexport const {name} = {json.dumps(value, ensure_ascii=False)};\n\n"

    body = (
        HEADER.replace("{count}", str(len(codes)))
        + const("HAN_CHARS", f"{len(codes)} characters, in codepoint order.", chars)
        + const("HAN_MANDARIN", "Mandarin (pinyin, with tone marks). Aligned to HAN_CHARS.", zh)
        + const("HAN_JAPANESE_ON", "Japanese on'yomi, for compounds. Aligned to HAN_CHARS.", ja_on)
        + const(
            "HAN_JAPANESE_KUN",
            "Japanese kun'yomi, for kanji with okurigana. Aligned to HAN_CHARS.",
            ja_kun,
        )
    )

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(body.rstrip("\n") + "\n")

    size = os.path.getsize(OUT)
    print(f"{len(codes)} characters -> {OUT} ({size / 1024:.0f} KB)")
    print(f"  mandarin: {len(mandarin)}  on: {len(on)}  kun: {len(kun)}")


if __name__ == "__main__":
    main()
