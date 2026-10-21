import {
  formatCurrency as money,
  formatCalendarDate as dateLabel,
  formatTimestamp,
  displayLabel as title,
  presentationColors,
} from "../../finance-contracts/presentation";
import { useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useRetainedScroll } from "./retained-scroll";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { NativeDateField } from "./native-time-field";
import {
  activityDateError,
  activityDay,
  activityQuery,
  appendActivityPage,
  initialActivityFilters,
  type ActivityFilters,
} from "./activity-model";
import {
  listTransactionActivity,
  type Account,
  type Category,
  type Transaction,
} from "./api";

type Props = {
  token: string;
  scope: string;
  accounts: Account[];
  categories: Category[];
  filters: ActivityFilters;
  onFiltersChange: (filters: ActivityFilters) => void;
  cached: Transaction[];
  pendingCount: number;
  onQuickAdd: () => void;
  onEdit?: (id: string) => void;
  focused?: boolean;
};
const types = [
  "expense",
  "income",
  "transfer",
  "adjustment",
  "fee",
  "refund",
  "lend",
  "borrow",
  "repayment_received",
  "repayment_paid",
];
function Button({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[s.button, disabled && s.disabled]}
    >
      <Text style={s.buttonText}>{label}</Text>
    </Pressable>
  );
}
function ActivityFilterSheet({
  value,
  accounts,
  categories,
  onApply,
  onClose,
}: {
  value: ActivityFilters;
  accounts: Account[];
  categories: Category[];
  onApply: (value: ActivityFilters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value),
    [picker, setPicker] = useState<"account" | "category" | "type" | null>(
      null,
    );
  const [search, setSearch] = useState(""),
    [error, setError] = useState("");
  const options =
    picker === "account"
      ? accounts
      : picker === "category"
        ? categories
        : types.map((type) => ({ id: type, name: title(type) }));
  function back() {
    if (picker) {
      setPicker(null);
      setSearch("");
    } else onClose();
  }
  return (
    <Modal visible animationType="slide" onRequestClose={back}>
      <SafeAreaView style={s.screen}>
        <View style={s.sheetHeader}>
          <Text accessibilityRole="header" style={s.heading}>
            {picker ? `Choose ${picker}` : "Activity filters"}
          </Text>
          <Button
            label={picker ? "Back to filters" : "Cancel filters"}
            onPress={back}
          />
        </View>
        {picker ? (
          <>
            <TextInput
              accessibilityLabel={`Search ${picker} options`}
              autoCorrect={false}
              placeholder="Search options"
              placeholderTextColor="#91a7c2"
              style={s.input}
              value={search}
              onChangeText={setSearch}
            />
            <FlatList
              keyboardShouldPersistTaps="handled"
              data={[
                {
                  id: "",
                  name: `All ${picker === "category" ? "categories" : picker === "type" ? "types" : "accounts"}`,
                },
                ...options,
              ].filter((item) =>
                item.name.toLowerCase().includes(search.toLowerCase()),
              )}
              keyExtractor={(item) => item.id}
              ListEmptyComponent={
                <Text style={s.muted}>No matching options.</Text>
              }
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: draft[picker] === item.id }}
                  style={s.option}
                  onPress={() => {
                    setDraft((current) => ({ ...current, [picker]: item.id }));
                    setPicker(null);
                    setSearch("");
                  }}
                >
                  <Text style={s.text}>
                    {draft[picker] === item.id ? "Selected · " : ""}
                    {item.name}
                  </Text>
                </Pressable>
              )}
            />
          </>
        ) : (
          <>
            <ScrollView
              contentContainerStyle={s.content}
              keyboardShouldPersistTaps="handled"
            >
              {(["account", "category", "type"] as const).map((key) => (
                <Button
                  key={key}
                  label={`${title(key)}: ${key === "account" ? (accounts.find((item) => item.id === draft.account)?.name ?? "All accounts") : key === "category" ? (categories.find((item) => item.id === draft.category)?.name ?? "All categories") : draft.type ? title(draft.type) : "All types"}`}
                  onPress={() => setPicker(key)}
                />
              ))}
              <Text accessibilityRole="header" style={s.text}>
                Transaction dates
              </Text>
              <View style={s.wrap}>
                {(["all", "daily", "monthly", "custom"] as const).map(
                  (mode) => (
                    <Pressable
                      key={mode}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: draft.mode === mode }}
                      onPress={() => {
                        setDraft((current) => ({ ...current, mode }));
                        setError("");
                      }}
                      style={[s.button, draft.mode === mode && s.selected]}
                    >
                      <Text style={s.buttonText}>
                        {
                          {
                            all: "All dates",
                            daily: "Daily",
                            monthly: "Monthly",
                            custom: "Custom range",
                          }[mode]
                        }
                      </Text>
                    </Pressable>
                  ),
                )}
              </View>
              {draft.mode !== "all" ? (
                <>
                  <Text style={s.muted}>
                    {draft.mode === "monthly"
                      ? `Month: ${draft.start.slice(0, 7)} · Choose a date within the month`
                      : draft.mode === "daily"
                        ? "Day"
                        : "Start date"}
                  </Text>
                  <NativeDateField
                    label={
                      draft.mode === "custom" ? "Start date" : "Activity date"
                    }
                    value={draft.start}
                    onChange={(start) => {
                      setDraft((current) => ({ ...current, start }));
                      setError("");
                    }}
                  />
                  {draft.mode === "custom" ? (
                    <>
                      <Text style={s.muted}>End date</Text>
                      <NativeDateField
                        label="End date"
                        value={draft.end}
                        onChange={(end) => {
                          setDraft((current) => ({ ...current, end }));
                          setError("");
                        }}
                      />
                    </>
                  ) : null}
                </>
              ) : null}
              <Text accessibilityRole="header" style={s.text}>
                Sort by
              </Text>
              {(
                [
                  ["-date", "Transaction date"],
                  ["-created_at", "Recently added"],
                  ["-updated_at", "Recently updated"],
                ] as const
              ).map(([ordering, label]) => (
                <Pressable
                  key={ordering}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: draft.ordering === ordering }}
                  onPress={() =>
                    setDraft((current) => ({ ...current, ordering }))
                  }
                  style={[s.button, draft.ordering === ordering && s.selected]}
                >
                  <Text style={s.buttonText}>{label}</Text>
                </Pressable>
              ))}
              {error ? (
                <Text accessibilityRole="alert" style={s.error}>
                  {error}
                </Text>
              ) : null}
            </ScrollView>
            <View style={s.footer}>
              <Button
                label="Reset filters"
                onPress={() => {
                  setDraft({
                    ...initialActivityFilters(),
                    search: value.search,
                  });
                  setError("");
                }}
              />
              <Button
                label="Apply activity filters"
                onPress={() => {
                  const issue = activityDateError(draft);
                  setError(issue);
                  if (!issue) onApply(draft);
                }}
              />
            </View>
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
}
function TransactionDetails({
  row,
  accounts,
  categories,
  onClose,
  onEdit,
}: {
  onEdit?: (id: string) => void;
  row: Transaction;
  accounts: Account[];
  categories: Category[];
  onClose: () => void;
}) {
  const name = (id: string | null) =>
    accounts.find((item) => item.id === id)?.name ?? "Unknown account";
  const currency =
    accounts.find((item) => item.id === row.account)?.currency ?? "BDT";
  const fields: Array<[string, string]> = [
    [row.type === "transfer" ? "From account" : "Account", name(row.account)],
    ...(row.type === "transfer"
      ? [["To account", name(row.transfer_account)] as [string, string]]
      : []),
    ["Transaction date", dateLabel(row.date)],
    ["Time", row.time ?? "Not reported"],
    ["Type", title(row.type)],
    [
      "Category",
      categories.find((item) => item.id === row.category)?.name ??
        "Uncategorized",
    ],
    ["Source", title(row.source)],
    ["Reference", row.reference || "Not reported"],
    ["Counterparty", row.counterparty_text || "Not reported"],
    ["Note", row.note || "None"],
    ["Added", formatTimestamp(row.created_at)],
    ["Updated", formatTimestamp(row.updated_at)],
  ];
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={s.screen}>
        <View style={s.sheetHeader}>
          <Text accessibilityRole="header" style={s.heading}>
            Transaction details
          </Text>
          <View style={s.wrap}>{onEdit ? <Button label="Edit transaction" onPress={() => { onClose(); onEdit(row.id); }} /> : null}<Button label="Close transaction details" onPress={onClose} /></View>
        </View>
        <ScrollView contentContainerStyle={s.content}>
          <Text style={s.amount}>{money(row.amount, currency)}</Text>
          {fields.map(([label, value]) => (
            <View key={label} style={s.detail}>
              <Text style={s.muted}>{label}</Text>
              <Text selectable style={s.text}>
                {value}
              </Text>
            </View>
          ))}
          {row.type === "transfer" && row.transfer_evidence?.length ? (
            row.transfer_evidence.map((report) => (
              <View key={report.id} style={s.detail}>
                <Text style={s.muted}>
                  Reported balance after · {name(report.account)}
                </Text>
                <Text style={s.text}>
                  {report.balance_after === null
                    ? "Not reported"
                    : money(
                        report.balance_after,
                        accounts.find((item) => item.id === report.account)
                          ?.currency ?? currency,
                      )}
                </Text>
              </View>
            ))
          ) : (
            <View style={s.detail}>
              <Text style={s.muted}>
                Reported balance after · {name(row.account)}
              </Text>
              <Text style={s.text}>
                {row.balance_after === null
                  ? "Not reported"
                  : money(row.balance_after, currency)}
              </Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
export function TransactionActivity({
  token,
  scope,
  accounts,
  categories,
  filters,
  onFiltersChange,
  cached,
  pendingCount,
  onQuickAdd,
  onEdit,
  focused = true,
}: Props) {
  const query = activityQuery(filters),
    key = JSON.stringify(query);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const paging = useRef(false);
  const queryKey = ["activity", scope, key] as const;
  const timeline = useInfiniteQuery({
    queryKey,
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      if (query.search && pageParam === 0) await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new Error("Search cancelled.")); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 250);
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
      return listTransactionActivity(tokenRef.current, JSON.parse(key), pageParam, signal);
    },
    getNextPageParam: page => page.next_offset ?? undefined,
    enabled: focused,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: false,
  });
  const rows = useMemo(() => timeline.data
    ? appendActivityPage([], timeline.data.pages.flatMap(page => page.results))
    : key === JSON.stringify(activityQuery(initialActivityFilters())) ? cached : [],
    [timeline.data, key, cached]);
  const count = timeline.data?.pages[0]?.count ?? null;
  const loadingMore = timeline.isFetchingNextPage;
  const loading = timeline.isFetching && !loadingMore;
  const error = timeline.error
    ? (timeline.error as { status?: number }).status === 404
      ? "Activity needs the latest backend deployment. Saved recent entries may still be shown."
      : timeline.error.message || "Could not load activity."
    : "";
  const [filterSheet, setFilterSheet] = useState(false);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const scroll = useRetainedScroll<FlatList<Transaction>>(focused, key);
  const accountNames = useMemo(() => new Map(accounts.map(item => [item.id, item.name])), [accounts]);
  const categoryNames = useMemo(() => new Map(categories.map(item => [item.id, item.name])), [categories]);
  async function loadMore() {
    if (paging.current || timeline.isFetching || !timeline.hasNextPage || !focused) return;
    paging.current = true;
    try { await timeline.fetchNextPage({ cancelRefetch: false }); }
    finally { paging.current = false; }
  }
  function refresh() { void timeline.refetch({ cancelRefetch: false }); }
  const sortLabel =
    filters.ordering === "-date"
      ? "Transaction date"
      : filters.ordering === "-created_at"
        ? "Added date · Asia/Dhaka"
        : "Updated date · Asia/Dhaka";
  const activeCount = [
    filters.account,
    filters.category,
    filters.type,
    filters.mode !== "all" ? filters.mode : "",
  ].filter(Boolean).length;
  const activeSummary = [
    filters.account
      ? (accounts.find((item) => item.id === filters.account)?.name ??
        "Selected account")
      : "",
    filters.category
      ? (categories.find((item) => item.id === filters.category)?.name ??
        "Selected category")
      : "",
    filters.type ? title(filters.type) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <View style={s.screen}>
      <FlatList
        ref={scroll.ref}
        onScroll={scroll.onScroll}
        onScrollBeginDrag={scroll.onScrollBeginDrag}
        onLayout={scroll.onLayout}
        onContentSizeChange={scroll.onContentSizeChange}
        scrollEventThrottle={16}
        data={rows}
        keyExtractor={(row) => row.id}
        keyboardShouldPersistTaps="handled"
        refreshing={loading && rows.length > 0}
        onRefresh={refresh}
        contentContainerStyle={s.content}
        ListHeaderComponent={
          <View style={s.contentHeader}>
            <Text accessibilityRole="header" style={s.heading}>
              Activity
            </Text>
            <TextInput
              accessibilityLabel="Search activity"
              autoCorrect={false}
              placeholder="Search transactions"
              placeholderTextColor="#91a7c2"
              maxLength={256}
              style={s.input}
              value={filters.search}
              onChangeText={(search) => onFiltersChange({ ...filters, search })}
            />
            <View style={s.wrap}>
              <Button
                label={`Activity filters${activeCount ? ` (${activeCount})` : ""}`}
                onPress={() => setFilterSheet(true)}
              />
              <Button label="Quick Add manual entry" onPress={onQuickAdd} />
              <Button
                label="Refresh activity"
                onPress={refresh}
              />
              {activeCount || filters.search || filters.ordering !== "-date" ? (
                <Button
                  label="Clear activity filters"
                  onPress={() => onFiltersChange(initialActivityFilters())}
                />
              ) : null}
            </View>
            <Text style={s.muted}>
              {sortLabel}
              {filters.mode === "all"
                ? " · All transaction dates"
                : ` · ${filters.mode === "monthly" ? filters.start.slice(0, 7) : filters.start}${filters.mode === "custom" ? ` – ${filters.end}` : ""}`}
            </Text>
            {pendingCount > 0 ? (
              <Text style={s.muted}>
                {pendingCount} manual entries waiting to sync
              </Text>
            ) : null}
            {activeSummary ? (
              <Text style={s.muted}>{activeSummary}</Text>
            ) : null}
            {count !== null ? (
              <Text accessibilityLiveRegion="polite" style={s.muted}>
                {rows.length} of {count} transactions
              </Text>
            ) : rows.length ? (
              <Text style={s.muted}>
                Saved recent entries · may be incomplete
              </Text>
            ) : null}
            {loading ? (
              <View accessibilityLiveRegion="polite" style={s.wrap}>
                <ActivityIndicator color="#55e6a5" />
                <Text style={s.muted}>{rows.length ? "Refreshing activity…" : "Loading activity…"}</Text>
              </View>
            ) : null}
            {error ? (
              <View>
                <Text accessibilityRole="alert" style={s.error}>
                  {error}
                </Text>
                <Button
                  label="Retry activity"
                  onPress={refresh}
                />
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          !loading && !error ? (
            <Text style={s.muted}>No transactions match these filters.</Text>
          ) : null
        }
        ListFooterComponent={
          timeline.hasNextPage ? (
            <Button
              label={
                loadingMore
                  ? "Loading more activity…"
                  : "Load more transactions"
              }
              disabled={loading || loadingMore}
              onPress={() => void loadMore()}
            />
          ) : null
        }
        renderItem={({ item: row, index }) => {
          const currency =
            accounts.find((item) => item.id === row.account)?.currency ?? "BDT";
          const day = activityDay(row, filters.ordering),
            showDay =
              index === 0 ||
              activityDay(rows[index - 1], filters.ordering) !== day,
            transfer = row.type === "transfer",
            receiving = row.account_direction === "credit";
          const tone = transfer ? "transfer" : receiving ? "credit" : "debit";
          const category = row.category ? categoryNames.get(row.category) : null;
          return (
            <View>
              {showDay ? (
                <Text accessibilityRole="header" style={s.day}>
                  {dateLabel(day)}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`View transaction: ${row.counterparty_text || title(row.type)}, ${money(row.amount, currency)}, ${row.date}`}
                onPress={() => setSelected(row)}
                style={[s.row, tone === "transfer" ? s.transferRow : tone === "credit" ? s.creditRow : s.debitRow]}
              >
                <View style={[s.typeIcon, tone === "transfer" ? s.transferIcon : tone === "credit" ? s.creditIcon : s.debitIcon]}>
                  <Text style={[s.typeIconText, tone === "transfer" ? s.transferText : tone === "credit" ? s.credit : s.debitText]}>
                    {transfer ? "↔" : receiving ? "↓" : "↑"}
                  </Text>
                </View>
                <View style={s.rowBody}>
                  <Text numberOfLines={2} style={s.rowTitle}>
                    {transfer
                      ? `${accountNames.get(row.account) ?? "Unknown"} → ${accountNames.get(row.transfer_account ?? "") ?? "Unknown"}`
                      : row.counterparty_text || row.note || title(row.type)}
                  </Text>
                  <Text style={s.muted}>
                    {title(row.type)}{category ? ` · ${category}` : ""} ·{" "}
                    {transfer
                      ? "Between accounts"
                      : (accountNames.get(row.account) ?? "Unknown account")}
                  </Text>
                  <Text style={s.muted}>
                    {row.time?.slice(0, 5) || "Time not reported"} · {title(row.source)}
                    {filters.ordering !== "-date" ? ` · ${dateLabel(row.date)}` : ""}
                  </Text>
                </View>
                <Text style={[s.rowAmount, tone === "transfer" ? s.transferText : receiving ? s.credit : s.debitText]}>
                  {transfer && !filters.account
                    ? "↔ "
                    : receiving
                      ? "+ "
                      : "− "}
                  {money(row.amount, currency)}
                </Text>
              </Pressable>
            </View>
          );
        }}
      />
      {filterSheet ? (
        <ActivityFilterSheet
          value={filters}
          accounts={accounts}
          categories={categories}
          onClose={() => setFilterSheet(false)}
          onApply={(value) => {
            onFiltersChange(value);
            setFilterSheet(false);
          }}
        />
      ) : null}
      {selected ? (
        <TransactionDetails
          onEdit={onEdit}
          row={selected}
          accounts={accounts}
          categories={categories}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </View>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#081421" },
  content: { padding: 16, paddingBottom: 28, gap: 10 },
  contentHeader: { gap: 10, marginBottom: 10 },
  heading: { color: "#f6f8fc", fontSize: 22, fontWeight: "700", flexShrink: 1 },
  text: { color: "#f6f8fc", fontSize: 15 },
  muted: { color: "#a8b8cc", fontSize: 13, lineHeight: 19 },
  input: {
    color: "#f6f8fc",
    backgroundColor: "#0e1c2c",
    borderWidth: 1,
    borderColor: "#2a4059",
    borderRadius: 10,
    padding: 12,
    minHeight: 48,
  },
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  button: {
    minHeight: 48,
    backgroundColor: "#132a3b",
    borderRadius: 8,
    padding: 12,
    justifyContent: "center",
  },
  buttonText: { color: "#cce8ec", fontSize: 14, fontWeight: "600" },
  selected: {
    borderWidth: 1,
    borderColor: presentationColors.accent,
    backgroundColor: presentationColors.selected,
  },
  disabled: { opacity: 0.5 },
  error: { color: "#ff9399", fontSize: 14, lineHeight: 21 },
  row: {
    minHeight: 68,
    backgroundColor: "#0e1c2c",
    borderRadius: 10,
    padding: 14,
    gap: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    borderLeftWidth: 3,
  },
  debitRow: { borderLeftColor: "#ff9399" },
  creditRow: { borderLeftColor: "#55e6a5" },
  transferRow: { borderLeftColor: "#75b8ff" },
  rowBody: { flexGrow: 1, flexShrink: 1, minWidth: 140, gap: 4 },
  rowTitle: { color: "#f6f8fc", fontSize: 15, fontWeight: "700" },
  typeIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  typeIconText: { fontSize: 18, fontWeight: "700" },
  debitIcon: { backgroundColor: "#3a232c" },
  creditIcon: { backgroundColor: "#12382f" },
  transferIcon: { backgroundColor: "#112d43" },
  debitText: { color: "#ff9399" },
  transferText: { color: "#75b8ff" },
  rowAmount: {
    color: "#d8e3f0",
    fontSize: 15,
    fontWeight: "700",
    flexShrink: 1,
  },
  credit: { color: "#55e6a5" },
  day: {
    color: "#a8b8cc",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 14,
    marginBottom: 8,
  },
  sheetHeader: {
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  footer: { padding: 16, gap: 8, flexDirection: "row", flexWrap: "wrap" },
  option: {
    minHeight: 48,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#263a52",
  },
  detail: {
    gap: 4,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#263a52",
  },
  amount: { color: "#55e6a5", fontSize: 30, fontWeight: "700" },
});
