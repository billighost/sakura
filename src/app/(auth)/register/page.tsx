"use client";

import { useState, useMemo } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import styles from "./page.module.css";

function getPasswordStrength(pw: string): { score: number; label: string } {
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  if (score <= 2) return { score, label: "Weak" };
  if (score <= 4) return { score, label: "Medium" };
  return { score, label: "Strong" };
}

const STRENGTH_SEGMENTS = 4;

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const strength = useMemo(() => getPasswordStrength(password), [password]);
  const filledSegments = useMemo(
    () => (password.length > 0 ? Math.max(1, Math.round((strength.score / 6) * STRENGTH_SEGMENTS)) : 0),
    [password, strength.score]
  );
  const strengthClass =
    strength.label === "Weak" ? styles.strengthWeak : strength.label === "Medium" ? styles.strengthMedium : styles.strengthStrong;

  const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }

    if (!agreedToTerms) {
      setError("You must agree to the terms");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Registration failed");
        return;
      }

      const signInRes = await signIn("credentials", {
        identifier: username,
        password,
        redirect: false,
      });

      if (signInRes?.error) {
        router.push("/login");
      } else {
        router.push("/home");
        router.refresh();
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      <div className={`${styles.bloom} ${styles.bloomOne}`} aria-hidden="true" />
      <div className={`${styles.bloom} ${styles.bloomTwo}`} aria-hidden="true" />

      <div className={styles.card}>
        <div className={styles.iconWrap}>
          <div className={styles.iconRing}>
            <Image
              src="/icons/icon-transparent-128.png"
              alt="Sakura"
              width={56}
              height={56}
              priority
              className={styles.icon}
            />
          </div>
        </div>
        <span className={styles.eyebrow}>Get started</span>
        <h1 className={styles.wordmark}>Sakura</h1>
        <p className={styles.subtitle}>Create your account</p>

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          {error && (
            <div className={styles.errorBox} role="alert">
              <svg className={styles.errorIcon} viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.25a.75.75 0 00-1.5 0v4.5a.75.75 0 001.5 0v-4.5zM10 14a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor="username">
              Username
            </label>
            <div className={styles.inputShell}>
              <span className={styles.inputIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="17" height="17">
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </span>
              <input
                id="username"
                className={styles.input}
                type="text"
                autoComplete="username"
                autoFocus
                placeholder="Choose a username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                minLength={3}
                maxLength={30}
                required
              />
            </div>
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor="email">
              Email
            </label>
            <div className={styles.inputShell}>
              <span className={styles.inputIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="17" height="17">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path d="M3 7l9 6 9-6" />
                </svg>
              </span>
              <input
                id="email"
                className={styles.input}
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor="password">
              Password
            </label>
            <div className={styles.inputShell}>
              <span className={styles.inputIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="17" height="17">
                  <rect x="3" y="11" width="18" height="10" rx="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
              </span>
              <input
                id="password"
                className={`${styles.input} ${styles.inputWithToggle}`}
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
              <button
                type="button"
                className={styles.toggleBtn}
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                    <path d="M14.12 14.12a3 3 0 11-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
            {password.length > 0 && (
              <div className={styles.strengthWrap}>
                <div className={styles.strengthTrack}>
                  {Array.from({ length: STRENGTH_SEGMENTS }).map((_, i) => (
                    <div
                      key={i}
                      className={`${styles.strengthSeg} ${i < filledSegments ? `${styles.strengthSegFilled} ${strengthClass}` : ""}`}
                    />
                  ))}
                </div>
                <span className={styles.strengthLabel}>{strength.label}</span>
              </div>
            )}
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor="confirmPassword">
              Confirm password
            </label>
            <div className={styles.inputShell}>
              <span className={styles.inputIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="17" height="17">
                  <rect x="3" y="11" width="18" height="10" rx="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
              </span>
              <input
                id="confirmPassword"
                className={`${styles.input} ${styles.inputWithToggle} ${passwordsMismatch ? styles.inputError : ""}`}
                type={showConfirm ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Repeat your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={6}
                aria-invalid={passwordsMismatch}
                required
              />
              <button
                type="button"
                className={styles.toggleBtn}
                onClick={() => setShowConfirm((v) => !v)}
                tabIndex={-1}
                aria-label={showConfirm ? "Hide password" : "Show password"}
              >
                {showConfirm ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                    <path d="M14.12 14.12a3 3 0 11-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
            {passwordsMismatch && <span className={styles.errorText}>Passwords don&apos;t match</span>}
          </div>

          <label className={styles.checkboxWrap}>
            <input
              type="checkbox"
              className={styles.checkboxInput}
              checked={agreedToTerms}
              onChange={(e) => setAgreedToTerms(e.target.checked)}
            />
            <span className={styles.checkboxCustom} />
            <span className={styles.checkboxLabel}>
              I agree to the{" "}
              <Link href="/terms" className={styles.checkboxLink}>
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className={styles.checkboxLink}>
                Privacy Policy
              </Link>
            </span>
          </label>

          <button
            className={styles.submitBtn}
            type="submit"
            disabled={loading || !username || !email || !password || !confirmPassword || !agreedToTerms}
          >
            {loading && (
              <svg className={styles.spinner} viewBox="0 0 24 24" fill="none" width="18" height="18">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.3" />
                <path d="M12 2a10 10 0 019.5 6.75" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            )}
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className={styles.footer}>
          Already have an account?{" "}
          <Link href="/login" className={styles.footerLink}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
