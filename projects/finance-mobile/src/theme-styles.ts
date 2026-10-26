import { StyleSheet } from "react-native";

const backgrounds: Record<string, string> = {
  "#06141f": "#edf6f2", "#081421": "#f5f9f7", "#091724": "#f5f9f7",
  "#0a1725": "#ffffff", "#0b1a29": "#ffffff", "#0e1c2c": "#ffffff",
  "#0d1c2b": "#ffffff", "#081521": "#ffffff",
  "#102238": "#ffffff", "#12382f": "#e3f5ec", "#132437": "#eaf3ef",
  "#132a3b": "#e1f1ea", "#153747": "#e1f1ea", "#173046": "#e1f1ea",
  "#183344": "#e1f1ea", "#321f27": "#fbe9eb",
  "#2b2414": "#fff4de"
};
const foregrounds: Record<string, string> = {
  "#f5f8fc": "#142b36", "#f6f8fc": "#142b36", "#f8fafc": "#142b36", "#ffffff": "#142b36", "white": "#142b36",
  "#e7eef7": "#213846", "#dce8f6": "#213846", "#cce8ec": "#213846", "#d8e3f0": "#213846", "#cbd5e1": "#506976",
  "#91a7c2": "#607782", "#9eb0c7": "#607782", "#a8b8cc": "#607782", "#a9bad0": "#607782",
  "#7890ad": "#607782", "#647b98": "#607782", "#55e6a5": "#117e5d",
  "#32d8f2": "#087b8c", "#ff9399": "#b82946", "#ff7d84": "#b82946",
  "#b9ead5": "#188465", "#ffb6b6": "#b82946"
};
const borders: Record<string, string> = {
  "#1c3046": "#dbe7e3", "#263a52": "#d6e4e0", "#294158": "#d6e4e0", "#2a4059": "#d6e4e0",
  "#2b4159": "#d6e4e0", "#2e6571": "#afcfcb", "#6a3440": "#f2b9c3"
};

/** The older planning tools were authored on white cards. Keep their light palette,
 * while translating those surfaces into the same navy system as the rest of the app. */
export function darkenLegacyMobileStyles<T extends Record<string, object>>(light: T): T {
  const background: Record<string, string> = {
    "#ffffff": "#0e1c2c", "#f8fafc": "#102238", "#ecfdf5": "#12382f",
    "#fffbeb": "#2b2414", "#e2e8f0": "#173046", "#dcfce7": "#12382f",
    "#fef3c7": "#2b2414",
  };
  const foreground: Record<string, string> = {
    "#0f172a": "#f6f8fc", "#334155": "#a8b8cc", "#475569": "#91a7c2",
    "#065f46": "#55e6a5", "#166534": "#55e6a5", "#92400e": "#ffc46b",
  };
  const entries = Object.entries(light).map(([name, style]) => [name,
    Object.fromEntries(Object.entries(StyleSheet.flatten?.(style) ?? style).map(([property, value]) => {
      if (typeof value !== "string") return [property, value];
      const color = value.toLowerCase();
      if (property === "backgroundColor") return [property, background[color] ?? value];
      if (property === "color") return [property, foreground[color] ?? value];
      if (property === "borderColor") return [property, color === "#cbd5e1" ? "#294158" : value];
      return [property, value];
    }))]);
  return StyleSheet.create(Object.fromEntries(entries)) as T;
}

export function lightMobileStyles<T extends Record<string, object>>(dark: T): T {
  const entries = Object.entries(dark).map(([name, style]) => {
    const light = Object.fromEntries(Object.entries(StyleSheet.flatten?.(style) ?? style).map(([property, value]) => {
      if (typeof value !== "string") return [property, value];
      const normalized = value.toLowerCase();
      if (property === "backgroundColor") return [property, backgrounds[normalized] ?? value];
      if (property === "borderColor" || property === "borderBottomColor" || property === "borderTopColor") return [property, borders[normalized] ?? value];
      if (property === "color") return [property, foregrounds[normalized] ?? value];
      return [property, value];
    }));
    return [name, light];
  });
  return StyleSheet.create(Object.fromEntries(entries)) as T;
}
