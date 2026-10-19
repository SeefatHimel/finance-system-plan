import AsyncStorage from "@react-native-async-storage/async-storage";

export type ThemePreference = "system" | "light" | "dark";

const key = "finance.mobile.theme.v1";

export async function loadThemePreference(): Promise<ThemePreference> {
  const stored = await AsyncStorage.getItem(key);
  return stored === "light" || stored === "dark" ? stored : "system";
}

export async function saveThemePreference(preference: ThemePreference): Promise<void> {
  await AsyncStorage.setItem(key, preference);
}
