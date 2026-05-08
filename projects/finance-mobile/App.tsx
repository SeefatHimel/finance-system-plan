import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";

import {
  checkHealth,
  getApiBaseUrl,
  getCurrentUser,
  listAccounts,
  listCategories,
  login,
  type Account,
  type Category,
  type HealthResult
} from "./src/api";

type ViewState = "idle" | "loading" | "success" | "error";

export default function App() {
  const [result, setResult] = useState<HealthResult | null>(null);
  const [state, setState] = useState<ViewState>("idle");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [authState, setAuthState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [authMessage, setAuthMessage] = useState("");
  const [dataState, setDataState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [dataMessage, setDataMessage] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const loadHealth = async () => {
    setState("loading");
    const nextResult = await checkHealth();
    setResult(nextResult);
    setState(nextResult.ok ? "success" : "error");
  };

  const handleLogin = async () => {
    setAuthState("loading");
    setAuthMessage("");

    try {
      const tokens = await login(username.trim(), password);
      setAccessToken(tokens.access);
      setRefreshToken(tokens.refresh);
      setAuthState("ok");
      setAuthMessage("Login successful. Tokens received.");
    } catch (error) {
      setAuthState("error");
      setAuthMessage(error instanceof Error ? error.message : "Login failed.");
    }
  };

  const handleTokenValidation = async () => {
    if (!accessToken.trim()) {
      setAuthState("error");
      setAuthMessage("Enter or generate an access token first.");
      return;
    }

    setAuthState("loading");
    setAuthMessage("");

    try {
      const user = await getCurrentUser(accessToken.trim());
      setAuthState("ok");
      setAuthMessage(`Authenticated as ${user.username}.`);
    } catch (error) {
      setAuthState("error");
      setAuthMessage(error instanceof Error ? error.message : "Token check failed.");
    }
  };

  const handleLoadReferenceData = async () => {
    if (!accessToken.trim()) {
      setDataState("error");
      setDataMessage("Sign in first or paste a valid access token.");
      return;
    }

    setDataState("loading");
    setDataMessage("");

    try {
      const [nextAccounts, nextCategories] = await Promise.all([
        listAccounts(accessToken.trim()),
        listCategories(accessToken.trim())
      ]);
      setAccounts(nextAccounts);
      setCategories(nextCategories);
      setDataState("ok");
      setDataMessage(
        `Loaded ${nextAccounts.length} account(s) and ${nextCategories.length} categor${nextCategories.length === 1 ? "y" : "ies"}.`
      );
    } catch (error) {
      setDataState("error");
      setDataMessage(error instanceof Error ? error.message : "Could not load accounts/categories.");
    }
  };

  useEffect(() => {
    void loadHealth();
  }, []);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.title}>Finance Mobile</Text>
          <Text style={styles.subtitle}>Phase 1 backend connection</Text>
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

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Login (JWT)</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setUsername}
            placeholder="Username"
            style={styles.input}
            value={username}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setPassword}
            placeholder="Password"
            secureTextEntry
            style={styles.input}
            value={password}
          />
          <Pressable onPress={handleLogin} style={styles.button}>
            <Text style={styles.buttonText}>Sign In</Text>
          </Pressable>

          <Text style={styles.sectionTitle}>Access Token</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            onChangeText={setAccessToken}
            placeholder="Paste access token for testing /api/auth/me/"
            style={styles.inputMultiline}
            value={accessToken}
          />
          <Pressable onPress={handleTokenValidation} style={styles.buttonSecondary}>
            <Text style={styles.buttonText}>Validate Token</Text>
          </Pressable>

          {refreshToken ? <Text style={styles.meta}>Refresh token received.</Text> : null}
          {authState === "loading" ? <ActivityIndicator /> : null}
          {authState === "ok" ? <Text style={styles.okText}>{authMessage}</Text> : null}
          {authState === "error" ? <Text style={styles.errorText}>{authMessage}</Text> : null}

          <Text style={styles.sectionTitle}>Reference Data</Text>
          <Pressable onPress={handleLoadReferenceData} style={styles.buttonSecondary}>
            <Text style={styles.buttonText}>Load Accounts & Categories</Text>
          </Pressable>

          {dataState === "loading" ? <ActivityIndicator /> : null}
          {dataState === "ok" ? <Text style={styles.okText}>{dataMessage}</Text> : null}
          {dataState === "error" ? <Text style={styles.errorText}>{dataMessage}</Text> : null}

          {accounts.length ? (
            <View style={styles.listSection}>
              <Text style={styles.listTitle}>Accounts</Text>
              {accounts.map((account) => (
                <Text key={account.id} style={styles.listItem}>
                  {account.name} ({account.type})
                </Text>
              ))}
            </View>
          ) : null}

          {categories.length ? (
            <View style={styles.listSection}>
              <Text style={styles.listTitle}>Categories</Text>
              {categories.map((category) => (
                <Text key={category.id} style={styles.listItem}>
                  {category.name} ({category.kind})
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>
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
  content: {
    gap: 14,
    padding: 20
  },
  errorText: {
    color: "#b91c1c",
    fontSize: 14
  },
  input: {
    backgroundColor: "#ffffff",
    borderColor: "#cbd5e1",
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  inputMultiline: {
    backgroundColor: "#ffffff",
    borderColor: "#cbd5e1",
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 12,
    minHeight: 84,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: "top"
  },
  meta: {
    color: "#334155",
    fontSize: 13
  },
  listItem: {
    color: "#0f172a",
    fontSize: 13
  },
  listSection: {
    gap: 4,
    marginTop: 8
  },
  listTitle: {
    color: "#0f172a",
    fontSize: 14,
    fontWeight: "700"
  },
  okText: {
    color: "#065f46",
    fontSize: 14,
    fontWeight: "600"
  },
  screen: {
    backgroundColor: "#f8fafc",
    flex: 1,
    width: "100%"
  },
  sectionTitle: {
    color: "#0f172a",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 6
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
  buttonSecondary: {
    backgroundColor: "#0369a1",
    borderRadius: 8,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  title: {
    color: "#0f172a",
    fontSize: 22,
    fontWeight: "700"
  }
});
