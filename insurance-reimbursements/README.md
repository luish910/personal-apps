# Insurance Reimbursements

A small, mobile-first reimbursement tracker. The app runs on Vercel, stores claim rows in Google Sheets, and exposes API endpoints that can also be called from iOS Shortcuts.

## Current scope

- Create a claim with either route:
  - `both`: Isapre first, then complementary insurance.
  - `complementary_only`: go straight to complementary insurance.
- Show action-needed and waiting claims in visually distinct vertical sections.
- Sort action-needed claims by oldest expense date; sort waiting claims by oldest submission date.
- Update statuses with one tap.
- Record the submission timestamps when a claim is submitted.
- Automatically advance a claim from `waiting_isapre` to `needs_complementary` when the Shortcut reports that the Isapre reimbursement certificate was saved.
- Keep closed claims in the sheet but hide them in the active interface.
- Protect the app and API using HTTP Basic Authentication.

This is a proof of concept. It does not submit claims to insurers, read PDFs, or access iCloud Drive.

## 1. Add this folder to your repository

Copy `insurance-reimbursements/` into the root of your existing `personal-apps` repository, next to `daily-portions/`.

In Vercel, create a **separate project** connected to the same GitHub repository. Set its **Root Directory** to `insurance-reimbursements`. Do not change the existing Daily Portions project's root directory or settings.

## 2. Create the Google Sheet

1. Create a new Google spreadsheet named `Insurance Reimbursements`.
2. Copy the spreadsheet ID from its URL. It is the part between `/d/` and `/edit`.
3. Create a tab named `Claims` (exact capitalization).
4. You can leave it empty; the app creates the header row on first request.

The columns are:

`Claim Name | Route | Status | Created At | Expense Date | Isapre Submitted At | Complementary Submitted At | Updated At`

Do not rename or reorder these columns after the app starts using the sheet.

## 3. Create Google service-account credentials

1. In Google Cloud Console, create or select a project.
2. Enable **Google Sheets API** for that project.
3. Create a service account.
4. Create a JSON key for that service account and download it securely.
5. Open the JSON key locally and note these fields:
   - `client_email`
   - `private_key`
6. Share the spreadsheet with the service account's `client_email` address and give it **Editor** access.

Do not commit the downloaded JSON key or any private key to GitHub.

## 4. Configure environment variables

In the Vercel project, add these environment variables for Production (and Preview only if you intend to use Preview deployments):

- `GOOGLE_SHEETS_SPREADSHEET_ID`: the spreadsheet ID from step 2.
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`: the service account's `client_email`.
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`: the complete `private_key` value, including the BEGIN/END lines. Paste it as a multiline value if Vercel accepts it; otherwise use `\n` for line breaks.
- `APP_USERNAME`: a username you choose.
- `APP_PASSWORD`: a long, unique password.

Redeploy after adding or changing environment variables.

For local development, copy `.env.example` to `.env.local` and fill in the same values. Never commit `.env.local`.

## 5. Deploy

1. Push the folder to GitHub.
2. In Vercel, import the existing `personal-apps` repository as a **new project**.
3. Set Root Directory to `insurance-reimbursements`.
4. Keep the detected Next.js framework preset.
5. Add the environment variables above.
6. Deploy.

When you visit the deployment URL, your browser should ask for the HTTP Basic Auth username and password. Enter the values configured in Vercel.

If the page shows an error, check the Vercel deployment logs. Common causes are a missing environment variable, a misspelled sheet tab name, or not sharing the spreadsheet with the service account.

## 6. Test the demo

Use the **+ Test claim** button. Claim names must start with `YYYY-MM-DD_`, for example:

- `2026-10-27_Pharmacy`
- `2026-10-25_Psychologist`
- `2026-10-22_Dental`

Choose the route and create the claim. Refresh the Google Sheet to confirm the row exists.

Try the status buttons. Verify that the status and submission timestamps change in the sheet. Closed claims remain in the sheet but are hidden from the active view.

The app requires a unique claim name. If you try to create the same name twice, it should reject the duplicate.

## 7. API reference

All endpoints are protected by HTTP Basic Auth.

### List claims

`GET /api/claims`

Example response:

```json
{
  "ok": true,
  "claims": []
}
```

### Create a claim

`POST /api/claims`

Headers:
- `Content-Type: application/json`
- `Authorization: Basic BASE64(username:password)`

Body:

```json
{
  "name": "2026-10-27_Pharmacy",
  "route": "complementary_only"
}
```

Use `"both"` for Isapre-first claims. The API derives the expense date from the `YYYY-MM-DD_` prefix and sets the initial status automatically.

### Perform an action

`POST /api/claims/action`

Body:

```json
{
  "name": "2026-10-27_Psychologist",
  "action": "submit_isapre"
}
```

Supported actions:

| Action | Expected current status | Result |
|---|---|---|
| `submit_isapre` | `needs_isapre` | `waiting_isapre`; records Isapre submission timestamp |
| `isapre_reimbursement_received` | `waiting_isapre` | `needs_complementary`; intended for the Shortcut after saving the reimbursement certificate |
| `submit_complementary` | `needs_complementary` | `waiting_complementary`; records complementary submission timestamp |
| `request_isapre_correction` | `waiting_isapre` | `correction_isapre` |
| `request_complementary_correction` | `needs_complementary` or `waiting_complementary` | `correction_complementary` |
| `resubmit_isapre` | `correction_isapre` | `waiting_isapre`; refreshes Isapre submission timestamp |
| `resubmit_complementary` | `correction_complementary` | `waiting_complementary`; refreshes complementary submission timestamp |
| `close` | `waiting_complementary` | `closed` |

Actions are validated against the current status. Repeating an action after a successful transition returns an error instead of silently applying the transition twice.

## 8. Connect iOS Shortcuts later

Do not change your production Shortcut until the web demo works.

When you are ready, in the Shortcut use **Get Contents of URL**:

- URL: `https://YOUR-VERCEL-DOMAIN/api/claims/action`
- Method: `POST`
- Request Body: JSON
- Header `Content-Type`: `application/json`
- Header `Authorization`: `Basic BASE64(username:password)`

For the Isapre reimbursement certificate document type, send this JSON body:

```json
{
  "name": "EXACT_FOLDER_NAME",
  "action": "isapre_reimbursement_received"
}
```

Replace `EXACT_FOLDER_NAME` with the existing folder name variable. The response contains `ok` and `message`; pass the message to **Show Result** or **Show Notification**.

For a new claim, POST to `/api/claims` with the folder name and route:

```json
{
  "name": "2026-10-27_Pharmacy",
  "route": "complementary_only"
}
```

For the other route use `"route": "both"`.

### Basic Auth header

The header value is `Basic ` followed by the Base64 encoding of `username:password`. Generate it locally or with a trusted password manager. Do not put the service-account private key in Shortcuts. The Shortcut only needs the app's Basic Auth credentials.

## Security and limitations

- The app is protected by HTTP Basic Auth over HTTPS. Use a long, unique password.
- Never commit credentials to the repository or put them in client-side code.
- Anyone with the app username/password can view and change the claims.
- The spreadsheet is the source of truth; export it periodically as a backup.
- The proof of concept uses simple row lookup, suitable for a small personal tracker. It is not designed for concurrent edits by many users.
- The app intentionally does not delete closed claims or files.
