# Sakura Bloom: ten cinematic listening worlds

Planning specification · 7 November 2026 · Mesh task `task-19`

This document plans the next Bloom release. It does not represent an implemented or visually validated release. The current production cleanup belongs to the other agent's task `task-18`; implementation starts after that work settles and the live file paths are checked again.

## 1. The experience we are building

Bloom becomes a short illustrated film about the music the listener actually heard. It has an opening, anticipation, recognition, a major song reveal, an artist reveal, and a memorable ending. The world changes as the story proceeds. Album artwork, artist names, and song identities are principal subjects within the film.

Ten themes each receive a distinct illustrated world, composition system, transition vocabulary, crafted title treatment, and emotional arc. A shared engine supplies accurate facts, reliable playback, navigation, and accessibility. The theme does not merely replace the background and accent colour.

The defining requirements are:

- Satisfying 2D branches, ornamental vines, painted water, paper, light, and abstract forms, selected to suit each world.
- A longer, varied listening story, with large song artwork and full artist credits, a leading artist, their leading songs, and additional meaningful insights.
- Relatable duration comparisons grounded in checked reference durations.
- Immediate, simple progression; optional continuous playback; a beautiful complete experience with sound muted or motion reduced.
- Four specifically researched art directions from Japan, China, Korea, and India.
- One dedicated subagent per theme, with repeated artistic critique and subsequent rendered iteration.
- Rich static illustration and measured, bounded animation suitable for ordinary phones.

## 2. What the repository currently does

The inspected baseline is Next 16.4.5 and React 19.2.8. The current Bloom code is under `src/rebuild/bloom/`.

| Area | Observed behaviour | Planned change |
| --- | --- | --- |
| `uiTypes.ts`, `design.ts` | Three designs: herbarium, nocturne, risograph; a seeded three-month rotation | Ten current worlds, versioned selection and compatibility with existing recaps |
| `BloomStory.tsx` | Cover, repeated stat composition, finish; each chapter requires Reveal and then Next | Distinct directed scenes; reveal on entry; one consistent forward action |
| `BloomArt.tsx`, `bloom.module.css` | Botanical, orbital, or print SVG shares one overall page structure | Individually composed environments, artwork scenes, typography, transitions, and finales |
| `service.ts` | Six baseline chapters; leading artist and first catalog genre add up to two more | Ranked songs and artists, artist-to-song relationships, adaptive additional facts |
| Chapter data | One numeric/text stat and one `relatedRecording` | Typed scene payloads, ranked collections, artwork and artist entities, comparison references |
| Listening source | Actual audible chunks; local period boundaries; first-open snapshots | Preserve the accounting rules and extend the snapshot additively |
| Reveals | Server-enforced sequential, idempotent reveals; completion after all facts | Preserve those guarantees while automatically revealing entered chapters |
| `useBloomAudio.ts` | Separate chapter audio; original queue preserved; account guards and real listening receipts | Longer musical continuity, explicit sound permission through the opening action, bounded fades |
| `export.ts` | A 1080 × 1920 canvas card with theme decoration and up to eight stats | Theme-specific illustrated poster with winning music artwork and a selected summary |

The existing calendar, archive, account isolation, expiry handling, safe errors, and listening records are important foundations. The visual redesign does not authorize resetting data or rewriting those rules.

## 3. The story: a film with several kinds of scene

Use a scene rather than a stat card as the unit of presentation. One factual chapter can support more than one cinematic scene: for example, the exact duration and its comparison share a listening-time fact. Scene count and server reveal count are deliberately separate.

For a history with enough material, target 16–20 scenes over roughly 2½–3½ minutes. Weekly stories can be somewhat shorter; rich yearly stories can reach about four minutes. These are editorial targets for optional autoplay, never minimum time the listener must wait. Sparse history receives a shorter, complete film without repeated filler.

| Beat | Content and reason for including it | Approximate reading hold |
| --- | --- | --- |
| 1. Enter the world | A short illustrated opening; period; a clear Open my Bloom action | 3–5 seconds |
| 2. Time in sound | Actual listening duration, displayed as hours/minutes where appropriate | 10–12 seconds |
| 3. Make that time tangible | One checked, playful comparison; exact duration remains visible | 8–10 seconds |
| 4. Music through your days | Active days and/or a supported local-time pattern | 9–12 seconds |
| 5. The breadth of the collection | Distinct recordings; a visual introduction to the song act | 8–10 seconds |
| 6. The countdown | Available ranks five through three, with covers, titles, and credits | 12–16 seconds |
| 7. The runner-up | A larger, quieter artwork shot | 9–12 seconds |
| 8. Your leading song | The biggest artwork reveal; exact title, all artists, listening measure | 12–16 seconds |
| 9. Your leading artist | Name, genuine image where available, listening total, and stated ranking basis | 12–15 seconds |
| 10. Their songs in your story | Up to three songs responsible for that artist's position, each with cover and credits | 14–18 seconds |
| 11. The other voices | Other leading artists, where reliable identities exist | 10–14 seconds |
| 12. First arrivals | Recordings first heard in the retained history during this period | 10–13 seconds |
| 13. Familiar returns | Most revisited song or genuinely repeated recordings | 9–12 seconds |
| 14. The colours of the catalog | Known genre tags, albums, or another supported perspective | 9–13 seconds |
| 15. A small surprise | One genuinely supported detail: peak day, busiest time bin, or a prior-period change | 9–13 seconds |
| 16. The completed world | A composed ending containing the major music identities; Save, Replay, music action | 12–18 seconds |

Ranked collections may occupy additional scenes on portrait screens so names and covers stay large. Each theme chooses how these beats inhabit its world and can rearrange eligible secondary beats. The music reveals and resulting artist-to-song connection remain central.

Alternate anticipation and reveal, wide views and close views, busy illustration and open space. Major information reveals settle into readable still compositions. Ornament can continue subtly in selected landscape scenes; it should rest while the listener reads a long title or ranking.

Give the final scene a visual reward: the tree has grown, the book has reached morning, the river passages connect, or the club has reached afterhours. The ending should be a complete illustrated object worth keeping.

## 4. Accurate facts, favorite music, and comparisons

### Listening and ranking rules

Continue deriving listening time from accepted audible increments, not recording duration multiplied by play count. Continue using the recap's stored IANA time zone, period boundaries, and first-open snapshot. Preserve delayed offline attribution and private-session rules.

Songs rank by audible time by default. Use a stable deterministic tie-breaker, such as recording UUID, and show the ranking basis. Distinguish alternate recording versions through canonical identities. Play counts count accepted distinct listening events, not receipt chunks.

The main artist ranking uses the primary credited identity, so one minute is not multiplied across collaborators. Prefer canonical artist UUID, then a retained provider reference. A display name alone must not merge unrelated artists with the same name. If attribution is unreliable, omit that ranking and keep the known song credits. Featured artists remain visible on the songs.

The artist's winning songs are this listener's actual recordings associated with that artist during this period. They are not a substitute list of globally popular songs. Explain why the artist led with their listening total and two or three actual tracks.

The presentation can say “Your favorite songs this month” with an adjacent explanation that the list uses listening time. If explicit saved favorites are shown, label that separate signal accurately. “Your most-listened artist” is the clearest factual subtitle for the artist reveal.

For additional chapters:

- “First heard” means first in the retained Sakura history, not newly released or newly discovered worldwide.
- Local-time patterns use accepted chunk timestamps. Do not claim an exact session length or continuously listened hours unless the ledger genuinely supports it.
- Genre colours come from published tags, with the attribution rule stated; no guessed acoustic mood or personality.
- Prior-period comparisons require equivalent complete periods and retained data. A partial baseline receives no growth claim.
- Album rankings require dependable album IDs; suppress the scene when metadata is insufficient.
- Nothing is padded to top five when only two recordings qualify.

### Time comparisons

Create a small editorial catalog of comparison entries with an ID, label, reference duration or range, source URL, checked date, locale, suitable time range, approximation flag, and approved wording. Store the selected comparison and its version in the recap so reopening does not change its story.

Examples of the intended voice:

- “3 hours 36 minutes. A whole double feature.” A supporting line can make the arithmetic explicit: “Two films of 108 minutes each.” This is a defined illustrative duration, not a claim about two unspecified real films.
- “Enough time to watch [verified film title] twice, with [calculated remainder] to spare.” Use a checked runtime and exact arithmetic.
- “About [number] orbits of Earth aboard the space station.” Use a checked typical orbital period and explicitly approximate language.
- “About the length of [named journey].” Use a dated, checked journey range; avoid presenting a variable flight or landing as a precise universal fact.

Movie, nature, travel, astronomy, and everyday comparisons can fit different worlds. The theme changes the framing and illustration; it does not change the arithmetic. If a reference is unavailable, use a clearly defined comparison or omit the analogy. Keep comparison sources available through a quiet detail action.

At 3.6 hours, show “3 h 36 min” as the principal duration. Never let playful copy replace or obscure the actual measure.

### Artwork and music identities

Each major song reveal includes a substantial original cover, full title, all credited artists, rank, and a relevant listening measure. Each major artist reveal includes the real name, an available genuine artist image, and the relevant tracks. If a portrait is missing, use a clearly identifiable cover arrangement or original neutral illustration rather than inventing a portrait.

Preserve square covers and recognizable artwork. The world frames the image; foliage, fish, seals, and ornate borders do not cut it into an unreadable prop. Metadata occupies quiet readable space beside or beneath it. On a phone, prefer one major cover to a tiny desktop triptych.

Missing artwork receives a theme-specific illustrated fallback while title and credits remain available. Long titles wrap; complex scripts shape correctly; commas within artist names remain intact.

## 5. Remove friction without weakening the server contract

The opening action enters the first scene and automatically requests its fact reveal. After that, the persistent forward action is simply **Next**. A user no longer presses Reveal and then Next for every chapter.

Keep the existing sequential reveal API initially. The controller requests the next required fact on entry, reconciles the returned recap, and presents its reveal within the scene. It may start a scenery transition while waiting, but it never substitutes guessed values. Revisited revealed facts need no repeat mutation. A second visual scene using the same fact does not create another reveal requirement.

During a decorative entrance, Next finishes or bypasses that entrance and advances. During an outstanding reveal mutation, coalesce repeated forward input into one pending intention and show a small loading state. Avoid overlapping reveals, skipping server prerequisites, or consuming several accidental taps. Close and sound controls remain responsive.

Navigation includes:

- A stable, thumb-reachable Next target of at least 44 × 44 CSS pixels; generous mobile padding and safe-area spacing.
- Previous, pause/resume, sound, and close in consistent positions across all worlds.
- Horizontal swipe and left/right keys, plus Space for pause when focus is not in another control; scrolling a long credit block must not advance.
- An accessible chapter list for revisiting revealed material; future reveals follow the normal sequential controller.
- Optional **Play my story** autoplay, enabled intentionally through the opening flow. Manual progress is always available.
- Pause autoplay on hidden tabs, loss of the relevant viewing state, reading-mode entry, and deliberate interaction with metadata/details. Resume intentionally after interruption.
- A reading mode with semantic headings, complete facts, artwork, and credits. Reveal pending facts sequentially as they are read; do not require theatrical animations to access information.
- Resume from the saved reveal frontier, with the last viewed scene stored under account ID, recap ID, and story version. Never persist another account's facts into a shared preference key.

The cinema should not introduce a setup wizard. A recommended world opens with one action; secondary controls can expose choosing another world, sound, or autoplay. An existing player queue remains recoverable when the Bloom closes.

Completion remains a server acknowledgment after all required factual chapters are revealed. Reading mode can complete the same facts. Scene autoplay finishing is not itself proof of server completion.

## 6. Typography is part of the illustration

Hand-author vector contours for each world's fixed title, selected chapter marks, and a small display numeral set where useful. A title can have real brush-width variation, irregular pigment edges, vine terminals, paper cuts, stained-glass joints, or geometric insets. Construct those chosen letters individually rather than relying on a generic font plus a decorative overlay.

Use finite authored letter groups with intentional timing. A small branch can grow from the terminal of the word “bloom”; a fold can uncover a title; a glass segment can complete a counter. Keep counters and number shapes clear.

Arbitrary song names, artist credits, translations, dates, and controls remain proper semantic text. Building every possible Unicode letter individually would break shaping and make the main musical identities harder to read. Artistic layout, borders, colour, and hierarchy can make real text belong to the scene.

Decorative SVG receives an equivalent accessible heading and is hidden from assistive technology to avoid duplicate announcements. Never invent Chinese or Japanese characters, or decorative substitutes for Korean or Indian scripts. Any additional translated title requires linguistic review.

## 7. Ten worlds and their independent ownership

| World | Primary art language | Film arc | Defining motion |
| --- | --- | --- | --- |
| Sakura Afterglow | Contemporary gouache orchard, ink branches, ornamental vines | Bare dawn tree → music-filled clearings → amber canopy | Branch unfurl, guided breeze, canopy match cut |
| Rainforest Reverie | Layered gouache jungle and painted water | Monsoon canopy → downstream artwork pools → dawn lagoon | Leaf curtain, ripples, changing depth |
| Velvet Disco | Velvet, lacquer, champagne Art Deco, broad illustrated light | Invitation → record lounge → headline stage → afterhours | Curtains, mirrorball light choreography, traveling sleeves |
| The Lantern Book — Japan | Edo illustrated fiction and original yōkai, book/scroll staging | Indigo book → lantern-led procession → final morning spread | Physical page folds, object-spirit gestures, ink match cuts |
| River of Ink — China | Shan shui landscape handscroll and restrained mineral wash | Blank paper → connected river passages → completed scroll | Handscroll passage, wash reveal, mist opening |
| Painted Courtyard — Korea | Joseon minhwa and chaekgeori painted screen | Sparse cabinet → music-filled screen → open courtyard | Painted panel turns, restrained magpie guide, object placement |
| Monsoon Miniature — India | Kangra/Pahari garden folio, fine contour and jewel pigments | Rain clouds → intimate pavilion music → pearlescent morning | Finite rain bands, borders, pavilion reveal |
| Tidal Dream | Painted ocean, salt contours, luminous abstract ribbons | Moonlit surface → tidal chamber → sunrise shoreline | Tide passage, ribbon currents, surface reveal |
| Paper Cosmos | Cut-paper celestial theatre and illustrated astronomy | Small observatory → unfolding music constellation → completed sky | Paper orbit, telescope framing, constellation assembly |
| Prismatic Garden | Original stained-glass botanical abstraction and coloured light | Unlit glass → artwork in coloured chambers → luminous window | Glass segment assembly, broad light bands, final illumination |

The first seven combine the requested Sakura, jungle, club, and four Asian directions. Ocean, paper cosmos, and prismatic glass supply the remaining three. Sakura connection can be a subtle petal, branch, colour, or closing mark where appropriate; it should not flatten all cultures and worlds into the same botanical wallpaper.

Each owner supplies an appropriate light and dark reading palette without flattening the directed lighting arc. The club can still travel through an evening and the book through a night even when a light reading surface is selected. Theme lighting and global interface preference are related design inputs, not a reason to recolour all ten worlds with one global token set. Decorative elements never reduce the contrast of names or controls.

### 7.1 Sakura Afterglow

One orchard remembers the entire film. Bare branches before dawn grow into an asymmetrical canopy carrying the music introduced throughout the story. The guide is a breeze, not a permanently falling particle field. Use warm ivory, brown ink, petrol shadows, dusty rose, coral, and restrained amber. Hand-composed branch elbows, buds, flowers of several silhouettes, and deliberately ornamental vine curls provide detail.

The opening moves from one closed bud to the title's curved terminal and pulls back into the waiting orchard. Time appears in the first clearing. A trail of light leads to days with music. The ranked songs occupy a real art-print triptych between branches; the winning song has a quieter blossom frame and the largest cover. A taller clearing introduces the leading artist, followed by their actual tracks connected along one limb. New arrivals appear beside opening buds. The final wide shot reveals the accumulated canopy and a clean illustrated poster.

The three signature effects are a finite sequence of illustrated branch sections settling into place; ten mobile or up to 24 desktop petals following a few authored breeze paths; and a foreground branch crossing the frame to conceal a transition into the next clearing. Long drawing effects are limited to a small optional opening flourish. Static pigment and paper provide richness; six or fewer principal moving groups provide motion.

Letter the fixed “bloom” mark with brush-like stems and a vine between the two o's. Covers stay uncut; the vines frame the art instead of crossing it. Portrait compositions preserve a central clearing and show rankings at a useful cover size. Reduced motion keeps the fully illustrated orchard and its cumulative growth with short fades.

Concept revisions: replace repeated pale botanical cards with one growing environment; promote covers and artist-to-song relationships above ornament; replace endless drawing/particles with bounded movement and independently composed mobile scenes. Reject a result whose ending resembles its opening, whose covers are minor decorations, or whose Next waits for petals to finish.

### 7.2 Rainforest Reverie

A painted river carries the listener from a dark monsoon canopy to an open dawn lagoon. A single curled leaf supplies continuity. Broad gouache foliage, cut-paper trunks, translucent horizontal water pigment, midnight teal, emerald, jade, celadon, and muted apricot establish the world. Dense foreground passages alternate with calm pools and open sky.

The opening leaf curtain reveals a ribbon of water. Listening time and its comparison occupy different river bends. Active days use a stepping-stone view. The song act enters a still pool: supporting covers rest intact on broad leaf-shaped supports, the runner-up gets a waterline close-up, and the winner receives an open frame. A grove clearing introduces the artist; their tracks follow the river's curve. First arrivals grow beside the bank. Dawn opens the entire lagoon and returns the leading artworks in a readable final arrangement.

Motion uses three precomposed depth layers for a short passage; a cover/support lifting with three scaling, fading ripple bands; and a vine curtain revealing prepared sections and gently rotating leaves. Selected landscape shots can translate two or three prepainted water strips. Water rests in reading shots. Reflections are static colour echoes rather than animated duplicates or fluid simulation.

The title is a fixed rounded brush-cut vector lockup with a branching R and a curled vine terminal. On phones, the river occupies the lower third, artwork the middle, and copy a clean upper area. Reduced motion presents completed painted tableaux while the monsoon-to-dawn change remains visible.

Concept revisions: turn jungle wallpaper into an actual downstream journey; protect covers and full credits instead of hiding them in floating ornaments; reduce rain, reflections, and animated foliage while keeping rich static painting. Reject repetitive composition, unreadable names, CSS-banner-looking water, or a finale without spatial opening.

### 7.3 Velvet Disco

An illustrated club opens after sunset, hosts the listener's headline music, and settles into affectionate afterhours light. Deep aubergine, plum velvet, champagne metal, warm chalk, rose, and restrained cobalt support an Art Deco room with stepped arches, geometric fans, lacquered sleeves, and carefully drawn mirrors. A Sakura branch can become a wall inlay and petals chandelier facets.

Start close to a lacquered invitation and a light under the door. Travel into a quiet hall as listening time illuminates a chandelier. A record-table countdown introduces the songs, then the winner moves into a champagne frame with a decorative vinyl shape behind it. Curtains open for the artist marquee. Their actual tracks occupy three stage windows. Other artists appear in a quiet record lounge; discoveries enter a crate. Return to the now-complete room before warm dawn light turns the finale into a souvenir ticket.

The signature effects are two illustrated curtains translating apart with prepared fold shadows; one mirrorball group with a few broad, gently drifting light patches; and the same record sleeve traveling from a table anchor to its stage anchor. Keep the cover upright and sharp. Do not run live mirrored interface surfaces, full-screen blur, flashing lights, or invented beat synchronization.

Hand-author geometric “NIGHT BLOOM” and a few fixed marquee marks with stepped stems and champagne inset lines. Artist names remain real text. On mobile, one sleeve and one readable metadata block fill the scene. Reduced motion keeps the room, colour choreography as still states, and clear stage/afterhours progression.

Concept revisions: replace generic continuous neon with a room journey and changes of intensity; make the artist's songs a real part of the stage composition; replace expensive reflection/strobe ideas with finite curtains and broad light groups. Reject generic neon cards, obscured credits, maximum intensity throughout, or a final room that did not accumulate the story.

### 7.4 The Lantern Book — Japan

A contemporary original illustrated book comes alive for one night. Its foundations are Edo kusazōshi illustrated fiction and yōkai picture books, with emakimono's continuous scene staging. An original crooked paper-lantern tsukumogami guides the film; a folded fan or teapot can join briefly. Real musicians remain themselves. Indigo covers, thread binding, warm parchment, soot contours, vermilion, ochre, and celadon give it physical character.

Open close on the book's title label. The lantern peeks between pages and the cover opens onto a path spanning the spread. Time occupies an empty mountain margin; the analogy appears in an illustrated vignette. The path leads into a procession carrying substantial square artwork stands. Supporting songs, runner-up, and winner get increasingly spacious page compositions. A quiet courtyard introduces the artist, and a connecting ink path visits their tracks. New gates and familiar courtyards host discovery and return facts. Morning reaches the shoreline before the final spread gathers the music into a finished illustration.

Page turns use an outgoing page, incoming page, and two or three prepared fold/shadow strips translating and rotating for roughly 700–1,000 ms. The lantern makes a match cut behind a large ink shape. A small cast of object spirits enters, gestures, settles, and stops. No simulated paper mesh, mandatory WebGL, continuous paper turbulence, or crowded character loops.

Fixed title words receive deliberately broad/narrow vector ink strokes. Do not invent kanji. Portrait screens show a dominant single page with a visible binding edge and full-sized artwork. Reduced motion changes between completed pages and places the lantern directly at its destination.

Concept revisions: turn disconnected demon illustrations into one physical book and procession; ground the craft in named traditions and enlarge the music; replace elaborate curling/large casts with bounded folds, still reading states, and portrait compositions. Reject flat UI cards masquerading as a book, decorative creatures dominating music, or page motion blocking Next.

### 7.5 River of Ink — China

One continuous shan shui handscroll moves through alternating close riverbanks, narrow gorges, open water, a mountain gallery, secluded grove, and a distant panorama. Dense ink and open paper create rhythm. Use warm paper, charcoal, wash grey, mineral green, blue-grey, and a small cinnabar accent. River water is primarily negative space shaped by its banks.

Begin with a narrow river mark and incomplete mountain contour. Listening time emerges beside a low tree; the comparison sits beside open water. Distant bank clearings introduce days with music. A foreground rock reveals the mountain gallery for the countdown. Covers remain substantial square contemporary artworks within quiet brush frames. The winner gets abundant paper space. A secluded grove introduces the artist, followed by a gallery of their actual tracks along the bank. New passages host discoveries. The final view connects previously encountered landscape sections into a complete scroll.

Prepare approximately six connected passages instead of one enormous continuously moving surface. Short transforms carry the framing between them. Six to ten prepared wash/contour groups appear with staggered opacity; two mist shapes briefly open the music gallery. Use no procedural ink simulation, animated turbulence, or full-screen blur. A small stroke reveal can be profiled as finite paint work.

The fixed Latin title has individually authored brush contours and a river-like terminal. Any Chinese title needs linguistic review; metadata keeps proper Unicode. Portrait layouts recompose the river low in the frame and mountains beside the text. Reduced motion retains unfolding landscape passages and the completed-scroll payoff through still states.

Concept revisions: replace wallpaper with connected passages and changing visual scale; remove generic pan-Asian motifs and tiny seal-sized covers; replace giant surfaces and live ink with finite groups and portrait galleries. Reject pseudo-characters, obscured artwork, identical compositions, or an ending that does not connect the journey.

### 7.6 Painted Courtyard — Korea

A warm domestic world is painted into an articulated screen. The dominant reference is Joseon chaekgeori: books and scholars' objects arranged in irregular cabinets across panels. Minhwa supplies expressive folk-animal contour; bojagi colour geometry is a secondary finale motif. Warm paper, indigo lacquer, ochre bindings, faded coral, malachite, and brown-black outline establish the palette.

Begin with a nearly closed screen and a magpie on an ink pine branch. An opening panel reveals the title and a courtyard window. Time occupies a large empty cabinet alcove, with its comparison on a nearby illustrated book. The song act opens a cabinet containing substantial front-facing record sleeves. A ceramic vessel and book stack frame the runner-up; the central panel gives the winner generous space. A tall recess introduces the artist, followed by their actual tracks on connected shelves. A brief expressive tiger interlude accompanies a factual return insight. New music fills previously empty spaces. Pull back to the completed screen before a wrapping-cloth composition presents the poster.

Illustration can retain the cabinets' unusual perspective; album artwork remains undistorted and square. Motion uses two or three backdrop panels translating and gently changing scale with prepared hinge shadows, a magpie making a pair of short pose-based hops, and a final passage of a few prepared wrapping-cloth colour blocks. Tiny objects, pine needles, and flowers are grouped and largely still.

The fixed English title receives brush-shaped contours, a flowering terminal, and pictorial accents. Any Korean title uses verified Hangul. Portrait scenes isolate one major cover, a readable block, and a recognisable fragment of the screen; the final panoramic object sits above a usable vertical recap. Reduced motion uses open panels and still animal poses.

Concept revisions: turn themed shelf cards into a sequence of courtyard, cabinet, artwork, artist, and screen views; establish chaekgeori as the dominant craft and enlarge the actual sleeves; replace independently animated objects and flower drawing with finite panel/pose passages. Reject generic pan-Asian decoration, distorted artwork, animals dominating music, or a screen that never accumulates the collection.

### 7.7 Monsoon Miniature — India

An original garden folio draws specifically on Kangra and related Pahari miniature painting: fine contour, delicate foliage, elevated garden views, coloured architectural planes, and gum-tempera-like jewel pigment. Its world is intimate rather than spectacular palace decoration. Warm paper, indigo, malachite, vermilion, rose, pale citron, and restrained gold sit inside a finely ruled floral border. A pomegranate branch recurs through border, garden, and finale.

Begin close to an unfinished border and branch, then reveal an elevated garden with paths, walls, a still pool, and a pavilion. Time appears beside the pool; the comparison is a separate painted vignette. Paving and paths carry the days/breadth scenes. A pavilion floor presents the supporting songs; a veranda gives the runner-up a portrait; an arch opens onto the winner's quiet central room. An adjoining chamber introduces the artist and connected gallery bays show their actual leading tracks. A new garden gate hosts first arrivals; the pool returns for familiar recordings. Monsoon clouds open toward pearlescent morning before the finished folio becomes a poster.

Unlike the Japanese book, this theme travels within a garden rather than turning pages. Unlike the Chinese scroll, it uses intimate architecture, framed compositions, and coloured planes. “Miniature” names the art tradition: covers must still be substantial, sharp squares. The museum reference's delicate border and fine contour are useful, but product names need considerably clearer contrast than antique pigment can provide.

The signature effects are a finite sequence of prepared border/pigment groups matching a branch into the garden; two or three painted clouds and a limited region of diagonal rain strips behind architecture; and a foreground arch/wall passing to expose the next room. Rain stops for artwork reading. Fixed title contours use pigment variation, gold insets, and one floral terminal; no invented Devanagari-like Latin letters or guessed script.

Portrait layouts narrow the folio border and give the central region to cover and credits. Reduced motion keeps complete tableaux, still clouds, and no rain. Concept revisions: replace generic palace/mandala decoration with a garden route and specific craft; put music above border intricacy; replace continuous weather and individual flower animation with bounded passages and still detail. Reject tiny covers, weather obscuring names, repeated room layouts, or a finale unrelated to the garden journey.

### 7.8 Tidal Dream

A luminous ocean dream moves from moonlit surface into a spacious painted tidal chamber and returns to a warm dawn shoreline. Midnight blue, muted indigo, sea-glass turquoise, pearl, dusty violet, and coral supply depth. Broad watercolor/ink bands, imperfect salt-like pigment edges, and large open areas distinguish it from the enclosed rainforest river. A single luminous ribbon eventually becomes the final shoreline contour.

Open close to one crest and a moon reflection, then use three prepared planes to suggest descent. Time and its comparison occupy generous, different open-water views. A shallow tidal terrace carries active days. A dark contour opens the expansive music chamber. Supporting songs sit on pearl backings; the runner-up receives a curved waterline close-up; the winner gets the largest cover with a luminous ring behind it. A taller quiet composition introduces the artist, whose actual tracks gather on a broad curved shelf. First arrivals extend the world; a return scene revisits a known contour. The last passage rises toward pearl and coral before a shoreline poster gathers the music.

The signature effects are a short differential movement of three painted depth layers; two or three elliptical contour bands scaling/fading behind a cover; and prepared ribbon poses crossfading with slight transforms. A small optional stroke reveal is finite paint work. No live refraction, procedural caustics, bubble field, fluid simulation, or continuously moving enormous surface is needed.

The fixed title uses broad painted letter edges and a tide-shaped terminal. Covers are never clipped into shells, bubbles, fish, or wave shapes. Portrait layouts keep artwork central and contours at the edges; reduced motion retains the descent-to-shore story through complete still compositions.

Concept revisions: replace underwater wallpaper with an actual descent, chamber, music portraits, and ascent; protect square artwork from decorative shapes and excess glow; replace particles/refraction with finite groups and still reading states. Reject aquarium-looking backgrounds, secondary music art, small credits, or no visible return to shore.

### 7.9 Paper Cosmos

A tangible paper observatory unfolds into a celestial theatre and finally a completed sky. Midnight cardstock, dusty ultramarine, cream paper, ochre, sage, and small coral accents pair with imperfect cut edges, fold lines, static offset shadows, printed chart marks, and illustrated brass pivots. A small paper star travels through the apparatus and takes its final place in the sky.

Start close to a folded dome and pivot. Its opening reveals individually assembled title letters. Pull back into arches and a compact paper sky. Time sits on a substantial instrument panel; a separate chart opens for the checked analogy. A shallow calendar carries the active-day fact. A viewing arch moves aside for the music theatre: large supporting covers, an intimate runner-up beside a folded chart, and a winner inside a spacious paper aperture with a finite starburst behind it. The artist gets a taller chamber; their tracks occupy connected supports. New charts host discoveries, familiar chambers carry return facts, and a final pullback connects the entire apparatus into an illustrated poster.

Motion uses two or three dome silhouettes translating apart with static folds; a prepared support following a short authored arc while its cover counter-rotates to remain upright; and a few star/connector groups assembling once. There is no endless orbit, giant twinkling field, physics model, or live per-frame diagram computation. The starting target is three main moving groups on mobile and six on desktop.

Hand-author cut-paper title contours with uneven edges, a few fold marks, and a star terminal. A telescope can frame a shot but must not crop the album cover into a circular aperture. Portrait scenes show one cover, clear metadata, and an apparatus fragment. Reduced motion uses open stationary paper tableaux with the star already in place.

Concept revisions: replace the old Nocturne-style circle wallpaper with an observatory journey; put covers and artist tracks above celestial machinery; replace constant spinning and tiny star motion with finite mechanical gestures. Reject extra circles presented as a new theme, obscured covers, identical compositions, or a sky that never becomes an assembled object.

### 7.10 Prismatic Garden

An original glass conservatory begins unlit and gradually gathers coloured botanical panes, music, and daylight into one complete window. Charcoal lead, ivory, bottle green, muted cobalt, rose, amber, and aqua create a tactile material vocabulary. Prepared striations, tiny bubbles, irregular pigment, lead joints, and broad reflected light make it feel crafted. A loose rose-petal pane recurs until it finds its final joint.

Begin close to an unlit lead connection and that loose pane. A seam of light reveals the title, then the conservatory opens around a quiet date area. Time appears in a clear central opening; an adjoining opening carries the comparison. A low architectural shot hosts active days. Passing a foreground frame reveals a music gallery, where the supporting covers sit in clear square openings. A quiet runner-up precedes the winner's large bay and completed botanical frame. A tall chamber introduces the artist and their tracks occupy connected bays. New music fills vacant spaces; a return insight revisits a now more complete chamber. Daylight warms the garden and the rose pane settles before the whole window becomes a readable poster.

Covers stay sharp, square, and untinted. Coloured light moves around them, never recolouring, splitting, or reflecting over the artwork or credits. The theme's own illustration supplies the glass, not a filter applied to the musician's image. The composition draws on glass craft without depending on cathedral symbols.

The signature effects are six to eight prepared pane groups aligning with small transforms; two or three prepainted broad light bands translating/fading; and a foreground lead curve concealing the passage to another chamber. Group tiny shards into assets. No ray tracing, live optical simulation, constantly changing filters, or endless shimmer.

The fixed “BLOOM” mark has lead-like outlined vector contours, clear counters, a few coloured sections, and a petal terminal. Dynamic names remain real text. Portrait shots retain one generous clear bay and move botanical glass to the edges; a panoramic finale sits above a readable recap. Reduced motion uses assembled glass, still light, and completed tableaux.

Concept revisions: turn glass wallpaper into chambers and a completed-window payoff; protect original art from tinting/shards and create the artist's track gallery; replace individually animated fragments/live optics with prepared groups and broad bands. Reject gradient-card staging, unreadable lead-like metadata, tinted covers, constant shimmer, or no accumulated illumination.

## 8. Proposed implementation structure

Check the final cleanup tree before implementation. Keep the current Bloom route/API boundaries unless a concrete dependency requires a change.

| Module | Responsibility |
| --- | --- |
| `story/contracts.ts` | Versioned fact kinds, ranked entities, comparison payloads, scenes, motion modes, theme contract |
| `story/buildStory.ts` | Deterministic eligible scene assembly and editorial ordering from an immutable snapshot |
| `story/useBloomDirector.ts` | Reveal reconciliation, navigation, timing, pause, resume, input coalescing, scene lifetime |
| `story/BloomStage.tsx` | Stable accessible dialog, scene slots, current/transitioning scene boundary |
| `story/BloomControls.tsx` | Shared predictable controls, progress, reading mode, optional autoplay |
| `story/BloomReadView.tsx` | Semantic readable alternative with the same music and facts |
| `story/comparisons.ts` | Reviewed duration definitions, arithmetic, wording, source details |
| `themes/<world>/` | Theme manifest, fixed-letter assets, environment, independently composed scenes, poster layout |
| `art/` | Small reusable primitives for branch groups, prepared folds, ripple bands, glass joins, layout-safe frames |
| `service.ts` plus a pure snapshot builder | Extend truthful facts/rankings; keep transaction, reveal, calendar and archive behaviour |
| `export.ts` and theme poster renderers | Explicit export of selected highlights and artwork, not every fact squeezed into one image |

The theme contract identifies its stable ID, art version, title, palette variants, cover poster, environment stages, supported scene renderers, transition choices, typography assets, still states, and export composition. The shared engine passes scene kind, disclosed payload, stage, motion mode, and transition direction. Theme code does not mutate listening data, call the reveal API, create its own audio player, or add its own navigation gates.

Keep themes genuinely independent: own shot compositions and film arc rather than one giant component with ten colour branches. Shared helpers should serve real visual primitives, not enforce one universal stat layout.

### Snapshot evolution and legacy recaps

Add an explicit snapshot/story version. Store top recordings, top artists, the leading artist's tracks, eligible secondary facts, comparison selection, and stable theme assignment in the snapshot where appropriate. Deduplicate recording entities in its transport representation; ranked references should not repeat a full recording payload many times.

Older saved snapshots must continue to render. An adapter can turn their existing six-to-eight chapters into a shorter cinematic story without inventing unavailable rankings. Do not regenerate an opened historical snapshot from current metadata/history simply to fill new scenes. New rankings apply to new snapshots.

Protect unrevealed payloads server-side, including the new collections and comparisons; the client must not receive hidden rankings under an unrelated summary field. Presentation assets can preload while facts remain hidden.

Persist the theme/story version on first open so a future rotation change does not silently restyle a saved film. Maintain legacy IDs for old saved recaps and direct links. Ten new current themes do not require deleting compatibility rendering for herbarium/nocturne/risograph.

Replace the three-month schedule with a tested seeded ten-theme cycle without consecutive repeats at cycle boundaries. Use the listener's local period date. A recommended theme provides variety automatically; a quiet Choose a world action allows replaying available facts in another world without recomputing or resetting them.

### Next 16 requirements checked for this plan

The installed guides were read for lazy loading, server/client boundaries, and image behaviour. Theme imports should be explicit and lazy within a client boundary; do not accidentally statically import all ten themes through the registry. `ssr: false` is a Client Component option, and dynamic imports from a Server Component do not currently guarantee automatic client code splitting.

Artwork needs reserved dimensions/aspect ratio, an appropriate `sizes` strategy, and asynchronous decode. If using `next/image`, `priority` is deprecated in this version; follow the documented eager/fetchPriority/preload guidance for the actual hero. Keep allowed remote image patterns specific, or use the existing controlled image route after checking its implementation. Avoid adding a second unrestricted proxy.

The inspected `/api/v2/image` route already checks approved artwork hosts and redirects, supported image MIME types, an 8 MiB response limit, timeout, and ETag/public caching. Reuse that same-origin path for exported recording artwork after the final cleanup handoff. CDN image downsizing or `next/image` is still needed where appropriate; the existing proxy alone does not reduce image dimensions.

### Audio continuity

Extend the existing Bloom audio controller rather than replacing queue ownership. Use a few musical anchors across an act so a recording is not restarted on every visual beat. Audio unavailability never prevents story navigation. Preserve current cancellation, account checks, private-session accounting, offline playback, and original-queue restoration.

Sound begins through the user's opening/sound action and handles browser autoplay refusal cleanly. A short bounded fade can use the existing media element; overlapping sources are optional only if measured and justified. The default light choreography is authored, independent of a claimed BPM. A live audio analyser is unnecessary for the first release.

### Saving the film's artwork

Deliver a theme-specific 1080 × 1920 poster as the first export, with a square variant if the same composition supports it. It should include the leading song, artist, a few covers, exact duration, and selected highlights. Share individual song/artist scenes where useful; do not cram twenty scenes into one image.

Use the controlled image fetch path and CORS-safe image preparation so exported covers do not taint the canvas. Match the theme's real art rather than keeping a generic stat template. Export is an explicit action; image rendering/encoding does not run during story playback. A downloaded video is a later separately scoped feature, not necessary to make the interactive Bloom feel cinematic.

## 9. Performance is a design constraint we measure

GPU-friendly motion is primarily transform and opacity on a small number of prepared layers. Browser compositing is measured, not promised by the presence of CSS or SVG. Stroke-dash animation, masks, changing filters, and complex SVG clips can require paint work.

Use rich authored still art, static textures, finite animation groups, reusable symbols, and deterministic prepared paths. SVG is the preferred code-native illustration format; small compressed raster textures can provide pigment or grain if they make a material difference. Full fluid simulation, a perpetual canvas renderer, and a 3D runtime are unnecessary defaults.

Initial budgets to validate in the first production prototype:

| Resource | Starting budget/behaviour |
| --- | --- |
| Scene mounting | Current scene plus at most one outgoing/incoming transition scene; retire the latter immediately afterward |
| Principal moving groups | Roughly 3–6 on mobile; up to 8 on desktop, depending on surface area |
| Particle accents | Usually 0–10 on mobile; up to 24 desktop during a bounded event, not all scenes |
| Persistent animation | 0–3 ambient groups in selected landscapes; zero when hidden, paused, reading, or settled finale |
| Animation duration | Around 0.5–1.0 s for navigation; longer opening ornament remains skippable |
| Frame bookkeeping | No per-frame React state updates; CSS/WAAPI for finite choreography |
| Loading | Shared engine and selected theme only; nearby scene images prepared on demand; no eager ten-world bundle |
| Incremental Bloom transfer | Initial guardrail: shared director/UI ≤ 50 KiB gzip, selected theme's code/vector art ≤ 100 KiB gzip, decorative raster assets ≤ 250 KiB for the first scene; measure separately from the existing app shell |
| First music artwork | Aim for ≤ 200 KiB per main cover at an appropriate display resolution; avoid decoding provider originals much larger than the viewport |
| Decoded image working set | Initial mobile target ≤ 24 MiB for current/transition scene imagery, excluding audio and the existing app shell; measure actual peak and release unused images |
| Compositor memory | Keep large promoted surfaces few; apply `will-change` only while needed; inspect actual layer memory |
| Decode | Reserve cover geometry; decode current artwork; prepare next artwork only after its allowed disclosure |
| Script work | No animation-driven long tasks over 50 ms; no repeated layout measurements during playback |
| Responsiveness | Aim for visual feedback within 100 ms of Next locally; server acknowledgment latency measured separately |
| Frame pacing | Aim near 60 fps on a representative phone; choose reduced ambient detail if sustained pacing exceeds its frame budget |

Confirm the proposed compressed-byte and decoded-image memory guardrails against the baseline prototype and inspect emitted chunks; revise a budget only for a demonstrated visual benefit with acceptable device measurements. Do not disguise rich vector geometry as “free.” Test both a representative mobile device and CPU-throttled Chromium. Artwork/network failures receive useful fallback scenes.

Performance adaptation removes expensive ornament, not music, content, or readability. The authored reduced-motion state is a first-class finished illustration for every scene. Reduced motion means no camera sweeps, spinning records, falling petals, or walking guides; short fades or immediate changes suffice.

## 10. Delivery sequence after cleanup

1. **Recheck the settled repository and existing contracts.** Read the other agent's task handoff, inspect final paths and tests, confirm calendar/snapshot/audio behaviour, and measure the current Bloom bundle and interaction cost.
2. **Build the shared story/data foundation.** Add versioned snapshot adapters, truthful ranked entities, comparison definitions, deterministic story assembly, and the single-action director. Keep calendar and account protections.
3. **Prove one full production theme: Sakura Afterglow.** Implement the entire beginning-to-ending story, artwork/artist scenes, title art, reading mode, and export. Render on desktop and a small phone, profile motion, and revise before extrapolating the architecture.
4. **Test two contrasting prototypes: Velvet Disco and The Lantern Book.** Prove the engine supports room staging and physical-page staging instead of forcing every world into the orchard layout. Adjust the theme contract from this evidence.
5. **Complete the remaining seven with independent theme owners.** At most three theme agents work alongside the integrator. They edit only their theme directories; shared engine/data/audio edits belong to the integrator.
6. **Integrate every world, legacy replay, and rotation.** Review scene coverage, cultural reference fidelity, small-screen layouts, metadata, controls, poster exports, and motion tiers.
7. **Run the required checks and produce reviewable evidence.** Deliver full journey recordings, screenshot contact sheets, representative frame/memory profiles, and comparison/identity fixtures before calling the experience finished.

The plan is complete when all ten briefs and this integration contract are recorded. Implementation is complete only when the full experiences, accessibility forms, exports, and appropriate checks actually work. Concept approval is not substitute evidence for a rendered film.

## 11. Dedicated agents and iteration protocol

There are ten separate planning owners: `bloom_sakura`, `bloom_jungle`, `bloom_disco`, `bloom_japan`, `bloom_china`, `bloom_korea`, `bloom_india`, `bloom_ocean`, `bloom_cosmos`, and `bloom_glass`. Each owns one theme only. Planning reports are integrated here. Mesh is accessed through its CLI under namespace `sakura`.

Every concept receives three explicit critique/revision passes:

1. **Cinema and story:** Does the viewer travel somewhere? Are shots varied? Is there anticipation and a rewarding finale? Remove repeated stat-card staging.
2. **Art, culture, typography, and music:** Does the world have coherent materials and a specific craft reference? Are actual covers, titles, and credits principal subjects? Is the artist connected to their actual songs? Refine the fixed-letter artwork.
3. **Phone, readability, and performance:** Recompose portrait shots; create still states; bound moving groups; remove expensive effects that add little; ensure navigation never waits for decoration.

During implementation repeat those passes using rendered evidence, then run a fourth integration critique covering the entire film and exports. Owners must inspect the beginning, midpoint, winning song, artist's tracks, and finale, as well as the complete progression. They revise weak scenes rather than polishing only the cover.

Review at least these dimensions: coherent illustration; varied cinematic staging; readable song/artist art; satisfying motion; distinctive theme identity; easy controls; meaningful ending; mobile performance. A weak dimension blocks completion even if the title screenshot looks attractive. Continue revisions while there is an actionable issue; do not claim infinite iteration or quality based solely on self-scoring.

## 12. Acceptance evidence for the release

- All ten themes have visibly different openings, music staging, transitions, and finales; screenshots at matching facts make those distinctions apparent.
- A complete rich-history story shows substantial song covers, full credited artists, leading artist identity, and that artist's actual winning tracks.
- Sparse and missing-artwork histories feel intentionally composed, with no invented ranking entries.
- Duration comparisons are mathematically correct, sourced or explicitly defined, and appropriately approximate.
- A full journey works with Next, Previous, swipe, keyboard, optional autoplay, pause, close, and resume. Rapid Next and slow network reveal do not skip prerequisites or duplicate advances.
- Reading mode and reduced-motion mode contain the same music and facts, with semantic headings and correct focus behaviour. Long multilingual names remain readable at text zoom.
- Existing saved snapshots, expiry, completed yearly archives, account switching, private sessions, retry, and original queue restoration continue to work.
- Selected-theme lazy loading is verified from emitted chunks/network, and a representative mobile profile confirms bounded layers, memory, and frame work.
- Theme-specific poster exports contain actual available artwork and remain readable with long titles and missing portraits.
- Validation uses focused meaningful data/director tests, existing Bloom/product/audio tests, TypeScript, scoped lint, then the required build/full suite after shared changes settle. Do not add tests that merely restate decorative SVG coordinates.

Suggested browser review matrix: all ten worlds at small portrait and desktop widths in normal and reduced motion; spotlight the four cultural themes for craft review; add keyboard/reading mode, 200% text zoom, tall credits, slow images/audio, unavailable artwork, sparse histories, rapid input, hidden/resumed tabs, expired periods, archives, and account boundaries. These checks are future release work, not claims made by this planning pass.

## 13. Reference research and provenance

Use museum references to study composition, contour, materials, and narrative structure. Author original illustrations. Existing song artwork remains the recording's actual artwork. Museum reference availability is distinct from permission to copy an image into the product.

Confirmed during this planning pass:

- The Met API, Hokusai, *Under the Wave off Kanagawa*, object 45434, approximately 1830–32; API reports public domain. Collection: https://www.metmuseum.org/art/collection/search/45434 . Image: https://images.metmuseum.org/CRDImages/as/web-large/DP130155.jpg . Supports contour rhythm, negative space, and flat pigment research.
- National Gallery, Rousseau, *Surprised!*: https://www.nationalgallery.org.uk/paintings/henri-rousseau-surprised . HTTP 200 with the expected painting title. Supports layered painted foliage and storm composition.
- V&A, *An introduction to Art Deco*: https://www.vam.ac.uk/articles/an-introduction-to-art-deco . Disco owner verified HTTP 200. Supports geometry and materials.
- Cleveland Museum Open Access API, Korean *Books and Scholars' Accoutrements*, accession 2011.37: https://clevelandart.org/art/2011.37 . Image: https://openaccess-cdn.clevelandart.org/2011.37/2011.37_web.jpg . Korea owner verified and visually inspected it.
- Cleveland Museum Open Access API, Korean *Tiger Family*, accession 1997.148: https://clevelandart.org/art/1997.148 . Image: https://openaccess-cdn.clevelandart.org/1997.148/1997.148_web.jpg . Korea owner verified and visually inspected it.
- Cleveland Museum Open Access API, *Royal lovers watching rain clouds: The month of Bhadon*, accession 1973.104, Pahari, circa 1790, gum tempera, ink and gold on paper: https://clevelandart.org/art/1973.104 . India owner verified this record.
- The integration pass downloaded and visually inspected the Korean screen above, the Indian monsoon painting, and the Chinese *Summer Mountains* image. The screen's irregular cabinets, the monsoon painting's botanical border/architectural framing, and the mountain painting's negative-space rhythm informed their respective briefs. Local research images are in ignored `.local/bloom-planning-references-20261107/`; they are research material, not production assets.
- Cleveland Museum Open Access API, *Summer Mountains (after Dong Yuan)*, accession 1992.1, Yuan ink and slight colour on silk: https://clevelandart.org/art/1992.1 . India owner located this useful Chinese reference.
- Cleveland Museum Open Access API, *River Village in a Rainstorm*, accession 1970.76, Ming: https://clevelandart.org/art/1970.76 . India owner located this Chinese reference.
- Cleveland Museum Open Access API, Homer, *Early Morning After a Storm at Sea*, accession 1924.195, 1900–1903: https://clevelandart.org/art/1924.195 . Image: https://openaccess-cdn.clevelandart.org/1924.195/1924.195_web.jpg . Ocean owner verified the record.
- NOAA, *What is bioluminescence?*: https://oceanservice.noaa.gov/facts/biolum.html . Ocean owner verified HTTP 200 as factual visual research.
- NASA, *Solar System Exploration*: https://science.nasa.gov/solar-system/ . Cosmos owner verified HTTP 200 and the expected page title. This does not verify a duration comparison.
- Cleveland Museum Open Access API, *Stained Glass Panel with Male Donor*, accession 1919.1.1, circa 1480: https://clevelandart.org/art/1919.1.1 . Glass owner verified metadata/image URL, without visual inspection. Study construction and colour; the planned conservatory illustration is original.
- Cleveland Museum Open Access API, Tiffany *Vase*, accession 1997.304, circa 1905–10, favrile glass: https://clevelandart.org/art/1997.304 . Glass owner verified metadata/image URL, without visual inspection. A material-variation research lead.

Suggested research leads with access unverified in this pass: National Diet Library digitized Toriyama Sekien editions, Brooklyn Botanic Garden cherry collections, Cooper Hewitt ornament collections, and MoMA's Rousseau *The Dream*. Several Met essay pages returned 429, Met search requests returned 410, Smithsonian collections returned 403, and the Studio 54 reference returned 429. Those failed pages are not represented as verified research.

No live flight duration, film runtime, or orbital-period source was established for a production comparison catalog in this pass. NASA's requested page failed to load and a proposed BFI URL returned 404. Verify those comparison entries during implementation; the explicitly defined double-feature arithmetic above is usable without a historical runtime claim.

## 14. Handoff

This plan is the input to the later implementation after task `task-18` finishes. Root owns the shared director, data, identity, comparison arithmetic, audio, navigation, export integration, and acceptance evidence. Each dedicated theme agent owns one artistic world and repeatedly refines its full journey. Existing account/listening data and the other agent's code changes must be preserved.
