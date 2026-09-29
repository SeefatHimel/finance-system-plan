import * as SecureStore from "expo-secure-store";

import type { AuthTokens } from "./api";

const sessionKey = "finance.auth.session.v1";

export type StoredSession = AuthTokens & {
  username: string;
};

function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<StoredSession>;
  return Boolean(candidate.access && candidate.refresh && typeof candidate.username === "string");
}

export async function loadSession(): Promise<StoredSession | null> {
  if (!(await SecureStore.isAvailableAsync())) {
    return null;
  }

  const storedValue = await SecureStore.getItemAsync(sessionKey);
  if (!storedValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(storedValue) as unknown;
    if (isStoredSession(parsed)) {
      return parsed;
    }
  } catch {
    // Invalid or obsolete session data is removed below.
  }

  await clearSession();
  return null;
}

export async function saveSession(session: StoredSession): Promise<void> {
  if (!(await SecureStore.isAvailableAsync())) {
    return;
  }

  await SecureStore.setItemAsync(sessionKey, JSON.stringify(session), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  });
}

export async function clearSession(): Promise<void> {
  if (!(await SecureStore.isAvailableAsync())) {
    return;
  }

  await SecureStore.deleteItemAsync(sessionKey);
}
