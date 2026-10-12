"use client";
import { useEffect, useState } from "react";
import { useQuickAdd } from "./quick-add";
import { ModalDialog } from "./modal-dialog";
import {
  blankPreset,
  categoryFits,
  type PresetInput,
  type QuickPreset,
} from "../../finance-contracts/quick-add";

export function QuickAddWorkspace() {
  const quick = useQuickAdd();
  const { load } = quick;
  const [editing, setEditing] = useState<{
    id?: string;
    input: PresetInput;
  } | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void load();
  }, [load]);
  function edit(preset: QuickPreset, duplicate = false) {
    const id = preset.id;
    const input: PresetInput = {
      name: preset.name,
      type: preset.type,
      account: preset.account,
      category: preset.category,
      amount: preset.amount,
      note: preset.note,
      counterparty_text: preset.counterparty_text,
      is_enabled: preset.is_enabled,
      is_favorite: preset.is_favorite,
      display_order: preset.display_order,
    };
    setEditing({
      id: duplicate ? undefined : id,
      input: {
        ...input,
        name: duplicate ? `${preset.name} copy`.slice(0, 120) : preset.name,
      },
    });
    setError("");
  }
  async function mutate(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save preset.");
    } finally {
      setBusy(false);
    }
  }
  const change = (patch: Partial<PresetInput>) =>
    setEditing((old) =>
      old ? { ...old, input: { ...old.input, ...patch } } : old,
    );
  return (
    <div className="workspace-grid">
      <section className="panel">
        <div className="panel__body">
          <div className="quick-heading">
            <div>
              <h2 className="section-title">Quick Add presets</h2>
              <p className="section-subtitle">
                Your shortcuts, accounts and categories. Each shortcut fills a
                draft; Save creates the transaction.
              </p>
            </div>
            <button
              className="button button--primary"
              onClick={() => {
                setEditing({
                  input: {
                    ...blankPreset(),
                    display_order: quick.presets.length,
                  },
                });
                setError("");
              }}
              type="button"
            >
              Create preset
            </button>
          </div>
        </div>
      </section>
      {quick.error ? (
        <p className="form-error">
          {quick.error}
          <button onClick={() => void quick.load()} type="button">
            Retry
          </button>
        </p>
      ) : null}
      {error && !editing ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {!quick.loaded && !quick.error ? (
        <p role="status">Loading presets…</p>
      ) : null}
      <section className="panel">
        <div className="panel__body quick-manager-list">
          {quick.presets.map((preset, index) => (
            <article className="quick-manager-row" key={preset.id}>
              <div>
                <strong>{preset.name}</strong>
                <p>
                  {preset.type} ·{" "}
                  {quick.accounts.find((a) => a.id === preset.account)?.name ??
                    "Choose account at entry"}{" "}
                  ·{" "}
                  {quick.categories.find((c) => c.id === preset.category)
                    ?.name ?? "Uncategorized"}
                  {preset.amount ? ` · ${preset.amount}` : ""}
                </p>
                <small>
                  {preset.is_enabled ? "Enabled" : "Disabled"} ·{" "}
                  {preset.is_favorite ? "Favorite" : "See all"}
                  {!preset.available ? " · Needs active account/category" : ""}
                </small>
              </div>
              <div className="quick-manager-actions">
                <button
                  className="button button--ghost"
                  disabled={busy || !preset.is_enabled}
                  onClick={() => quick.open(preset)}
                  type="button"
                  aria-label={`Use ${preset.name}`}
                >
                  Use
                </button>
                <button
                  className="button button--ghost"
                  disabled={busy}
                  onClick={() => edit(preset)}
                  type="button"
                  aria-label={`Edit ${preset.name}`}
                >
                  Edit
                </button>
                <button
                  className="button button--ghost"
                  disabled={busy}
                  onClick={() => edit(preset, true)}
                  type="button"
                  aria-label={`Duplicate ${preset.name}`}
                >
                  Duplicate
                </button>
                <button
                  className="button button--ghost"
                  disabled={busy}
                  onClick={() =>
                    void mutate(() =>
                      quick.savePreset(
                        { is_enabled: !preset.is_enabled },
                        preset.id,
                      ),
                    )
                  }
                  type="button"
                >
                  {preset.is_enabled ? "Disable" : "Enable"}
                </button>
                {[-1, 1].map((delta) => (
                  <button
                    className="button button--ghost"
                    key={delta}
                    aria-label={`Move ${preset.name} ${delta < 0 ? "up" : "down"}`}
                    disabled={
                      busy ||
                      index + delta < 0 ||
                      index + delta >= quick.presets.length
                    }
                    type="button"
                    onClick={() =>
                      void mutate(() => {
                        const ids = quick.presets.map((p) => p.id);
                        [ids[index], ids[index + delta]] = [
                          ids[index + delta],
                          ids[index],
                        ];
                        return quick.reorder(ids);
                      })
                    }
                  >
                    {delta < 0 ? "↑" : "↓"}
                  </button>
                ))}
              </div>
            </article>
          ))}
          {quick.loaded && !quick.presets.length ? (
            <p>
              Create a preset such as Lunch, Transport or Shopping. Choose your
              own defaults.
            </p>
          ) : null}
        </div>
      </section>
      {editing ? (
        <ModalDialog
          initialFocus="input"
          labelledBy="preset-editor-title"
          busy={busy}
          className="decision-modal quick-add-modal"
          onCancel={() => setEditing(null)}
        >
          <h2 id="preset-editor-title">
            {editing.id ? "Edit preset" : "Create preset"}
          </h2>
          <form
            className="quick-entry-fields"
            onSubmit={(event) => {
              event.preventDefault();
              void mutate(async () => {
                await quick.savePreset(editing.input, editing.id);
                setEditing(null);
              });
            }}
          >
            <fieldset disabled={busy} className="quick-entry-fields">
              <label className="field">
                <span className="field__label">Preset name</span>
                <input
                  autoFocus
                  className="field__control"
                  value={editing.input.name}
                  maxLength={120}
                  required
                  onChange={(event) => change({ name: event.target.value })}
                />
              </label>
              <div className="quick-fields">
                <label className="field">
                  <span className="field__label">Preset type</span>
                  <select
                    className="field__control"
                    value={editing.input.type}
                    onChange={(event) =>
                      change({
                        type: event.target.value as "expense" | "income",
                        category: null,
                      })
                    }
                  >
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">Default account</span>
                  <select
                    className="field__control"
                    value={editing.input.account ?? ""}
                    onChange={(event) =>
                      change({ account: event.target.value || null })
                    }
                  >
                    <option value="">Choose at entry</option>
                    {quick.accounts
                      .filter((a) => a.is_active)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">Default category</span>
                  <select
                    className="field__control"
                    value={editing.input.category ?? ""}
                    onChange={(event) =>
                      change({ category: event.target.value || null })
                    }
                  >
                    <option value="">Uncategorized / choose at entry</option>
                    {quick.categories
                      .filter(
                        (c) =>
                          c.is_active &&
                          categoryFits(c.kind, editing.input.type),
                      )
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">
                    Default amount (optional)
                  </span>
                  <input
                    className="field__control"
                    inputMode="decimal"
                    value={editing.input.amount ?? ""}
                    onChange={(event) =>
                      change({ amount: event.target.value || null })
                    }
                  />
                </label>
              </div>
              <label className="field">
                <span className="field__label">
                  Default merchant / counterparty
                </span>
                <input
                  className="field__control"
                  value={editing.input.counterparty_text}
                  maxLength={255}
                  onChange={(event) =>
                    change({ counterparty_text: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span className="field__label">Default note</span>
                <input
                  className="field__control"
                  value={editing.input.note}
                  maxLength={2000}
                  onChange={(event) => change({ note: event.target.value })}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={editing.input.is_favorite}
                  onChange={(event) =>
                    change({ is_favorite: event.target.checked })
                  }
                />{" "}
                Show among favorite shortcuts
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={editing.input.is_enabled}
                  onChange={(event) =>
                    change({ is_enabled: event.target.checked })
                  }
                />{" "}
                Enabled
              </label>
              <p>
                Dates and times are resolved for each entry. Saving a
                transaction never edits this preset.
              </p>
            </fieldset>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="decision-modal__actions">
              <button
                className="button button--ghost"
                disabled={busy}
                onClick={() => setEditing(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="button button--primary"
                disabled={busy}
                type="submit"
              >
                {busy ? "Saving…" : "Save preset"}
              </button>
            </div>
          </form>
        </ModalDialog>
      ) : null}
    </div>
  );
}
