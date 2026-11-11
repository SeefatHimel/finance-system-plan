import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, Text, View } from "react-native";
import { checkForAppUpdate, type UpdateResult } from "./app-updates";

type Props = { installedVersionCode: number; installedVersionName: string; isLight: boolean };

export function AppUpdateCard({ installedVersionCode, installedVersionName, isLight }: Props) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [result, setResult] = useState<UpdateResult | null>(null);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const check = useCallback(async () => {
    if (Platform.OS !== "android") return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    setStatus("loading");
    setError("");
    try {
      const next = await checkForAppUpdate(installedVersionCode, controller.signal);
      if (mounted.current && activeRequest.current === controller) { setResult(next); setStatus("ready"); }
    } catch {
      if (mounted.current && activeRequest.current === controller) {
        setStatus("error");
        setError(controller.signal.aborted ? "Update check timed out. Try again when connected." : "Could not check for updates. Try again when connected.");
      }
    } finally {
      clearTimeout(timeout);
    }
  }, [installedVersionCode]);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    mounted.current = true;
    void check();
    return () => { mounted.current = false; activeRequest.current?.abort(); };
  }, [check]);
  if (Platform.OS !== "android") return null;

  const text = isLight ? "#243746" : "#e8f1fa";
  const secondary = isLight ? "#637789" : "#9aacc2";
  const border = isLight ? "#d5e0e6" : "#283d52";
  const background = isLight ? "#ffffff" : "#102233";
  const available = status === "ready" && result?.kind === "available";
  const summary = status === "loading" ? "Checking for updates…"
    : status === "error" ? error
    : result?.kind === "available" ? `Version ${result.release.versionName} is ready to install.`
    : result?.kind === "unpublished" ? "A newer build is being prepared. Check again later."
    : "You have the latest published version.";

  async function openDownload() {
    if (!available || !result.release.apkUrl) return;
    try { await Linking.openURL(result.release.apkUrl); }
    catch { setError("Could not open the download. Check your browser connection."); }
  }

  return <View style={{ backgroundColor: background, borderColor: available ? "#55d7a3" : border, borderWidth: 1, borderRadius: 18, padding: 16, gap: 8 }}>
    <Text accessibilityRole="header" style={{ color: text, fontSize: 15, fontWeight: "700" }}>App updates</Text>
    <Text style={{ color: secondary, fontSize: 13 }}>Installed version {installedVersionName}</Text>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      {status === "loading" ? <ActivityIndicator color="#55d7a3" size="small" /> : null}
      <Text accessibilityLiveRegion="polite" style={{ color: available ? "#55d7a3" : secondary, fontSize: 13, flex: 1 }}>{summary}</Text>
    </View>
    {available && result?.release.notes ? <Text style={{ color: secondary, fontSize: 13 }}>{result.release.notes}</Text> : null}
    {available ? <Pressable accessibilityRole="button" accessibilityLabel="Download app update" onPress={() => void openDownload()} style={{ backgroundColor: "#55d7a3", borderRadius: 11, paddingVertical: 11, alignItems: "center" }}><Text style={{ color: "#06221a", fontWeight: "700", fontSize: 14 }}>Download update</Text></Pressable> : null}
    {error && available ? <Text accessibilityRole="alert" style={{ color: "#ff8d95", fontSize: 13 }}>{error}</Text> : null}
    <Pressable accessibilityRole="button" accessibilityLabel="Check for app updates" disabled={status === "loading"} onPress={() => void check()} style={{ minHeight: 40, justifyContent: "center" }}><Text style={{ color: text, fontSize: 13 }}>{status === "loading" ? "Checking…" : "Check again"}</Text></Pressable>
  </View>;
}
