import { useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useLightAppearance } from "./mobile-theme";
/** Keep optional controls mounted so opening help never resets a draft. */
export function Disclosure({
  label,
  children,
  revealKey,
}: {
  label: string;
  children: ReactNode;
  revealKey?: string;
}) {
  const isLight = useLightAppearance();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (revealKey) setOpen(true); }, [revealKey]);
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={label}
        onPress={() => setOpen((value) => !value)}
        style={{ minHeight: 48, justifyContent: "center", padding: 12, borderRadius: 8,
          backgroundColor: isLight ? "#e1f1ea" : "#153747" }}
      >
        <Text style={{ color: isLight ? "#213846" : "#dce8f6", fontWeight: "700" }}>
          {open ? "▾" : "▸"} {label}
        </Text>
      </Pressable>
      <View
        style={{ display: open ? "flex" : "none", gap: 8 }}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? "auto" : "no-hide-descendants"}
      >
        {children}
      </View>
    </View>
  );
}
