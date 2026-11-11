import { useEffect, useState } from "react";
import { AccessibilityInfo, LayoutAnimation, Platform, UIManager } from "react-native";

let androidLayoutAnimationEnabled = false;

/** Animate a user-requested disclosure only; avoid motion when the OS requests less. */
export function animateDisclosureChange(reduceMotion: boolean) {
  if (reduceMotion || !LayoutAnimation?.configureNext) return;
  if (Platform.OS === "android" && !androidLayoutAnimationEnabled) {
    UIManager?.setLayoutAnimationEnabledExperimental?.(true);
    androidLayoutAnimationEnabled = true;
  }
  LayoutAnimation.configureNext({
    duration: 180,
    create: { type: "easeInEaseOut", property: "opacity" },
    update: { type: "easeInEaseOut" },
    delete: { type: "easeInEaseOut", property: "opacity" },
  });
}

export function useReduceMotion() {
  // An unknown preference starts without animation until the OS responds.
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    if (!AccessibilityInfo?.isReduceMotionEnabled) return;
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (active) setReduceMotion(value);
    }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener?.("reduceMotionChanged", setReduceMotion);
    return () => { active = false; subscription?.remove(); };
  }, []);
  return reduceMotion;
}
