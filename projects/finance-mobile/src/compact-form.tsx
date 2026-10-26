import { Children, useState, type ReactNode } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { NativeDateField, NativeTimeField } from "./native-time-field";
import { useMobileUi } from "./mobile-ui";

/** Change only cell widths: never reparent fields when layout or font size changes. */
export function CompactFields({ children, minFieldWidth = 260, maxColumns = 3 }: {
  children: ReactNode;
  minFieldWidth?: number;
  maxColumns?: number;
}) {
  const [width, setWidth] = useState(0);
  const { fontScale } = useWindowDimensions();
  const gap = 12;
  const columns = Math.max(1, Math.min(maxColumns,
    Math.floor((width + gap) / (minFieldWidth * Math.max(1, fontScale) + gap))));
  const cellWidth = width > 0 ? (width - gap * (columns - 1)) / columns : "100%";
  return <View onLayout={event => {
    const next = event.nativeEvent.layout.width;
    if (Number.isFinite(next) && next > 0) setWidth(current => Math.abs(current - next) > 1 ? next : current);
  }} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap }}>
    {Children.toArray(children).map(child => <View key={(child as { key?: string }).key}
      style={{ width: cellWidth, minWidth: 0, gap: 8 }}>{child}</View>)}
  </View>;
}

export function CompactDateTime({ date, time, disabled, onDate, onTime }: {
  date: string;
  time: string;
  disabled?: boolean;
  onDate: (date: string) => void;
  onTime: (time: string) => void;
}) {
  const ui = useMobileUi();
  return <CompactFields minFieldWidth={180} maxColumns={2}>
    <View key="date" style={{ gap: 6 }}>
      <Text style={ui.muted}>Date</Text>
      <NativeDateField compact disabled={disabled} label="Transaction date" value={date} onChange={onDate} />
    </View>
    <View key="time" style={{ gap: 6 }}>
      <Text style={ui.muted}>Time</Text>
      <NativeTimeField compact disabled={disabled} label="Transaction time" value={time} onChange={onTime} />
    </View>
  </CompactFields>;
}
