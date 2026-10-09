import { useEffect, useRef } from "react";
import { Pressable, type PressableProps } from "react-native";

import { TapGesture } from "./tap-gesture";

type ChoicePressableProps = Omit<PressableProps, "onTouchStart" | "onTouchMove" | "onTouchEnd" | "onTouchCancel">;

/** Settings choices accept taps while leaving scrolling to the parent view. */
export function ChoicePressable({ onPress, ...props }: ChoicePressableProps) {
  const gesture = useRef<TapGesture | null>(null);
  if (!gesture.current) gesture.current = new TapGesture();
  const endTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (endTimer.current !== null) clearTimeout(endTimer.current);
    endTimer.current = null;
  };

  useEffect(() => () => {
    if (endTimer.current !== null) clearTimeout(endTimer.current);
  }, []);

  return (
    <Pressable
      {...props}
      cancelable
      onTouchStart={event => {
        clearTimer();
        gesture.current!.begin(event.nativeEvent);
      }}
      onTouchMove={event => gesture.current!.move(event.nativeEvent)}
      onTouchCancel={() => {
        clearTimer();
        gesture.current!.reset();
      }}
      onTouchEnd={() => {
        // onPress runs during release dispatch; clear cancelled gestures after it
        // so later accessibility/keyboard activation isn't blocked by an old drag.
        clearTimer();
        endTimer.current = setTimeout(() => gesture.current!.reset(), 0);
      }}
      onPress={event => {
        clearTimer();
        if (gesture.current!.finish(event.nativeEvent)) onPress?.(event);
      }}
    />
  );
}
