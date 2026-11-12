/** Exact trusted aliases. Existing rules/IDs and per-device choices stay intact. */
export const pathaoSenders = [
  "Pathao.Pay",
  "Pathao Pay.",
  "PathaoPay.",
  "PathaoPay",
] as const;
export function isPathaoSender(sender: string, provider = "pathao_pay") {
  return (
    provider === "pathao_pay" &&
    pathaoSenders.some(
      (alias) => alias.toLowerCase() === sender.trim().toLowerCase(),
    )
  );
}
export function senderRuleGroups<
  T extends {
    id: string;
    sender: string;
    provider: string;
    account: string;
    match_type: string;
  },
>(rules: T[]) {
  const result = new Map<
    string,
    { key: string; label: string; grouped: boolean; members: T[] }
  >();
  for (const rule of rules) {
    const grouped =
      rule.match_type === "exact" && isPathaoSender(rule.sender, rule.provider);
    const key = grouped ? `pathao_pay:${rule.account}` : rule.id;
    const group = result.get(key) ?? {
      key,
      label: grouped ? "Pathao Pay" : rule.sender,
      grouped,
      members: [],
    };
    group.members.push(rule);
    result.set(key, group);
  }
  return [...result.values()];
}

export type PathaoSourcePreview = {
  available: boolean;
  reference: string;
  keep: string | null;
  preview_token: string;
  can_resolve: boolean;
  blockers: string[];
  sources: {
    id: string;
    sender: string;
    text: string;
    received_at: string;
    status: string;
    transaction: string | null;
    amount: string | null;
    direction: string;
    balance_after: string | null;
    fee_amount: string | null;
  }[];
  transactions: {
    id: string;
    account_name: string;
    date: string;
    amount: string;
    direction: string;
    balance_after: string | null;
    description: string;
    note: string;
    type: string;
  }[];
};
