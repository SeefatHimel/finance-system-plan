import { Children, useState, type ReactNode } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { NativeDateField, NativeTimeField } from "./native-time-field";
import { useMobileUi } from "./mobile-ui";

/** Change only cell widths: never reparent fields when layout or font size changes. */
export function CompactFields({ children, minFieldWidth = 260, maxColumns = 3, gap = 12 }: {
  children: ReactNode;
  minFieldWidth?: number;
  maxColumns?: number;
  gap?: number;
}) {
  const [width, setWidth] = useState(0);
  const { fontScale } = useWindowDimensions();
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

export function CompactDateTime({ date, time, disabled, onDate, onTime, dense = false }: {
  date: string;
  time: string;
  disabled?: boolean;
  dense?: boolean;
  onDate: (date: string) => void;
  onTime: (time: string) => void;
}) {
  const ui = useMobileUi();
  return <CompactFields minFieldWidth={180} maxColumns={2} gap={dense ? 8 : 12}>
    <View key="date" style={{ gap: dense ? 4 : 6 }}>
      <Text style={[ui.muted, dense && { fontSize: 12, lineHeight: 17 }]}>Date</Text>
      <NativeDateField compact smallText={dense} disabled={disabled} label="Transaction date" value={date} onChange={onDate} />
    </View>
    <View key="time" style={{ gap: dense ? 4 : 6 }}>
      <Text style={[ui.muted, dense && { fontSize: 12, lineHeight: 17 }]}>Time</Text>
      <NativeTimeField compact smallText={dense} disabled={disabled} label="Transaction time" value={time} onChange={onTime} />
    </View>
  </CompactFields>;
}
