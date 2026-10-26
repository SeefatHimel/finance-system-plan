import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useMobileUi, ActionButton } from "./mobile-ui";
import type { Account } from "./api";
import { InstitutionMark } from "./institution-mark";
import {
  displayLabel,
  formatCalendarDate,
  formatCurrency,
} from "../../finance-contracts/presentation";
export function AccountSummary({
  account,
  onReview,
  cached = false,
}: {
  account: Account;
  cached?: boolean;
  onReview: () => void;
}) {
  const ui = useMobileUi();
  const comparison = account.reported_balance_comparison;
  const [expanded, setExpanded] = useState(false);
  const hasDifference = comparison === "mismatch" && account.type !== "credit_card";
  return (
    <View style={ui.card}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${account.name}, ledger balance ${formatCurrency(account.ledger_balance, account.currency)}${hasDifference ? ", reported balance needs review" : ""}`}
        accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={ui.row}>
        <InstitutionMark name={account.name} type={account.type} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={ui.title}>{account.name}</Text>
          <Text style={ui.muted}>{displayLabel(account.type)} · {account.currency}{account.is_active === false ? " · Inactive" : ""}</Text>
        </View>
        <View style={{ alignItems: "flex-end", flexShrink: 1 }}>
          <Text numberOfLines={1} adjustsFontSizeToFit style={ui.text}>{formatCurrency(account.ledger_balance, account.currency)}</Text>
          <Text style={hasDifference ? ui.error : ui.muted}>{hasDifference ? "Check balance · " : "Details · "}{expanded ? "⌃" : "⌄"}</Text>
        </View>
      </Pressable>
      {expanded ? <>
      {cached ? (
        <Text style={ui.muted}>
          Saved account snapshot · refresh when connected
        </Text>
      ) : null}
      <Text style={ui.muted}>
        Latest reported balance
        {account.latest_reported_balance_date
          ? ` · ${formatCalendarDate(account.latest_reported_balance_date)}`
          : ""}
      </Text>
      <Text style={ui.text}>
        {formatCurrency(account.latest_reported_balance, account.currency)}
      </Text>
      {account.type === "credit_card" ||
      comparison === "credit_card_reference" ? (
        <Text style={ui.muted}>
          Card balance reference; not a cash-balance comparison.
        </Text>
      ) : comparison === "mismatch" ? (
        <>
          <Text style={ui.error}>
            Reported minus ledger at report:{" "}
            {formatCurrency(
              account.latest_reported_balance_difference,
              account.currency,
            )}
          </Text>
          <Text style={ui.muted}>
            Ledger at report:{" "}
            {formatCurrency(
              account.ledger_balance_at_latest_report,
              account.currency,
            )}
          </Text>
          <ActionButton
            label={`Review balance difference for ${account.name}`}
            onPress={onReview}
          />
        </>
      ) : comparison === "matched" ? (
        <Text style={ui.text}>Matches the ledger at the report time.</Text>
      ) : account.latest_reported_balance !== null ? (
        <Text style={ui.muted}>
          Check report timing before comparing with today's balance.
        </Text>
      ) : null}
      </> : null}
    </View>
  );
}
