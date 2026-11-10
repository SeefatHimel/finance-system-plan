"use client";
import { BulkImportEntryList } from "./bulk-import-entry-list";
import { BulkImportMapping } from "./bulk-import-mapping";
import { BulkImportCheckpoints } from "./bulk-import-checkpoints";

import { useEffect, useState } from "react";
import {
  X,
  UploadSimple,
  ArrowLeft,
  CheckCircle,
  WarningCircle,
  CircleNotch,
} from "@phosphor-icons/react";
import { ModalDialog } from "./modal-dialog";
import { useToast } from "./toast-provider";
import { getAccessToken } from "@/lib/auth-storage";
import type { Account, Category } from "@/lib/api";
import type { BulkConfiguration } from "../../finance-contracts/bulk-import";
import {
  createBulkImport,
  reopenBulkImport,
  getBulkImport,
  reviewBulkImport,
  commitBulkImport,
  undoBulkImport,
  listBulkImports,
  type BulkPreview,
  type BulkReceipt,
} from "@/lib/bulk-import-api";
import { displayLabel } from "../../finance-contracts/presentation";

const template =
  "Date\tCategory\tDescription\tAmount\tNotes\n2026-01-02\tFood\tExample lunch\t150.00\t\n2026-01-02\tGroceries\tExample refund\t-20.00\t";
function token() {
  const value = getAccessToken();
  if (!value) throw new Error("Sign in to import entries.");
  return value;
}
function failed(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The import could not be completed. Please retry.";
}
function changed() {
  window.dispatchEvent(new Event("finance:transactions-changed"));
}

function OriginalTable({ preview }: { preview: BulkPreview }) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(preview.rows.length / 25));
  return (
    <details className="bulk-import-disclosure">
      <summary>Original table · {preview.rows.length} rows</summary>
      <p className="muted-text">
        Original cells stay unchanged. Corrections apply to the imported
        entries.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Row</th>
              {preview.headers.map((h) => (
                <th scope="col" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.slice((page - 1) * 25, page * 25).map((row) => (
              <tr key={row.number}>
                <th scope="row">{row.number}</th>
                {preview.headers.map((h) => (
                  <td key={h}>{row.original[h] || "—"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bulk-import-pagination">
        <button
          type="button"
          className="button button--ghost button--small"
          disabled={page === 1}
          onClick={() => setPage((n) => n - 1)}
        >
          Previous source rows
        </button>
        <span>
          Page {page} of {pages}
        </span>
        <button
          type="button"
          className="button button--ghost button--small"
          disabled={page === pages}
          onClick={() => setPage((n) => n + 1)}
        >
          Next source rows
        </button>
      </div>
    </details>
  );
}

type Props = {
  accounts: Account[];
  categories: Category[];
  onClose: () => void;
};
export function BulkImportDialog({ accounts, categories, onClose }: Props) {
  const { notify } = useToast();
  const [account, setAccount] = useState(
    accounts.find((a) => ["cash", "home_cash"].includes(a.type) && a.is_active)
      ?.id ??
      accounts.find((a) => a.is_active)?.id ??
      "",
  );
  const [text, setText] = useState("");
  const [filename, setFilename] = useState("Pasted table");
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [config, setConfig] = useState<BulkConfiguration | null>(null);
  const [receipt, setReceipt] = useState<BulkReceipt | null>(null);
  const [busy, setBusy] = useState("");
  const [dirty, setDirty] = useState(false);

  const [recent, setRecent] = useState<
    Awaited<ReturnType<typeof listBulkImports>>
  >([]);
  const [historyError, setHistoryError] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const selected = accounts.find((a) => a.id === (preview?.account ?? account));
  const currency = selected?.currency ?? "BDT";

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve()
      .then(() => listBulkImports(token(), controller.signal))
      .then(setRecent)
      .catch(() => {
        if (!controller.signal.aborted) setHistoryError(true);
      });
    return () => controller.abort();
  }, []);
  function accept(next: BulkPreview) {
    setPreview(next);
    setConfig({
      ...next.configuration,
      decisions: Object.fromEntries(
        Object.entries(next.configuration.decisions).map(([key, d]) => [
          key,
          {
            ...d,
            reviewed:
              next.rows.find((r) => String(r.number) === key)?.reviewed ??
              false,
          },
        ]),
      ),
    });
    setDirty(false);
    setReceipt(
      next.state === "draft"
        ? null
        : { id: next.id, state: next.state, receipt: next.receipt },
    );
  }
  function edit(update: Partial<BulkConfiguration>) {
    setConfig((c) => (c ? { ...c, ...update } : c));
    setDirty(true);
  }

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    try {
      await action();
    } catch (error) {
      notify(failed(error), "error");
    } finally {
      setBusy("");
    }
  }
  async function readFile(file?: File) {
    if (!file) return;
    if (file.size > 1_000_000) {
      notify("Use a UTF-8 CSV, TSV or text file up to 1 MB.", "error");
      return;
    }
    if (!/\.(csv|tsv|txt)$/i.test(file.name)) {
      notify(
        "Copy Excel cells here, or export the sheet as UTF-8 CSV first.",
        "error",
      );
      return;
    }
    await run("Reading file", async () => {
      setText(await file.text());
      setFilename(file.name);
    });
  }

  const balanceDifferences =
    preview?.checkpoints.filter(
      (c) =>
        !c.errors.length && c.difference !== null && c.difference !== "0.00",
    ).length ?? 0;
  const blocked =
    dirty ||
    Boolean(preview?.errors.length) ||
    Boolean(preview?.summary.needs_review) ||
    !preview?.review_token;
  return (
    <ModalDialog
      className="bulk-import-dialog"
      labelledBy="bulk-import-title"
      initialFocus="#bulk-import-account"
      busy={Boolean(busy)}
      onCancel={onClose}
    >
      <header className="bulk-import-header">
        <div>
          <span className="bulk-import-eyebrow">Bulk import</span>
          <h2 id="bulk-import-title">
            {receipt
              ? "Import receipt"
              : preview
                ? "Review imported entries"
                : "Import cash entries"}
          </h2>
          <p>
            {preview
              ? `${selected?.name ?? "Selected account"} · ${currency} · ${preview.filename}`
              : "Paste from Google Sheets or Excel, or choose a CSV/TSV file."}
          </p>
        </div>
        <button
          type="button"
          className="icon-button"
          disabled={Boolean(busy)}
          onClick={onClose}
          aria-label="Close import"
        >
          <X size={22} />
        </button>
      </header>
      <div className="bulk-import-body" aria-busy={Boolean(busy)}>
        <fieldset className="bulk-import-content" disabled={Boolean(busy)}>
          {!preview && !receipt ? (
            <>
              <label className="field">
                <span className="field__label">Wallet or account</span>
                <select
                  id="bulk-import-account"
                  className="field__control"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                >
                  <option value="">Choose an account</option>
                  {accounts
                    .filter((a) => a.is_active)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · {a.currency}
                      </option>
                    ))}
                </select>
              </label>
              <div className="bulk-import-upload">
                <UploadSimple size={28} aria-hidden="true" />
                <div>
                  <strong>Bring your table</strong>
                  <p>
                    Date, category, description, amount and notes work directly.
                    Different headings can be mapped in the next step.
                  </p>
                  <label className="button button--ghost">
                    Choose CSV / TSV
                    <input
                      className="sr-only"
                      type="file"
                      accept=".csv,.tsv,.txt"
                      aria-label="Choose import file"
                      onChange={(e) => void readFile(e.target.files?.[0])}
                    />
                  </label>
                </div>
              </div>
              <label className="field">
                <span className="field__label">Paste table</span>
                <textarea
                  className="field__control bulk-import-paste"
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setFilename("Pasted table");
                  }}
                  placeholder="Date    Category    Description    Amount    Notes"
                  maxLength={1_000_000}
                />
              </label>
              <div className="bulk-import-caption">
                <span>
                  Up to 500 rows · BDT amounts may include ৳ and commas ·
                  Unknown times stay unknown.
                </span>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setText(template);
                    setFilename("Example table");
                  }}
                >
                  Try an example
                </button>
              </div>
              {recent.length || historyError ? (
                <details className="bulk-import-disclosure">
                  <summary>
                    Recent imports {recent.length ? `(${recent.length})` : ""}
                  </summary>
                  {historyError ? (
                    <p>
                      Recent imports could not load. You can still paste your
                      table; identical sources are checked by the server.
                    </p>
                  ) : (
                    recent.map((item) => (
                      <button
                        className="bulk-import-recent"
                        type="button"
                        key={item.id}
                        onClick={() =>
                          void run("Opening import", async () =>
                            accept(await getBulkImport(token(), item.id)),
                          )
                        }
                      >
                        <span>
                          {item.filename}
                          <small>
                            {accounts.find((a) => a.id === item.account)?.name}{" "}
                            ·{" "}
                            {new Date(item.created_at).toLocaleDateString(
                              "en-GB",
                            )}
                          </small>
                        </span>
                        <span>{displayLabel(item.state)}</span>
                      </button>
                    ))
                  )}
                </details>
              ) : null}
            </>
          ) : null}
          {preview && config && !receipt ? (
            <>
              <div className="bulk-import-summary">
                <span>
                  <strong>{preview.summary.new ?? 0}</strong> new
                </span>
                <span>
                  <strong>{preview.summary.linked ?? 0}</strong> linked
                </span>
                <span>
                  <strong>{preview.summary.skipped ?? 0}</strong> skipped
                </span>
                <span
                  className={
                    preview.summary.needs_review ? "bulk-import-warning" : ""
                  }
                >
                  <strong>{preview.summary.needs_review ?? 0}</strong> need
                  review
                </span>
                {balanceDifferences ? (
                  <span className="bulk-import-warning">
                    <strong>{balanceDifferences}</strong> balance{" "}
                    {balanceDifferences === 1 ? "difference" : "differences"}
                  </span>
                ) : null}
              </div>
              <BulkImportMapping
                preview={preview}
                config={config}
                categories={categories}
                onChange={edit}
              />
              {preview.errors.map((error) => (
                <p className="bulk-import-warning" key={error}>
                  {error}
                </p>
              ))}
              <BulkImportEntryList
                preview={preview}
                config={config}
                categories={categories}
                accounts={accounts}
                currency={currency}
                busy={busy}
                onChange={edit}
              />
              <BulkImportCheckpoints
                preview={preview}
                config={config}
                currency={currency}
                onChange={edit}
              />
            </>
          ) : null}
          {receipt ? (
            <section className="bulk-import-receipt">
              <CheckCircle size={52} aria-hidden="true" />
              <h3>
                {receipt.state === "undone"
                  ? "Import undone"
                  : "Your entries are recorded"}
              </h3>
              <p>
                {receipt.state === "undone"
                  ? "New entries and unchanged checkpoints from this batch were removed. Pre-existing linked transactions were kept."
                  : `${receipt.receipt.new ?? 0} new entries · ${receipt.receipt.linked ?? 0} linked sources · ${receipt.receipt.skipped ?? 0} skipped rows · ${receipt.receipt.checkpoints ?? 0} balance checkpoints`}
              </p>
              <p className="muted-text">
                Original rows stay saved. Entries appear in Transactions,
                reports and the timeline; checkpoints appear in Reconciliation.
              </p>
              {receipt.state === "undone" && preview ? (
                <button
                  className="button button--ghost"
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void run("Reopening table", async () =>
                      accept(
                        await reopenBulkImport(
                          token(),
                          receipt.id,
                          preview.version,
                        ),
                      ),
                    )
                  }
                >
                  Review this table again
                </button>
              ) : null}
              {receipt.state === "committed" ? (
                <>
                  <button
                    className="button button--ghost"
                    type="button"
                    onClick={() => setConfirmUndo(true)}
                  >
                    Undo this import
                  </button>
                  {confirmUndo ? (
                    <div className="bulk-import-undo">
                      <WarningCircle size={22} aria-hidden="true" />
                      <p>
                        Remove entries created by this batch and detach its
                        linked source rows? Existing transactions are kept.
                        Edited or subsequently linked entries block automatic
                        Undo.
                      </p>
                      <button
                        className="button button--ghost"
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void run("Undoing import", async () => {
                            setReceipt(
                              await undoBulkImport(token(), receipt.id),
                            );
                            changed();
                            notify("Import undone.");
                            setConfirmUndo(false);
                          })
                        }
                      >
                        Confirm Undo import
                      </button>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => setConfirmUndo(false)}
                      >
                        Keep import
                      </button>
                    </div>
                  ) : null}
                </>
              ) : null}
              {preview ? <OriginalTable preview={preview} /> : null}
            </section>
          ) : null}
        </fieldset>
      </div>
      <footer className="bulk-import-footer">
        <div aria-live="polite">
          {busy ? (
            <span className="bulk-import-loading">
              <CircleNotch className="spin" size={20} aria-hidden="true" />
              {busy}…
            </span>
          ) : dirty ? (
            "Your edits need a refreshed preview."
          ) : preview && !receipt ? (
            preview.errors.length ? (
              "Resolve the highlighted import issue before recording."
            ) : preview.summary.needs_review ? (
              `${preview.summary.needs_review} items need review before recording.`
            ) : balanceDifferences ? (
              `Ready to record · ${balanceDifferences} balance ${balanceDifferences === 1 ? "difference remains" : "differences remain"} flagged.`
            ) : (
              "Ready to record your selected entries."
            )
          ) : (
            "Your original sources stay available."
          )}
        </div>
        <div>
          {preview && !receipt ? (
            <button
              className="button button--ghost"
              type="button"
              disabled={Boolean(busy)}
              onClick={() => {
                setPreview(null);
                setConfig(null);
                setDirty(false);
              }}
            >
              <ArrowLeft size={16} aria-hidden="true" />
              Back
            </button>
          ) : null}
          {receipt ? (
            <button
              className="button button--primary"
              type="button"
              disabled={Boolean(busy)}
              onClick={onClose}
            >
              Done
            </button>
          ) : !preview ? (
            <button
              className="button button--primary"
              type="button"
              disabled={Boolean(busy) || !account || !text.trim()}
              onClick={() =>
                void run("Preparing preview", async () =>
                  accept(
                    await createBulkImport(token(), account, text, filename),
                  ),
                )
              }
            >
              Preview import
            </button>
          ) : (
            <>
              <button
                className="button button--ghost"
                type="button"
                disabled={Boolean(busy) || !config}
                onClick={() =>
                  void run("Checking your changes", async () => {
                    if (config)
                      accept(
                        await reviewBulkImport(
                          token(),
                          preview.id,
                          preview.version,
                          config,
                        ),
                      );
                  })
                }
              >
                Refresh preview
              </button>
              <button
                className="button button--primary"
                type="button"
                disabled={Boolean(busy) || blocked}
                onClick={() =>
                  void run("Recording import", async () => {
                    try {
                      const saved = await commitBulkImport(token(), preview);
                      setReceipt(saved);
                      changed();
                      notify(
                        "Import recorded. Your transactions and checkpoints are saved.",
                      );
                    } catch (error) {
                      if ((error as { status?: number }).status === 409)
                        accept(await getBulkImport(token(), preview.id));
                      throw error;
                    }
                  })
                }
              >
                Import approved entries
              </button>
            </>
          )}
        </div>
      </footer>
    </ModalDialog>
  );
}
