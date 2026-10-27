import { google } from "googleapis";
import type { Claim, ClaimAction, ClaimRoute, ClaimStatus } from "@/lib/types";

const SHEET_NAME = "Claims";
const HEADERS = [
  "Claim Name",
  "Route",
  "Status",
  "Created At",
  "Expense Date",
  "Isapre Submitted At",
  "Complementary Submitted At",
  "Updated At"
];

function getSpreadsheetId() {
  const id = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!id) throw new Error("Missing GOOGLE_SHEETS_SPREADSHEET_ID.");
  return id;
}

function getSheetsClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new Error("Google Sheets service-account credentials are not configured.");
  }

  const privateKey = rawKey.replace(/\\n/g, "\n");
  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  return google.sheets({ version: "v4", auth });
}

function claimsRange() {
  return `${SHEET_NAME}!A:H`;
}

function rowToClaim(row: string[]): Claim {
  return {
    name: row[0] ?? "",
    route: (row[1] || "both") as ClaimRoute,
    status: (row[2] || "needs_isapre") as ClaimStatus,
    createdAt: row[3] ?? "",
    expenseDate: row[4] ?? "",
    isapreSubmittedAt: row[5] ?? "",
    complementarySubmittedAt: row[6] ?? "",
    updatedAt: row[7] ?? ""
  };
}

function extractExpenseDate(name: string): string {
  // Expected prefix: YYYY-MM-DD_label. Keep the date as a date-only string.
  const match = name.match(/^(\d{4}-\d{2}-\d{2})_/);
  return match ? match[1] : "";
}

async function ensureHeaders() {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A1:H1`
  });

  const current = result.data.values?.[0] ?? [];
  if (current.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_NAME}!A1:H1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADERS] }
    });
  }
}

export async function listClaims(): Promise<Claim[]> {
  await ensureHeaders();
  const sheets = getSheetsClient();
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: claimsRange()
  });

  const rows = (result.data.values ?? []).slice(1);
  return rows
    .filter((row) => row[0])
    .map(rowToClaim);
}

async function findClaimRow(name: string): Promise<{ rowNumber: number; claim: Claim } | null> {
  const claims = await listClaims();
  const index = claims.findIndex((claim) => claim.name === name);
  if (index < 0) return null;

  // listClaims excludes the header and empty rows, but our app only writes
  // complete rows and does not delete rows. Row 2 is the first claim.
  return { rowNumber: index + 2, claim: claims[index] };
}

export async function createClaim(name: string, route: ClaimRoute): Promise<Claim> {
  await ensureHeaders();

  const existing = await findClaimRow(name);
  if (existing) throw new Error("A claim with this exact name already exists.");

  const now = new Date().toISOString();
  const expenseDate = extractExpenseDate(name);
  if (!expenseDate) {
    throw new Error("Claim name must start with a date in YYYY-MM-DD_ format.");
  }

  const status: ClaimStatus = route === "both" ? "needs_isapre" : "needs_complementary";
  const row = [name, route, status, now, expenseDate, "", "", now];

  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: `${SHEET_NAME}!A:H`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] }
  });

  return {
    name,
    route,
    status,
    createdAt: now,
    expenseDate,
    isapreSubmittedAt: "",
    complementarySubmittedAt: "",
    updatedAt: now
  };
}

const ALLOWED_TRANSITIONS: Record<ClaimAction, { from: ClaimStatus[]; to: ClaimStatus }> = {
  submit_isapre: { from: ["needs_isapre"], to: "waiting_isapre" },
  isapre_reimbursement_received: { from: ["waiting_isapre"], to: "needs_complementary" },
  submit_complementary: { from: ["needs_complementary"], to: "waiting_complementary" },
  request_isapre_correction: { from: ["waiting_isapre"], to: "correction_isapre" },
  request_complementary_correction: { from: ["needs_complementary", "waiting_complementary"], to: "correction_complementary" },
  resubmit_isapre: { from: ["correction_isapre"], to: "waiting_isapre" },
  resubmit_complementary: { from: ["correction_complementary"], to: "waiting_complementary" },
  close: { from: ["waiting_complementary"], to: "closed" }
};

export async function updateClaim(name: string, action: ClaimAction): Promise<Claim> {
  const found = await findClaimRow(name);
  if (!found) throw new Error("No claim was found with that exact name.");

  const transition = ALLOWED_TRANSITIONS[action];
  if (!transition) throw new Error("Unsupported action.");

  if (!transition.from.includes(found.claim.status)) {
    throw new Error(`Cannot perform "${action}" while the claim status is "${found.claim.status}".`);
  }

  if (action === "isapre_reimbursement_received" && found.claim.route !== "both") {
    throw new Error("This claim does not require Isapre.");
  }

  const now = new Date().toISOString();
  const updated: Claim = {
    ...found.claim,
    status: transition.to,
    updatedAt: now,
    isapreSubmittedAt:
      action === "submit_isapre" || action === "resubmit_isapre"
        ? now
        : found.claim.isapreSubmittedAt,
    complementarySubmittedAt:
      action === "submit_complementary" || action === "resubmit_complementary"
        ? now
        : found.claim.complementarySubmittedAt
  };

  const row = [
    updated.name,
    updated.route,
    updated.status,
    updated.createdAt,
    updated.expenseDate,
    updated.isapreSubmittedAt,
    updated.complementarySubmittedAt,
    updated.updatedAt
  ];

  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `${SHEET_NAME}!A${found.rowNumber}:H${found.rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [row] }
  });

  return updated;
}
