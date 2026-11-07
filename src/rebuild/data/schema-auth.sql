-- Minimal fresh identity schema. No legacy product tables are required.
BEGIN;
CREATE TABLE IF NOT EXISTS public."User" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  "passwordHash" text NOT NULL,
  "avatarUrl" text,
  bio text,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS v2_user_username_lower ON public."User"(lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS v2_user_email_lower ON public."User"(lower(email));
COMMIT;
