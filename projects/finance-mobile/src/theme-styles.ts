import { StyleSheet } from "react-native";

const backgrounds: Record<string, string> = {
  "#06141f": "#edf6f2", "#081421": "#f5f9f7", "#091724": "#f5f9f7",
  "#0a1725": "#ffffff", "#0b1a29": "#ffffff", "#0e1c2c": "#ffffff",
  "#102238": "#ffffff", "#12382f": "#e3f5ec", "#132437": "#eaf3ef",
  "#153747": "#e1f1ea", "#173046": "#e1f1ea", "#321f27": "#fbe9eb",
  "#2b2414": "#fff4de"
};
const foregrounds: Record<string, string> = {
  "#f6f8fc": "#142b36", "#f8fafc": "#142b36", "#ffffff": "#142b36",
  "#e7eef7": "#213846", "#dce8f6": "#213846", "#cbd5e1": "#506976",
  "#91a7c2": "#607782", "#9eb0c7": "#607782", "#a9bad0": "#607782",
  "#7890ad": "#607782", "#647b98": "#607782", "#55e6a5": "#117e5d",
  "#32d8f2": "#087b8c", "#ff9399": "#b82946", "#ff7d84": "#b82946",
  "#b9ead5": "#188465"
};
const borders: Record<string, string> = {
  "#1c3046": "#dbe7e3", "#263a52": "#d6e4e0", "#294158": "#d6e4e0",
  "#2b4159": "#d6e4e0", "#2e6571": "#afcfcb", "#6a3440": "#f2b9c3"
};

export function lightMobileStyles<T extends Record<string, object>>(dark: T): T {
  const entries = Object.entries(dark).map(([name, style]) => {
    const light = Object.fromEntries(Object.entries(StyleSheet.flatten(style)).map(([property, value]) => {
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
