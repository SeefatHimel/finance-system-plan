"use client";

import { useState } from "react";
import { accountAvatar, isAccountLogo } from "@/lib/account-avatar";

type AccountAppearance = { id?: string; name: string; logo?: string };

export function AccountAvatar({ account, size = "small" }: { account: AccountAppearance; size?: "small" | "medium" | "large" }) {
  const { initial, color } = accountAvatar(account.name, account.id);
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const logo = isAccountLogo(account.logo) && account.logo !== failedLogo ? account.logo : null;
  return <span className={`account-avatar account-avatar--${size} account-avatar--${color}${logo ? " account-avatar--image" : ""}`} aria-hidden="true">
    {logo ? /* Already resized by the API; inline images need no Next optimizer. */
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logo} alt="" width={128} height={128} decoding="async" onError={() => setFailedLogo(logo)} /> : initial}
  </span>;
}

export function AccountLabel({ account, fallback = "Account", size = "small" }: { account?: AccountAppearance; fallback?: string; size?: "small" | "medium" }) {
  const display = account ?? { name: fallback };
  return <span className="account-label"><AccountAvatar account={display} size={size} /><span>{display.name}</span></span>;
}
