import { NextResponse } from "next/server";
import { MOBILE_RELEASE_REPOSITORY, mobileManifestFromRelease } from "@/lib/mobile-release";

export const dynamic = "force-dynamic";

/** Public release metadata only. No financial API, identity, or login is involved. */
export async function GET() {
  const headers = { "Cache-Control": "public, max-age=0, s-maxage=300" };
  try {
    const response = await fetch(`https://api.github.com/repos/${MOBILE_RELEASE_REPOSITORY}/releases?per_page=100`, {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Finance-Mobile-Release-Check",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("Release metadata unavailable");
    const releases: unknown = await response.json();
    if (!Array.isArray(releases)) throw new Error("Release metadata invalid");
    const manifest = releases.map(mobileManifestFromRelease)
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => b.android.versionCode - a.android.versionCode)[0];
    if (!manifest) {
      // Before the first tagged APK, keep the installed build's update screen calm.
      const hasInvalidMobileRelease = releases.some(item => item && typeof item === "object" &&
        "tag_name" in item && typeof item.tag_name === "string" && item.tag_name.startsWith("mobile-v"));
      if (hasInvalidMobileRelease) throw new Error("Release metadata invalid");
      return NextResponse.json({ schemaVersion: 1, android: {
        versionCode: 30, versionName: "0.1.29", apkUrl: null, notes: "",
      } }, { headers });
    }
    return NextResponse.json(manifest, { headers });
  } catch {
    return NextResponse.json({ detail: "Release information is temporarily unavailable." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
