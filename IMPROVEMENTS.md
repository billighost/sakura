# Sakura Project - Page-by-Page Improvement Plan

Generated: August 5, 2026

---

## 1. Login Page (`/login`)

### Current State
- Simple card with username/email + password fields
- Basic error display, loading state
- Link to register

### Improvements
1. **Add sakura logo/icon at top** - Replace text-only "Sakura" with the generated icon + text for branding
2. **Add input validation feedback** - Show inline validation (e.g., "field required" before submit)
3. **Add "show password" toggle** - Eye icon to reveal/hide password
4. **Add keyboard submit** - Already has form submit, but ensure Enter key works consistently
5. **Add forgot password link** - Even if not implemented yet, placeholder for future
6. **Add animation on card entrance** - Subtle fade-in/slide-up on mount
7. **Improve error display** - Use a toast/banner instead of inline text that pushes content
8. **Add social login placeholders** - Google/GitHub buttons (disabled with "coming soon")
9. **Add remember me checkbox** - Persist login preference
10. **Improve mobile spacing** - Better safe area handling for notch devices
11. **Add page transition animation** - Smooth transition from register page
12. **Add loading spinner on button** - Replace text with animated spinner during submit

---

## 2. Register Page (`/register`)

### Current State
- Username, email, password, confirm password fields
- Basic validation (password match, minLength)

### Improvements
1. **Add sakura logo/icon at top** - Consistent branding with login
2. **Add password strength indicator** - Visual bar showing weak/medium/strong
3. **Add "show password" toggle** - For both password fields
4. **Add username availability check** - Debounced async check as user types
5. **Add input validation feedback** - Real-time validation messages
6. **Add terms agreement checkbox** - "I agree to the Terms of Service"
7. **Add animation on card entrance** - Consistent with login page
8. **Improve error display** - Toast/banner style
9. **Add password requirements list** - Show checklist: 6+ chars, uppercase, etc.
10. **Add transition to login** - Smooth page transition
11. **Add loading spinner on button** - During account creation
12. **Add back button** - Navigate to login without browser back

---

## 3. Home Page (`/home`)

### Current State
- "Sakura" greeting header
- Recently Played horizontal carousel
- New Arrivals horizontal carousel
- Empty state with emoji

### Improvements
1. **Personalized greeting** - "Good evening, {username}" based on time of day
2. **Add user avatar** - Small avatar in top-right corner linking to profile
3. **Add pull-to-refresh** - Native-feeling refresh gesture
4. **Improve empty state** - Add illustration + CTA button to search
5. **Add quick action buttons** - "Import", "Search", "Create Playlist" shortcuts
6. **Add shuffle play button** - Play all tracks randomly
7. **Improve skeleton loading** - More realistic shimmer animation
8. **Add track count badges** - Show "12 tracks" under section titles
9. **Add gradient header** - Subtle gradient background for visual depth
10. **Improve card hover/active states** - Better visual feedback on tap
11. **Add "Continue Listening" section** - Resume from where you left off
12. **Add genre/mood categories** - Quick filter chips for different moods

---

## 4. Search Page (`/search`)

### Current State
- Search input with icon
- Library + Deezer results merged
- Download button for Deezer tracks

### Improvements
1. **Add search history** - Show recent searches below input when focused
2. **Add trending/popular section** - Before user searches, show popular tracks
3. **Add filter chips** - Filter by: All, Tracks, Artists, Albums
4. **Add voice search button** - Microphone icon for voice input
5. **Add keyboard shortcut** - Cmd/Ctrl+K to focus search
6. **Improve debounce** - Show results as you type (already 400ms, good)
7. **Add "no internet" state** - Show offline message when fetch fails
8. **Add album/artist search tabs** - Separate sections for each result type
9. **Improve empty state** - Show popular/trending when no query
10. **Add recent searches** - Clearable list of past queries
11. **Add search suggestions** - Autocomplete as user types
12. **Add batch download** - Select multiple Deezer results to download at once

---

## 5. Library Page (`/library`)

### Current State
- Tabs: Tracks, Artists, Albums
- Grid view for artists/albums, list for tracks
- Basic skeleton loading

### Improvements
1. **Add sort options** - Sort by: Name, Date Added, Recently Played
2. **Add search within library** - Filter input specific to current tab
3. **Add grid/list toggle** - Switch between views
4. **Add empty state per tab** - Different messages for tracks/artists/albums
5. **Add swipe actions** - Swipe left to delete, right to play
6. **Add multi-select mode** - Select multiple items for batch operations
7. **Add alphabetical index** - Quick jump to letter (for large libraries)
8. **Improve tab animation** - Smooth sliding indicator
9. **Add pull-to-refresh** - Refresh library data
10. **Add "Recently Added" tab** - Show newest additions
11. **Add total duration display** - "2h 34m total" under each tab
12. **Improve grid responsiveness** - Better column sizing for different screens

---

## 6. Liked Page (`/liked`)

### Current State
- Header with heart icon and count
- Play All button
- Track list with TrackRow components

### Improvements
1. **Add gradient header** - Use gradient background matching the heart theme
2. **Add shuffle play** - Add shuffle button alongside Play All
3. **Add sort options** - Sort by: Date Liked, Title, Artist, Duration
4. **Add total duration** - Show "12 songs · 45 min"
5. **Add share/export button** - Export liked songs as playlist
6. **Improve empty state** - Better illustration and CTA
7. **Add pull-to-refresh** - Refresh favorites
8. **Add "Remove All" option** - Batch unlike (with confirmation)
9. **Add animation on like** - Heart animation when liking/unliking
10. **Add swipe to unlike** - Swipe left to remove from liked
11. **Add listening stats** - "You've liked X songs this month"
12. **Add smart playlists** - Auto-generate playlists from liked songs by genre/mood

---

## 7. Profile Page (`/profile`)

### Current State
- Avatar with upload button
- Username, bio display
- Stats: Played, Playlists, Liked
- Account info section

### Improvements
1. **Add avatar crop/resize** - Before upload, allow cropping
2. **Add bio editing** - Inline edit with save button
3. **Add username editing** - Allow changing username
4. **Add email editing** - Allow changing email
5. **Add listening time stat** - Total hours listened
6. **Add top genre stat** - Most played genre
7. **Add streak counter** - "Listening streak: 5 days"
8. **Add share profile button** - Generate shareable link
9. **Add profile picture removal** - Option to remove avatar
10. **Add stats visualization** - Mini charts for listening patterns
11. **Add account deletion option** - Danger zone with confirmation
12. **Add export data button** - Download all user data as JSON

---

## 8. Settings Page (`/settings`)

### Current State
- Appearance: Theme selector
- Playback: Audio quality, crossfade, auto-download
- Links: About, Terms, Privacy
- Account: Username, Email display
- Log Out button

### Improvements
1. **Add crossfade slider** - Currently shows "0s" but no slider to change it
2. **Add equalizer settings** - Basic bass/treble controls
3. **Add download quality setting** - Choose quality for offline downloads
4. **Add storage usage display** - "Using 1.2 GB of local storage"
5. **Add clear cache button** - Clear audio cache and API cache
6. **Add notification settings** - Toggle for playback notifications
7. **Add language selector** - For future i18n
8. **Add "Check for updates" button** - Force SW update
9. **Add version info with changelog** - Click version to see changes
10. **Add dark/light mode preview** - Show preview before applying
11. **Add export/import settings** - Backup settings to file
12. **Add developer info section** - GitHub link, tech stack info
13. **Add storage management** - View/clear individual cached tracks

---

## 9. Import Page (`/import`)

### Current State
- URL input field
- Import button
- Track list with status indicators
- Save All button

### Improvements
1. **Add drag-and-drop URL** - Drop a URL anywhere on the page
2. **Add clipboard paste button** - One-tap paste from clipboard
3. **Add URL validation** - Show valid/invalid URL indicator before import
4. **Add progress bar** - Show import progress as tracks are saved
5. **Add individual track selection** - Checkboxes to select specific tracks
6. **Add "Import Another" button** - After import, easy to start new one
7. **Add Deezer direct import** - Support deezer.com URLs alongside Spotify
8. **Add playlist preview** - Show playlist name/description before import
9. **Add import history** - Show past imports
10. **Add batch import** - Import multiple URLs at once
11. **Add duplicate detection** - Already in library indicator
12. **Add import from file** - Upload a text file with URLs

---

## 10. Playlist Detail Page (`/playlist/[id]`)

### Current State
- Hero with cover art, name, description, track count
- Play button
- Track list

### Improvements
1. **Add shuffle play button** - Add shuffle alongside play
2. **Add edit playlist** - Rename, change description, reorder tracks
3. **Add delete playlist** - With confirmation dialog
4. **Add share playlist** - Generate shareable link
5. **Add add tracks button** - Search and add tracks to playlist
6. **Add remove tracks** - Swipe or long-press to remove
7. **Add total duration** - "12 songs · 45 min"
8. **Add playlist art upload** - Custom cover for playlist
9. **Add sort tracks** - Manual, alphabetical, date added
10. **Add export playlist** - Download as text/JSON
11. **Add duplicate warning** - When adding existing track
12. **Add playlist statistics** - Total plays, top artist

---

## 11. Artist Detail Page (`/artist/[id]`)

### Current State
- Hero with avatar, name, track/album count
- Albums grid
- Top tracks list

### Improvements
1. **Add "Play All" button** - Play all tracks by artist
2. **Add "Shuffle" button** - Shuffle all tracks
3. **Add "Follow" button** - Follow/unfollow artist
4. **Add artist bio section** - Brief artist description
5. **Add genre tags** - Show artist genres
6. **Add "Fans Also Like" section** - Related artists
7. **Add album sort** - By year, name, track count
8. **Add "Appears On" section** - Compilations, features
9. **Add total play count** - "Played 45 times"
10. **Add share artist** - Share link to artist
11. **Add album count display** - "3 albums" in header
12. **Add track count per album** - In album grid cards

---

## 12. Album Detail Page (`/album/[id]`)

### Current State
- Hero with cover art, title, artist, year, track count
- Play and Shuffle buttons
- Track list

### Improvements
1. **Add "Add to Playlist" button** - Add album tracks to playlist
2. **Add "Like All" button** - Like all tracks at once
3. **Add album notes section** - Track listing with notes
4. **Add release date display** - Full date, not just year
5. **Add genre tags** - Album genres
6. **Add share album** - Share link
7. **Add "Other Albums by {Artist}" section** - Related albums
8. **Add track duration total** - "Total: 45:23"
9. **Add year filter in library** - Filter albums by year
10. **Add album rating** - Personal rating system
11. **Add "Recently Played" indicator** - If album was recently played
12. **Add download all tracks** - Batch offline download

---

## 13. About Page (`/about`)

### Current State
- 4 paragraphs of basic info
- Mentions school project

### Improvements
1. **Add app icon/image** - Visual header with Sakura icon
2. **Add feature list** - Bullet points of key features
3. **Add tech stack section** - Technologies used with icons
4. **Add version info** - Current version number
5. **Add "What's New" section** - Recent updates/changelog
6. **Add contact information** - Email, GitHub link
7. **Add acknowledgments** - Libraries and tools used
8. **Add roadmap** - Planned features
9. **Add license information** - MIT or similar
10. **Add screenshot gallery** - App screenshots
11. **Add "Built with" badges** - Technology badges
12. **Add FAQ section** - Common questions and answers
13. **Add credits section** - Music sources, design inspiration

---

## 14. Privacy Policy Page (`/privacy`)

### Current State
- 7 paragraphs covering data collection, storage, audio files, offline data, no tracking, contact

### Improvements
1. **Add table of contents** - Clickable section links
2. **Add "Last reviewed" date** - Separate from "Last updated"
3. **Add data retention section** - How long data is kept
4. **Add user rights section** - Right to access, modify, delete data
5. **Add cookies section** - Detailed cookie policy
6. **Add third-party services** - List all third-party services used
7. **Add children's privacy** - COPPA compliance statement
8. **Add international data transfers** - Where data is stored geographically
9. **Add security measures** - How data is protected
10. **Add breach notification** - What happens if data is compromised
11. **Add policy change notification** - How users are notified of changes
12. **Add contact email** - Replace placeholder with actual email
13. **Add effective date** - Clear effective date
14. **Add downloadable PDF** - PDF version of the policy

---

## 15. Terms of Service Page (`/terms`)

### Current State
- 7 paragraphs covering ownership, usage, availability, liability, changes, contact

### Improvements
1. **Add table of contents** - Clickable section links
2. **Add "Last reviewed" date** - Separate from "Last updated"
3. **Add acceptable use policy** - What users can/cannot do
4. **Add intellectual property section** - IP ownership details
5. **Add disclaimer section** - Detailed legal disclaimers
6. **Add indemnification clause** - User indemnification
7. **Add governing law** - Jurisdiction for disputes
8. **Add dispute resolution** - Arbitration/mediation process
9. **Add termination policy** - How accounts can be terminated
10. **Add refund policy** - If applicable (even if "no refunds")
11. **Add accessibility statement** - WCAG compliance
12. **Add contact email** - Replace placeholder with actual email
13. **Add effective date** - Clear effective date
14. **Add downloadable PDF** - PDF version of the terms

---

## 16. Root Layout (`layout.tsx`)

### Current State
- Basic HTML structure
- Meta tags for PWA
- SWRegister and OfflineBanner

### Improvements
1. **Add proper favicon references** - Already updated with new icons
2. **Add Apple touch icon** - Already updated
3. **Add Open Graph meta tags** - For social sharing
4. **Add Twitter card meta tags** - For Twitter sharing
5. **Add canonical URL** - For SEO
6. **Add structured data** - JSON-LD for app info
7. **Add viewport meta** - Already present
8. **Add theme-color meta** - Already present
9. **Add robots meta** - For search engine control
10. **Add performance hints** - Preload critical resources
11. **Add font preloading** - If custom fonts are added
12. **Add CSP headers** - Content Security Policy

---

## 17. Service Worker (`sw.js`)

### Current State
- Shell caching
- API network-first
- Audio cache-on-play

### Improvements
1. **Update cache versions** - Bump version for new icons
2. **Add cache invalidation** - Better version management
3. **Add offline fallback page** - Custom offline page
4. **Add background sync** - Queue actions when offline
5. **Add push notifications** - For playback controls
6. **Add cache size limits** - Prevent unbounded growth
7. **Add audio cache eviction** - LRU for cached audio
8. **Add API cache TTL** - Time-based expiration
9. **Add image caching** - Cache cover art images
10. **Add font caching** - Cache system fonts
11. **Add proper error pages** - 404, 500 offline pages
12. **Add periodic sync** - Background data refresh

---

## 18. Manifest (`manifest.json`)

### Current State
- Basic PWA manifest
- Icons already updated

### Improvements
1. **Add screenshots** - App screenshots for store listing
2. **Add shortcuts** - Quick actions (Search, Import, Settings)
3. **Add related_applications** - Links to app stores if applicable
4. **Add prefer_related_applications** - false for web-first
5. **Add scope** - Define app scope
6. **Add id** - Unique app identifier
7. **Add categories** - Already has music/entertainment
8. **Add description** - Already present
9. **Add lang** - Language declaration
10. **Add dir** - Text direction
11. **Add display override** - For better PWA behavior
12. **Add handle_links** - How links are handled
