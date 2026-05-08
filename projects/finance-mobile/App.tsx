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
  createTransaction,
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
  const [txAccountId, setTxAccountId] = useState("");
  const [txCategoryId, setTxCategoryId] = useState("");
  const [txDate, setTxDate] = useState(new Date().toISOString().slice(0, 10));
  const [txType, setTxType] = useState("expense");
  const [txAmount, setTxAmount] = useState("");
  const [txNote, setTxNote] = useState("");
  const [txState, setTxState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [txMessage, setTxMessage] = useState("");

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
      if (!txAccountId && nextAccounts.length > 0) {
        setTxAccountId(nextAccounts[0].id);
      }
      if (!txCategoryId && nextCategories.length > 0) {
        setTxCategoryId(nextCategories[0].id);
      }
      setDataState("ok");
      setDataMessage(
        `Loaded ${nextAccounts.length} account(s) and ${nextCategories.length} categor${nextCategories.length === 1 ? "y" : "ies"}.`
      );
    } catch (error) {
      setDataState("error");
      setDataMessage(error instanceof Error ? error.message : "Could not load accounts/categories.");
    }
  };

  const handleQuickAddTransaction = async () => {
    if (!accessToken.trim()) {
      setTxState("error");
      setTxMessage("Sign in first or paste a valid access token.");
      return;
    }

    if (!txAccountId.trim() || !txDate.trim() || !txType.trim() || !txAmount.trim()) {
      setTxState("error");
      setTxMessage("Account, date, type, and amount are required.");
      return;
    }

    setTxState("loading");
    setTxMessage("");

    try {
      await createTransaction(accessToken.trim(), {
        account: txAccountId.trim(),
        amount: txAmount.trim(),
        category: txCategoryId.trim() || undefined,
        date: txDate.trim(),
        note: txNote.trim(),
        type: txType.trim()
      });
      setTxState("ok");
      setTxMessage("Transaction created.");
      setTxAmount("");
      setTxNote("");
    } catch (error) {
      setTxState("error");
      setTxMessage(error instanceof Error ? error.message : "Could not create transaction.");
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
                <Pressable key={account.id} onPress={() => setTxAccountId(account.id)}>
                  <Text style={styles.listItem}>
                    {account.name} ({account.type})
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {categories.length ? (
            <View style={styles.listSection}>
              <Text style={styles.listTitle}>Categories</Text>
              {categories.map((category) => (
                <Pressable key={category.id} onPress={() => setTxCategoryId(category.id)}>
                  <Text style={styles.listItem}>
                    {category.name} ({category.kind})
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <Text style={styles.sectionTitle}>Quick Add Transaction</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setTxAccountId}
            placeholder="Account ID"
            style={styles.input}
            value={txAccountId}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setTxCategoryId}
            placeholder="Category ID (optional)"
            style={styles.input}
            value={txCategoryId}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setTxDate}
            placeholder="Date (YYYY-MM-DD)"
            style={styles.input}
            value={txDate}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setTxType}
            placeholder="Type (expense/income/transfer...)"
            style={styles.input}
            value={txType}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="decimal-pad"
            onChangeText={setTxAmount}
            placeholder="Amount (e.g. 1200.00)"
            style={styles.input}
            value={txAmount}
          />
          <TextInput
            autoCapitalize="sentences"
            onChangeText={setTxNote}
            placeholder="Note (optional)"
            style={styles.input}
            value={txNote}
          />
          <Pressable onPress={handleQuickAddTransaction} style={styles.button}>
            <Text style={styles.buttonText}>Create Transaction</Text>
          </Pressable>

          {txState === "loading" ? <ActivityIndicator /> : null}
          {txState === "ok" ? <Text style={styles.okText}>{txMessage}</Text> : null}
          {txState === "error" ? <Text style={styles.errorText}>{txMessage}</Text> : null}
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
