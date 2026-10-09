"use client";

import { DatedList } from "@/components/dated-list";

import type React from "react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { type AuditLogEntry, type AuditLogFilters, listAuditLogs } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { LoadingState } from "@/components/loading-state";

type AuditLogState =
  | { status: "idle" }
  | { status: "loading" }
  | { message: string; status: "error" }
  | { entries: AuditLogEntry[]; status: "ready" };

const actionOptions = ["created", "updated", "deleted"];

const defaultAuditFilters = {
  action: "",
  entity_id: "",
  entity_type: "transactions.transaction"
};

function filtersFromUrl() {
  if (typeof window === "undefined") {
    return defaultAuditFilters;
  }

  const params = new URLSearchParams(window.location.search);
  return {
    action: params.get("action") ?? "",
    entity_id: params.get("entity_id") ?? "",
    entity_type: params.get("entity_type") ?? defaultAuditFilters.entity_type
  };
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-BD", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}

function actionBadgeClass(action: string) {
  if (action === "created") {
    return "status-badge status-badge--ok";
  }
  if (action === "deleted") {
    return "status-badge status-badge--error";
  }
  return "status-badge status-badge--idle";
}

function snapshotText(snapshot: Record<string, unknown> | null, key: string) {
  const value = snapshot?.[key];
  return typeof value === "string" && value ? value : null;
}

function snapshotSummary(entry: AuditLogEntry) {
  if (entry.action === "created") {
    return snapshotText(entry.after, "note") || snapshotText(entry.after, "counterparty_text") || "Created transaction";
  }
  if (entry.action === "deleted") {
    return snapshotText(entry.before, "note") || snapshotText(entry.before, "counterparty_text") || "Deleted transaction";
  }
  return snapshotText(entry.after, "note") || snapshotText(entry.before, "note") || "Updated transaction";
}

function changedFields(entry: AuditLogEntry) {
  if (!entry.before || !entry.after) {
    return [];
  }

  return Array.from(new Set([...Object.keys(entry.before), ...Object.keys(entry.after)]))
    .filter((key) => JSON.stringify(entry.before?.[key]) !== JSON.stringify(entry.after?.[key]))
    .slice(0, 8);
}

function SnapshotBlock({ label, value }: { label: string; value: Record<string, unknown> | null }) {
  return (
    <div className="audit-snapshot">
      <span className="field__label">{label}</span>
      <pre className="audit-json">{value ? JSON.stringify(value, null, 2) : "null"}</pre>
    </div>
  );
}

export function AuditLogWorkspace() {
  const [filters, setFilters] = useState(defaultAuditFilters);
  const [state, setState] = useState<AuditLogState>({ status: "idle" });

  const loadAuditLogs = useCallback(async (activeFilters: AuditLogFilters) => {
    const accessToken = getAccessToken();

    if (!accessToken) {
      setState({ message: "Sign in before viewing audit logs.", status: "error" });
      return;
    }

    setState({ status: "loading" });

    try {
      const entries = await listAuditLogs(accessToken, activeFilters);
      setState({ entries, status: "ready" });
    } catch (error) {
      setState({
        message: error instanceof Error ? error.message : "Could not load audit logs.",
        status: "error"
      });
    }
  }, []);

  useEffect(() => {
    const initialFilters = filtersFromUrl();
    setFilters(initialFilters);
    void loadAuditLogs(initialFilters);
  }, [loadAuditLogs]);

  const summary = useMemo(() => {
    if (state.status !== "ready") {
      return {
        created: 0,
        deleted: 0,
        total: 0,
        updated: 0
      };
    }

    return state.entries.reduce(
      (totals, entry) => {
        totals.total += 1;
        if (entry.action === "created") {
          totals.created += 1;
        }
        if (entry.action === "updated") {
          totals.updated += 1;
        }
        if (entry.action === "deleted") {
          totals.deleted += 1;
        }
        return totals;
      },
      {
        created: 0,
        deleted: 0,
        total: 0,
        updated: 0
      }
    );
  }, [state]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadAuditLogs(filters);
  }

  function clearFilters() {
    const clearedFilters = {
      action: "",
      entity_id: "",
      entity_type: ""
    };
    setFilters(clearedFilters);
    void loadAuditLogs(clearedFilters);
  }

  return (
    <div className="workspace-grid">
      <section className="panel">
        <div className="panel__body">
          <h1 className="section-title">Audit logs</h1>
          <p className="section-subtitle">
            Review transaction creates, updates, and deletions with before and after snapshots.
          </p>

          <form className="filter-form audit-filter-form" onSubmit={handleSubmit}>
            <label className="field">
              <span className="field__label">Action</span>
              <select
                className="field__control"
                onChange={(event) => setFilters({ ...filters, action: event.target.value })}
                value={filters.action}
              >
                <option value="">All actions</option>
                {actionOptions.map((action) => (
                  <option key={action} value={action}>
                    {formatLabel(action)}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">Entity type</span>
              <input
                className="field__control"
                onChange={(event) => setFilters({ ...filters, entity_type: event.target.value })}
                placeholder="transactions.transaction"
                type="text"
                value={filters.entity_type}
              />
            </label>

            <label className="field">
              <span className="field__label">Entity ID</span>
              <input
                className="field__control"
                onChange={(event) => setFilters({ ...filters, entity_id: event.target.value })}
                type="text"
                value={filters.entity_id}
              />
            </label>

            <button className="button button--primary" type="submit">
              Apply filters
            </button>
            <button className="button button--ghost" onClick={clearFilters} type="button">
              Clear
            </button>
          </form>

          {state.status === "ready" ? (
            <div className="metric-row audit-metric-row" aria-label="Audit log summary">
              <div className="metric">
                <span className="metric__label">Total</span>
                <span className="metric__value">{summary.total}</span>
              </div>
              <div className="metric">
                <span className="metric__label">Created</span>
                <span className="metric__value">{summary.created}</span>
              </div>
              <div className="metric">
                <span className="metric__label">Updated</span>
                <span className="metric__value">{summary.updated}</span>
              </div>
              <div className="metric">
                <span className="metric__label">Deleted</span>
                <span className="metric__value">{summary.deleted}</span>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel__body">
          <h2 className="section-title">History</h2>

          {state.status === "idle" ? (
            <div className="empty-state">
              <p className="section-subtitle">Apply filters to load audit history.</p>
            </div>
          ) : null}

          {state.status === "loading" ? (
            <LoadingState compact detail="Retrieving matching history" label="Loading audit logs" />
          ) : null}

          {state.status === "error" ? (
            <div className="empty-state">
              <p className="section-subtitle">{state.message}</p>
              <Link className="button button--primary" href="/login">
                Sign in
              </Link>
            </div>
          ) : null}

          <DatedList items={state.status === "ready" ? state.entries : []} fields={[{ label: "Event date", date: entry => entry.created_at }]} label="Audit history">{entries => <>
          {state.status === "ready" && entries.length === 0 ? (
            <div className="empty-state">
              <p className="section-subtitle">No audit entries match these filters.</p>
            </div>
          ) : null}

          {state.status === "ready" && entries.length > 0 ? (
            <div className="list-stack">
              {entries.map((entry) => {
                const fields = changedFields(entry);

                return (
                  <article className="list-row audit-row" key={entry.id}>
                    <div>
                      <div className="audit-row__title">
                        <span className={actionBadgeClass(entry.action)}>{formatLabel(entry.action)}</span>
                        <strong>{snapshotSummary(entry)}</strong>
                      </div>
                      <span className="list-row__meta">
                        {formatDateTime(entry.created_at)} · {entry.entity_type} · {entry.entity_id}
                      </span>
                      {fields.length > 0 ? (
                        <span className="list-row__meta">Changed: {fields.map(formatLabel).join(", ")}</span>
                      ) : null}
                    </div>

                    <details className="audit-details">
                      <summary>Snapshots</summary>
                      <div className="audit-snapshot-grid">
                        <SnapshotBlock label="Before" value={entry.before} />
                        <SnapshotBlock label="After" value={entry.after} />
                      </div>
                    </details>
                  </article>
                );
              })}
            </div>
          ) : null}
          </>}</DatedList>
        </div>
      </section>
    </div>
  );
}
