import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";

import { checkHealth, getApiBaseUrl, type HealthResult } from "./src/api";

type ViewState = "idle" | "loading" | "success" | "error";

export default function App() {
  const [result, setResult] = useState<HealthResult | null>(null);
  const [state, setState] = useState<ViewState>("idle");

  const loadHealth = async () => {
    setState("loading");
    const nextResult = await checkHealth();
    setResult(nextResult);
    setState(nextResult.ok ? "success" : "error");
  };

  useEffect(() => {
    void loadHealth();
  }, []);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.card}>
        <Text style={styles.title}>Finance Mobile</Text>
        <Text style={styles.subtitle}>Phase 1 health check</Text>
        <Text style={styles.meta}>API: {getApiBaseUrl()}</Text>

        {state === "loading" ? (
          <View style={styles.statusRow}>
            <ActivityIndicator />
            <Text style={styles.statusText}>Checking backend...</Text>
          </View>
        ) : null}

        {state === "success" ? (
          <Text style={styles.okText}>Backend status: {result?.status?.toUpperCase()}</Text>
        ) : null}

        {state === "error" ? (
          <Text style={styles.errorText}>Health check failed: {result?.error ?? "Unknown error"}</Text>
        ) : null}

        <Pressable onPress={loadHealth} style={styles.button}>
          <Text style={styles.buttonText}>Retry Health Check</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: "#0f766e",
    borderRadius: 8,
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center"
  },
  card: {
    backgroundColor: "#ffffff",
    borderColor: "#cbd5e1",
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    padding: 20,
    width: "100%"
  },
  errorText: {
    color: "#b91c1c",
    fontSize: 14
  },
  meta: {
    color: "#334155",
    fontSize: 13
  },
  okText: {
    color: "#065f46",
    fontSize: 14,
    fontWeight: "600"
  },
  screen: {
    alignItems: "center",
    backgroundColor: "#f8fafc",
    flex: 1,
    justifyContent: "center",
    padding: 20
  },
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8
  },
  statusText: {
    color: "#0f172a",
    fontSize: 14
  },
  subtitle: {
    color: "#334155",
    fontSize: 15
  },
  title: {
    color: "#0f172a",
    fontSize: 22,
    fontWeight: "700"
  }
});
