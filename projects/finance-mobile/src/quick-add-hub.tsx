import { presentationColors } from "../../finance-contracts/presentation";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { lightMobileStyles } from "./theme-styles";
import { useLightAppearance } from "./mobile-theme";
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
  useWindowDimensions,
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
    const s = useQuickAddStyles();
    const isLight = useLightAppearance();
    const { height: windowHeight, width: windowWidth } = useWindowDimensions();
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
    const visiblePresetCount = all ? enabled.length : favorites.length;
    const launcherHeight = Math.min(
      Math.max(180, 0.94 * (windowHeight - insets.top - insets.bottom - 20)),
      210 + visiblePresetCount * 88 + (enabled.length > favorites.length ? 62 : 0)
        + (!enabled.length ? 34 : 0) + (queue.length ? 120 + queue.length * 110 : 0),
    );
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayDay = localDay(yesterday);
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
            <View style={[s.sheet, surface === "launcher" ? [s.launcherSheet, { height: launcherHeight }] : null]}>
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
                <View style={s.headingActions}>
                  {surface === "launcher" ? <>
                    <Pressable accessibilityRole="button" accessibilityLabel="Manage Quick Add presets"
                      accessibilityState={{ disabled: busy }} disabled={busy}
                      onPress={() => { setSurface("manager"); void refresh(); }} style={[s.headerAction, busy ? { opacity: 0.45 } : null]}>
                      <MaterialCommunityIcons name="cog-outline" size={19} color={isLight ? "#087b8c" : "#91a7c2"} />
                      {windowWidth >= 380 ? <Text style={s.bold}>Manage</Text> : null}
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel="Refresh Quick Add presets"
                      accessibilityState={{ disabled: busy }} disabled={busy}
                      onPress={() => void refresh()} style={[s.headerIconAction, busy ? { opacity: 0.45 } : null]}>
                      <MaterialCommunityIcons name="refresh" size={23} color={isLight ? "#087b8c" : "#91a7c2"} />
                    </Pressable>
                  </> : null}
                  <Action label="Close" disabled={busy} onPress={() => setSurface(null)} />
                </View>
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
                        accessibilityLabel={`${p.name}, ${p.type === "income" ? "money in" : "money out"}, ${data.accounts.find((a) => a.id === p.account)?.name ?? "choose account"}. Open prefilled entry`}
                        key={p.id}
                        style={s.presetTile}
                        onPress={() => open(p.id)}
                      >
                        <View style={[s.directionIcon, p.type === "income" ? s.incomeIcon : s.expenseIcon]}>
                          <MaterialCommunityIcons name={p.type === "income" ? "plus" : "minus"} size={26}
                            color={p.type === "income" ? (isLight ? "#117e5d" : "#55e6a5") : (isLight ? "#b82946" : "#ff9399")} />
                        </View>
                        <View style={s.presetContent}>
                          <Text style={s.presetTitle}>{p.name}</Text>
                          <Text style={s.muted}>
                            {p.type === "income" ? "Money in" : "Money out"} · {data.accounts.find((a) => a.id === p.account)?.name ?? "Choose account"} · {data.categories.find((c) => c.id === p.category)?.name ?? "Uncategorized"}
                            {!p.available ? " · Needs active options" : ""}
                          </Text>
                        </View>
                        <MaterialCommunityIcons name="chevron-right" size={24} color={isLight ? "#607782" : "#91a7c2"} />
                      </Pressable>
                    ))}
                    {enabled.length > favorites.length && !all ? (
                      <Pressable accessibilityRole="button" accessibilityLabel={`See all ${enabled.length} Quick Add presets`}
                        onPress={() => setAll(true)} style={s.seeAllAction}>
                        <Text style={s.seeAllText}>See all presets ({enabled.length})</Text>
                        <MaterialCommunityIcons name="chevron-down" size={20} color={isLight ? "#087b8c" : "#32d8f2"} />
                      </Pressable>
                    ) : all && enabled.length > favorites.length ? (
                      <Pressable accessibilityRole="button" accessibilityLabel="Show favorite Quick Add presets"
                        onPress={() => setAll(false)} style={s.seeAllAction}>
                        <Text style={s.seeAllText}>Show favorites</Text>
                        <MaterialCommunityIcons name="chevron-up" size={20} color={isLight ? "#087b8c" : "#32d8f2"} />
                      </Pressable>
                    ) : null}
                    {!enabled.length ? (
                      <Text style={s.muted}>
                        Create your first preset or use a blank entry.
                      </Text>
                    ) : null}
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
                    <View accessibilityRole="radiogroup" accessibilityLabel="Entry type" style={s.entryTypeGroup}>
                      {(["expense", "income"] as const).map((type) => <Pressable key={type}
                        accessibilityRole="radio" accessibilityLabel={type === "expense" ? "Expense, money out" : "Income, money in"}
                        accessibilityState={{ checked: draft.type === type }}
                        onPress={() => choose({
                          type,
                          category: data.categories.some((c) => c.id === draft.category && categoryFits(c.kind, type)) ? draft.category : "",
                        })}
                        style={[s.entryTypeOption, draft.type === type ? type === "expense" ? s.entryExpenseSelected : s.entryIncomeSelected : null]}>
                        <Text style={[s.entryTypeText, draft.type === type ? { color: type === "expense" ? (isLight ? "#b82946" : "#ff9399") : (isLight ? "#117e5d" : "#55e6a5") } : null]}>
                          {type === "expense" ? "− Expense · Money out" : "+ Income · Money in"}
                        </Text>
                      </Pressable>)}
                    </View>
                    <View style={s.entryStack}>
                      <Field label="Amount" value={draft.amount} onChange={(amount) => choose({ amount })}
                        numeric inputRef={primaryInput} prefix={data.accounts.find((a) => a.id === draft.account)?.currency ?? ""} />
                      <Choices label="Category" value={draft.category}
                        options={data.categories.filter((c) => c.is_active !== false && categoryFits(c.kind, draft.type))}
                        favorites={data.presets.filter((p) => p.is_enabled && p.is_favorite).map((p) => p.category).filter((id): id is string => Boolean(id))}
                        onChange={(category) => choose({ category })} allowEmpty inlineSeeAll />
                      <Text style={s.muted}>Date & time</Text>
                      <View style={s.row}>
                        <Action label="Today" selected={draft.dateMode === "today"}
                          onPress={() => choose({ dateMode: "today", date: localDay() })} />
                        <Action label="Yesterday" selected={draft.dateMode === "custom" && draft.date === yesterdayDay}
                          onPress={() => choose({ dateMode: "custom", date: yesterdayDay })} />
                        <Action label="Now" selected={draft.timeMode === "now"}
                          onPress={() => choose({ timeMode: "now" })} />
                      </View>
                      <View style={s.dateSummaryRow}>
                        <Text style={[s.muted, s.dateSummaryText]}>
                          {draft.dateMode === "today" ? "Today" : draft.date} · {draft.timeMode === "now" ? "Current time at Save" : draft.timeMode === "none" ? "Time unknown" : draft.time} · Local timezone
                        </Text>
                        <Pressable accessibilityRole="button" accessibilityLabel="Change date/time"
                          accessibilityState={{ expanded: timeOpen }} onPress={() => setTimeOpen(!timeOpen)} style={s.customDateAction}>
                          <MaterialCommunityIcons name="pencil-outline" size={17} color={isLight ? "#087b8c" : "#32d8f2"} />
                          <Text style={s.seeAllText}>Custom</Text>
                        </Pressable>
                      </View>
                      <Choices label="Account" value={draft.account} options={activeAccounts}
                        favorites={data.presets.filter((p) => p.is_enabled && p.is_favorite).map((p) => p.account).filter((id): id is string => Boolean(id))}
                        onChange={(account) => choose({ account })} limit={4} inlineSeeAll />
                    </View>
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
                    {enabled.some((p) => p.available) ? <Disclosure label="Other shortcuts">
                      <Text style={s.muted}>Apply another preset; typed amount and note are retained.</Text>
                      <View style={s.row}>
                        {enabled.filter((p) => p.available).map((p) => <Action key={p.id} label={p.name} onPress={() => open(p.id)} />)}
                      </View>
                    </Disclosure> : null}
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
  const s = useQuickAddStyles();
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
  prefix,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
  inputRef?: RefObject<TextInput | null>;
  maxLength?: number;
  prefix?: string;
}) {
  const s = useQuickAddStyles();
  const isLight = useLightAppearance();
  const input = <TextInput
    accessibilityLabel={label}
    ref={inputRef}
    value={value}
    onChangeText={onChange}
    keyboardType={numeric ? "decimal-pad" : "default"}
    maxLength={maxLength}
    style={prefix !== undefined ? s.prefixedInput : s.input}
    placeholderTextColor={isLight ? "#607782" : "#91a7c2"}
  />;
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.muted}>{label}</Text>
      {prefix !== undefined ? <View style={s.prefixedInputRow}>{prefix ? <Text style={s.prefixText}>{prefix}</Text> : null}{input}</View> : input}
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
  inlineSeeAll = false,
}: {
  label: string;
  value: string;
  options: { id: string; name: string }[];
  favorites: string[];
  onChange: (id: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  limit?: number;
  inlineSeeAll?: boolean;
}) {
  const s = useQuickAddStyles();
  const isLight = useLightAppearance();
  const [all, setAll] = useState(false),
    [query, setQuery] = useState("");
  const shortlist = options
    .filter((o) => favorites.includes(o.id) || o.id === value)
    .sort((a, b) => Number(b.id === value) - Number(a.id === value))
    .slice(0, limit);
  const shown = (
    all ? options : shortlist.length ? shortlist : options.slice(0, limit)
  ).filter((o) => o.name.toLowerCase().includes(query.toLowerCase()));
  const toggleLabel = all ? "Show favorites" : `See all ${label === "Category" ? "categories" : "accounts"}`;
  return (
    <View style={{ gap: 8 }}>
      <View style={s.choiceHeading}>
        <Text style={s.muted}>
          {inlineSeeAll ? label : `${label}: ${options.find((o) => o.id === value)?.name ?? (allowEmpty ? emptyLabel : "Choose account")}`}
        </Text>
        {inlineSeeAll ? <Pressable accessibilityRole="button" accessibilityLabel={toggleLabel}
          accessibilityState={{ expanded: all }} onPress={() => setAll(!all)} style={s.choiceSeeAll}>
          <Text style={s.seeAllText}>{all ? "Show less" : "See all"}</Text>
          <MaterialCommunityIcons name={all ? "chevron-up" : "chevron-down"} size={17} color={isLight ? "#087b8c" : "#32d8f2"} />
        </Pressable> : null}
      </View>
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
        {allowEmpty && (all || !value) ? (
          <Action
            label={emptyLabel}
            selected={!value}
            onPress={() => onChange("")}
          />
        ) : null}
      </View>
      {!inlineSeeAll ? <Action
        label={
          all
            ? "Show favorites"
            : `See all ${label.includes("category") || label === "Category" ? "categories" : "accounts"}`
        }
        onPress={() => setAll(!all)}
      /> : null}
    </View>
  );
}
const darkQuickAddStyles = StyleSheet.create({
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
  launcherSheet: { flex: 0 },
  heading: {
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  headingActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  headerAction: { minHeight: 48, minWidth: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "#183344" },
  headerIconAction: { minHeight: 48, minWidth: 48, alignItems: "center", justifyContent: "center", borderRadius: 8 },
  title: { color: "#f5f8fc", fontSize: 21, fontWeight: "700", flexShrink: 1 },
  scroll: { flex: 1 },
  body: { padding: 16, gap: 14 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  presetTile: { minHeight: 74, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: "#294158", borderRadius: 10, padding: 12 },
  directionIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  incomeIcon: { backgroundColor: "#12382f" },
  expenseIcon: { backgroundColor: "#321f27" },
  presetContent: { flex: 1, minWidth: 0, gap: 3 },
  presetTitle: { color: "#f5f8fc", fontSize: 17, fontWeight: "700" },
  seeAllAction: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
  seeAllText: { color: "#32d8f2", fontSize: 14, fontWeight: "600" },
  entryTypeGroup: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  entryTypeOption: { minHeight: 48, minWidth: 144, flexGrow: 1, justifyContent: "center", alignItems: "center", borderRadius: 8, backgroundColor: "#183344", paddingHorizontal: 12 },
  entryExpenseSelected: { backgroundColor: "#321f27", borderWidth: 1, borderColor: "#6a3440" },
  entryIncomeSelected: { backgroundColor: "#12382f", borderWidth: 1, borderColor: "#55e6a5" },
  entryTypeText: { color: "#91a7c2", fontSize: 14, fontWeight: "700", textAlign: "center" },
  entryStack: { gap: 16 },
  dateSummaryRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  dateSummaryText: { flexGrow: 1, flexShrink: 1 },
  customDateAction: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8 },
  choiceHeading: { minHeight: 28, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  choiceSeeAll: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 4 },
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
  prefixedInputRow: { minHeight: 50, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#294158", borderRadius: 8, backgroundColor: "#081521", paddingLeft: 12 },
  prefixText: { color: "#91a7c2", fontSize: 15, marginRight: 8 },
  prefixedInput: { minHeight: 48, flex: 1, color: "white", fontSize: 21, fontWeight: "700", paddingHorizontal: 4, paddingVertical: 8 },
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
const lightQuickAddStyles = lightMobileStyles(darkQuickAddStyles);
function useQuickAddStyles() {
  return useLightAppearance() ? lightQuickAddStyles : darkQuickAddStyles;
}
