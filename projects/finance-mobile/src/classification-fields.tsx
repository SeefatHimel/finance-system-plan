import { CompactFields } from "./compact-form";
import { useState } from "react";
import { Text, View } from "react-native";
import type { Category } from "./api";
import { SearchSelect, ActionButton, useMobileUi } from "./mobile-ui";
import {
  categoryTypes,
  directionForType,
  transactionTypes,
} from "./transaction-draft";
import { displayLabel } from "../../finance-contracts/presentation";
export function ClassificationFields({
  type,
  category,
  categories,
  disabled,
  compact = false,
  onChange,
}: {
  type: string;
  category: string;
  categories: Category[];
  disabled?: boolean;
  compact?: boolean;
  onChange: (value: {
    type: string;
    category: string;
    direction?: string;
  }) => void;
}) {
  const ui = useMobileUi();
  const [proposal, setProposal] = useState<{
    label: string;
    options: { type: string; category: string }[];
  } | null>(null);
  function chooseType(next: string) {
    const selected = categories.find((item) => item.id === category),
      allowed = categoryTypes(selected?.kind);
    if (allowed && !allowed.includes(next))
      setProposal({
        label: `${selected?.name} does not fit ${displayLabel(next)}. Clear the category and change type?`,
        options: [{ type: next, category: "" }],
      });
    else {
      setProposal(null);
      onChange({
        type: next,
        category,
        ...(next !== type ? { direction: directionForType(next) } : {}),
      });
    }
  }
  function chooseCategory(id: string) {
    const selected = categories.find((item) => item.id === id),
      allowed = categoryTypes(selected?.kind);
    if (allowed && !allowed.includes(type))
      setProposal({
        label: `${selected?.name} needs a compatible transaction type. Choose the intended movement.`,
        options: allowed.map((next) => ({ type: next, category: id })),
      });
    else {
      setProposal(null);
      onChange({ type, category: id });
    }
  }
  return (
    <View style={{ gap: compact ? 8 : 12 }}>
      <CompactFields minFieldWidth={180} maxColumns={2} gap={compact ? 8 : 12}>
        <SearchSelect
          compact={compact}
          label="Transaction type"
          value={type}
          options={transactionTypes.map((id) => ({ id, name: displayLabel(id) }))}
          onChange={chooseType}
          disabled={disabled}
        />
        <SearchSelect
          compact={compact}
          label="Category"
          value={category}
          options={categories
            .filter((item) => item.is_active !== false || item.id === category)
            .map((item) => ({ ...item, detail: displayLabel(item.kind) }))}
          emptyLabel="No category"
          onChange={chooseCategory}
          disabled={disabled}
        />
      </CompactFields>
      {proposal ? (
        <View style={ui.card}>
          <Text accessibilityRole="alert" style={ui.text}>
            {proposal.label}
          </Text>
          {proposal.options.map((option) => (
            <ActionButton
              key={option.type}
              label={`Use ${displayLabel(option.type)}`}
              disabled={disabled}
              onPress={() => {
                onChange({
                  ...option,
                  direction: directionForType(option.type),
                });
                setProposal(null);
              }}
            />
          ))}
          <ActionButton
            label="Cancel category/type change"
            disabled={disabled}
            onPress={() => setProposal(null)}
          />
        </View>
      ) : null}
    </View>
  );
}
