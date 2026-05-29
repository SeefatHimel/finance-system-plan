import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
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
  importRawMessage,
  listAccounts,
  listCategories,
  listPaymentMethods,
  listSenderRules,
  listTransactions,
  login,
  type Account,
  type Category,
  type HealthResult,
  type PaymentMethod,
  type SenderRule,
  type Transaction
} from "./src/api";

type ViewState = "idle" | "loading" | "success" | "error";
type SmsPermissionState = "unknown" | "checking" | "granted" | "denied";
type QueuedRawMessage = {
  body: string;
  deviceMessageId: string;
  id: string;
  receivedAt: string;
  sender: string;
};

const rawMessageQueueKey = "finance.rawMessageQueue";

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
  const [listState, setListState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [listMessage, setListMessage] = useState("");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [smsPermissionState, setSmsPermissionState] = useState<SmsPermissionState>("unknown");
  const [smsPermissionMessage, setSmsPermissionMessage] = useState(
    "Native SMS permission is not wired in this Expo scaffold yet."
  );
  const [smsSettingsState, setSmsSettingsState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [smsSettingsMessage, setSmsSettingsMessage] = useState("");
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [senderRules, setSenderRules] = useState<SenderRule[]>([]);
  const [enabledSenderRuleIds, setEnabledSenderRuleIds] = useState<string[]>([]);
  const [rawSender, setRawSender] = useState("");
  const [rawBody, setRawBody] = useState("");
  const [rawReceivedAt, setRawReceivedAt] = useState(new Date().toISOString());
  const [rawDeviceMessageId, setRawDeviceMessageId] = useState("");
  const [rawQueue, setRawQueue] = useState<QueuedRawMessage[]>([]);
  const [rawQueueState, setRawQueueState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [rawQueueMessage, setRawQueueMessage] = useState("");

  const loadHealth = async () => {
    setState("loading");
    const nextResult = await checkHealth();
    setResult(nextResult);
    setState(nextResult.ok ? "success" : "error");
  };

  const handleLoadTransactions = async () => {
    if (!accessToken.trim()) {
      setListState("error");
      setListMessage("Sign in first or paste a valid access token.");
      return;
    }

    setListState("loading");
    setListMessage("");
    try {
      const payload = await listTransactions(accessToken.trim());
      setTransactions(payload);
      setListState("ok");
      setListMessage(`Loaded ${payload.length} transaction(s).`);
    } catch (error) {
      setListState("error");
      setListMessage(error instanceof Error ? error.message : "Could not load transactions.");
    }
  };

  const handleRequestSmsPermission = () => {
    setSmsPermissionState("checking");
    setSmsPermissionMessage(
      "Permission gate reached. Add a native Android SMS permission module before reading inbox messages."
    );
    setSmsPermissionState("denied");
  };

  const handleLoadSmsSettings = async () => {
    if (!accessToken.trim()) {
      setSmsSettingsState("error");
      setSmsSettingsMessage("Sign in first or paste a valid access token.");
      return;
    }

    setSmsSettingsState("loading");
    setSmsSettingsMessage("");
    try {
      const [nextPaymentMethods, nextSenderRules] = await Promise.all([
        listPaymentMethods(accessToken.trim()),
        listSenderRules(accessToken.trim())
      ]);
      setPaymentMethods(nextPaymentMethods);
      setSenderRules(nextSenderRules);
      setEnabledSenderRuleIds((currentIds) =>
        currentIds.filter((ruleId) => nextSenderRules.some((rule) => rule.id === ruleId))
      );
      setSmsSettingsState("ok");
      setSmsSettingsMessage(
        `Loaded ${nextPaymentMethods.length} payment method(s) and ${nextSenderRules.length} sender rule(s).`
      );
    } catch (error) {
      setSmsSettingsState("error");
      setSmsSettingsMessage(error instanceof Error ? error.message : "Could not load SMS settings.");
    }
  };

  const handleToggleSenderRule = (senderRuleId: string) => {
    setEnabledSenderRuleIds((currentIds) => {
      if (currentIds.includes(senderRuleId)) {
        return currentIds.filter((id) => id !== senderRuleId);
      }
      return [...currentIds, senderRuleId];
    });
  };

  const saveRawQueue = async (nextQueue: QueuedRawMessage[]) => {
    setRawQueue(nextQueue);
    await AsyncStorage.setItem(rawMessageQueueKey, JSON.stringify(nextQueue));
  };

  const handleQueueRawMessage = async () => {
    if (!rawSender.trim() || !rawBody.trim() || !rawReceivedAt.trim()) {
      setRawQueueState("error");
      setRawQueueMessage("Sender, body, and received time are required.");
      return;
    }

    const queuedMessage: QueuedRawMessage = {
      body: rawBody.trim(),
      deviceMessageId: rawDeviceMessageId.trim(),
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      receivedAt: rawReceivedAt.trim(),
      sender: rawSender.trim()
    };

    try {
      await saveRawQueue([...rawQueue, queuedMessage]);
      setRawQueueState("ok");
      setRawQueueMessage("Raw message queued locally.");
      setRawBody("");
      setRawDeviceMessageId("");
      setRawReceivedAt(new Date().toISOString());
    } catch (error) {
      setRawQueueState("error");
      setRawQueueMessage(error instanceof Error ? error.message : "Could not save raw message.");
    }
  };

  const handleSyncRawQueue = async () => {
    if (!accessToken.trim()) {
      setRawQueueState("error");
      setRawQueueMessage("Sign in first or paste a valid access token.");
      return;
    }
    if (rawQueue.length === 0) {
      setRawQueueState("ok");
      setRawQueueMessage("No queued raw messages to sync.");
      return;
    }

    setRawQueueState("loading");
    setRawQueueMessage("");

    const remainingQueue: QueuedRawMessage[] = [];
    let syncedCount = 0;

    for (const queuedMessage of rawQueue) {
      try {
        await importRawMessage(accessToken.trim(), {
          body: queuedMessage.body,
          device_message_id: queuedMessage.deviceMessageId,
          received_at: queuedMessage.receivedAt,
          sender: queuedMessage.sender
        });
        syncedCount += 1;
      } catch {
        remainingQueue.push(queuedMessage);
      }
    }

    try {
      await saveRawQueue(remainingQueue);
      setRawQueueState(remainingQueue.length === 0 ? "ok" : "error");
      setRawQueueMessage(
        `Synced ${syncedCount} message(s). ${remainingQueue.length} message(s) remain queued.`
      );
    } catch (error) {
      setRawQueueState("error");
      setRawQueueMessage(error instanceof Error ? error.message : "Could not update local queue.");
    }
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
    AsyncStorage.getItem(rawMessageQueueKey)
      .then((storedQueue) => {
        if (storedQueue) {
          setRawQueue(JSON.parse(storedQueue) as QueuedRawMessage[]);
        }
      })
      .catch(() => {
        setRawQueueState("error");
        setRawQueueMessage("Could not load local raw message queue.");
      });
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

          <Text style={styles.sectionTitle}>Transactions</Text>
          <Pressable onPress={handleLoadTransactions} style={styles.buttonSecondary}>
            <Text style={styles.buttonText}>Load Transactions</Text>
          </Pressable>
          {listState === "loading" ? <ActivityIndicator /> : null}
          {listState === "ok" ? <Text style={styles.okText}>{listMessage}</Text> : null}
          {listState === "error" ? <Text style={styles.errorText}>{listMessage}</Text> : null}

          {transactions.length ? (
            <View style={styles.listSection}>
              {transactions.map((transaction) => (
                <Text key={transaction.id} style={styles.listItem}>
                  {transaction.date} | {transaction.type} | {transaction.amount} | {transaction.note || "No note"}
                </Text>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>SMS Tracking Settings</Text>
          <Text style={styles.meta}>
            Choose trusted backend sender rules before any future native SMS reader imports messages.
          </Text>

          <View style={styles.permissionBox}>
            <Text style={styles.listTitle}>Permission gate</Text>
            <Text style={styles.meta}>Status: {smsPermissionState}</Text>
            <Text style={styles.meta}>{smsPermissionMessage}</Text>
            <Pressable onPress={handleRequestSmsPermission} style={styles.buttonSecondary}>
              <Text style={styles.buttonText}>Check SMS Permission Scaffold</Text>
            </Pressable>
          </View>

          <Pressable onPress={handleLoadSmsSettings} style={styles.button}>
            <Text style={styles.buttonText}>Load Payment Methods & Sender Rules</Text>
          </Pressable>

          {smsSettingsState === "loading" ? <ActivityIndicator /> : null}
          {smsSettingsState === "ok" ? <Text style={styles.okText}>{smsSettingsMessage}</Text> : null}
          {smsSettingsState === "error" ? <Text style={styles.errorText}>{smsSettingsMessage}</Text> : null}

          {paymentMethods.length ? (
            <View style={styles.listSection}>
              <Text style={styles.listTitle}>Payment Methods</Text>
              {paymentMethods.map((method) => (
                <Text key={method.id} style={styles.listItem}>
                  {method.name} ({method.provider}){method.identifier ? ` - ${method.identifier}` : ""}
                </Text>
              ))}
            </View>
          ) : null}

          {senderRules.length ? (
            <View style={styles.listSection}>
              <Text style={styles.listTitle}>Tracked Senders</Text>
              {senderRules.map((rule) => {
                const isEnabled = enabledSenderRuleIds.includes(rule.id);
                return (
                  <Pressable
                    key={rule.id}
                    onPress={() => handleToggleSenderRule(rule.id)}
                    style={isEnabled ? styles.senderRuleSelected : styles.senderRule}
                  >
                    <Text style={styles.listTitle}>{rule.sender}</Text>
                    <Text style={styles.listItem}>
                      {rule.name} | {rule.provider} | {rule.match_type} | priority {rule.priority}
                    </Text>
                    <Text style={isEnabled ? styles.okText : styles.meta}>
                      {isEnabled ? "Enabled for future import" : "Tap to enable"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <Text style={styles.sectionTitle}>Local Raw Message Queue</Text>
          <Text style={styles.meta}>
            This is the offline-safe handoff point for future native SMS capture.
          </Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setRawSender}
            placeholder="Sender (for example bKash)"
            style={styles.input}
            value={rawSender}
          />
          <TextInput
            autoCapitalize="sentences"
            multiline
            onChangeText={setRawBody}
            placeholder="Raw SMS body"
            style={styles.inputMultiline}
            value={rawBody}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setRawReceivedAt}
            placeholder="Received at ISO time"
            style={styles.input}
            value={rawReceivedAt}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setRawDeviceMessageId}
            placeholder="Device message ID (optional)"
            style={styles.input}
            value={rawDeviceMessageId}
          />
          <Pressable onPress={handleQueueRawMessage} style={styles.buttonSecondary}>
            <Text style={styles.buttonText}>Queue Raw Message</Text>
          </Pressable>
          <Pressable onPress={handleSyncRawQueue} style={styles.button}>
            <Text style={styles.buttonText}>Sync Queued Messages</Text>
          </Pressable>

          {rawQueueState === "loading" ? <ActivityIndicator /> : null}
          {rawQueueState === "ok" ? <Text style={styles.okText}>{rawQueueMessage}</Text> : null}
          {rawQueueState === "error" ? <Text style={styles.errorText}>{rawQueueMessage}</Text> : null}

          <View style={styles.listSection}>
            <Text style={styles.listTitle}>Queued Messages ({rawQueue.length})</Text>
            {rawQueue.map((queuedMessage) => (
              <Text key={queuedMessage.id} style={styles.listItem}>
                {queuedMessage.sender} | {queuedMessage.receivedAt} | {queuedMessage.body}
              </Text>
            ))}
          </View>
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
  permissionBox: {
    backgroundColor: "#f8fafc",
    borderColor: "#cbd5e1",
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
    marginTop: 8,
    padding: 12
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
  senderRule: {
    backgroundColor: "#ffffff",
    borderColor: "#cbd5e1",
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
    padding: 12
  },
  senderRuleSelected: {
    backgroundColor: "#ecfdf5",
    borderColor: "#10b981",
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
    padding: 12
  },
  title: {
    color: "#0f172a",
    fontSize: 22,
    fontWeight: "700"
  }
});
