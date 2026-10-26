import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { getCurrentUserWithRecovery, updateCurrentUser, type CurrentUser } from "./api";
import type { ThemePreference } from "./theme-preference";

type Props = {
  accessToken: string;
  isLight: boolean;
  onSignOut: () => void;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  username: string;
};

const options = [
  { key: "system", label: "System", icon: "theme-light-dark" },
  { key: "light", label: "Light", icon: "white-balance-sunny" },
  { key: "dark", label: "Dark", icon: "weather-night" }
] as const;

export function ProfileScreen({ accessToken, isLight, onSignOut, preference, setPreference, username }: Props) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    getCurrentUserWithRecovery(accessToken).then(current => {
      if (!active) return;
      setUser(current);
      setFirstName(current.first_name);
      setLastName(current.last_name);
      setEmail(current.email);
      setError("");
    }).catch(() => {
      if (active) setError("Could not load your profile. Check your connection and reopen this page.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // Reopen on account change; a token refresh must not erase form edits.
  }, [username]);

  const ink = isLight ? "#142b36" : "#f5faf9";
  const muted = isLight ? "#617683" : "#9fb4c4";
  const surface = isLight ? "#ffffff" : "#102335";
  const border = isLight ? "#dbe9e7" : "#2b4556";
  const input = isLight ? "#f8fbfa" : "#0a1a29";
  const fullName = user ? [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username : username;
  const initials = user ? [user.first_name, user.last_name].filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase() || user.username.slice(0, 2).toUpperCase() : username.slice(0, 2).toUpperCase();
  const dirty = Boolean(user) && (firstName.trim() !== user?.first_name || lastName.trim() !== user?.last_name || email.trim() !== user?.email);

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const updated = await updateCurrentUser(accessToken, {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim()
      });
      setUser(updated);
      setFirstName(updated.first_name);
      setLastName(updated.last_name);
      setEmail(updated.email);
      setSuccess("Profile saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  }

  return <View style={sheet.stack}>
    <View>
      <Text accessibilityRole="header" style={[sheet.pageTitle, { color: ink }]}>Your profile</Text>
      <Text style={[sheet.subtitle, { color: muted }]}>Your details and app appearance.</Text>
    </View>
    <View style={[sheet.hero, { backgroundColor: isLight ? "#e7f7f0" : "#14392e", borderColor: isLight ? "#c5e8d9" : "#28624a" }]}>
      <View style={sheet.heroGlow} />
      <View style={[sheet.avatar, { backgroundColor: isLight ? "#d0eee0" : "#205943" }]}><Text style={[sheet.avatarText, { color: isLight ? "#0c7054" : "#e7fff1" }]}>{initials}</Text></View>
      <Text style={[sheet.heroName, { color: ink }]}>{fullName}</Text>
      <Text style={[sheet.heroMeta, { color: muted }]}>@{username}</Text>
      {user?.email ? <Text style={[sheet.heroMeta, { color: muted }]}>{user.email}</Text> : null}
    </View>

    <View style={[sheet.card, { backgroundColor: surface, borderColor: border }]}>
      <Text accessibilityRole="header" style={[sheet.sectionTitle, { color: ink }]}>Appearance</Text>
      <Text style={[sheet.helper, { color: muted }]}>Choose how Finance looks on this device.</Text>
      <View style={sheet.options}>
        {options.map(({ key, label, icon }) => <Pressable
          accessibilityRole="radio"
          accessibilityState={{ checked: preference === key }}
          key={key}
          onPress={() => setPreference(key)}
          style={[sheet.option, { borderColor: preference === key ? "#20b987" : border, backgroundColor: preference === key ? isLight ? "#e1f7ed" : "#174438" : input }]}
        ><MaterialCommunityIcons name={icon} size={22} color={preference === key ? "#14946e" : muted} /><Text style={[sheet.optionLabel, { color: ink }]}>{label}</Text></Pressable>)}
      </View>
    </View>

    <View style={[sheet.card, { backgroundColor: surface, borderColor: border }]}>
      <Text accessibilityRole="header" style={[sheet.sectionTitle, { color: ink }]}>Profile information</Text>
      <Text style={[sheet.helper, { color: muted }]}>Update your name and email across web and mobile.</Text>
      {loading ? <ActivityIndicator color="#20b987" /> : null}
      {user ? <>
        <Text style={[sheet.label, { color: ink }]}>First name</Text>
        <TextInput accessibilityLabel="First name" autoCapitalize="words" maxLength={150} onChangeText={value => { setFirstName(value); setSuccess(""); }} style={[sheet.input, { backgroundColor: input, borderColor: border, color: ink }]} value={firstName} />
        <Text style={[sheet.label, { color: ink }]}>Last name</Text>
        <TextInput accessibilityLabel="Last name" autoCapitalize="words" maxLength={150} onChangeText={value => { setLastName(value); setSuccess(""); }} style={[sheet.input, { backgroundColor: input, borderColor: border, color: ink }]} value={lastName} />
        <Text style={[sheet.label, { color: ink }]}>Username</Text>
        <View style={[sheet.input, sheet.readOnly, { backgroundColor: input, borderColor: border }]}><Text selectable style={{ color: muted }}>{username}</Text><MaterialCommunityIcons name="lock-outline" size={17} color={muted} /></View>
        <Text style={[sheet.label, { color: ink }]}>Email address</Text>
        <TextInput accessibilityLabel="Email address" autoCapitalize="none" autoComplete="email" keyboardType="email-address" onChangeText={value => { setEmail(value); setSuccess(""); }} style={[sheet.input, { backgroundColor: input, borderColor: border, color: ink }]} value={email} />
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !dirty || saving }} disabled={!dirty || saving} onPress={() => void save()} style={[sheet.save, (!dirty || saving) && sheet.disabled]}>
          {saving ? <ActivityIndicator color="#073727" /> : <Text style={sheet.saveText}>Save profile</Text>}
        </Pressable>
      </> : null}
      {error ? <Text accessibilityRole="alert" style={sheet.error}>{error}</Text> : null}
      {success ? <Text accessibilityRole="alert" style={sheet.success}>{success}</Text> : null}
    </View>
    <Pressable accessibilityRole="button" onPress={onSignOut} style={[sheet.signOut, { backgroundColor: surface, borderColor: border }]}><MaterialCommunityIcons name="logout" size={20} color={ink} /><Text style={[sheet.signOutText, { color: ink }]}>Sign out</Text></Pressable>
  </View>;
}

const sheet = StyleSheet.create({
  stack: { gap: 18, paddingBottom: 26 },
  pageTitle: { fontSize: 28, fontWeight: "800", letterSpacing: -0.8 },
  subtitle: { fontSize: 14, marginTop: 4 },
  hero: { alignItems: "center", borderRadius: 24, borderWidth: 1, gap: 5, overflow: "hidden", padding: 25 },
  heroGlow: { backgroundColor: "#73dec0", borderRadius: 90, height: 130, opacity: 0.14, position: "absolute", right: -15, top: -65, width: 130 },
  avatar: { alignItems: "center", borderRadius: 36, height: 72, justifyContent: "center", marginBottom: 7, width: 72 },
  avatarText: { color: "#0c7054", fontSize: 24, fontWeight: "800" },
  heroName: { fontSize: 22, fontWeight: "800", textAlign: "center" },
  heroMeta: { fontSize: 14, textAlign: "center" },
  card: { borderRadius: 20, borderWidth: 1, gap: 10, padding: 19 },
  sectionTitle: { fontSize: 19, fontWeight: "800" },
  helper: { fontSize: 13, lineHeight: 19, marginBottom: 7 },
  options: { flexDirection: "row", gap: 8 },
  option: { alignItems: "center", borderRadius: 12, borderWidth: 1, flex: 1, gap: 5, justifyContent: "center", minHeight: 72, padding: 6 },
  optionLabel: { fontSize: 12, fontWeight: "700" },
  label: { fontSize: 13, fontWeight: "700", marginTop: 5 },
  input: { borderRadius: 11, borderWidth: 1, fontSize: 16, minHeight: 48, paddingHorizontal: 13, paddingVertical: 10 },
  readOnly: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  save: { alignItems: "center", backgroundColor: "#4cdda7", borderRadius: 12, justifyContent: "center", minHeight: 50, marginTop: 12 },
  saveText: { color: "#073727", fontSize: 15, fontWeight: "800" },
  disabled: { opacity: 0.48 },
  error: { color: "#d2465c", fontSize: 13 },
  success: { color: "#188568", fontSize: 13, fontWeight: "700" },
  signOut: { alignItems: "center", borderRadius: 15, borderWidth: 1, flexDirection: "row", gap: 10, justifyContent: "center", minHeight: 52 },
  signOutText: { fontSize: 15, fontWeight: "700" }
});
