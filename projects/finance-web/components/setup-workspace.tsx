"use client";

import type React from "react";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  type Account,
  type Category,
  createAccount,
  createCategory,
  deleteAccount,
  deleteCategory,
  listAccounts,
  listCategories
} from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";

type SetupState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { accounts: Account[]; categories: Category[]; status: "ready" };

const accountTypes = [
  "cash",
  "home_cash",
  "mobile_wallet",
  "bank",
  "credit_card",
  "savings",
  "other"
];

const categoryKinds = ["expense", "income", "transfer", "debt", "system"];

export function SetupWorkspace() {
  const [setupState, setSetupState] = useState<SetupState>({ status: "loading" });
  const [accountError, setAccountError] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [isSavingAccount, setIsSavingAccount] = useState(false);
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null);
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);

  async function loadData() {
    const accessToken = getAccessToken();

    if (!accessToken) {
      setSetupState({ message: "Sign in before managing setup data.", status: "error" });
      return;
    }

    setSetupState({ status: "loading" });

    try {
      const [accounts, categories] = await Promise.all([
        listAccounts(accessToken),
        listCategories(accessToken)
      ]);
      setSetupState({ accounts, categories, status: "ready" });
    } catch (error) {
      setSetupState({
        message: error instanceof Error ? error.message : "Could not load setup data.",
        status: "error"
      });
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function handleAccountSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accessToken = getAccessToken();

    if (!accessToken) {
      setAccountError("Sign in before creating an account.");
      return;
    }

    const formData = new FormData(event.currentTarget);
    setAccountError(null);
    setIsSavingAccount(true);

    try {
      await createAccount(accessToken, {
        name: String(formData.get("name") ?? ""),
        starting_balance: String(formData.get("starting_balance") ?? "0.00"),
        type: String(formData.get("type") ?? "cash")
      });
      event.currentTarget.reset();
      await loadData();
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "Could not create account.");
    } finally {
      setIsSavingAccount(false);
    }
  }

  async function handleCategorySubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accessToken = getAccessToken();

    if (!accessToken) {
      setCategoryError("Sign in before creating a category.");
      return;
    }

    const formData = new FormData(event.currentTarget);
    setCategoryError(null);
    setIsSavingCategory(true);

    try {
      await createCategory(accessToken, {
        kind: String(formData.get("kind") ?? "expense"),
        name: String(formData.get("name") ?? "")
      });
      event.currentTarget.reset();
      await loadData();
    } catch (error) {
      setCategoryError(error instanceof Error ? error.message : "Could not create category.");
    } finally {
      setIsSavingCategory(false);
    }
  }

  async function handleDeleteAccount(account: Account) {
    const accessToken = getAccessToken();
    if (!accessToken) {
      setAccountError("Sign in before deleting an account.");
      return;
    }

    const confirmed = window.confirm(
      `Delete account "${account.name}"? This fails if transactions still reference it.`
    );
    if (!confirmed) {
      return;
    }

    setAccountError(null);
    setDeletingAccountId(account.id);
    try {
      await deleteAccount(accessToken, account.id);
      await loadData();
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "Could not delete account.");
    } finally {
      setDeletingAccountId(null);
    }
  }

  async function handleDeleteCategory(category: Category) {
    const accessToken = getAccessToken();
    if (!accessToken) {
      setCategoryError("Sign in before deleting a category.");
      return;
    }

    const confirmed = window.confirm(
      `Delete category "${category.name}"? This fails if transactions still reference it.`
    );
    if (!confirmed) {
      return;
    }

    setCategoryError(null);
    setDeletingCategoryId(category.id);
    try {
      await deleteCategory(accessToken, category.id);
      await loadData();
    } catch (error) {
      setCategoryError(error instanceof Error ? error.message : "Could not delete category.");
    } finally {
      setDeletingCategoryId(null);
    }
  }

  if (setupState.status === "loading") {
    return (
      <div className="panel">
        <div className="panel__body">
          <span className="status-badge status-badge--idle">Loading setup</span>
        </div>
      </div>
    );
  }

  if (setupState.status === "error") {
    return (
      <div className="panel">
        <div className="panel__body empty-state">
          <h1 className="section-title">Accounts and categories</h1>
          <p className="section-subtitle">{setupState.message}</p>
          <Link className="button button--primary" href="/login">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-grid">
      <section className="panel">
        <div className="panel__body">
          <h1 className="section-title">Accounts</h1>
          <p className="section-subtitle">
            Add the places where money can move from or to.
          </p>

          <form className="setup-form" onSubmit={handleAccountSubmit}>
            <label className="field">
              <span className="field__label">Name</span>
              <input className="field__control" name="name" required type="text" />
            </label>

            <label className="field">
              <span className="field__label">Type</span>
              <select className="field__control" name="type" required>
                {accountTypes.map((type) => (
                  <option key={type} value={type}>
                    {type.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">Starting balance</span>
              <input
                className="field__control"
                min="0"
                name="starting_balance"
                step="0.01"
                type="number"
              />
            </label>

            {accountError ? <p className="form-error">{accountError}</p> : null}

            <button className="button button--primary" disabled={isSavingAccount} type="submit">
              {isSavingAccount ? "Saving..." : "Add account"}
            </button>
          </form>

          <div className="list-stack">
            {setupState.accounts.length === 0 ? (
              <p className="muted-text">No accounts yet.</p>
            ) : (
              setupState.accounts.map((account) => (
                <div className="list-row" key={account.id}>
                  <strong>{account.name}</strong>
                  <div className="list-row__actions">
                    <span>{account.type.replaceAll("_", " ")}</span>
                    <button
                      className="button button--danger"
                      disabled={deletingAccountId === account.id}
                      onClick={() => void handleDeleteAccount(account)}
                      type="button"
                    >
                      {deletingAccountId === account.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel__body">
          <h2 className="section-title">Categories</h2>
          <p className="section-subtitle">
            Add labels for spending, income, debts, transfers, and system items.
          </p>

          <form className="setup-form" onSubmit={handleCategorySubmit}>
            <label className="field">
              <span className="field__label">Name</span>
              <input className="field__control" name="name" required type="text" />
            </label>

            <label className="field">
              <span className="field__label">Kind</span>
              <select className="field__control" name="kind" required>
                {categoryKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </label>

            {categoryError ? <p className="form-error">{categoryError}</p> : null}

            <button className="button button--primary" disabled={isSavingCategory} type="submit">
              {isSavingCategory ? "Saving..." : "Add category"}
            </button>
          </form>

          <div className="list-stack">
            {setupState.categories.length === 0 ? (
              <p className="muted-text">No categories yet.</p>
            ) : (
              setupState.categories.map((category) => (
                <div className="list-row" key={category.id}>
                  <strong>{category.name}</strong>
                  <div className="list-row__actions">
                    <span>{category.kind}</span>
                    <button
                      className="button button--danger"
                      disabled={deletingCategoryId === category.id}
                      onClick={() => void handleDeleteCategory(category)}
                      type="button"
                    >
                      {deletingCategoryId === category.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
