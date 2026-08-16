"use client";

import { useMemo, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AuthError,
  AuthField,
  AuthFooter,
  AuthShell,
  AuthSubmit,
} from "../AuthShell";
import styles from "../AuthShell.module.css";

/**
 * Create an account.
 *
 * The validation is the substantive change. Before, every rule lived only on the
 * server: you filled in four fields, pressed the button, waited for a round trip
 * and got "Username must be 3-30 characters" in a banner at the top — with the
 * offending field not marked, and the rule stated only after breaking it.
 * Now each field says its own rule as a hint, checks on blur, and the server
 * remains the authority for the two things only it can know (taken username,
 * taken email).
 *
 * Rules are mirrored from /api/auth/register deliberately, and the comment there
 * matters: if they drift, the client will accept something the server rejects.
 */

/** Mirrors /api/auth/register. */
const USERNAME_MIN = 3;
const USERNAME_MAX = 30;
const PASSWORD_MIN = 6;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STRENGTH_SEGMENTS = 4;

/**
 * A rough strength read, and honest about being rough — four buckets and a word,
 * not a percentage. Length dominates because it genuinely dominates; character
 * classes are worth less than people expect but they're what most users reach
 * for, so they still move the needle.
 */
function strengthOf(pw: string): { filled: number; label: string; className: string } {
  if (!pw) return { filled: 0, label: "", className: "" };

  let score = 0;
  if (pw.length >= PASSWORD_MIN) score++;
  if (pw.length >= 10) score++;
  if (pw.length >= 14) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  const filled = Math.max(1, Math.round((score / 6) * STRENGTH_SEGMENTS));
  if (score <= 2) return { filled, label: "Weak", className: styles.segWeak };
  if (score <= 4) return { filled, label: "Getting there", className: styles.segFair };
  return { filled, label: "Strong", className: styles.segStrong };
}

export default function RegisterPage() {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /*
   * Which fields have been left. A rule shown while someone is still typing
   * their third character tells them they're wrong before they've had a chance
   * to be right, so messages wait for blur — and clear again as soon as the
   * field becomes valid.
   */
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const touch = (field: string) => setTouched((t) => ({ ...t, [field]: true }));

  const usernameProblem =
    username.length > 0 && username.length < USERNAME_MIN
      ? `${USERNAME_MIN} characters or more`
      : null;
  const emailProblem = email.length > 0 && !EMAIL_RE.test(email) ? "Doesn't look right" : null;
  const passwordProblem =
    password.length > 0 && password.length < PASSWORD_MIN
      ? `${PASSWORD_MIN} characters or more`
      : null;
  const confirmProblem = confirm.length > 0 && confirm !== password ? "Doesn't match" : null;

  const strength = useMemo(() => strengthOf(password), [password]);

  const valid =
    username.length >= USERNAME_MIN &&
    username.length <= USERNAME_MAX &&
    EMAIL_RE.test(email) &&
    password.length >= PASSWORD_MIN &&
    confirm === password &&
    agreed;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Mark everything touched so any outstanding rule becomes visible, rather
    // than the form simply refusing to submit with nothing explaining why.
    setTouched({ username: true, email: true, password: true, confirm: true });
    if (!valid) return;

    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), email: email.trim(), password }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        // 409 is the only server answer the client can't predict, and it's the
        // most common one, so it's phrased as a next step rather than a verdict.
        setError(
          res.status === 409
            ? `${data?.error ?? "That's already taken"}. Try another, or sign in if it's yours.`
            : (data?.error ?? "We couldn't create your account. Try again in a moment.")
        );
        return;
      }

      const signInRes = await signIn("credentials", {
        identifier: username.trim(),
        password,
        redirect: false,
      });

      // The account exists either way — if the automatic sign-in fails, the
      // right destination is the sign-in page, not an error.
      if (signInRes?.error) {
        router.push("/login");
        return;
      }
      router.push("/onboarding");
      router.refresh();
    } catch {
      setError("We couldn't reach Sakura. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell eyebrow="Get started" heading="Make an account and start listening.">
      {error && <AuthError>{error}</AuthError>}

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <AuthField
          id="username"
          label="Username"
          value={username}
          onChange={setUsername}
          onBlur={() => touch("username")}
          autoComplete="username"
          autoFocus
          placeholder="What should we call you?"
          minLength={USERNAME_MIN}
          maxLength={USERNAME_MAX}
          required
          problem={touched.username ? usernameProblem : null}
        />

        <AuthField
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          onBlur={() => touch("email")}
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          required
          problem={touched.email ? emailProblem : null}
        />

        <AuthField
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          onBlur={() => touch("password")}
          autoComplete="new-password"
          placeholder={`At least ${PASSWORD_MIN} characters`}
          minLength={PASSWORD_MIN}
          required
          problem={touched.password ? passwordProblem : null}
        >
          {password.length > 0 && (
            <div className={styles.strength}>
              {/* Decorative: the label beside it carries the same information as
                  text, so announcing the segments too would just be noise. */}
              <div className={styles.strengthTrack} aria-hidden="true">
                {Array.from({ length: STRENGTH_SEGMENTS }).map((_, i) => (
                  <span
                    key={i}
                    className={`${styles.strengthSeg} ${
                      i < strength.filled ? strength.className : ""
                    }`}
                  />
                ))}
              </div>
              <span className={styles.strengthLabel}>{strength.label}</span>
            </div>
          )}
        </AuthField>

        <AuthField
          id="confirm"
          label="Password again"
          type="password"
          value={confirm}
          onChange={setConfirm}
          onBlur={() => touch("confirm")}
          autoComplete="new-password"
          placeholder="Type it once more"
          required
          problem={touched.confirm ? confirmProblem : null}
        />

        <label className={styles.terms}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span className={styles.termsLabel}>
            I&apos;ve read the{" "}
            <Link href="/terms" className={styles.termsLink}>
              terms
            </Link>{" "}
            and the{" "}
            <Link href="/privacy" className={styles.termsLink}>
              privacy policy
            </Link>
            .
          </span>
        </label>

        <AuthSubmit busy={loading} busyLabel="Creating your account…" disabled={!valid}>
          Create account
        </AuthSubmit>
      </form>

      <AuthFooter prompt="Already have an account?" href="/login" action="Sign in" />
    </AuthShell>
  );
}
