import { presentationColors } from "../../finance-contracts/presentation";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  Alert,
  AppState,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";
import {
  listAccounts,
  listCategories,
  listQuickPresets,
  postQuickEntry,
  reorderQuickPresets,
  saveQuickPreset,
  type Account,
  type Category,
} from "./api";
import {
  readPendingEntries,
  quickRetryAt,
  type PendingQuickEntry,
} from "./quick-entry-queue";
import { readSecureDocument, writeSecureDocument } from "./secure-document";
import { CompactFields, CompactDateTime } from "./compact-form";
import { Disclosure } from "./disclosure";
import {
  applyQuickPreset,
  blankPreset,
  buildQuickEntry,
  categoryFits,
  isRejectedEntry,
  localDay,
  newEntryId,
  newQuickDraft,
  type PresetInput,
  type QuickDraft,
  type QuickEntryInput,
  type QuickPreset,
} from "../../finance-contracts/quick-add";

type Data = {
  accounts: Account[];
  categories: Category[];
  presets: QuickPreset[];
};
type Pending = PendingQuickEntry;
export type QuickAddHandle = {
  open: (presetId?: string) => void;
  manage: () => void;
};
type Props = {
  token: string;
  scope: string | null;
  onFavorites: (presets: QuickPreset[]) => void;
  onPendingCount: (count: number) => void;
  onReferences: (accounts: Account[], categories: Category[]) => void;
  onSaved: () => void;
  onFullEntry: (draft: QuickDraft) => void;
};
const emptyData: Data = { accounts: [], categories: [], presets: [] };
const secureStore = {
  getItemAsync: SecureStore.getItemAsync,
  setItemAsync: (key: string, value: string) =>
    SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  deleteItemAsync: SecureStore.deleteItemAsync,
};

export const QuickAddHub = forwardRef<QuickAddHandle, Props>(
  function QuickAddHub(props, ref) {
    const { scope } = props;
    const [data, setData] = useState<Data>(emptyData),
      [ready, setReady] = useState(false);
    const [queue, setQueue] = useState<Pending[]>([]),
      [surface, setSurface] = useState<
        "launcher" | "entry" | "manager" | "preset" | null
      >(null);
    const [draft, setDraft] = useState<QuickDraft>(newQuickDraft),
      [title, setTitle] = useState("Quick entry");
    const [editing, setEditing] = useState<{ id?: string; input: PresetInput }>(
      { input: blankPreset() },
    );
    const [all, setAll] = useState(false),
      [timeOpen, setTimeOpen] = useState(false);
    const [error, setError] = useState(""),
      [notice, setNotice] = useState(""),
      [busy, setBusy] = useState(false),
      [syncing, setSyncing] = useState(false);
    const refreshVersion = useRef(0),
      cacheWriting = useRef<Promise<void>>(Promise.resolve());
    const queueRef = useRef<Pending[]>([]),
      writing = useRef<Promise<void>>(Promise.resolve());
    const saving = useRef(false),
      syncingRef = useRef(false),
      alive = useRef(true),
      replaceId = useRef<string | null>(null),
      propsRef = useRef(props);
    propsRef.current = props;
    const insets = useSafeAreaInsets();
    const primaryInput = useRef<TextInput>(null);
    const [modalShown, setModalShown] = useState(false);
    useEffect(() => {
      if (surface === null) {
        setModalShown(false);
        return;
      }
      if (!modalShown || (surface !== "entry" && surface !== "preset")) return;
      // Android's dialog must own window focus before requesting the IME.
      // Also focus when switching from the manager to its editor in the same dialog.
      const frame = requestAnimationFrame(() => primaryInput.current?.focus());
      return () => cancelAnimationFrame(frame);
    }, [modalShown, surface]);
    const queueKey = `finance.quick.queue.${scope ?? "none"}`,
      cacheKey = `finance.quick.cache.${scope ?? "none"}`;
    useEffect(() => {
      alive.current = true;
      return () => {
        alive.current = false;
      };
    }, []);
    const updateQueue = useCallback(
      (change: (previous: Pending[]) => Pending[]) => {
        const task = writing.current
          .catch(() => { })
          .then(async () => {
            if (!scope || !(await SecureStore.isAvailableAsync()))
              throw new Error(
                "Secure local storage is unavailable. Your entry has not been saved.",
              );
            const next = change(queueRef.current);
            await writeSecureDocument(
              secureStore,
              queueKey,
              JSON.stringify(next),
            );
            queueRef.current = next;
            if (alive.current) {
              setQueue(next);
              propsRef.current.onPendingCount(next.length);
            }
          });
        writing.current = task;
        return task;
      },
      [scope, queueKey],
    );
    const retry = useCallback(
      async (force = false) => {
        if (!scope || !ready || syncingRef.current) return;
        syncingRef.current = true;
        if (alive.current) setSyncing(true);
        const attempted = new Set<string>();
        let posted = false;
        try {
          while (alive.current) {
            const entry = queueRef.current.find(
              (item) =>
                !attempted.has(item.input.client_request_id) &&
                (force || (!item.blocked && item.retryAt <= Date.now())),
            );
            if (!entry) break;
            const id = entry.input.client_request_id;
            attempted.add(id);
            try {
              await postQuickEntry(propsRef.current.token, entry.input);
              await updateQueue((items) =>
                items.filter((item) => item.input.client_request_id !== id),
              );
              if (alive.current) {
                setNotice("Transaction synced to your ledger.");
                posted = true;
              }
            } catch (err) {
              const message =
                err instanceof Error ? err.message : "Sync failed.";
              const blocked =
                isRejectedEntry(err) ||
                (Boolean(err && typeof err === "object" && "status" in err) &&
                  Number((err as { status: number }).status) === 409);
              await updateQueue((items) =>
                items.map((item) =>
                  item.input.client_request_id === id
                    ? {
                      ...item,
                      attempts: item.attempts + 1,
                      retryAt: quickRetryAt(item.attempts),
                      error: message,
                      blocked,
                      status:
                        err && typeof err === "object" && "status" in err
                          ? Number(err.status)
                          : undefined,
                    }
                    : item,
                ),
              );
              if (alive.current)
                setNotice(
                  blocked
                    ? "A pending entry needs correction. Open Quick Add to review it."
                    : "Saved on device. Waiting to sync.",
                );
            }
          }
        } catch (err) {
          if (alive.current)
            setError(
              err instanceof Error
                ? err.message
                : "Could not update pending entries.",
            );
        } finally {
          syncingRef.current = false;
          if (alive.current) {
            setSyncing(false);
            if (posted) propsRef.current.onSaved();
          }
        }
      },
      [scope, ready, updateQueue],
    );
    const refresh = useCallback(async () => {
      if (!scope) return;
      const version = ++refreshVersion.current;
      try {
        const [accounts, categories, presets] = await Promise.all([
          listAccounts(propsRef.current.token),
          listCategories(propsRef.current.token),
          listQuickPresets(propsRef.current.token),
        ]);
        if (!alive.current || version !== refreshVersion.current) return;
        const next = { accounts, categories, presets };
        setData(next);
        setError("");
        const task = cacheWriting.current
          .catch(() => { })
          .then(async () => {
            if (alive.current && version === refreshVersion.current)
              await writeSecureDocument(
                secureStore,
                cacheKey,
                JSON.stringify(next),
              );
          });
        cacheWriting.current = task;
        await task;
      } catch (err) {
        if (alive.current && version === refreshVersion.current)
          setError(
            err instanceof Error
              ? err.message
              : "Could not refresh presets. Cached choices remain available.",
          );
      }
    }, [scope, cacheKey]);
    useEffect(() => {
      void (async () => {
        if (!scope) return;
        try {
          const [cached, pending] = await Promise.all([
            readSecureDocument(secureStore, cacheKey),
            readSecureDocument(secureStore, queueKey),
          ]);
          if (!alive.current) return;
          if (cached) {
            try {
              const choices = JSON.parse(cached) as Data;
              if (
                Array.isArray(choices.accounts) &&
                Array.isArray(choices.categories) &&
                Array.isArray(choices.presets)
              )
                setData(choices);
            } catch {
              // Reference choices can be fetched again; preserve the entry queue independently.
            }
          }
          const saved = readPendingEntries(pending);
          if (!Array.isArray(saved))
            throw new Error("Pending entries could not be read.");
          queueRef.current = saved;
          setQueue(saved);
          propsRef.current.onPendingCount(saved.length);
          setReady(true);
          await refresh();
        } catch (err) {
          if (alive.current)
            setError(
              err instanceof Error
                ? err.message
                : "Could not read local entries. Nothing has been overwritten.",
            );
        }
      })();
    }, [scope, cacheKey, queueKey, refresh]);
    useEffect(() => {
      propsRef.current.onFavorites(
        data.presets.filter((p) => p.is_enabled && p.is_favorite).slice(0, 6),
      );
    }, [data.presets]);
    useEffect(() => {
      if (!ready) return;
      void retry();
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") {
          void refresh();
          void retry();
        }
      });
      const timer = setInterval(() => {
        if (AppState.currentState === "active" && queueRef.current.length)
          void retry();
      }, 30000);
      return () => {
        subscription.remove();
        clearInterval(timer);
      };
    }, [ready, retry, refresh]);
    useEffect(() => {
      if (!notice) return;
      const timer = setTimeout(() => setNotice(""), 6500);
      return () => clearTimeout(timer);
    }, [notice]);
    function open(presetId?: string) {
      setError("");
      setAll(false);
      const preset = data.presets.find((p) => p.id === presetId);
      replaceId.current = null;
      if (preset) {
        setDraft(
          surface === "entry"
            ? applyQuickPreset(draft, preset)
            : newQuickDraft(preset),
        );
        setTitle(preset.name);
        setSurface("entry");
        if (!preset.available)
          setError(
            "This preset needs an active account/category. Choose valid options before saving.",
          );
      } else setSurface("launcher");
    }
    useImperativeHandle(ref, () => ({
      open,
      manage: () => {
        setError("");
        setSurface("manager");
        void refresh();
      },
    }));
    const choose = (patch: Partial<QuickDraft>) => {
      if (!saving.current) setDraft((old) => ({ ...old, ...patch }));
    };
    async function saveEntry() {
      if (saving.current || !ready) return;
      saving.current = true;
      setBusy(true);
      setError("");
      try {
        if (
          !data.accounts.some(
            (a) => a.id === draft.account && a.is_active !== false,
          ) ||
          (draft.category &&
            !data.categories.some(
              (c) =>
                c.id === draft.category &&
                c.is_active !== false &&
                categoryFits(c.kind, draft.type),
            ))
        )
          throw new Error(
            "Choose active account/category options before saving.",
          );
        const input = buildQuickEntry(draft, newEntryId(), "mobile");
        await updateQueue((items) => {
          if (items.length >= 100 && !replaceId.current)
            throw new Error("Sync pending entries before adding more.");
          return [
            ...items.filter(
              (item) => item.input.client_request_id !== replaceId.current,
            ),
            { input, attempts: 0, retryAt: 0, error: "", blocked: false },
          ];
        });
        if (alive.current) {
          setSurface(null);
          setDraft(newQuickDraft());
          setNotice("Saved on device. Waiting to sync.");
        }
        replaceId.current = null;
        void retry();
      } catch (err) {
        if (alive.current)
          setError(err instanceof Error ? err.message : "Entry was not saved.");
      } finally {
        saving.current = false;
        if (alive.current) setBusy(false);
      }
    }
    async function mutate(action: () => Promise<unknown>) {
      if (saving.current) return;
      saving.current = true;
      setBusy(true);
      setError("");
      try {
        await action();
        await refresh();
      } catch (err) {
        if (alive.current)
          setError(
            err instanceof Error ? err.message : "Could not save preset.",
          );
      } finally {
        saving.current = false;
        if (alive.current) setBusy(false);
      }
    }
    function edit(preset?: QuickPreset, duplicate = false) {
      const input = preset
        ? {
          ...preset,
          name: duplicate ? `${preset.name} copy`.slice(0, 120) : preset.name,
        }
        : { ...blankPreset(), display_order: data.presets.length };
      setEditing({ id: duplicate ? undefined : preset?.id, input });
      setSurface("preset");
      setError("");
    }
    const changePreset = (patch: Partial<PresetInput>) => {
      if (!saving.current)
        setEditing((old) => ({ ...old, input: { ...old.input, ...patch } }));
    };
    const activeAccounts = data.accounts.filter((a) => a.is_active !== false);
    const enabled = data.presets.filter((p) => p.is_enabled),
      favorites = enabled.filter((p) => p.is_favorite).slice(0, 6);
    function editPending(entry: Pending) {
      if (!isRejectedEntry({ status: entry.status })) return;
      const input = entry.input;
      replaceId.current = input.client_request_id;
      setDraft({
        ...newQuickDraft(),
        account: input.account,
        category: input.category ?? "",
        type: input.type,
        amount: input.amount,
        counterparty_text: input.counterparty_text,
        note: input.note,
        date: input.date,
        dateMode: "custom",
        time: input.time ?? "",
        timeMode: input.time === null ? "none" : "custom",
      });
      setTitle("Correct pending entry");
      setSurface("entry");
      setError("");
    }
    return (
      <>
        {notice ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss Quick Add notification"
            onPress={() => setNotice("")}
            style={s.notice}
          >
            <Text accessibilityLiveRegion="polite" style={s.text}>
              {notice}
            </Text>
          </Pressable>
        ) : null}
        <Modal
          visible={surface !== null}
          transparent
          animationType="slide"
          onShow={() => setModalShown(true)}
          onRequestClose={() => {
            if (!busy) setSurface(null);
          }}
        >
          <KeyboardAvoidingView
            // Android's native Modal already uses adjustResize; avoid resizing twice.
            enabled={Platform.OS === "ios"}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={[
              s.scrim,
              { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 8 },
            ]}
          >
            <View style={s.sheet}>
              <View style={s.heading}>
                <Text style={s.title}>
                  {surface === "entry"
                    ? title
                    : surface === "preset"
                      ? editing.id
                        ? "Edit preset"
                        : "Create preset"
                      : surface === "manager"
                        ? "Quick Add presets"
                        : "Quick Add"}
                </Text>
                <Action
                  label="Close"
                  disabled={busy}
                  onPress={() => setSurface(null)}
                />
              </View>
              <ScrollView
                pointerEvents={busy ? "none" : "auto"}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="none"
                removeClippedSubviews={false}
                style={s.scroll}
                contentContainerStyle={s.body}
              >
                {error ? (
                  <Text accessibilityLiveRegion="polite" style={s.error}>
                    {error}
                  </Text>
                ) : null}
                {!ready ? (
                  <Text style={s.text}>Preparing secure local entries…</Text>
                ) : null}
                {surface === "launcher" ? (
                  <>
                    <Text style={s.muted}>
                      Choose a shortcut. Save records the transaction.
                    </Text>
                    {(all ? enabled : favorites).map((p) => (
                      <Pressable
                        accessibilityRole="button"
                        key={p.id}
                        style={s.tile}
                        onPress={() => open(p.id)}
                      >
                        <Text style={s.bold}>{p.name}</Text>
                        <Text style={s.muted}>
                          {data.accounts.find((a) => a.id === p.account)
                            ?.name ?? "Choose account"}{" "}
                          ·{" "}
                          {data.categories.find((c) => c.id === p.category)
                            ?.name ?? "Uncategorized"}
                          {!p.available ? " · Needs active options" : ""}
                        </Text>
                      </Pressable>
                    ))}
                    {enabled.length > favorites.length && !all ? (
                      <Action
                        label="See all presets"
                        onPress={() => setAll(true)}
                      />
                    ) : null}
                    {!enabled.length ? (
                      <Text style={s.muted}>
                        Create your first preset or use a blank entry.
                      </Text>
                    ) : null}
                    <Action
                      label="Manage presets"
                      onPress={() => {
                        setSurface("manager");
                        void refresh();
                      }}
                    />
                    <Action
                      label="Refresh presets"
                      onPress={() => void refresh()}
                    />
                    {queue.length ? (
                      <>
                        <Text style={s.bold}>
                          {queue.length} pending sync
                          {syncing ? " · Syncing…" : ""}
                        </Text>
                        <Action
                          label="Retry pending entries"
                          disabled={syncing}
                          onPress={() => void retry(true)}
                        />
                        {queue.map((entry) => (
                          <View
                            key={entry.input.client_request_id}
                            style={s.tile}
                          >
                            <Text style={s.text}>
                              {data.accounts.find(
                                (a) => a.id === entry.input.account,
                              )?.name ?? "Account"}{" "}
                              · {entry.input.amount} · {entry.input.date}
                            </Text>
                            <Text style={s.error}>
                              {entry.error || "Waiting to sync"}
                            </Text>
                            {entry.blocked &&
                              isRejectedEntry({ status: entry.status }) ? (
                              <Action
                                label="Correct pending entry"
                                onPress={() => editPending(entry)}
                              />
                            ) : null}
                            <Action
                              label="Remove pending device copy"
                              onPress={() =>
                                Alert.alert(
                                  "Remove pending entry?",
                                  "This removes only the device copy. A save with an uncertain response may already be in your ledger; check Activity before adding it again.",
                                  [
                                    { text: "Keep", style: "cancel" },
                                    {
                                      text: "Remove",
                                      style: "destructive",
                                      onPress: () => {
                                        void updateQueue((items) =>
                                          items.filter(
                                            (item) =>
                                              item.input.client_request_id !==
                                              entry.input.client_request_id,
                                          ),
                                        ).catch((err) => setError(String(err)));
                                      },
                                    },
                                  ],
                                )
                              }
                            />
                          </View>
                        ))}
                      </>
                    ) : null}
                  </>
                ) : null}
                {surface === "entry" ? (
                  <>
                    <CompactFields>
                      <Field
                        label="Amount"
                        value={draft.amount}
                        onChange={(amount) => choose({ amount })}
                        numeric
                        inputRef={primaryInput}
                      />
                      <Choices
                        label="Account"
                        value={draft.account}
                        options={activeAccounts}
                        favorites={data.presets
                          .filter((p) => p.is_enabled && p.is_favorite)
                          .map((p) => p.account)
                          .filter((id): id is string => Boolean(id))}
                        onChange={(account) => choose({ account })}
                        limit={4}
                      />
                      <Choices
                        label="Category"
                        value={draft.category}
                        options={data.categories.filter(
                          (c) =>
                            c.is_active !== false &&
                            categoryFits(c.kind, draft.type),
                        )}
                        favorites={data.presets
                          .filter((p) => p.is_enabled && p.is_favorite)
                          .map((p) => p.category)
                          .filter((id): id is string => Boolean(id))}
                        onChange={(category) => choose({ category })}
                        allowEmpty
                      />
                      <View style={{ gap: 8 }}>
                        <Text style={s.muted}>
                          {draft.type === "expense"
                            ? "Expense · Money out"
                            : "Income · Money in"}
                        </Text>
                        <Action
                          label="Change entry type"
                          onPress={() => {
                            const type =
                              draft.type === "expense" ? "income" : "expense";
                            choose({
                              type,
                              category: data.categories.some(
                                (c) =>
                                  c.id === draft.category &&
                                  categoryFits(c.kind, type),
                              )
                                ? draft.category
                                : "",
                            });
                          }}
                        />
                      </View>
                    </CompactFields>
                    <View style={s.row}>
                      <Action
                        label="Today"
                        onPress={() =>
                          choose({ dateMode: "today", date: localDay() })
                        }
                      />
                      <Action
                        label="Yesterday"
                        onPress={() => {
                          const date = new Date();
                          date.setDate(date.getDate() - 1);
                          choose({ dateMode: "custom", date: localDay(date) });
                        }}
                      />
                      <Action
                        label="Now"
                        onPress={() =>
                          choose({ dateMode: "today", timeMode: "now" })
                        }
                      />
                    </View>
                    <Text style={s.muted}>
                      {draft.dateMode === "today" ? "Today" : draft.date} ·{" "}
                      {draft.timeMode === "now"
                        ? "Current time at Save"
                        : draft.timeMode === "none"
                          ? "Time unknown"
                          : draft.time}{" "}
                      · Local timezone
                    </Text>
                    <Action
                      label="Change date/time"
                      onPress={() => setTimeOpen(!timeOpen)}
                    />
                    <View style={{ display: timeOpen ? "flex" : "none", gap: 8 }}
                      accessibilityElementsHidden={!timeOpen} importantForAccessibility={timeOpen ? "auto" : "no-hide-descendants"}>
                      <CompactDateTime date={draft.dateMode === "today" ? localDay() : draft.date} time={draft.time} disabled={busy}
                        onDate={date => choose({ date, dateMode: "custom" })} onTime={time => choose({ time, timeMode: "custom" })} />
                      <Action label="Time unknown" onPress={() => choose({ timeMode: "none" })} />
                    </View>
                    <Disclosure label="More details" revealKey={error}>
                      <CompactFields>
                        <Field label="Merchant / counterparty" value={draft.counterparty_text}
                          onChange={counterparty_text => choose({ counterparty_text })} maxLength={255} />
                        <Field label="Note" value={draft.note} onChange={note => choose({ note })} maxLength={2000} />
                      </CompactFields>
                    </Disclosure>
                    <Text style={s.muted}>
                      Apply another preset; typed amount/note are retained.
                    </Text>
                    <View style={s.row}>
                      {enabled
                        .filter((p) => p.available)
                        .map((p) => (
                          <Action
                            key={p.id}
                            label={p.name}
                            onPress={() => open(p.id)}
                          />
                        ))}
                    </View>
                  </>
                ) : null}
                {surface === "manager" ? (
                  <>
                    <Text style={s.muted}>
                      Enable and favorite the shortcuts you want to see. Move
                      them into your preferred order.
                    </Text>
                    <Action
                      label="Create preset"
                      primary
                      onPress={() => edit()}
                    />
                    {data.presets.map((p, index) => (
                      <View key={p.id} style={s.tile}>
                        <Text style={s.bold}>{p.name}</Text>
                        <Text style={s.muted}>
                          {p.type} ·{" "}
                          {data.accounts.find((a) => a.id === p.account)
                            ?.name ?? "Choose account"}{" "}
                          ·{" "}
                          {data.categories.find((c) => c.id === p.category)
                            ?.name ?? "Uncategorized"}
                        </Text>
                        <Text style={s.muted}>
                          {p.is_enabled ? "Enabled" : "Disabled"} ·{" "}
                          {p.is_favorite ? "Favorite" : "See all"}
                          {!p.available ? " · Needs active options" : ""}
                        </Text>
                        <View style={s.row}>
                          <Action
                            label={`Edit ${p.name}`}
                            disabled={busy}
                            onPress={() => edit(p)}
                          />
                          <Action
                            label={`Duplicate ${p.name}`}
                            disabled={busy}
                            onPress={() => edit(p, true)}
                          />
                          <Action
                            label={p.is_enabled ? "Disable" : "Enable"}
                            disabled={busy}
                            onPress={() =>
                              void mutate(() =>
                                saveQuickPreset(
                                  propsRef.current.token,
                                  { is_enabled: !p.is_enabled },
                                  p.id,
                                ),
                              )
                            }
                          />
                          {[-1, 1].map((delta) => (
                            <Action
                              key={delta}
                              label={delta < 0 ? "Move up" : "Move down"}
                              disabled={
                                busy ||
                                index + delta < 0 ||
                                index + delta >= data.presets.length
                              }
                              onPress={() =>
                                void mutate(() => {
                                  const ids = data.presets.map(
                                    (item) => item.id,
                                  );
                                  [ids[index], ids[index + delta]] = [
                                    ids[index + delta],
                                    ids[index],
                                  ];
                                  return reorderQuickPresets(
                                    propsRef.current.token,
                                    ids,
                                  );
                                })
                              }
                            />
                          ))}
                        </View>
                      </View>
                    ))}
                  </>
                ) : null}
                {surface === "preset" ? (
                  <>
                    <Field
                      label="Preset name"
                      value={editing.input.name}
                      onChange={(name) => changePreset({ name })}
                      maxLength={120}
                      inputRef={primaryInput}
                    />
                    <View style={s.row}>
                      {["expense", "income"].map((type) => (
                        <Action
                          key={type}
                          label={type === "expense" ? "Expense" : "Income"}
                          selected={editing.input.type === type}
                          disabled={busy}
                          onPress={() =>
                            changePreset({
                              type: type as "expense" | "income",
                              category: null,
                            })
                          }
                        />
                      ))}
                    </View>
                    <Choices
                      label="Default account"
                      value={editing.input.account ?? ""}
                      options={activeAccounts}
                      favorites={[]}
                      onChange={(account) =>
                        changePreset({ account: account || null })
                      }
                      allowEmpty
                      emptyLabel="Choose at entry"
                    />
                    <Choices
                      label="Default category"
                      value={editing.input.category ?? ""}
                      options={data.categories.filter(
                        (c) =>
                          c.is_active !== false &&
                          categoryFits(c.kind, editing.input.type),
                      )}
                      favorites={[]}
                      onChange={(category) =>
                        changePreset({ category: category || null })
                      }
                      allowEmpty
                    />
                    <Field
                      label="Default amount (optional)"
                      value={editing.input.amount ?? ""}
                      numeric
                      onChange={(amount) =>
                        changePreset({ amount: amount || null })
                      }
                    />
                    <Field
                      label="Default merchant / counterparty"
                      value={editing.input.counterparty_text}
                      maxLength={255}
                      onChange={(counterparty_text) =>
                        changePreset({ counterparty_text })
                      }
                    />
                    <Field
                      label="Default note"
                      value={editing.input.note}
                      maxLength={2000}
                      onChange={(note) => changePreset({ note })}
                    />
                    <Action
                      label={
                        editing.input.is_favorite
                          ? "Favorite: on"
                          : "Favorite: off"
                      }
                      selected={editing.input.is_favorite}
                      onPress={() =>
                        changePreset({
                          is_favorite: !editing.input.is_favorite,
                        })
                      }
                    />
                    <Action
                      label={
                        editing.input.is_enabled
                          ? "Enabled: on"
                          : "Enabled: off"
                      }
                      selected={editing.input.is_enabled}
                      onPress={() =>
                        changePreset({ is_enabled: !editing.input.is_enabled })
                      }
                    />
                    <Text style={s.muted}>
                      Dates and times are fresh for each entry. Transaction
                      edits never change this preset.
                    </Text>
                  </>
                ) : null}
              </ScrollView>
              <View style={s.footer}>
                {surface === "entry" ? (
                  <>
                    <Action
                      label="Full entry"
                      disabled={busy}
                      onPress={() => {
                        setSurface(null);
                        propsRef.current.onFullEntry(draft);
                      }}
                    />
                    <Action
                      label={busy ? "Saving…" : "Save transaction"}
                      primary
                      disabled={busy || !ready}
                      onPress={() => void saveEntry()}
                    />
                  </>
                ) : surface === "preset" ? (
                  <>
                    <Action
                      label="Cancel"
                      disabled={busy}
                      onPress={() => setSurface("manager")}
                    />
                    <Action
                      label={busy ? "Saving…" : "Save preset"}
                      primary
                      disabled={busy}
                      onPress={() => {
                        if (!editing.input.name.trim()) {
                          setError("Enter a preset name.");
                          return;
                        }
                        void mutate(async () => {
                          await saveQuickPreset(
                            propsRef.current.token,
                            editing.input,
                            editing.id,
                          );
                          if (alive.current) setSurface("manager");
                        });
                      }}
                    />
                  </>
                ) : (
                  <>
                    <Action
                      label={
                        surface === "manager"
                          ? "Back to Quick Add"
                          : "Blank entry"
                      }
                      primary
                      onPress={() => {
                        if (surface === "manager") setSurface("launcher");
                        else {
                          replaceId.current = null;
                          setDraft(newQuickDraft());
                          setTitle("Quick entry");
                          setSurface("entry");
                        }
                      }}
                    />
                  </>
                )}
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </>
    );
  },
);
function Action({
  label,
  onPress,
  disabled = false,
  primary = false,
  selected = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  selected?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={[
        s.action,
        primary ? s.primary : selected ? s.selected : null,
        disabled ? { opacity: 0.45 } : null,
      ]}
    >
      <Text
        style={[
          s.bold,
          primary
            ? { color: "#08261d" }
            : selected
              ? { color: presentationColors.accent }
              : null,
        ]}
      >
        {selected ? "✓ " : ""}
        {label}
      </Text>
    </Pressable>
  );
}
function Field({
  label,
  value,
  onChange,
  numeric,
  inputRef,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
  inputRef?: RefObject<TextInput | null>;
  maxLength?: number;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.muted}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        ref={inputRef}
        value={value}
        onChangeText={onChange}
        keyboardType={numeric ? "decimal-pad" : "default"}
        maxLength={maxLength}
        style={s.input}
        placeholderTextColor="#91a7c2"
      />
    </View>
  );
}
function Choices({
  label,
  value,
  options,
  favorites,
  onChange,
  allowEmpty,
  emptyLabel = "Uncategorized",
  limit = 6,
}: {
  label: string;
  value: string;
  options: { id: string; name: string }[];
  favorites: string[];
  onChange: (id: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  limit?: number;
}) {
  const [all, setAll] = useState(false),
    [query, setQuery] = useState("");
  const shortlist = options
    .filter((o) => favorites.includes(o.id) || o.id === value)
    .sort((a, b) => Number(b.id === value) - Number(a.id === value))
    .slice(0, limit);
  const shown = (
    all ? options : shortlist.length ? shortlist : options.slice(0, limit)
  ).filter((o) => o.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.muted}>
        {label}:{" "}
        {options.find((o) => o.id === value)?.name ??
          (allowEmpty ? emptyLabel : "Choose account")}
      </Text>
      {all ? (
        <Field
          label={`Search ${label.toLowerCase()}`}
          value={query}
          onChange={setQuery}
        />
      ) : null}
      <View style={s.row}>
        {shown.map((o) => (
          <Action
            key={o.id}
            label={o.name}
            selected={o.id === value}
            onPress={() => onChange(o.id)}
          />
        ))}
        {allowEmpty ? (
          <Action
            label={emptyLabel}
            selected={!value}
            onPress={() => onChange("")}
          />
        ) : null}
      </View>
      <Action
        label={
          all
            ? "Show favorites"
            : `See all ${label.includes("category") || label === "Category" ? "categories" : "accounts"}`
        }
        onPress={() => setAll(!all)}
      />
    </View>
  );
}
const s = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: "#0009",
    justifyContent: "flex-end",
    paddingHorizontal: 12,
  },
  sheet: {
    maxHeight: "94%",
    flex: 1,
    backgroundColor: "#0d1c2b",
    borderWidth: 1,
    borderColor: "#294158",
    borderRadius: 18,
    overflow: "hidden",
  },
  heading: {
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  title: { color: "#f5f8fc", fontSize: 21, fontWeight: "700", flexShrink: 1 },
  scroll: { flex: 1 },
  body: { padding: 16, gap: 14 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 8,
    padding: 14,
    borderTopWidth: 1,
    borderColor: "#294158",
  },
  action: {
    minHeight: 48,
    justifyContent: "center",
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#183344",
    flexShrink: 1,
  },
  primary: { backgroundColor: presentationColors.accent },
  selected: {
    backgroundColor: presentationColors.selected,
    borderWidth: 1,
    borderColor: presentationColors.accent,
  },
  text: { color: "#e7eef7", fontSize: 14 },
  bold: { color: "#e7eef7", fontSize: 14, fontWeight: "700" },
  muted: { color: "#91a7c2", fontSize: 13 },
  error: { color: "#ffb6b6", fontSize: 13 },
  input: {
    backgroundColor: "#081521",
    borderWidth: 1,
    borderColor: "#294158",
    borderRadius: 8,
    padding: 12,
    color: "white",
    fontSize: 17,
    minHeight: 46,
  },
  tile: {
    borderWidth: 1,
    borderColor: "#294158",
    borderRadius: 10,
    padding: 14,
    gap: 8,
  },
  notice: {
    position: "absolute",
    bottom: 90,
    left: 16,
    right: 16,
    backgroundColor: "#153747",
    borderWidth: 1,
    borderColor: "#55e6a5",
    borderRadius: 10,
    padding: 14,
    zIndex: 100,
  },
});
