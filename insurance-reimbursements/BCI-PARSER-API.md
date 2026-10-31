# BCI PDF Parser API

This is a separate Python endpoint inside the existing `insurance-reimbursements` Vercel project. It does not write to Google Sheets and does not perform transaction classification; Google Apps Script remains responsible for classification and the existing workflow.

## Deploy safely

1. This implementation is on branch `feat/bci-pdf-parser-api`; it does not change `main`.
2. In Vercel, open the existing Insurance Reimbursements project and create a Preview deployment for this branch (or wait for the automatic Git preview deployment).
3. In that project's Environment Variables, add `BCI_PARSER_API_KEY` with a long random secret. Set it for Preview first. Do not commit the secret.
4. Redeploy the Preview deployment after adding the variable.
5. Open `https://YOUR-PREVIEW-DOMAIN/api/parse-bci`. A JSON service status should be returned.

Vercel's Python runtime is currently Beta. The dependency is declared in `requirements.txt`.

## Call the endpoint

Send the PDF itself as the raw request body. Do not use JSON or multipart form data.

```bash
curl -X POST 'https://YOUR-PREVIEW-DOMAIN/api/parse-bci' \
  -H 'Authorization: Bearer YOUR_BCI_PARSER_API_KEY' \
  -H 'Content-Type: application/pdf' \
  --data-binary '@2026_10_30_bci.pdf'
```

If the PDF is password-protected, optionally provide its password in `X-PDF-Password`. Do not log or store that password unnecessarily.

Successful response shape:

```json
{
  "ok": true,
  "counts": {
    "national": 0,
    "international": 0
  },
  "data": {
    "national": [],
    "international": [],
    "totals": {}
  }
}
```

The zeroes and empty arrays above are illustrative only.

## Important limits and security

- Vercel Functions reject request bodies larger than 4.5 MB. This endpoint returns a clear 413 response for oversized PDFs.
- The API requires a bearer token. Keep `BCI_PARSER_API_KEY` server-side. Do not put it in browser/client code or in a public iOS Shortcut.
- The parser currently depends on the PDF's text extraction and the regexes validated locally. Verify transaction counts and reconciliation totals before relying on a statement's output.
- This is a parser-only endpoint. It does not mutate the production spreadsheet, apply the Google Apps Script classification rules, or change the existing treatment of Lider.
