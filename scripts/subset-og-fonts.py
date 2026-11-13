"""Prepare licensed, local fallback fonts and brand glyph advances for the OG renderer."""
import json
import sys
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools import subset
from fontTools.ttLib.tables import otTables

destination, staging = map(Path, sys.argv[1:3])
sources = json.loads((staging / 'sources.json').read_text(encoding='utf-8'))
metrics = {}
sans = TTFont(destination / 'inter-400-normal.ttf')
metrics['sans'] = {chr(point): round(sans['hmtx'][glyph][0] / sans['head'].unitsPerEm, 5) for point, glyph in sans.getBestCmap().items()}
sans.close()
for style in ('normal', 'italic'):
    # The sans font supplies Greek/Cyrillic when the display serif lacks a glyph.
    advances = {}
    for filename in ('inter-400-normal.ttf', 'fraunces-600-' + style + '.ttf'):
        font = TTFont(destination / filename)
        scale = font['head'].unitsPerEm
        advances.update({chr(point): round(font['hmtx'][glyph][0] / scale, 5) for point, glyph in font.getBestCmap().items()})
        font.close()
    metrics[style] = advances
Path('src/rebuild/og/font-metrics.json').write_text(json.dumps(metrics, ensure_ascii=False) + '\n', encoding='utf-8')

entries = []
covered = set()
for source in [item for item in sources if item['fallback']]:
    path = staging / source['file']
    font = TTFont(path)
    points = sorted(point for point in font.getBestCmap() if point > 0x7f and point not in covered)
    font.close()
    for offset in range(0, len(points), 600):
        selected = points[offset:offset + 600]
        font = TTFont(path)
        options = subset.Options()
        options.flavor = 'woff'
        options.recalc_timestamp = False
        # Keep shaping features, including Arabic and Devanagari substitutions.
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(unicodes=selected)
        subsetter.subset(font)
        # This Next/Satori build supports chained context format 3, but not
        # context-only format 3. Empty surrounding contexts are equivalent.
        if 'GSUB' in font:
            for lookup in font['GSUB'].table.LookupList.Lookup:
                if lookup.LookupType != 5 or any(table.Format != 3 for table in lookup.SubTable):
                    continue
                converted = []
                for table in lookup.SubTable:
                    chain = otTables.ChainContextSubst()
                    chain.Format = 3
                    chain.BacktrackGlyphCount = 0
                    chain.BacktrackCoverage = []
                    chain.InputGlyphCount = table.GlyphCount
                    chain.InputCoverage = table.Coverage
                    chain.LookAheadGlyphCount = 0
                    chain.LookAheadCoverage = []
                    chain.SubstCount = table.SubstCount
                    chain.SubstLookupRecord = table.SubstLookupRecord
                    converted.append(chain)
                lookup.LookupType = 6
                lookup.SubTable = converted
        filename = source['file'].replace('.ttf', '-' + str(offset // 600) + '.woff')
        font.flavor = 'woff'
        font.save(destination / filename)
        font.close()
        ranges = []
        for point in selected:
            if ranges and point == ranges[-1][1] + 1:
                ranges[-1][1] = point
            else:
                ranges.append([point, point])
        entries.append({'name': 'OG ' + source['family'] + ' ' + str(offset // 600), 'file': filename, 'ranges': ranges})
    covered.update(points)
(destination / 'fallbacks.json').write_text(json.dumps({'fonts': entries, 'sources': sources}, ensure_ascii=False) + '\n', encoding='utf-8')
print('Prepared ' + str(len(entries)) + ' local Unicode font shards.')
