"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertIcon,
  EyeIcon,
  EyeOffIcon,
  PetalIcon,
  SpinnerIcon,
} from "@/components/Icons";
import styles from "./AuthShell.module.css";

/**
 * Shared chrome for sign-in and sign-up.
 *
 * The two pages were 90% the same markup — same wordmark block, same input
 * shell, same hand-inlined eye/eye-off SVG pair (four copies of it across the
 * two files), same error banner, same submit button, same footer link. They also
 * each had two absolutely-positioned gradient blobs behind the card, which the
 * brief asks to remove.
 *
 * ── What replaced the blobs ───────────────────────────────────────────────
 *
 * Nothing, in the sense of decoration — and the card went with them. A form
 * floating in a shadowed panel over blurred colour is the default look for this
 * screen, and it was doing no work: there is nothing behind the card to be
 * separated from.
 *
 * Instead the page is a single stepped surface with the fields edge-to-edge,
 * divided by hairlines, the way a form on paper is set. That leaves type as the
 * only thing carrying the page, which is the right answer for a product whose
 * identity is a serif wordmark and one pink accent: the wordmark is the hero at
 * display scale, the blossom is a single piece of punctuation beside it, and the
 * accent appears exactly twice — the focused field and the submit button.
 *
 * The one piece of motion is the blossom's five petals settling in on load,
 * once, using the `data-part="petal"` hooks the icon already carries. It's the
 * app's own mark assembling itself rather than an ambient effect, and it's off
 * under reduced motion.
 */

export function AuthShell({
  eyebrow,
  heading,
  children,
}: {
  /** "Welcome back" / "Get started". */
  eyebrow: string;
  /** What this screen is for, under the wordmark. */
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1 className={styles.wordmark}>
            Sakura
            <span className={styles.mark} aria-hidden="true">
              <PetalIcon size={26} filled />
            </span>
          </h1>
          <p className={styles.heading}>{heading}</p>
        </header>

        {children}
      </div>
    </main>
  );
}

/* ── Error banner ─────────────────────────────────────────────────────────── */

/**
 * Form-level failure.
 *
 * `role="alert"` so it's announced when it appears — a sighted user sees the
 * banner arrive, and without this a screen reader user gets nothing at all after
 * pressing a button that appeared to do nothing.
 */
export function AuthError({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.error} role="alert">
      <AlertIcon size={16} />
      <span>{children}</span>
    </div>
  );
}

/* ── Field ────────────────────────────────────────────────────────────────── */

export interface AuthFieldProps {
  id: string;
  label: string;
  type?: "text" | "email" | "password";
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  autoFocus?: boolean;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  /** Validation message. Shown once the field has been left, not while typing. */
  problem?: string | null;
  /** Called on blur, so the caller can start validating this field. */
  onBlur?: () => void;
  /** Rendered under the field — a strength meter, a hint. */
  children?: React.ReactNode;
}

export function AuthField({
  id,
  label,
  type = "text",
  value,
  onChange,
  autoComplete,
  autoFocus,
  placeholder,
  required,
  minLength,
  maxLength,
  inputMode,
  problem,
  onBlur,
  children,
}: AuthFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";
  const errorId = `${id}-problem`;

  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
        {/*
          The message sits beside the label rather than under the input. Under
          the input it pushes the next field down as you type, so a form with
          three validated fields jumps around while being filled in.
        */}
        {problem && (
          <span className={styles.problem} id={errorId}>
            {problem}
          </span>
        )}
      </div>

      <div className={`${styles.inputRow} ${problem ? styles.inputRowBad : ""}`}>
        <input
          id={id}
          className={styles.input}
          type={isPassword && revealed ? "text" : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          placeholder={placeholder}
          required={required}
          minLength={minLength}
          maxLength={maxLength}
          inputMode={inputMode}
          // Names and emails: never let the keyboard capitalise or autocorrect
          // them. A username silently turned into "Bob" by iOS then fails to
          // match and the error says the password is wrong.
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? errorId : undefined}
        />

        {isPassword && (
          <button
            type="button"
            className={styles.reveal}
            onClick={() => setRevealed((v) => !v)}
            // Reachable by keyboard, unlike the previous version which set
            // tabIndex={-1} — that hid the only way to check a typo from exactly
            // the people most likely to need it.
            aria-label={revealed ? "Hide password" : "Show password"}
            aria-pressed={revealed}
          >
            {revealed ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
          </button>
        )}
      </div>

      {children}
    </div>
  );
}

/* ── Submit ───────────────────────────────────────────────────────────────── */

export function AuthSubmit({
  busy,
  busyLabel,
  children,
  disabled,
}: {
  busy: boolean;
  busyLabel: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      className={`${styles.submit} pressable`}
      disabled={busy || disabled}
    >
      {busy && <SpinnerIcon size={17} className={styles.spin} />}
      {busy ? busyLabel : children}
    </button>
  );
}

/* ── Footer ───────────────────────────────────────────────────────────────── */

export function AuthFooter({
  prompt,
  href,
  action,
}: {
  prompt: string;
  href: string;
  action: string;
}) {
  return (
    <p className={styles.footer}>
      {prompt}{" "}
      <Link href={href} className={styles.footerLink}>
        {action}
      </Link>
    </p>
  );
}
