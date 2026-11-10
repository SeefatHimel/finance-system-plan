import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useEffect, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import {
  defaultWidgetPrivacy, installedWidgets, pinWidget, widgetKinds, widgetsAvailable,
  type WidgetKind, type WidgetPrivacy,
} from "./android-widgets";
import { useLightAppearance } from "./mobile-theme";

const details: Record<WidgetKind, { title: string; description: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }> = {
  quick_add: { title: "Quick Add", description: "Expense, transfer, or voice entry.", icon: "plus-circle-outline" },
  review: { title: "Review Inbox", description: "See how many messages need review.", icon: "inbox-outline" },
  balances: { title: "Account Balances", description: "A snapshot of up to three accounts.", icon: "wallet-outline" },
  activity: { title: "Recent Activity", description: "Your latest loaded ledger entries.", icon: "history" },
  spending: { title: "Spending Snapshot", description: "Exact monthly spending from Reports.", icon: "chart-donut" },
  presets: { title: "Quick Presets", description: "Open saved shortcuts in one tap.", icon: "lightning-bolt-outline" },
};

export function WidgetSettings({ privacy, onPrivacyChange }: {
  privacy: WidgetPrivacy;
  onPrivacyChange: (next: WidgetPrivacy) => Promise<void>;
}) {
  const isLight = useLightAppearance();
  const [installed, setInstalled] = useState<Partial<Record<WidgetKind, number>>>({});
  const [message, setMessage] = useState("");
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const privacyWritePending = useRef(false);
  useEffect(() => {
    if (!widgetsAvailable) return;
    const refresh = () => { void installedWidgets().then(setInstalled).catch(() => {}); };
    refresh();
    const subscription = AppState.addEventListener("change", state => { if (state === "active") refresh(); });
    return () => subscription.remove();
  }, []);
  async function add(kind: WidgetKind) {
    setMessage("");
    try {
      if (!await pinWidget(kind))
        setMessage("On your home screen, long-press an empty area, choose Widgets, then the Finance widget you want.");
      else setMessage("Your launcher will ask where to place this widget.");
    } catch {
      setMessage("Open your home-screen widget picker and choose Finance.");
    }
  }
  async function changePrivacy(next: WidgetPrivacy) {
    if (privacyWritePending.current) return;
    privacyWritePending.current = true;
    setSavingPrivacy(true);
    setMessage("");
    try { await onPrivacyChange(next); }
    catch { setMessage("Widget privacy could not be saved. Your previous setting is still active. Try again."); }
    finally { privacyWritePending.current = false; setSavingPrivacy(false); }
  }
  const toggle = (key: keyof WidgetPrivacy) =>
    void changePrivacy({ ...privacy, [key]: !privacy[key] });
  return <View style={styles.root}>
    <View style={styles.intro}>
      <Text style={[styles.title, isLight && styles.lightTitle]}>Home-screen widgets</Text>
      <Text style={[styles.secondary, isLight && styles.lightSecondary]}>Pin the shortcuts you use. Tapping a widget opens Finance; every transaction still needs your review before saving.</Text>
    </View>
    {!widgetsAvailable ? <Text style={styles.notice}>Widgets can be added from the installed Android app. This browser preview shows their settings.</Text> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{message}</Text> : null}
    <Text style={[styles.sectionTitle, isLight && styles.lightTitle]}>What appears on your home screen</Text>
    <Text style={[styles.secondary, isLight && styles.lightSecondary]}>Money details stay hidden until you switch them on. Anyone looking at your home screen can see the details you enable.</Text>
    <View style={styles.list}>
      {([
        ["showBalances", "Show account balances"],
        ["showActivity", "Show recent amounts and names"],
        ["showSpending", "Show monthly spending"],
      ] as const).map(([key, label]) => <View key={key} style={styles.toggle}>
        <Text style={styles.name}>{label}</Text>
        <Switch accessibilityLabel={label} value={privacy[key]} disabled={savingPrivacy} onValueChange={() => toggle(key)}
          trackColor={{ false: "#334a59", true: "#218969" }} thumbColor={privacy[key] ? "#69e3ae" : "#c2ced3"} />
      </View>)}
    </View>
    <Pressable accessibilityRole="button" disabled={savingPrivacy} onPress={() => void changePrivacy(defaultWidgetPrivacy)} style={styles.reset}>
      <Text style={styles.resetText}>Hide all financial details</Text>
    </Pressable>
    <Text style={[styles.sectionTitle, isLight && styles.lightTitle]}>Choose a widget</Text>
    <View style={styles.list}>
      {widgetKinds.map(kind => <View key={kind} style={styles.row}>
        <View style={styles.icon}><MaterialCommunityIcons name={details[kind].icon} size={22} color="#5ee2a8" /></View>
        <View style={styles.copy}>
          <Text style={styles.name}>{details[kind].title}</Text>
          <Text style={styles.secondary}>{details[kind].description}</Text>
          {installed[kind] ? <Text style={styles.installed}>On home screen · {installed[kind]}</Text> : null}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Add ${details[kind].title} widget`}
          onPress={() => void add(kind)} style={styles.add}>
          <Text style={styles.addText}>Add</Text>
        </Pressable>
      </View>)}
    </View>
    <Text style={[styles.secondary, isLight && styles.lightSecondary]}>Snapshots update when Finance opens or refreshes and expire after 24 hours. Android may delay redraws while the app is closed.</Text>
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 12, paddingBottom: 28 },
  intro: { gap: 5 },
  title: { color: "#eef7f8", fontSize: 17, fontWeight: "700" },
  sectionTitle: { color: "#eef7f8", fontSize: 14, fontWeight: "700", marginTop: 8 },
  secondary: { color: "#9db3c1", fontSize: 12, lineHeight: 18, flexShrink: 1 },
  lightTitle: { color: "#18333e" },
  lightSecondary: { color: "#526d79" },
  notice: { color: "#f4c879", backgroundColor: "#302b1d", borderRadius: 12, padding: 12, fontSize: 12, lineHeight: 18 },
  list: { backgroundColor: "#1b2a45", borderWidth: 1, borderColor: "#455878", borderRadius: 20, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderBottomWidth: 1, borderBottomColor: "#344767" },
  icon: { width: 36, height: 36, borderRadius: 12, backgroundColor: "#344767", alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, gap: 2 },
  name: { color: "#e6f1f5", fontSize: 13, fontWeight: "600" },
  installed: { color: "#5ee2a8", fontSize: 11 },
  add: { backgroundColor: "#4bdca0", borderRadius: 10, minHeight: 48, paddingHorizontal: 14, justifyContent: "center" },
  addText: { color: "#092322", fontSize: 12, fontWeight: "700" },
  toggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 14, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: "#344767" },
  reset: { alignSelf: "flex-start", minHeight: 48, justifyContent: "center" },
  resetText: { color: "#5ee2a8", fontSize: 12, fontWeight: "600" },
});
