import { useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
/** Keep optional controls mounted so opening help never resets a draft. */
export function Disclosure({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={label}
        onPress={() => setOpen((value) => !value)}
        style={{
          minHeight: 48,
          justifyContent: "center",
          padding: 12,
          borderRadius: 8,
          backgroundColor: "#153747",
        }}
      >
        <Text style={{ color: "#dce8f6", fontWeight: "700" }}>
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
