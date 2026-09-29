"use client";

import type React from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { login } from "@/lib/api";
import { canUseLocalTokenStorage, saveTokens } from "@/lib/auth-storage";
import { loginWithCookieSession } from "@/lib/session-api";
import { ButtonBusy } from "@/components/loading-state";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const username = String(formData.get("username") ?? "");
    const password = String(formData.get("password") ?? "");

    setError(null);
    setIsSubmitting(true);

    try {
      if (canUseLocalTokenStorage()) {
        const tokens = await login(username, password);
        saveTokens(tokens);
      } else {
        await loginWithCookieSession(username, password);
      }
      router.push("/");
      router.refresh();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Login failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label className="field">
        <span className="field__label">Username</span>
        <input
          autoComplete="username"
          className="field__control"
          name="username"
          required
          type="text"
        />
      </label>

      <label className="field">
        <span className="field__label">Password</span>
        <input
          autoComplete="current-password"
          className="field__control"
          name="password"
          required
          type="password"
        />
      </label>

      {error ? <p className="form-error">{error}</p> : null}

      <button className="button button--primary" disabled={isSubmitting} type="submit">
        {isSubmitting ? <ButtonBusy label="Signing in" /> : "Sign in"}
      </button>
    </form>
  );
}
