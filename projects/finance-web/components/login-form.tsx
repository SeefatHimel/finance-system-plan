"use client";

import type React from "react";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { ButtonBusy } from "@/components/loading-state";

export function LoginForm() {
  const { signIn } = useAuth();
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
      await signIn(username, password);
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
          autoFocus
          className="field__control"
          name="username"
          disabled={isSubmitting}
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
          disabled={isSubmitting}
          required
          type="password"
        />
      </label>

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      <button className="button button--primary" disabled={isSubmitting} type="submit">
        {isSubmitting ? <ButtonBusy label="Signing in" /> : "Sign in"}
      </button>
    </form>
  );
}
