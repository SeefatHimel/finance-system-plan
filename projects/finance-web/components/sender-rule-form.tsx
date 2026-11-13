"use client";
import type { FormEvent } from "react";
import { Trash } from "@phosphor-icons/react";
import type {
  Account,
  Category,
  PaymentMethod,
  SenderRuleMatchType,
  SenderRuleProvider,
  TransactionType,
} from "@/lib/api";
import { senderProviderLabels } from "@/lib/sender-rule-display";
import { pathaoSenders } from "../../finance-contracts/sender-groups";
import { ButtonBusy } from "./loading-state";
export type SenderRuleDraft = {
  account: string;
  provider: SenderRuleProvider;
  sender: string;
  name: string;
  category: string;
  payment_method: string;
  default_transaction_type: TransactionType | "";
  match_type: SenderRuleMatchType;
  pattern: string;
  priority: string;
  is_active: boolean;
};
const types: TransactionType[] = [
  "expense",
  "income",
  "transfer",
  "adjustment",
  "fee",
  "refund",
];
type Props = {
  mode: "add" | "edit";
  draft: SenderRuleDraft;
  change: (patch: Partial<SenderRuleDraft>) => void;
  preset: boolean;
  setPreset: (preset: boolean) => void;
  advanced: boolean;
  setAdvanced: (advanced: boolean) => void;
  busy: string | null;
  save: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  close: () => void;
  onRemove: () => void;
  accounts: Account[];
  categories: Category[];
  paymentMethods: PaymentMethod[];
};
export function SenderRuleForm({
  mode,
  draft,
  change,
  preset,
  setPreset,
  advanced,
  setAdvanced,
  busy,
  save,
  close,
  onRemove,
  accounts,
  categories,
  paymentMethods,
}: Props) {
  const wallets = accounts.filter(
    (account) =>
      account.is_active &&
      account.type === "mobile_wallet" &&
      account.currency === "BDT",
  );
  const matchingMethods = paymentMethods.filter(
    (method) =>
      method.account === draft.account &&
      (method.is_active || method.id === draft.payment_method),
  );
  return (
    <form
      className="sender-rule-editor-form"
      onSubmit={(event) => void save(event)}
    >
      <div className="sender-rule-dialog-body">
        {mode === "add" ? (
          <fieldset className="sender-setup-mode">
            <legend className="sr-only">Sender setup</legend>
            <label>
              <input
                type="radio"
                name="sender_setup"
                checked={!preset}
                disabled={Boolean(busy)}
                onChange={() => {
                  setPreset(false);
                  change({ account: "" });
                }}
              />
              One sender
            </label>
            <label>
              <input
                type="radio"
                name="sender_setup"
                checked={preset}
                disabled={Boolean(busy)}
                onChange={() => {
                  setPreset(true);
                  change({
                    account: wallets.length === 1 ? wallets[0].id : "",
                  });
                }}
              />
              Pathao Pay group
            </label>
          </fieldset>
        ) : null}
        {preset ? (
          <>
            <p className="sender-preset-note">
              Add these four Pathao Pay sender names together. Existing rules
              keep their account, category and enabled state.
            </p>
            <div className="sender-alias-chips">
              {pathaoSenders.map((alias) => (
                <span key={alias}>{alias}</span>
              ))}
            </div>
          </>
        ) : null}
        <div className="sender-rule-form-grid">
          <label className="field field--wide">
            <span className="field__label">
              {preset ? "Pathao Pay wallet" : "Reporting account"}
            </span>
            <select
              id="sender-rule-account"
              aria-label={preset ? "Pathao Pay wallet" : "Reporting account"}
              className="field__control"
              required
              value={draft.account}
              disabled={Boolean(busy)}
              onChange={(event) =>
                change({
                  account: event.target.value,
                  payment_method: "",
                })
              }
            >
              <option value="">Choose account</option>
              {(preset
                ? wallets
                : accounts.filter(
                    (account) =>
                      account.is_active || account.id === draft.account,
                  )
              ).map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                  {account.is_active ? "" : " (inactive)"}
                </option>
              ))}
            </select>
            {preset && !wallets.length ? (
              <span className="field__hint">
                Create an active BDT mobile wallet in Accounts first.
              </span>
            ) : (
              <span className="field__hint">
                The account this SMS reports a movement or balance for.
              </span>
            )}
          </label>
          {!preset ? (
            <>
              <label className="field">
                <span className="field__label">Provider</span>
                <select
                  className="field__control"
                  value={draft.provider}
                  disabled={Boolean(busy)}
                  onChange={(event) =>
                    change({
                      provider: event.target.value as SenderRuleProvider,
                    })
                  }
                >
                  {Object.entries(senderProviderLabels).map(([value, name]) => (
                    <option key={value} value={value}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">SMS sender name</span>
                <input
                  className="field__control"
                  required
                  maxLength={120}
                  value={draft.sender}
                  disabled={Boolean(busy)}
                  placeholder="e.g. CITYBANK"
                  onChange={(event) => change({ sender: event.target.value })}
                />
              </label>
            </>
          ) : null}
        </div>
        {!preset ? (
          <>
            <label className="sender-rule-enabled">
              <input
                type="checkbox"
                checked={draft.is_active}
                disabled={Boolean(busy)}
                onChange={(event) =>
                  change({ is_active: event.target.checked })
                }
              />
              Rule enabled
            </label>
            <details
              className="sender-rule-advanced"
              open={advanced}
              onToggle={(event) => setAdvanced(event.currentTarget.open)}
            >
              <summary>
                Advanced options
                <span>Category, matching and priority</span>
              </summary>
              <div className="sender-rule-form-grid">
                <label className="field field--wide">
                  <span className="field__label">Rule name (optional)</span>
                  <input
                    className="field__control"
                    maxLength={120}
                    value={draft.name}
                    placeholder="Use provider and sender name"
                    disabled={Boolean(busy)}
                    onChange={(event) => change({ name: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field__label">Default category</span>
                  <select
                    className="field__control"
                    value={draft.category}
                    disabled={Boolean(busy)}
                    onChange={(event) =>
                      change({ category: event.target.value })
                    }
                  >
                    <option value="">Automatic</option>
                    {categories
                      .filter(
                        (category) =>
                          category.is_active || category.id === draft.category,
                      )
                      .map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                  </select>
                  <span className="field__hint">
                    More specific saved choices take priority.
                  </span>
                </label>
                <label className="field">
                  <span className="field__label">Payment method</span>
                  <select
                    className="field__control"
                    value={draft.payment_method}
                    disabled={Boolean(busy)}
                    onChange={(event) =>
                      change({ payment_method: event.target.value })
                    }
                  >
                    <option value="">No specific method</option>
                    {matchingMethods.map((method) => (
                      <option key={method.id} value={method.id}>
                        {method.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">Sender matching</span>
                  <select
                    className="field__control"
                    value={draft.match_type}
                    disabled={Boolean(busy)}
                    onChange={(event) =>
                      change({
                        match_type: event.target.value as SenderRuleMatchType,
                      })
                    }
                  >
                    <option value="exact">Exact name (recommended)</option>
                    <option value="contains">Name contains text</option>
                    <option value="regex">Regular expression</option>
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">Priority</span>
                  <input
                    className="field__control"
                    type="number"
                    min={0}
                    max={2147483647}
                    step={1}
                    value={draft.priority}
                    disabled={Boolean(busy)}
                    onChange={(event) =>
                      change({ priority: event.target.value })
                    }
                  />
                  <span className="field__hint">
                    Lower numbers are checked first.
                  </span>
                </label>
                {draft.match_type !== "exact" ? (
                  <label className="field field--wide">
                    <span className="field__label">
                      Matching pattern (optional)
                    </span>
                    <input
                      className="field__control"
                      maxLength={255}
                      value={draft.pattern}
                      placeholder="Use the sender name above"
                      disabled={Boolean(busy)}
                      onChange={(event) =>
                        change({ pattern: event.target.value })
                      }
                    />
                    <span className="field__hint">
                      Broader matching can include unwanted senders. Use an
                      exact name when possible.
                    </span>
                  </label>
                ) : null}
                <label className="field field--wide">
                  <span className="field__label">
                    Fallback transaction type
                  </span>
                  <select
                    className="field__control"
                    value={draft.default_transaction_type}
                    disabled={Boolean(busy)}
                    onChange={(event) =>
                      change({
                        default_transaction_type: event.target.value as
                          | TransactionType
                          | "",
                      })
                    }
                  >
                    <option value="">Detect from each message</option>
                    {types.map((type) => (
                      <option key={type} value={type}>
                        {type.charAt(0).toUpperCase() + type.slice(1)}
                      </option>
                    ))}
                  </select>
                  <span className="field__hint">
                    Only used when the parser cannot identify the message kind.
                    Debit and credit still come from the source.
                  </span>
                </label>
              </div>
            </details>
          </>
        ) : null}
      </div>
      <footer className="sender-rule-dialog-footer">
        {mode === "edit" ? (
          <button
            className="sender-rule-remove"
            type="button"
            disabled={Boolean(busy)}
            onClick={() => onRemove()}
          >
            <Trash size={16} aria-hidden="true" />
            Remove rule
          </button>
        ) : null}
        <button
          className="button button--ghost"
          type="button"
          disabled={Boolean(busy)}
          onClick={close}
        >
          Cancel
        </button>
        <button
          className="button button--primary"
          type="submit"
          disabled={
            Boolean(busy) ||
            (mode === "add" &&
              !preset &&
              !accounts.some((account) => account.is_active)) ||
            (preset && !wallets.length)
          }
        >
          {busy ? (
            <ButtonBusy label="Saving" />
          ) : preset ? (
            "Set up Pathao Pay group"
          ) : mode === "edit" ? (
            "Save changes"
          ) : (
            "Add sender"
          )}
        </button>
      </footer>
    </form>
  );
}
