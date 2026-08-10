#!/usr/bin/env python3
"""
Generate the Han reading table used by src/lib/transliterate.ts.

Why this exists: romanising Chinese and Japanese needs per-character readings,
and those are genuine lexical data — no algorithm derives "bei" from 北.
Everything else the transliterator handles (Cyrillic, Greek, Hangul, kana,
Arabic, Hebrew, Devanagari, Thai) is rule-based and lives in code.

Source is the Unicode Consortium's Unihan database, which is the authority the
dictionaries themselves cite. Fields taken:

  kMandarin    — Mandarin reading, one value per character, in the pinyin the
                 Unicode standard normalises to.
  kJapaneseOn  — Sino-Japanese readings, for kanji in Japanese text.
  kJapaneseKun — native Japanese readings.

Restricted to the CJK block that actually occurs in song lyrics, because
shipping all 98k assigned Han characters to a phone to romanise a chorus is
indefensible.

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


def main():
    mandarin, on, kun = parse()

    # Japanese: prefer on'yomi. In compound words — which is what most kanji in
    # lyrics are — on'yomi is the reading that occurs, and picking kun'yomi
    # there produces something a Japanese reader would not recognise. Neither
    # is right without morphological analysis; on'yomi is wrong less often.
    japanese = {}
    for code in set(on) | set(kun):
        japanese[code] = on.get(code) or kun[code]

    codes = sorted(set(mandarin) | set(japanese))

    # Encoded as parallel strings indexed by a shared codepoint list rather
    # than a JSON object with 20k keys: the object form parses into 20k
    # property slots at import, which is slower and permanently resident.
    # Delimited strings are one allocation each, split into a Map on first use.
    chars = "".join(chr(c) for c in codes)
    zh = "".join(mandarin.get(c, "") for c in codes)
    ja = "".join(japanese.get(c, "") for c in codes)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(
            "/**\n"
            " * Han character readings — GENERATED, do not edit by hand.\n"
            " *\n"
            " * Source: Unicode Han Database (Unihan), fields kMandarin,\n"
            " * kJapaneseOn and kJapaneseKun, restricted to the CJK Unified\n"
            " * Ideographs block (U+4E00-U+9FFF).\n"
            " *\n"
            " * Regenerate with: python scripts/gen-han-readings.py\n"
            " *\n"
            " * Stored as parallel delimited strings rather than an object so\n"
            " * the module costs three string allocations at import instead of\n"
            f" * {len(codes)} property slots. See buildHanMap() in transliterate.ts.\n"
            " */\n\n"
        )
        f.write(f"/** {len(codes)} characters, in codepoint order. */\n")
        f.write(f"export const HAN_CHARS = {json.dumps(chars, ensure_ascii=False)};\n\n")
        f.write("/** Mandarin (pinyin), \\u0001-delimited, aligned to HAN_CHARS. */\n")
        f.write(f"export const HAN_MANDARIN = {json.dumps(zh, ensure_ascii=False)};\n\n")
        f.write("/** Japanese (on'yomi, falling back to kun'yomi), aligned to HAN_CHARS. */\n")
        f.write(f"export const HAN_JAPANESE = {json.dumps(ja, ensure_ascii=False)};\n")

    size = os.path.getsize(OUT)
    print(f"{len(codes)} characters -> {OUT} ({size / 1024:.0f} KB)")
    print(f"  mandarin: {len(mandarin)}  japanese: {len(japanese)}")


if __name__ == "__main__":
    main()
