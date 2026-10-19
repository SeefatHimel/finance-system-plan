"use client";

import { Desktop, Moon, SignOut, Sun } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth-provider";
import { ButtonBusy } from "@/components/loading-state";
import { useTheme, type ThemePreference } from "@/components/theme-provider";
import { useToast } from "@/components/toast-provider";

const themes = [
  { value: "system", label: "System", Icon: Desktop },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon }
] as const;

export function ProfileWorkspace() {
  const { session, updateProfile, signOut, isSigningOut } = useAuth();
  const { preference, setPreference } = useTheme();
  const { notify } = useToast();
  const user = session.status === "signed-in" ? session.user : null;
  const [firstName, setFirstName] = useState(user?.first_name ?? "");
  const [lastName, setLastName] = useState(user?.last_name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  if (!user) return null;

  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username;
  const initials = [user.first_name, user.last_name].filter(Boolean).map(part => part.trim().charAt(0))
    .join("").toUpperCase().slice(0, 2) || user.username.slice(0, 2).toUpperCase();
  const dirty = firstName.trim() !== user.first_name || lastName.trim() !== user.last_name || email.trim() !== user.email;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !dirty) return;
    setSaving(true);
    setError("");
    try {
      const updated = await updateProfile({ first_name: firstName.trim(), last_name: lastName.trim(), email: email.trim() });
      setFirstName(updated.first_name);
      setLastName(updated.last_name);
      setEmail(updated.email);
      notify("Profile saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your profile. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return <main className="profile-page">
    <section className="profile-hero" aria-label="Profile overview">
      <div className="profile-identity">
        <span className="profile-avatar" aria-hidden="true">{initials}</span>
        <div className="profile-identity__text">
          <h2>{fullName}</h2>
          <p>@{user.username}</p>
          {user.email ? <p>{user.email}</p> : null}
        </div>
      </div>
      <fieldset className="profile-appearance">
        <legend>Appearance</legend>
        <div className="profile-appearance__options">
          {themes.map(({ value, label, Icon }) => <button
            aria-pressed={preference === value}
            className={`profile-appearance__option${preference === value ? " profile-appearance__option--selected" : ""}`}
            key={value}
            onClick={() => setPreference(value as ThemePreference)}
            type="button"
          ><Icon aria-hidden="true" size={20} /><span>{label}</span></button>)}
        </div>
      </fieldset>
    </section>

    <section className="profile-details" aria-labelledby="profile-details-title">
      <div className="profile-details__heading">
        <h2 id="profile-details-title">Profile information</h2>
        <p>Update how your name and email appear in Finance.</p>
      </div>
      <form onSubmit={save}>
        <div className="profile-row">
          <div><label htmlFor="profile-first-name">First name</label><p>Your name in the app.</p></div>
          <input autoComplete="given-name" id="profile-first-name" maxLength={150} onChange={event => setFirstName(event.target.value)} value={firstName} />
        </div>
        <div className="profile-row">
          <div><label htmlFor="profile-last-name">Last name</label><p>Shown with your first name.</p></div>
          <input autoComplete="family-name" id="profile-last-name" maxLength={150} onChange={event => setLastName(event.target.value)} value={lastName} />
        </div>
        <div className="profile-row">
          <div><span className="profile-row__label">Username</span><p>Your sign-in name stays the same.</p></div>
          <span className="profile-row__static">{user.username}</span>
        </div>
        <div className="profile-row">
          <div><label htmlFor="profile-email">Email address</label><p>Saved with your account.</p></div>
          <input autoComplete="email" id="profile-email" onChange={event => setEmail(event.target.value)} type="email" value={email} />
        </div>
        {error ? <p className="profile-error" role="alert">{error}</p> : null}
        <div className="profile-actions">
          <button className="button button--primary" disabled={!dirty || saving} type="submit">
            {saving ? <ButtonBusy label="Saving profile" /> : "Save profile"}
          </button>
          <button className="button button--ghost profile-signout" disabled={isSigningOut} onClick={() => void signOut()} type="button">
            <SignOut aria-hidden="true" size={19} />{isSigningOut ? <ButtonBusy label="Signing out" /> : "Sign out"}
          </button>
        </div>
      </form>
    </section>
  </main>;
}
