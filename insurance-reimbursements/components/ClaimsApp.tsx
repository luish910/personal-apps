"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Claim, ClaimAction, ClaimRoute, ClaimStatus } from "@/lib/types";

function parseDate(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: string): string {
  const date = parseDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function titleFromName(name: string): string {
  return name.replace(/^\d{4}-\d{2}-\d{2}_/, "").replace(/[-_]+/g, " ");
}

function expenseSortValue(claim: Claim): string {
  return claim.expenseDate || claim.name.slice(0, 10);
}

function actionSortValue(claim: Claim): string {
  if (claim.status === "waiting_isapre") return claim.isapreSubmittedAt || claim.createdAt;
  if (claim.status === "waiting_complementary") return claim.complementarySubmittedAt || claim.createdAt;
  return expenseSortValue(claim);
}

const STATUS_LABEL: Record<ClaimStatus, string> = {
  needs_isapre: "Submit to Isapre",
  waiting_isapre: "Waiting for Isapre",
  needs_complementary: "Submit to complementary",
  waiting_complementary: "Waiting for complementary",
  correction_isapre: "Correction needed · Isapre",
  correction_complementary: "Correction needed · complementary",
  closed: "Closed"
};

type ActionButton = { label: string; action: ClaimAction; variant?: "primary" | "quiet" | "danger" };

function actionsFor(claim: Claim): ActionButton[] {
  switch (claim.status) {
    case "needs_isapre":
      return [
        { label: "Submitted to Isapre", action: "submit_isapre", variant: "primary" },
        { label: "Correction needed", action: "request_isapre_correction", variant: "quiet" }
      ];
    case "waiting_isapre":
      return [
        { label: "Isapre reimbursed", action: "isapre_reimbursement_received", variant: "primary" },
        { label: "Correction needed", action: "request_isapre_correction", variant: "quiet" }
      ];
    case "needs_complementary":
      return [
        { label: "Submitted to complementary", action: "submit_complementary", variant: "primary" },
        { label: "Correction needed", action: "request_complementary_correction", variant: "quiet" }
      ];
    case "waiting_complementary":
      return [
        { label: "Mark as done", action: "close", variant: "primary" },
        { label: "Correction needed", action: "request_complementary_correction", variant: "quiet" }
      ];
    case "correction_isapre":
      return [{ label: "Correction resubmitted", action: "resubmit_isapre", variant: "primary" }];
    case "correction_complementary":
      return [{ label: "Correction resubmitted", action: "resubmit_complementary", variant: "primary" }];
    case "closed":
      return [];
  }
}

export default function ClaimsApp() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRoute, setNewRoute] = useState<ClaimRoute>("both");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/claims", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || "Could not load claims.");
      setClaims(data.claims as Claim[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load claims.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const activeClaims = useMemo(() => claims.filter((claim) => claim.status !== "closed"), [claims]);
  const needsAction = useMemo(
    () => activeClaims
      .filter((claim) => ["needs_isapre", "needs_complementary", "correction_isapre", "correction_complementary"].includes(claim.status))
      .sort((a, b) => expenseSortValue(a).localeCompare(expenseSortValue(b))),
    [activeClaims]
  );
  const waiting = useMemo(
    () => activeClaims
      .filter((claim) => ["waiting_isapre", "waiting_complementary"].includes(claim.status))
      .sort((a, b) => actionSortValue(a).localeCompare(actionSortValue(b))),
    [activeClaims]
  );

  async function runAction(claim: Claim, action: ClaimAction) {
    setBusyName(claim.name);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/claims/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: claim.name, action })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || "The update failed.");
      setMessage(data.message);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The update failed.");
    } finally {
      setBusyName(null);
    }
  }

  async function createClaim(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), route: newRoute })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || "Could not create claim.");
      setMessage(data.message);
      setNewName("");
      setNewRoute("both");
      setShowCreate(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create claim.");
    }
  }

  function ClaimCard({ claim }: { claim: Claim }) {
    const buttons = actionsFor(claim);
    const submitted = claim.status === "waiting_isapre"
      ? claim.isapreSubmittedAt
      : claim.status === "waiting_complementary"
        ? claim.complementarySubmittedAt
        : "";

    return (
      <article className={`claim-card ${claim.status.startsWith("correction") ? "claim-card-correction" : ""}`}>
        <div className="claim-topline">
          <h3>{titleFromName(claim.name)}</h3>
          <span className={`route-pill ${claim.route === "both" ? "route-both" : "route-direct"}`}>
            {claim.route === "both" ? "Isapre + complementary" : "Direct"}
          </span>
        </div>
        <p className="expense-date">Expense date · {formatDate(claim.expenseDate)}</p>
        <div className="status-line">
          <span className={`status-dot ${claim.status.startsWith("correction") ? "dot-correction" : claim.status.startsWith("waiting") ? "dot-waiting" : "dot-action"}`} />
          <span className="status-label">{STATUS_LABEL[claim.status]}</span>
          {submitted && <span className="submitted-date">· Submitted {formatDate(submitted)}</span>}
        </div>
        <div className="claim-actions">
          {buttons.map((button) => (
            <button
              key={button.action}
              className={`button ${button.variant ?? "quiet"}`}
              disabled={busyName === claim.name}
              onClick={() => void runAction(claim, button.action)}
            >
              {busyName === claim.name ? "Saving…" : button.label}
            </button>
          ))}
        </div>
      </article>
    );
  }

  return (
    <main className="page-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">PERSONAL TRACKER</p>
          <h1>Reimbursements</h1>
          <p className="subtitle">Keep each claim moving to its next step.</p>
        </div>
        <button className="button add-button" onClick={() => setShowCreate((value) => !value)}>
          {showCreate ? "Cancel" : "+ Test claim"}
        </button>
      </header>

      {showCreate && (
        <form className="create-panel" onSubmit={createClaim}>
          <h2>Create a test claim</h2>
          <label htmlFor="claim-name">Claim name</label>
          <input
            id="claim-name"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="2026-10-27_Pharmacy"
            pattern="\d{4}-\d{2}-\d{2}_.+"
            title="Use YYYY-MM-DD_Description"
            required
          />
          <label htmlFor="claim-route">Insurance route</label>
          <select id="claim-route" value={newRoute} onChange={(event) => setNewRoute(event.target.value as ClaimRoute)}>
            <option value="both">Isapre first, then complementary</option>
            <option value="complementary_only">Complementary only</option>
          </select>
          <p className="field-hint">The name must begin with YYYY-MM-DD_ and must be unique.</p>
          <button className="button primary" type="submit">Create claim</button>
        </form>
      )}

      {message && <div className="notice success" role="status">{message}</div>}
      {error && <div className="notice error" role="alert">{error}</div>}

      <section className="work-section action-section" aria-labelledby="needs-heading">
        <div className="section-heading">
          <div className="section-marker action-marker" />
          <div>
            <h2 id="needs-heading">Needs your action</h2>
            <p>Claims you can move forward</p>
          </div>
          <span className="count-badge action-count">{needsAction.length}</span>
        </div>
        {loading ? <p className="empty-state">Loading claims…</p> : needsAction.length ? (
          <div className="claim-list">{needsAction.map((claim) => <ClaimCard key={claim.name} claim={claim} />)}</div>
        ) : <p className="empty-state">Nothing needs your attention right now.</p>}
      </section>

      <section className="work-section waiting-section" aria-labelledby="waiting-heading">
        <div className="section-heading">
          <div className="section-marker waiting-marker" />
          <div>
            <h2 id="waiting-heading">Waiting for reimbursement</h2>
            <p>Submitted and awaiting a response</p>
          </div>
          <span className="count-badge waiting-count">{waiting.length}</span>
        </div>
        {loading ? <p className="empty-state">Loading claims…</p> : waiting.length ? (
          <div className="claim-list">{waiting.map((claim) => <ClaimCard key={claim.name} claim={claim} />)}</div>
        ) : <p className="empty-state">No claims waiting for reimbursement.</p>}
      </section>

      <footer className="page-footer">
        <span>{activeClaims.length} active {activeClaims.length === 1 ? "claim" : "claims"}</span>
        <button className="text-button" onClick={() => void refresh()}>Refresh</button>
        <span className="footer-separator">·</span>
        <span>Closed claims are hidden</span>
      </footer>
    </main>
  );
}
