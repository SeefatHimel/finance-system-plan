import { useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { formatTimestamp } from "../../finance-contracts/presentation";
export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#081421" },
  content: { padding: 16, gap: 14 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  header: {
    padding: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderColor: "#294158",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { color: "#f6f8fc", fontSize: 22, fontWeight: "700", flexShrink: 1 },
  text: { color: "#e7eef7", fontSize: 16, lineHeight: 24 },
  muted: { color: "#a8b8cc", fontSize: 14, lineHeight: 21 },
  error: { color: "#ffb6b6", fontSize: 15, lineHeight: 23 },
  input: {
    backgroundColor: "#0a1725",
    borderColor: "#294158",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    minHeight: 48,
    color: "#f6f8fc",
    fontSize: 16,
  },
  button: {
    minHeight: 48,
    padding: 12,
    borderRadius: 8,
    borderColor: "#294158",
    borderWidth: 1,
    backgroundColor: "#153747",
    justifyContent: "center",
    flexShrink: 1,
  },
  primary: { backgroundColor: "#55e6a5", borderColor: "#55e6a5" },
  selected: { backgroundColor: "#12382f", borderColor: "#55e6a5" },
  card: {
    padding: 14,
    gap: 8,
    backgroundColor: "#0e1c2c",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#294158",
  },
  footer: {
    padding: 16,
    gap: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    borderTopWidth: 1,
    borderColor: "#294158",
  },
});
export function ActionButton({
  label,
  text,
  onPress,
  primary = false,
  disabled = false,
}: {
  label: string;
  text?: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[ui.button, primary && ui.primary, disabled && { opacity: 0.5 }]}
    >
      <Text
        style={[
          ui.text,
          { fontWeight: "700", color: primary ? "#08261d" : "#e7eef7" },
        ]}
      >
        {text ?? label}
      </Text>
    </Pressable>
  );
}
export function InputField({
  label,
  ...props
}: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={ui.muted}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#91a7c2"
        {...props}
        style={[ui.input, props.style]}
      />
    </View>
  );
}
export type SelectOption = { id: string; name: string; detail?: string };
export function SearchSelect({
  label,
  value,
  options,
  onChange,
  emptyLabel,
  disabled = false,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  emptyLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const selected =
    options.find((item) => item.id === value)?.name ??
    (value
      ? "Unavailable — choose another"
      : (emptyLabel ?? "Choose an option"));
  function close() {
    setOpen(false);
  }
  return (
    <View style={{ gap: 6 }}>
      <Text style={ui.muted}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected}`}
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        style={ui.button}
        onPress={() => {
          setQuery("");
          setOpen(true);
        }}
      >
        <Text style={ui.text}>{selected} ▾</Text>
      </Pressable>
      {open ? (
        <Modal visible animationType="slide" onRequestClose={close}>
          <SafeAreaView style={ui.screen}>
            <View style={ui.header}>
              <Text accessibilityRole="header" style={ui.title}>
                {label}
              </Text>
              <ActionButton
                label={`Cancel ${label.toLowerCase()}`}
                onPress={close}
              />
            </View>
            <View style={{ padding: 16 }}>
              <InputField
                label={`Search ${label.toLowerCase()}`}
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
                maxLength={256}
              />
            </View>
            <FlatList
              keyboardShouldPersistTaps="handled"
              data={[
                ...(emptyLabel ? [{ id: "", name: emptyLabel }] : []),
                ...options,
              ].filter((item) =>
                `${item.name} ${item.detail ?? ""}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )}
              keyExtractor={(item) => item.id}
              contentContainerStyle={ui.content}
              ListEmptyComponent={
                <Text style={ui.muted}>No matching options.</Text>
              }
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityLabel={item.name}
                  accessibilityState={{ checked: item.id === value }}
                  style={[ui.button, item.id === value && ui.selected]}
                  onPress={() => {
                    onChange(item.id);
                    close();
                  }}
                >
                  <Text style={ui.text}>
                    {item.id === value ? "✓ " : ""}
                    {item.name}
                  </Text>
                  {item.detail ? (
                    <Text style={ui.muted}>{item.detail}</Text>
                  ) : null}
                </Pressable>
              )}
            />
          </SafeAreaView>
        </Modal>
      ) : null}
    </View>
  );
}
export function SourceMessage({
  message,
}: {
  message: {
    sender: string;
    received_at: string;
    body: string | null;
    redacted_at?: string | null;
  };
}) {
  const [open, setOpen] = useState(false);
  const body =
    message.redacted_at || !message.body
      ? "Original SMS is unavailable or was removed by your retention choice."
      : message.body;
  return (
    <View style={ui.card}>
      <Text style={ui.muted}>
        {message.sender} · {formatTimestamp(message.received_at)}
      </Text>
      <Text numberOfLines={3} style={ui.text}>
        {body}
      </Text>
      <ActionButton label="View full SMS" onPress={() => setOpen(true)} />
      {open ? (
        <Modal
          visible
          animationType="slide"
          onRequestClose={() => setOpen(false)}
        >
          <SafeAreaView style={ui.screen}>
            <View style={ui.header}>
              <Text accessibilityRole="header" style={ui.title}>
                Original SMS
              </Text>
              <ActionButton
                label="Close original SMS"
                onPress={() => setOpen(false)}
              />
            </View>
            <ScrollView contentContainerStyle={ui.content}>
              <Text style={ui.muted}>
                {message.sender} · {formatTimestamp(message.received_at)}
              </Text>
              <Text selectable style={ui.text}>
                {body}
              </Text>
            </ScrollView>
          </SafeAreaView>
        </Modal>
      ) : null}
    </View>
  );
}
export function ModalFrame({
  title,
  busy,
  onClose,
  children,
  footer,
}: {
  title: string;
  busy: boolean;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <SafeAreaView style={ui.screen}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          enabled={Platform.OS === "ios"}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={ui.header}>
            <Text accessibilityRole="header" style={ui.title}>
              {title}
            </Text>
            <ActionButton
              label={`Close ${title.toLowerCase()}`}
              onPress={onClose}
              disabled={busy}
            />
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={ui.content}
          >
            {children}
          </ScrollView>
          <View style={ui.footer}>{footer}</View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
