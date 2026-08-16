-- Theme default: "dark" → "system"
--
-- `UserSettings.theme` defaulted to 'dark', so a row created as a side effect of
-- saving any *other* setting claimed the user had chosen a dark palette. The
-- settings page reconciles the server's theme against the device's on load, and
-- adopted that claim — so opening Settings repainted the whole app dark for
-- anyone who had never picked a theme. On a light-mode device the change was
-- plainly visible.
--
-- Only the column DEFAULT changes here. Existing rows are deliberately left
-- alone: a stored 'dark' cannot be distinguished from a deliberate choice of
-- dark, and rewriting them would take the palette away from everyone who really
-- did pick it. The client-side half of the fix makes that unnecessary — a device
-- with its own stored preference now keeps it (see lib/theme.ts,
-- getStoredTheme), so a stale 'dark' on the server can no longer override what
-- the device is already showing.
--
-- Re-runnable.

ALTER TABLE "UserSettings" ALTER COLUMN "theme" SET DEFAULT 'system';
