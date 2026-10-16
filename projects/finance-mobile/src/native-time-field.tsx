import { useState } from "react";
import {
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  Modal,
} from "react-native";
import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import {
  formatCalendarDate,
  presentationColors,
} from "../../finance-contracts/presentation";
import { localTime } from "../../finance-contracts/quick-add";

export function NativeTimeField({
  value,
  onChange,
  label,
}: {
  value: string;
  label?: string;
  onChange: (value: string) => void;
}) {
  const [ios, setIos] = useState<Date | null>(null);
  function open() {
    const date = new Date();
    if (/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value))
      date.setHours(Number(value.slice(0, 2)), Number(value.slice(3, 5)), 0, 0);
    if (Platform.OS === "android")
      DateTimePickerAndroid.open({
        value: date,
        mode: "time",
        display: "clock",
        is24Hour: true,
        onChange: (event, selected) => {
          if (event.type === "set" && selected) onChange(localTime(selected));
        },
      });
    else setIos(date);
  }
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          label ? `Choose ${label.toLowerCase()} on clock` : undefined
        }
        onPress={open}
        style={{
          backgroundColor: presentationColors.selected,
          borderRadius: 8,
          padding: 12,
          minHeight: 48,
          justifyContent: "center",
        }}
      >
        <Text style={{ color: presentationColors.accent, fontWeight: "700" }}>
          Choose time on clock
        </Text>
      </Pressable>
      <TextInput
        accessibilityLabel={`${label ?? "Exact time"} HH:MM`}
        value={value}
        onChangeText={onChange}
        keyboardType="numbers-and-punctuation"
        placeholder="HH:MM"
        placeholderTextColor="#91a7c2"
        style={{
          backgroundColor: "#0a1725",
          color: "white",
          borderWidth: 1,
          borderColor: "#294158",
          padding: 12,
          borderRadius: 8,
        }}
      />
      {ios ? (
        <Modal
          transparent
          animationType="slide"
          onRequestClose={() => setIos(null)}
        >
          <View
            style={{
              flex: 1,
              justifyContent: "center",
              padding: 20,
              backgroundColor: "#0009",
            }}
          >
            <View
              style={{
                backgroundColor: "#102238",
                padding: 20,
                borderRadius: 12,
              }}
            >
              <DateTimePicker
                value={ios}
                mode="time"
                display="spinner"
                themeVariant="dark"
                onChange={(_event, date) => {
                  if (date) setIos(date);
                }}
              />
              <Pressable
                accessibilityRole="button"
                style={{ minHeight: 48, justifyContent: "center" }}
                onPress={() => {
                  onChange(localTime(ios));
                  setIos(null);
                }}
              >
                <Text style={{ color: "#55e6a5", padding: 12 }}>
                  Apply time
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={{ minHeight: 48, justifyContent: "center" }}
                onPress={() => setIos(null)}
              >
                <Text style={{ color: "white", padding: 12 }}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

export function NativeDateField({
  value,
  onChange,
  label,
}: {
  value: string;
  label?: string;
  onChange: (value: string) => void;
}) {
  const [ios, setIos] = useState<Date | null>(null);
  function open() {
    const date =
      formatCalendarDate(value) !== "Unknown date"
        ? new Date(`${value}T12:00:00`)
        : new Date();
    const apply = (selected: Date) =>
      onChange(
        `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, "0")}-${String(selected.getDate()).padStart(2, "0")}`,
      );
    if (Platform.OS === "android")
      DateTimePickerAndroid.open({
        value: Number.isNaN(date.getTime()) ? new Date() : date,
        mode: "date",
        display: "calendar",
        onChange: (event, selected) => {
          if (event.type === "set" && selected) apply(selected);
        },
      });
    else setIos(Number.isNaN(date.getTime()) ? new Date() : date);
  }
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          label ? `Choose ${label.toLowerCase()} on calendar` : undefined
        }
        onPress={open}
        style={{
          backgroundColor: presentationColors.selected,
          borderRadius: 8,
          padding: 12,
          minHeight: 48,
          justifyContent: "center",
        }}
      >
        <Text style={{ color: presentationColors.accent, fontWeight: "700" }}>
          Choose date
          {formatCalendarDate(value) !== "Unknown date"
            ? ` · ${formatCalendarDate(value)}`
            : ""}
        </Text>
      </Pressable>
      <TextInput
        accessibilityLabel={`${label ?? "Exact date"} YYYY-MM-DD`}
        value={value}
        onChangeText={onChange}
        placeholder="YYYY-MM-DD"
        placeholderTextColor="#91a7c2"
        style={{
          backgroundColor: "#0a1725",
          color: "white",
          borderWidth: 1,
          borderColor: "#294158",
          padding: 12,
          borderRadius: 8,
        }}
      />
      {ios ? (
        <Modal transparent onRequestClose={() => setIos(null)}>
          <View
            style={{
              flex: 1,
              justifyContent: "center",
              padding: 20,
              backgroundColor: "#0009",
            }}
          >
            <View
              style={{
                backgroundColor: "#102238",
                padding: 20,
                borderRadius: 12,
              }}
            >
              <DateTimePicker
                value={ios}
                mode="date"
                display="spinner"
                themeVariant="dark"
                onChange={(_event, date) => {
                  if (date) setIos(date);
                }}
              />
              <Pressable
                accessibilityRole="button"
                style={{ minHeight: 48, justifyContent: "center" }}
                onPress={() => {
                  const date = ios;
                  onChange(
                    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
                  );
                  setIos(null);
                }}
              >
                <Text style={{ color: "#55e6a5", padding: 12 }}>
                  Apply date
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={{ minHeight: 48, justifyContent: "center" }}
                onPress={() => setIos(null)}
              >
                <Text style={{ color: "white", padding: 12 }}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}
