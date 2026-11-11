export const RELEASE_MANIFEST_URL = "https://finance-system-plan.vercel.app/mobile-release.json";

export type AndroidRelease = {
  versionCode: number;
  versionName: string;
  apkUrl: string | null;
  notes: string;
};

export type UpdateResult =
  | { kind: "current"; release: AndroidRelease }
  | { kind: "available"; release: AndroidRelease }
  | { kind: "unpublished"; release: AndroidRelease };

export function parseReleaseManifest(value: unknown): AndroidRelease {
  if (!value || typeof value !== "object") throw new Error("The update information is invalid.");
  const manifest = value as Record<string, unknown>;
  const release = manifest.android;
  if (manifest.schemaVersion !== 1 || !release || typeof release !== "object") {
    throw new Error("The update information is invalid.");
  }
  const android = release as Record<string, unknown>;
  if (!Number.isSafeInteger(android.versionCode) || Number(android.versionCode) < 1 ||
      typeof android.versionName !== "string" || !/^\d+\.\d+\.\d+$/.test(android.versionName) ||
      !(android.apkUrl === null || typeof android.apkUrl === "string") ||
      typeof android.notes !== "string") {
    throw new Error("The update information is invalid.");
  }
  if (typeof android.apkUrl === "string") {
    if (!/^https:\/\/[^\s/?#@]+(?:[/?#]|$)/.test(android.apkUrl)) throw new Error("The update download link is invalid.");
  }
  return {
    versionCode: Number(android.versionCode),
    versionName: android.versionName,
    apkUrl: android.apkUrl,
    notes: android.notes.slice(0, 300),
  };
}

export function compareRelease(release: AndroidRelease, installedVersionCode: number): UpdateResult {
  if (release.versionCode <= installedVersionCode) return { kind: "current", release };
  if (!release.apkUrl) return { kind: "unpublished", release };
  return { kind: "available", release };
}

export async function checkForAppUpdate(installedVersionCode: number, signal?: AbortSignal): Promise<UpdateResult> {
  const response = await fetch(`${RELEASE_MANIFEST_URL}?check=${Date.now()}`, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error("Could not check for updates.");
  return compareRelease(parseReleaseManifest(await response.json()), installedVersionCode);
}
