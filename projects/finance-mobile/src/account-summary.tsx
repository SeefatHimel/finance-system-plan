import { Text, View } from "react-native";
import { useMobileUi, ActionButton } from "./mobile-ui";
import type { Account } from "./api";
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
  return (
    <View style={ui.card}>
      <View style={ui.row}>
        <Text accessibilityRole="header" style={[ui.title, { flexGrow: 1 }]}>
          {account.name}
        </Text>
        <Text style={ui.muted}>
          {account.is_active === false
            ? "Inactive"
            : account.is_active === true
              ? "Active"
              : "Saved"}
        </Text>
      </View>
      {cached ? (
        <Text style={ui.muted}>
          Saved account snapshot · refresh when connected
        </Text>
      ) : null}
      <Text style={ui.muted}>
        {displayLabel(account.type)} · {account.currency}
      </Text>
      <Text style={ui.muted}>Ledger balance</Text>
      <Text style={ui.title}>
        {formatCurrency(account.ledger_balance, account.currency)}
      </Text>
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
    </View>
  );
}
