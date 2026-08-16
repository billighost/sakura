"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  AuthError,
  AuthField,
  AuthFooter,
  AuthShell,
  AuthSubmit,
} from "../AuthShell";
import styles from "../AuthShell.module.css";

/**
 * Sign in.
 *
 * The copy is the substantive change beyond the layout. "Invalid username/email
 * or password" is written from the validator's point of view and leaves the user
 * with nothing to do; it also can't distinguish "you typed it wrong" from "you
 * don't have an account", which is the actual question someone is asking when
 * they get it. The replacement says what to check and offers the other door.
 */
export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [failed, setFailed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setProblem(null);
    setFailed(false);
    setLoading(true);

    try {
      const res = await signIn("credentials", {
        identifier: identifier.trim(),
        password,
        redirect: false,
      });

      if (res?.error) {
        setFailed(true);
        return;
      }
      router.push("/home");
      router.refresh();
    } catch {
      // Distinguished from bad credentials: the request never completed, so
      // telling someone to check their password would be actively misleading.
      setProblem("We couldn't reach Sakura. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell eyebrow="Welcome back" heading="Sign in to pick up where you left off.">
      {failed && (
        <AuthError>
          That username and password don&apos;t match. Check for typos — or create an
          account if you haven&apos;t made one yet.
        </AuthError>
      )}
      {problem && <AuthError>{problem}</AuthError>}

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <AuthField
          id="identifier"
          label="Username or email"
          value={identifier}
          onChange={(v) => {
            setIdentifier(v);
            if (failed) setFailed(false);
          }}
          autoComplete="username"
          autoFocus
          placeholder="you@example.com"
          required
        />

        <AuthField
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={(v) => {
            setPassword(v);
            if (failed) setFailed(false);
          }}
          autoComplete="current-password"
          required
        />

        <AuthSubmit
          busy={loading}
          busyLabel="Signing in…"
          disabled={!identifier.trim() || !password}
        >
          Sign in
        </AuthSubmit>
      </form>

      <AuthFooter prompt="New to Sakura?" href="/register" action="Create an account" />
    </AuthShell>
  );
}
