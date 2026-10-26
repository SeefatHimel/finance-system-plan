import { Text, View } from "react-native";

// These are in-app identifiers, not copies of bank or wallet trademarks.
// Match only explicit institution names; a custom account keeps its own initials.
export function institutionBadge(name: string, type?: string) {
  const normalized = name.trim().toLowerCase();
  if (/\bbkash\b|\bb\s*kash\b/.test(normalized)) return { label: "b", background: "#55223f", foreground: "#ffb9dc" };
  if (/\bnagad\b/.test(normalized)) return { label: "N", background: "#573622", foreground: "#ffd3a3" };
  if (/\brocket\b/.test(normalized)) return { label: "R", background: "#352952", foreground: "#d8c2ff" };
  if (/dutch[ -]?bangla|\bdbbl\b/.test(normalized)) return { label: "DB", background: "#352952", foreground: "#d8c2ff" };
  if (/\bebl\b|eastern bank/.test(normalized)) return { label: "EBL", background: "#173949", foreground: "#b4eafa" };
  if (/\bcity bank\b/.test(normalized)) return { label: "C", background: "#4b2b31", foreground: "#ffd1d7" };
  if (/\bbrac bank\b/.test(normalized)) return { label: "B", background: "#284957", foreground: "#c9f1f6" };
  if (type === "cash" || /\bcash\b/.test(normalized)) return { label: "cash", background: "#194536", foreground: "#b4f5d0" };
  const initials = name.trim().split(/\s+/).slice(0, 2).map(word => word[0]?.toUpperCase() ?? "").join("") || "?";
  return { label: initials, background: type === "wallet" ? "#303e54" : "#203a43", foreground: "#dbeef4" };
}

export function InstitutionMark({ name, type, size = 38 }: { name: string; type?: string; size?: number }) {
  const badge = institutionBadge(name, type);
  return <View accessibilityLabel={`${name} account`} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: badge.background, alignItems: "center", justifyContent: "center" }}>
    <Text style={{ color: badge.foreground, fontSize: badge.label.length > 2 ? size * 0.24 : size * 0.38, fontWeight: "800" }}>{badge.label === "cash" ? "৳" : badge.label}</Text>
  </View>;
}
