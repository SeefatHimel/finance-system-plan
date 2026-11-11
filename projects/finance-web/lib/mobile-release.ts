export const MOBILE_RELEASE_REPOSITORY = "SeefatHimel/finance-system-plan";

type ReleaseAsset = {
  browser_download_url?: unknown;
  name?: unknown;
  size?: unknown;
  state?: unknown;
};

type GithubRelease = {
  assets?: unknown;
  body?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  tag_name?: unknown;
};

/** Only a published release with the expected APK can be advertised to phones. */
export function mobileManifestFromRelease(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const release = value as GithubRelease;
  if (release.draft || release.prerelease || typeof release.tag_name !== "string" || !Array.isArray(release.assets)) return null;
  const tag = /^mobile-v(\d+\.\d+\.\d+)-code([1-9]\d*)$/.exec(release.tag_name);
  if (!tag) return null;
  const [, versionName, codeText] = tag;
  const versionCode = Number(codeText);
  if (!Number.isSafeInteger(versionCode)) return null;
  const name = `finance-mobile-${versionName}.apk`;
  const expectedUrl = `https://github.com/${MOBILE_RELEASE_REPOSITORY}/releases/download/${release.tag_name}/${name}`;
  const asset = (release.assets as ReleaseAsset[]).find(item => item.name === name && item.state === "uploaded" &&
    Number.isSafeInteger(item.size) && Number(item.size) > 1_000_000 && item.browser_download_url === expectedUrl);
  if (!asset) return null;
  const notes = typeof release.body === "string" ? release.body.split("\n", 1)[0].trim().slice(0, 250) : "";
  return {
    schemaVersion: 1,
    android: { versionCode, versionName, apkUrl: expectedUrl, notes },
  };
}
