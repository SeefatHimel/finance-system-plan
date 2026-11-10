"use client";
import type { Category } from "@/lib/api";
import type { BulkConfiguration } from "../../finance-contracts/bulk-import";
import type { BulkPreview } from "@/lib/bulk-import-api";
import { displayLabel } from "../../finance-contracts/presentation";
import { useMemo, useState } from "react";
const fields = [
  "date",
  "amount",
  "description",
  "category",
  "notes",
  "time",
  "balance_after",
];
type Props = {
  preview: BulkPreview;
  config: BulkConfiguration;
  categories: Category[];
  onChange: (update: Partial<BulkConfiguration>) => void;
};
export function BulkImportMapping({
  preview,
  config,
  categories,
  onChange: edit,
}: Props) {
  const [mapOpen, setMapOpen] = useState(!preview.review_token);
  const sourceCategories = useMemo(
    () => [
      ...new Set(preview.rows.map((r) => r.source_category).filter(Boolean)),
    ],
    [preview],
  );
  return (
    <details
      className="bulk-import-disclosure"
      open={mapOpen}
      onToggle={(e) => setMapOpen(e.currentTarget.open)}
    >
      <summary>Column mapping and category choices</summary>
      <div className="bulk-import-grid">
        {fields.map((field) => (
          <label className="field" key={field}>
            <span className="field__label">
              {displayLabel(field)}
              {["date", "amount"].includes(field) ? " *" : ""}
            </span>
            <select
              className="field__control"
              value={config.mapping[field] ?? ""}
              onChange={(e) =>
                edit({
                  mapping: {
                    ...config.mapping,
                    [field]: e.target.value,
                  },
                })
              }
            >
              <option value="">
                {["date", "amount"].includes(field)
                  ? "Choose a column"
                  : "Not provided"}
              </option>
              {preview.headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="field">
          <span className="field__label">Date order</span>
          <select
            className="field__control"
            value={config.date_order}
            onChange={(e) =>
              edit({
                date_order: e.target.value as BulkConfiguration["date_order"],
              })
            }
          >
            <option value="ISO">Year-month-day (2026-10-05)</option>
            <option value="DMY">Day/month/year (05/10/2026)</option>
            <option value="MDY">Month/day/year (10/05/2026)</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">Positive amounts mean</span>
          <select
            className="field__control"
            value={config.positive_direction}
            onChange={(e) =>
              edit({
                positive_direction: e.target.value as "debit" | "credit",
              })
            }
          >
            <option value="debit">Money out · expenses</option>
            <option value="credit">Money in · income</option>
          </select>
        </label>
      </div>
      {sourceCategories.length ? (
        <>
          <h3>Map categories once for this batch</h3>
          <div className="bulk-import-grid">
            {sourceCategories.map((name) => (
              <label className="field" key={name}>
                <span className="field__label">{name}</span>
                <select
                  className="field__control"
                  value={
                    (name in config.category_map
                      ? config.category_map[name]
                      : categories.find(
                          (c) => c.name.toLowerCase() === name.toLowerCase(),
                        )?.id) ?? ""
                  }
                  onChange={(e) =>
                    edit({
                      category_map: {
                        ...config.category_map,
                        [name]: e.target.value || null,
                      },
                    })
                  }
                >
                  <option value="">Keep uncategorized</option>
                  {categories
                    .filter((c) => c.is_active)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
            ))}
          </div>
          <p className="muted-text">
            Original category labels stay attached to their source rows.
          </p>
        </>
      ) : null}
    </details>
  );
}
