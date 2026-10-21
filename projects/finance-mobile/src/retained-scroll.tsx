import { useCallback, useLayoutEffect, useRef } from "react";
import { ScrollView, type ScrollViewProps, type NativeSyntheticEvent, type NativeScrollEvent } from "react-native";

type ScrollHandle = { scrollToOffset?: (options: { offset: number; animated: boolean }) => void; scrollTo?: (options: { y: number; animated: boolean }) => void };

/** Keep native layout stable, then restore after focus/layout or a filter change. */
export function useRetainedScroll<T extends ScrollHandle>(focused: boolean, identity = "workspace") {
  const ref = useRef<T>(null);
  const offsets = useRef(new Map<string, number>());
  const pending = useRef(true);
  const restore = useCallback(() => {
    if (!focused || !pending.current || !ref.current) return;
    const y = offsets.current.get(identity) ?? 0;
    if (ref.current.scrollToOffset) ref.current.scrollToOffset({ offset: y, animated: false });
    else ref.current.scrollTo?.({ y, animated: false });
  }, [focused, identity]);
  useLayoutEffect(() => {
    pending.current = true;
    if (!focused) return;
    let settled: number | undefined;
    const frame = requestAnimationFrame(() => {
      restore();
      // Ignore native clamp/restore events during layout, then accept keyboard
      // and accessibility scrolling too (which need not emit a drag event).
      settled = requestAnimationFrame(() => { pending.current = false; });
    });
    return () => { cancelAnimationFrame(frame); if (settled !== undefined) cancelAnimationFrame(settled); };
  }, [focused, identity, restore]);
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    // Hidden screens can emit layout-clamping events when the chrome changes.
    if (focused && !pending.current) offsets.current.set(identity, event.nativeEvent.contentOffset.y);
  };
  const onLayout = () => { restore(); };
  const onContentSizeChange = () => { restore(); };
  const onScrollBeginDrag = () => { pending.current = false; };
  return { ref, onScroll, onLayout, onContentSizeChange, onScrollBeginDrag };
}

export function WorkspaceScrollView({ focused, ...props }: ScrollViewProps & { focused: boolean }) {
  const scroll = useRetainedScroll<ScrollView>(focused);
  return <ScrollView {...props} {...scroll} scrollEventThrottle={16} />;
}
