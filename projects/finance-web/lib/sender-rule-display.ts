import { senderRuleGroups } from "../../finance-contracts/sender-groups";
type DisplayRule = {
  id: string;
  sender: string;
  name: string;
  provider: string;
  account: string;
  category: string | null;
  match_type: string;
  is_active: boolean;
  priority: number;
};
type NamedReference = { id: string; name: string };

export const senderProviderLabels: Record<string, string> = {
  bkash: "bKash",
  nagad: "Nagad",
  rocket: "Rocket",
  ebl: "EBL",
  city_bank: "City Bank",
  pathao_pay: "Pathao Pay",
  bank: "Bank",
  card: "Card",
  other: "Other",
};
export type SenderStatusFilter =
  | "all"
  | "enabled"
  | "disabled"
  | "provider_paused";

/** Search/filter selects whole connections; it never drops hidden aliases from a group. */
export function visibleSenderGroups<T extends DisplayRule>(
  rules: T[],
  accounts: NamedReference[],
  categories: NamedReference[],
  excluded: string[],
  search: string,
  status: SenderStatusFilter,
) {
  const accountNames = new Map(
    accounts.map((account) => [account.id, account.name]),
  );
  const categoryNames = new Map(
    categories.map((category) => [category.id, category.name]),
  );
  const query = search.trim().toLocaleLowerCase();
  return senderRuleGroups(rules)
    .sort(
      (left, right) =>
        Math.min(...left.members.map((rule) => rule.priority)) -
          Math.min(...right.members.map((rule) => rule.priority)) ||
        (left.grouped ? left.label : left.members[0].name).localeCompare(
          right.grouped ? right.label : right.members[0].name,
        ),
    )
    .filter((group) => {
      const paused = excluded.includes(group.members[0].provider);
      if (status === "provider_paused" && !paused) return false;
      if (
        status === "enabled" &&
        (paused || !group.members.some((rule) => rule.is_active))
      )
        return false;
      if (
        status === "disabled" &&
        !group.members.some((rule) => !rule.is_active)
      )
        return false;
      return (
        !query ||
        group.members.some((rule) =>
          [
            rule.name,
            rule.sender,
            senderProviderLabels[rule.provider],
            accountNames.get(rule.account),
            categoryNames.get(rule.category ?? ""),
          ].some((value) => value?.toLocaleLowerCase().includes(query)),
        )
      );
    });
}
