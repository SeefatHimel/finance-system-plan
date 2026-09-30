"use client";

import type React from "react";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  type Account,
  type AccountType,
  type Category,
  type CategoryKind,
  createAccount,
  createCategory,
  deleteAccount,
  deleteCategory,
  listAccounts,
  listCategories,
  updateAccount,
  updateCategory
} from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { ButtonBusy, LoadingState } from "@/components/loading-state";

type SetupState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { accounts: Account[]; categories: Category[]; status: "ready" };

const accountTypes: AccountType[] = [
  "cash",
  "home_cash",
  "mobile_wallet",
  "bank",
  "credit_card",
  "savings",
  "other"
];

const categoryKinds: CategoryKind[] = ["expense", "income", "transfer", "debt", "system"];

type SetupTab = "accounts" | "categories";
type SetupDrawer = "account-create" | "account-edit" | "category-create" | "category-edit" | null;

function sortByName<T extends { name: string }>(items: T[]) {
  return [...items].sort((left, right) => left.name.localeCompare(right.name));
}

function formatAccountBalance(account: Account, balance: string) {
  return new Intl.NumberFormat("en-BD", {
    currency: account.currency,
    maximumFractionDigits: 2,
    style: "currency"
  }).format(Number(balance));
}

export function SetupWorkspace() {
  const [setupState, setSetupState] = useState<SetupState>({ status: "loading" });
  const [accountError, setAccountError] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [isSavingAccount, setIsSavingAccount] = useState(false);
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [isUpdatingAccount, setIsUpdatingAccount] = useState(false);
  const [isUpdatingCategory, setIsUpdatingCategory] = useState(false);
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null);
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);
  const [editingAccountId, setEditingAccountId] = useState("");
  const [editingAccountName, setEditingAccountName] = useState("");
  const [editingAccountType, setEditingAccountType] = useState<AccountType>("cash");
  const [editingCategoryId, setEditingCategoryId] = useState("");
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [editingCategoryKind, setEditingCategoryKind] = useState<CategoryKind>("expense");
  const [activeTab, setActiveTab] = useState<SetupTab>("accounts");
  const [drawer, setDrawer] = useState<SetupDrawer>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [accountSearch, setAccountSearch] = useState("");
  const [accountTypeFilter, setAccountTypeFilter] = useState<AccountType | "all">("all");
  const [accountStatusFilter, setAccountStatusFilter] = useState<"active" | "all" | "inactive">("all");
  const [categorySearch, setCategorySearch] = useState("");
  const [categoryKindFilter, setCategoryKindFilter] = useState<CategoryKind | "all">("all");

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

    const form = event.currentTarget;
    const formData = new FormData(form);
    setAccountError(null);
    setIsSavingAccount(true);

    try {
      const account = await createAccount(accessToken, {
        currency: String(formData.get("currency") ?? "BDT"),
        name: String(formData.get("name") ?? ""),
        starting_balance: String(formData.get("starting_balance") ?? "0.00"),
        type: String(formData.get("type") ?? "cash") as AccountType
      });
      form.reset();
      setSetupState((current) => current.status === "ready"
        ? { ...current, accounts: sortByName([...current.accounts, account]) }
        : current);
      setDrawer(null);
      setNotice(`Account “${account.name}” added.`);
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

    const form = event.currentTarget;
    const formData = new FormData(form);
    setCategoryError(null);
    setIsSavingCategory(true);

    try {
      const category = await createCategory(accessToken, {
        kind: String(formData.get("kind") ?? "expense") as CategoryKind,
        name: String(formData.get("name") ?? "")
      });
      form.reset();
      setSetupState((current) => current.status === "ready"
        ? { ...current, categories: sortByName([...current.categories, category]) }
        : current);
      setDrawer(null);
      setNotice(`Category “${category.name}” added.`);
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
      setSetupState((current) => current.status === "ready"
        ? { ...current, accounts: current.accounts.filter((item) => item.id !== account.id) }
        : current);
      setNotice(`Account “${account.name}” deleted.`);
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
      setSetupState((current) => current.status === "ready"
        ? { ...current, categories: current.categories.filter((item) => item.id !== category.id) }
        : current);
      setNotice(`Category “${category.name}” deleted.`);
    } catch (error) {
      setCategoryError(error instanceof Error ? error.message : "Could not delete category.");
    } finally {
      setDeletingCategoryId(null);
    }
  }

  function handleSelectAccount(accountId: string) {
    setEditingAccountId(accountId);
    const selected = setupState.status === "ready"
      ? setupState.accounts.find((account) => account.id === accountId)
      : null;
    setEditingAccountName(selected?.name ?? "");
    setEditingAccountType((selected?.type ?? "cash") as AccountType);
    if (selected) setDrawer("account-edit");
  }

  function handleSelectCategory(categoryId: string) {
    setEditingCategoryId(categoryId);
    const selected = setupState.status === "ready"
      ? setupState.categories.find((category) => category.id === categoryId)
      : null;
    setEditingCategoryName(selected?.name ?? "");
    setEditingCategoryKind((selected?.kind ?? "expense") as CategoryKind);
    if (selected) setDrawer("category-edit");
  }

  async function handleAccountUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accessToken = getAccessToken();
    if (!accessToken) {
      setAccountError("Sign in before updating an account.");
      return;
    }
    if (!editingAccountId) {
      setAccountError("Select an account to edit.");
      return;
    }

    setAccountError(null);
    setIsUpdatingAccount(true);
    try {
      const account = await updateAccount(accessToken, editingAccountId, {
        name: editingAccountName,
        type: editingAccountType
      });
      setSetupState((current) => current.status === "ready"
        ? { ...current, accounts: sortByName(current.accounts.map((item) => item.id === account.id ? account : item)) }
        : current);
      setDrawer(null);
      setNotice(`Account “${account.name}” updated.`);
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "Could not update account.");
    } finally {
      setIsUpdatingAccount(false);
    }
  }

  async function handleCategoryUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accessToken = getAccessToken();
    if (!accessToken) {
      setCategoryError("Sign in before updating a category.");
      return;
    }
    if (!editingCategoryId) {
      setCategoryError("Select a category to edit.");
      return;
    }

    setCategoryError(null);
    setIsUpdatingCategory(true);
    try {
      const category = await updateCategory(accessToken, editingCategoryId, {
        kind: editingCategoryKind,
        name: editingCategoryName
      });
      setSetupState((current) => current.status === "ready"
        ? { ...current, categories: sortByName(current.categories.map((item) => item.id === category.id ? category : item)) }
        : current);
      setDrawer(null);
      setNotice(`Category “${category.name}” updated.`);
    } catch (error) {
      setCategoryError(error instanceof Error ? error.message : "Could not update category.");
    } finally {
      setIsUpdatingCategory(false);
    }
  }

  if (setupState.status === "loading") {
    return <LoadingState detail="Syncing account and category configuration" label="Preparing accounts" />;
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

  const bdtLedgerBalance = setupState.accounts
    .filter((account) => account.currency === "BDT")
    .reduce((sum, account) => sum + Number(account.ledger_balance), 0);
  const activeAccounts = setupState.accounts.filter((account) => account.is_active).length;
  const visibleAccounts = setupState.accounts.filter((account) => {
    const matchesSearch = account.name.toLowerCase().includes(accountSearch.trim().toLowerCase());
    const matchesType = accountTypeFilter === "all" || account.type === accountTypeFilter;
    const matchesStatus = accountStatusFilter === "all"
      || (accountStatusFilter === "active" ? account.is_active : !account.is_active);
    return matchesSearch && matchesType && matchesStatus;
  });
  const visibleCategories = setupState.categories.filter((category) => {
    const matchesSearch = category.name.toLowerCase().includes(categorySearch.trim().toLowerCase());
    const matchesKind = categoryKindFilter === "all" || category.kind === categoryKindFilter;
    return matchesSearch && matchesKind;
  });

  return (
    <div className="workspace-grid">
      <section className="metric-strip setup-summary" aria-label="Account summary">
        <div className="metric"><span className="metric__label">Total accounts</span><strong className="metric__value">{setupState.accounts.length}</strong></div>
        <div className="metric"><span className="metric__label">Active accounts</span><strong className="metric__value">{activeAccounts}</strong></div>
        <div className="metric"><span className="metric__label">BDT ledger balance</span><strong className="metric__value">{new Intl.NumberFormat("en-BD", { currency: "BDT", maximumFractionDigits: 0, style: "currency" }).format(bdtLedgerBalance)}</strong></div>
        <div className="metric"><span className="metric__label">Categories</span><strong className="metric__value">{setupState.categories.length}</strong></div>
      </section>

      <section className="panel data-surface">
        <div className="panel__body">
          <div className="section-header section-header--tabs">
            <div className="tab-list" role="tablist" aria-label="Setup sections">
              <button className={`tab-button${activeTab === "accounts" ? " tab-button--active" : ""}`} onClick={() => setActiveTab("accounts")} role="tab" type="button">Accounts <span>{setupState.accounts.length}</span></button>
              <button className={`tab-button${activeTab === "categories" ? " tab-button--active" : ""}`} onClick={() => setActiveTab("categories")} role="tab" type="button">Categories <span>{setupState.categories.length}</span></button>
            </div>
            <button className="button button--primary" onClick={() => { setNotice(null); setDrawer(activeTab === "accounts" ? "account-create" : "category-create"); }} type="button">+ Add {activeTab === "accounts" ? "account" : "category"}</button>
          </div>

          {activeTab === "accounts" ? (
            setupState.accounts.length === 0 ? (
              <div className="empty-state empty-state--centered"><div className="empty-state__icon">▣</div><strong>No accounts yet</strong><span>Add your first account to start tracking money movement.</span><button className="button button--primary" onClick={() => setDrawer("account-create")} type="button">Add account</button></div>
            ) : (
              <><div className="data-toolbar"><label className="search-control"><span aria-hidden="true">⌕</span><input aria-label="Search accounts" onChange={(event) => setAccountSearch(event.target.value)} placeholder="Search accounts" type="search" value={accountSearch} /></label><div className="data-toolbar__filters"><select aria-label="Filter accounts by type" className="compact-select" onChange={(event) => setAccountTypeFilter(event.target.value as AccountType | "all")} value={accountTypeFilter}><option value="all">All types</option>{accountTypes.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select><select aria-label="Filter accounts by status" className="compact-select" onChange={(event) => setAccountStatusFilter(event.target.value as "active" | "all" | "inactive")} value={accountStatusFilter}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div></div>{visibleAccounts.length === 0 ? <div className="empty-state empty-state--centered empty-state--compact"><strong>No matching accounts</strong><span>Try a different search term or filter.</span><button className="button button--ghost" onClick={() => { setAccountSearch(""); setAccountTypeFilter("all"); setAccountStatusFilter("all"); }} type="button">Clear filters</button></div> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Name</th><th>Type</th><th>Currency</th><th>Ledger balance</th><th>Latest reported</th><th>Status</th><th className="align-right">Actions</th></tr></thead><tbody>{visibleAccounts.map((account) => <tr key={account.id}><td><strong>{account.name}</strong></td><td><span className="type-label">{account.type.replaceAll("_", " ")}</span></td><td>{account.currency}</td><td className="amount-cell">{formatAccountBalance(account, account.ledger_balance)}</td><td className="amount-cell">{account.latest_reported_balance ? <>{formatAccountBalance(account, account.latest_reported_balance)}{account.latest_reported_balance_date ? <small className="meta"> {account.latest_reported_balance_date}</small> : null}</> : "—"}</td><td><span className={`status-badge status-badge--${account.is_active ? "ok" : "idle"}`}>{account.is_active ? "Active" : "Inactive"}</span></td><td><div className="row-actions"><button className="button button--ghost button--small" onClick={() => handleSelectAccount(account.id)} type="button">Edit</button><button className="button button--danger button--small" disabled={deletingAccountId === account.id} onClick={() => void handleDeleteAccount(account)} type="button">{deletingAccountId === account.id ? "Deleting…" : "Delete"}</button></div></td></tr>)}</tbody></table></div>}</>
            )
          ) : (
            setupState.categories.length === 0 ? (
              <div className="empty-state empty-state--centered"><div className="empty-state__icon">◇</div><strong>No categories yet</strong><span>Create categories for expenses, income, transfers, and debt.</span><button className="button button--primary" onClick={() => setDrawer("category-create")} type="button">Add category</button></div>
            ) : (
              <><div className="data-toolbar"><label className="search-control"><span aria-hidden="true">⌕</span><input aria-label="Search categories" onChange={(event) => setCategorySearch(event.target.value)} placeholder="Search categories" type="search" value={categorySearch} /></label><div className="data-toolbar__filters"><select aria-label="Filter categories by kind" className="compact-select" onChange={(event) => setCategoryKindFilter(event.target.value as CategoryKind | "all")} value={categoryKindFilter}><option value="all">All kinds</option>{categoryKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></div></div>{visibleCategories.length === 0 ? <div className="empty-state empty-state--centered empty-state--compact"><strong>No matching categories</strong><span>Try a different search term or filter.</span><button className="button button--ghost" onClick={() => { setCategorySearch(""); setCategoryKindFilter("all"); }} type="button">Clear filters</button></div> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Name</th><th>Kind</th><th className="align-right">Actions</th></tr></thead><tbody>{visibleCategories.map((category) => <tr key={category.id}><td><strong>{category.name}</strong></td><td><span className="type-label">{category.kind}</span></td><td><div className="row-actions"><button className="button button--ghost button--small" onClick={() => handleSelectCategory(category.id)} type="button">Edit</button><button className="button button--danger button--small" disabled={deletingCategoryId === category.id} onClick={() => void handleDeleteCategory(category)} type="button">{deletingCategoryId === category.id ? "Deleting…" : "Delete"}</button></div></td></tr>)}</tbody></table></div>}</>
            )
          )}
        </div>
      </section>

      {drawer ? (
        <><button className="drawer-scrim" aria-label="Close form" onClick={() => setDrawer(null)} type="button" /><aside aria-modal="true" className="form-drawer" role="dialog">
          <div className="form-drawer__header"><div><h2>{drawer === "account-create" ? "Add account" : drawer === "account-edit" ? "Edit account" : drawer === "category-create" ? "Add category" : "Edit category"}</h2><p>{drawer.startsWith("account") ? "Keep account details accurate for reporting and reconciliation." : "Organize transactions with clear, reusable labels."}</p></div><button aria-label="Close form" className="icon-button" onClick={() => setDrawer(null)} type="button">×</button></div>

          {drawer === "account-create" ? <form className="drawer-form" onSubmit={handleAccountSubmit}><label className="field"><span className="field__label">Name</span><input autoFocus className="field__control" name="name" required type="text" /></label><label className="field"><span className="field__label">Type</span><select className="field__control" name="type" required>{accountTypes.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></label><label className="field"><span className="field__label">Starting balance</span><input className="field__control" min="0" name="starting_balance" step="0.01" type="number" /></label><label className="field"><span className="field__label">Currency</span><select className="field__control" defaultValue="BDT" name="currency"><option value="BDT">BDT</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option></select></label>{accountError ? <p className="form-error">{accountError}</p> : null}<div className="drawer-form__actions"><button className="button button--ghost" onClick={() => setDrawer(null)} type="button">Cancel</button><button className="button button--primary" disabled={isSavingAccount} type="submit">{isSavingAccount ? <ButtonBusy label="Saving" /> : "Add account"}</button></div></form> : null}

          {drawer === "account-edit" ? <form className="drawer-form" onSubmit={handleAccountUpdate}><label className="field"><span className="field__label">Name</span><input autoFocus className="field__control" onChange={(event) => setEditingAccountName(event.target.value)} required type="text" value={editingAccountName} /></label><label className="field"><span className="field__label">Type</span><select className="field__control" onChange={(event) => setEditingAccountType(event.target.value as AccountType)} value={editingAccountType}>{accountTypes.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></label>{accountError ? <p className="form-error">{accountError}</p> : null}<div className="drawer-form__actions"><button className="button button--ghost" onClick={() => setDrawer(null)} type="button">Cancel</button><button className="button button--primary" disabled={isUpdatingAccount} type="submit">{isUpdatingAccount ? <ButtonBusy label="Updating" /> : "Save changes"}</button></div></form> : null}

          {drawer === "category-create" ? <form className="drawer-form" onSubmit={handleCategorySubmit}><label className="field"><span className="field__label">Name</span><input autoFocus className="field__control" name="name" required type="text" /></label><label className="field"><span className="field__label">Kind</span><select className="field__control" name="kind" required>{categoryKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label>{categoryError ? <p className="form-error">{categoryError}</p> : null}<div className="drawer-form__actions"><button className="button button--ghost" onClick={() => setDrawer(null)} type="button">Cancel</button><button className="button button--primary" disabled={isSavingCategory} type="submit">{isSavingCategory ? <ButtonBusy label="Saving" /> : "Add category"}</button></div></form> : null}

          {drawer === "category-edit" ? <form className="drawer-form" onSubmit={handleCategoryUpdate}><label className="field"><span className="field__label">Name</span><input autoFocus className="field__control" onChange={(event) => setEditingCategoryName(event.target.value)} required type="text" value={editingCategoryName} /></label><label className="field"><span className="field__label">Kind</span><select className="field__control" onChange={(event) => setEditingCategoryKind(event.target.value as CategoryKind)} value={editingCategoryKind}>{categoryKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label>{categoryError ? <p className="form-error">{categoryError}</p> : null}<div className="drawer-form__actions"><button className="button button--ghost" onClick={() => setDrawer(null)} type="button">Cancel</button><button className="button button--primary" disabled={isUpdatingCategory} type="submit">{isUpdatingCategory ? <ButtonBusy label="Updating" /> : "Save changes"}</button></div></form> : null}
        </aside></>
      ) : null}

      {notice ? <div className="toast" role="status"><span className="toast__icon">✓</span><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice(null)} type="button">×</button></div> : null}
    </div>
  );
}
