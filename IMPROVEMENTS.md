# Sakura — Comprehensive Page-by-Page Improvement Plan

> Guided by Spotify's UI/UX patterns, accessibility, and modern mobile-first design.

---

## 1. Home Page (`/home`)

### Current Issues
- Basic greeting + horizontal scroll of recently played / new arrivals only
- No personalized recommendations based on listening history
- No "Made for You" or "Quick Picks" sections
- No recently added albums section
- No mood/genre-based sections
- Missing artist-based recommendations
- Empty state is generic
- No pull-to-refresh

### Improvements
1. **Spotify-style greeting** with time-based background gradient (morning=warm, afternoon=golden, evening=purple)
2. **Quick Picks grid** — 2x3 grid of most-played tracks (like Spotify's 6-card grid)
3. **Recently Played** section with proper horizontal scroll cards showing album art + title + artist
4. **Made for You** — auto-generated playlist recommendations based on listening patterns (top genres, top artists)
5. **New Arrivals** — tracks recently added to library
6. **Your Top Artists** — horizontal scroll of most-played artists with circular avatars
7. **Jump Back In** — recently played albums/playlists for quick resume
8. **Popular Playlists** — user's playlists sorted by last updated
9. **Genre Mood Cards** — colored cards for genre/mood browsing (like Spotify's genre cards)
10. **Pull-to-refresh** support with haptic feedback
11. **Smooth section fade-in animations** as user scrolls
12. **Better empty state** with illustrated mascot and clear CTA
13. **Listening Stats Banner** — "You've listened to X hours this week"
14. **Profile avatar click** navigates to profile page
15. **Accessibility** — proper ARIA labels, screen reader text

---

## 2. Search Page (`/search`)

### Current Issues
- Only text search, no categories or browsing
- No recent searches
- No trending or discover section
- Empty state is minimal
- No search filters visible initially

### Improvements
1. **Browse Categories** — grid of genre/mood categories (Pop, Rock, Hip-Hop, Electronic, etc.) with colored background cards (Spotify-style)
2. **Recent Searches** — show last 10 search queries with clear option
3. **Trending Now** — show trending tracks from Deezer
4. **Quick Filters** — filter chips for Tracks, Artists, Albums, Playlists
5. **Search Suggestions** — autocomplete dropdown as user types
6. **Voice Search Button** — Web Speech API integration
7. **Empty State Redesign** — "What do you want to listen to?" with genre cards
8. **Keyboard Shortcut** — `/` to focus search input
9. **Search History in URL** — save last search in URL params
10. **Debounce improvement** — reduce from 400ms to 300ms
11. **Result Count Badges** — show counts per section
12. **Better Loading States** — skeleton loading matching result layout
13. **No Results State** — "No results for X. Try checking your spelling or use different keywords."
14. **Offline State** — show cached library search only
15. **Accessibility** — ARIA live regions for search results

---

## 3. Library Page (`/library`)

### Current Issues
- Basic tabs (Tracks/Artists/Albums) with simple grid
- No playlist tab
- Sort options limited
- No search within library
- No filter by recently added, most played

### Improvements
1. **Add Playlists Tab** — 4th tab for playlists (Tracks/Artists/Albums/Playlists)
2. **Search Within Library** — inline search bar at top
3. **Better Sort Options** — Name, Date Added, Recently Played, Most Played, Duration
4. **Grid/List Toggle** — switch between grid view and list view
5. **Filter Chips** — filter by "Recently Added", "Most Played", "Favorites"
6. **Album Art Grid** — larger album art cards with overlay play button
7. **Artist Circular Cards** — circular artist avatars (like Spotify)
8. **Swipe Actions** — swipe left to delete, swipe right to add to playlist
9. **Empty State per Tab** — contextual empty state with specific CTAs
10. **Count Badges** — show total items per tab
11. **Sticky Headers** — section headers that stick while scrolling
12. **Pull-to-refresh** support
13. **Batch Actions** — select multiple tracks for bulk operations
14. **Quick Actions Menu** — long-press context menu (like Spotify)
15. **Alphabetical Sidebar** — improved touch targets and haptic feedback

---

## 4. Liked Songs Page (`/liked`)

### Current Issues
- Basic gradient header with heart icon
- Play All / Shuffle buttons
- No sorting options
- No search within liked

### Improvements
1. **Spotify-style gradient header** — full-width gradient with playlist artwork
2. **Sort Options** — by Title, Artist, Album, Date Added, Duration
3. **Search Within Liked** — filter liked songs
4. **Total Listening Time** — show total duration prominently
5. **Recently Liked Section** — highlight recently added liked songs
6. **Shuffle Play Button** — larger, more prominent
7. **Download All for Offline** — batch download all liked songs
8. **Share Playlist** — export as playlist or share link
9. **Remove from Liked** — swipe to remove
10. **Duplicate Detection** — show if songs are duplicated
11. **Better Empty State** — "Songs you like will appear here. Tap the heart on any track."
12. **Track Count with Pluralization** — "1 song" vs "24 songs"
13. **Smooth Scroll** — virtual scrolling for large lists
14. **Now Playing Highlight** — highlight currently playing track
15. **Pull-to-refresh**

---

## 5. Full Player (`/player`)

### Current Issues
- Basic album art + controls
- No lyrics section
- No queue view
- No share button
- Volume slider is basic
- No "Add to Playlist" button
- No song info link to album/artist

### Improvements
1. **Album Art with Blur Background** — blurred album art as background (Spotify-style)
2. **Lyrics Section** — scrollable lyrics overlay (toggle with button)
3. **Queue View** — see upcoming tracks, reorder, remove
4. **Add to Playlist** — button to add current track to a playlist
5. **Share Button** — share current track with deep link
6. **Song Info Link** — tap title/artist to go to album/artist page
7. **Crossfade Controls** — visual crossfade indicator
8. **Audio Quality Indicator** — show bitrate/quality
9. **Sleep Timer** — set auto-stop timer
10. **Like Button with Animation** — heart animation on like
11. **Better Seek Bar** — custom styled with album art preview on hover
12. **Volume Boost** — optional volume boost toggle
13. **Equalizer Access** — link to audio settings
14. **Background Play Indicator** — show when playing in background
15. **Swipe Down to Close** — gesture-based close

---

## 6. Mini Player

### Current Issues
- Basic art + title + artist + play/pause
- No next/prev buttons
- No progress bar visible

### Improvements
1. **Progress Bar** — thin progress line at top (already exists but make more visible)
2. **Next/Previous Buttons** — add skip controls
3. **Like Button** — quick like/unlike
4. **Swipe Up to Expand** — gesture to open full player
5. **Better Album Art** — larger art with shadow
6. **Queue Indicator** — small icon showing queue count
7. **Offline Indicator** — show if track is cached
8. **Smooth Transitions** — smooth art/title transitions when track changes
9. **Haptic Feedback** — on play/pause tap
10. **Long Press Menu** — quick actions (add to playlist, share, etc.)

---

## 7. Album Detail Page (`/album/[id]`)

### Current Issues
- Basic hero with cover + info
- Play/Shuffle/Add/Like/Share buttons
- Track list
- Other albums section

### Improvements
1. **Dynamic Gradient Hero** — extract dominant color from album art for gradient
2. **Release Date Formatting** — "August 5, 2026" format
3. **Genre Tags** — show genres as pills
4. **Track Numbers** — proper track numbering
5. **Duration Total** — show total album duration
6. **Copyright Info** — show copyright notice
7. **Add to Playlist** — functional playlist picker
8. **Like Individual Tracks** — heart icon per track
9. **Share Album** — share with album art
10. **Related Albums** — show similar albums
11. **Play Count** — total plays for this album
12. **Better Empty State** — when album has no tracks
13. **Skeleton Loading** — proper skeleton matching layout
14. **Scroll Progress** — show scroll progress in header
15. **Back Button** — navigation back to library

---

## 8. Artist Detail Page (`/artist/[id]`)

### Current Issues
- Basic hero with avatar + name
- Albums grid
- Top tracks
- No follower count
- No monthly listeners

### Improvements
1. **Dynamic Gradient Hero** — color from artist image
2. **Monthly Listeners** — show listener count (if available)
3. **Follow/Unfollow** — follow artist functionality
4. **Artist Bio** — expandable biography section
5. **Discography Section** — organize by albums, singles, EPs
6. **Appears On** — compilations and features
7. **Related Artists** — similar artists grid
8. **Top Tracks** — limited to 5 with "Show All"
9. **Share Artist** — share profile link
10. **Artist Radio** — generate artist-based playlist
11. **Concert Dates** — upcoming concerts (API integration)
12. **Better Empty State** — when artist has no tracks
13. **Follow Button** — prominent follow/unfollow
14. **Play Count** — total plays for this artist
15. **Background Image** — use artist photo as hero background

---

## 9. Playlist Detail Page (`/playlist/[id]`)

### Current Issues
- Basic hero with cover + info
- Add tracks modal is placeholder
- No edit functionality
- No collaborative features

### Improvements
1. **Dynamic Gradient Hero** — color from playlist cover
2. **Edit Playlist** — inline editing of name, description
3. **Add Tracks Modal** — functional search and add to playlist
4. **Reorder Tracks** — drag and drop to reorder
5. **Remove Tracks** — swipe to remove individual tracks
6. **Playlist Description** — show and edit description
7. **Creator Info** — show who created and when
8. **Export Playlist** — download as text/JSON
9. **Duplicate Detection** — warn about duplicates when adding
10. **Playlist Stats** — total duration, genre breakdown
11. **Collaborative Playlist** — invite others (future feature)
12. **Share Playlist** — share with link or as image
13. **Delete Confirmation** — better styled confirmation dialog
14. **Empty State** — "This playlist is empty. Add some tracks!"
15. **Cover Art Upload** — better upload UX with crop tool

---

## 10. Profile Page (`/profile`)

### Current Issues
- Basic avatar + bio + stats
- Account info section
- Export button
- No listening insights

### Improvements
1. **Listening Insights** — hours listened, most played track, top genre
2. **Listening History Timeline** — visual timeline of listening activity
3. **Top Artists Section** — most played artists with play counts
4. **Top Tracks Section** — most played tracks with play counts
5. **Achievements/Badges** — gamification (100 songs, 50 hours, etc.)
6. **Share Profile** — share profile link
7. **Edit Profile** — inline editing for username, email
8. **Theme Selection** — visual theme picker (not just dropdown)
9. **Notification Settings** — manage notifications
10. **Connected Accounts** — link Spotify/Deezer
11. **Account Stats Card** — visual stat cards with icons
12. **Member Since** — formatted date
13. **Listening Streak** — consecutive days of listening
14. **Data Usage** — storage used breakdown
15. **Danger Zone** — account deletion with confirmation

---

## 11. Settings Page (`/settings`)

### Current Issues
- Basic sections: Appearance, Playback, Storage, Updates, Links, Account, Developer
- Theme is dropdown
- No notification settings
- No language settings

### Improvements
1. **Visual Theme Picker** — card-based theme selection with previews
2. **Audio Quality Explanation** — explain what each quality level means
3. **Crossfade Visualization** — visual crossfade demo
4. **Download Quality** — separate streaming vs download quality
5. **Notification Settings** — manage push notifications
6. **Language Settings** — multi-language support
7. **Storage Breakdown** — detailed storage usage by category
8. **Auto-Download Settings** — configurable auto-download rules
9. **Equalizer Access** — audio equalizer settings
10. **About Section** — app version, build date, licenses
11. **Help & Support** — FAQ, contact, bug report
12. **What's New** — changelog for updates
13. **Accessibility Settings** — font size, contrast, reduce motion
14. **Cache Management** — selective cache clearing (by track, by date)
15. **Account Management** — change password, delete account

---

## 12. Import Page (`/import`)

### Current Issues
- Basic URL paste + import
- History stored in localStorage
- Progress bar is basic
- Limited error messages

### Improvements
1. **URL Validation Feedback** — real-time URL validation
2. **Import Preview** — show playlist info before importing
3. **Duplicate Detection** — warn about existing tracks
4. **Batch Import** — import multiple URLs at once
5. **Import Queue** — show import progress for multiple items
6. **Better Error Messages** — specific error reasons
7. **Import History** — show with thumbnails and track counts
8. **Drag & Drop** — drag audio files directly
9. **Clipboard Auto-Detect** — auto-detect Spotify/Deezer URLs in clipboard
10. **Import Stats** — tracks imported, failed, skipped
11. **Supported Platforms** — show Deezer, Spotify, YouTube Music logos
12. **Import Tips** — helpful tips for best results
13. **Progress Steps** — step-by-step progress (Fetching → Matching → Downloading → Saving)
14. **Cancel Import** — ability to cancel ongoing import
15. **Import Another** — easy reset for next import

---

## 13. Login Page (`/login`)

### Current Issues
- Basic form with username/email + password
- Error handling exists
- Forgot password link (broken - no page)
- No social login

### Improvements
1. **Branded Header** — larger Sakura logo with animation
2. **Social Login Buttons** — Google, GitHub, Discord
3. **Remember Me** — checkbox for persistent session
4. **Forgot Password** — functional reset flow
5. **Show Password Toggle** — already exists, keep it
6. **Form Validation** — real-time validation feedback
7. **Loading States** — better loading indicators
8. **Keyboard Navigation** — full keyboard support
9. **Auto-focus** — auto-focus first input
10. **Enter to Submit** — submit on Enter key
11. **Error Animations** — shake animation on error
12. **Success Transition** — smooth transition to home
13. **Background Animation** — subtle animated background
14. **Mobile Optimized** — larger touch targets
15. **Accessibility** — ARIA labels, error announcements

---

## 14. Register Page (`/register`)

### Current Issues
- Basic form with username, email, password, confirm
- Password strength indicator
- Terms checkbox
- No social registration

### Improvements
1. **Step-by-Step Registration** — multi-step form (Account → Profile → Done)
2. **Social Registration** — Google, GitHub, Discord
3. **Username Availability Check** — real-time username validation
4. **Password Requirements** — visual checklist of requirements
5. **Better Password Strength** — color-coded with specific feedback
6. **Profile Picture Upload** — optional avatar during registration
7. **Welcome Message** — post-registration welcome screen
8. **Terms Inline** — show terms inline instead of new page
9. **Form Progress** — visual progress indicator
10. **Auto-focus** — auto-focus first input
11. **Better Error Messages** — specific field errors
12. **Success Animation** — celebration animation on success
13. **Email Verification** — send verification email
14. **Referral Code** — optional referral code field
15. **Accessibility** — ARIA labels, error announcements

---

## 15. TabBar

### Current Issues
- 4 tabs: Home, Search, Library, Liked
- Basic icons
- Active state is color change only

### Improvements
1. **Better Icons** — use filled icons for active state
2. **Active Indicator** — animated pill/dot indicator
3. **Tab Labels** — add subtle label text
4. **Haptic Feedback** — on tab switch
5. **Smooth Transitions** — animated tab switching
6. **Badge Support** — notification badges on tabs
7. **Long Press Menu** — quick actions on long press
8. **Better Spacing** — improve tap targets
9. **Active Animation** — scale/color animation on active
10. **Scroll to Top** — tap active tab to scroll to top

---

## 16. Global Styles (`globals.css`)

### Current Issues
- Dark theme is well-defined
- Light theme exists but needs polish
- No custom scrollbar for light theme
- Missing some utility classes

### Improvements
1. **Refine Dark Theme** — ensure proper contrast ratios
2. **Polish Light Theme** — softer shadows, better borders
3. **Smooth Theme Transition** — CSS transition on theme change
4. **Custom Scrollbar** — match theme for both modes
5. **Focus Styles** — visible focus indicators for accessibility
6. **Animation Utilities** — fade-in, slide-up classes
7. **Typography Scale** — consistent type scale
8. **Spacing Utilities** — consistent spacing
9. **Color Palette** — ensure all colors work in both themes
10. **Reduced Motion** — respect prefers-reduced-motion
11. **High Contrast Mode** — support for high contrast
12. **Print Styles** — hide interactive elements when printing

---

## 17. Component Improvements

### TrackRow Component
1. **Context Menu** — right-click/long-press menu
2. **Like Button** — inline like/unlike
3. **Add to Playlist** — quick add button
4. **Better Hover State** — smoother hover transition
5. **Swipe Actions** — swipe left/right for actions
6. **Drag Handle** — for playlist reordering
7. **Now Playing Indicator** — animated equalizer bars
8. **Better Skeleton** — loading skeleton matching layout

### FullPlayer Component
1. **Drag to Dismiss** — swipe down gesture
2. **Parallax Album Art** — subtle parallax effect
3. **Background Gradient** — dynamic gradient from album art
4. **Lyrics Sync** — highlighted current lyric line
5. **Queue Peek** — peek at next tracks
6. **Share Card** — generate shareable image

### MiniPlayer Component
1. **Swipe Up** — gesture to expand
2. **Swipe Down** — gesture to dismiss
3. **Progress Gradient** — color gradient on progress
4. **Album Art Animation** — subtle rotation/pulse

---

## 18. Wording & Content Fixes

### Throughout App
- Fix "Recently Played" → "Recently Played" (consistency)
- Fix "New Arrivals" → "New Arrivals" (proper noun consistency)
- Fix empty states to be more helpful and inviting
- Fix error messages to be more specific and helpful
- Fix button labels to be action-oriented ("Play All" not "Play All Tracks")
- Fix placeholders to be descriptive and helpful
- Fix aria-labels for all interactive elements
- Fix page titles for SEO and navigation
- Fix loading states to show meaningful progress
- Fix success messages for user actions

---

## 19. Light Mode Specific

### Issues
- Light theme shadows too subtle
- Light theme borders need more contrast
- Light theme accent color needs more pop
- Light theme skeleton needs to be more visible

### Fixes
1. Increase shadow opacity in light mode
2. Darker border color in light mode
3. More vibrant accent in light mode
4. Better skeleton contrast in light mode
5. Test all pages in light mode
6. Ensure all text is readable in both modes
7. Fix any white-on-white issues
8. Ensure images have proper borders in light mode

---

## 20. Performance & UX

### Improvements
1. **Virtual Scrolling** — for large lists (>100 items)
2. **Image Lazy Loading** — load images as they enter viewport
3. **Preload Next Page** — preload likely next pages
4. **Optimistic Updates** — update UI before API confirms
5. **Debounced Search** — reduce API calls
6. **Cache Strategy** — better cache headers for API
7. **Error Boundaries** — catch and display errors gracefully
8. **Offline Fallbacks** — show cached data when offline
9. **Loading优先** — show content as it loads
10. **Smooth Animations** — 60fps animations everywhere

---

*Total Improvements: 300+ across 20 categories*
