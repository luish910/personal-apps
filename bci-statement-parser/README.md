# BCI Statement Parser API

A standalone Python endpoint for parsing the original BCI credit-card statement PDF. It returns structured JSON; transaction classification stays in Google Apps Script.

## Endpoint

- `GET /api/parse` — health check
- `POST /api/parse` — parse a PDF

POST the raw PDF bytes with:

- `Content-Type: application/pdf`
- `Authorization: Bearer <BCI_PARSER_API_KEY>`

Optional header: `X-PDF-Password` for password-protected PDFs.

Successful response:

```json
{
  "ok": true,
  "counts": { "national": 0, "international": 0 },
  "data": {
    "national": [],
    "international": [],
    "totals": {}
  }
}
```

## Deploy on Vercel without the terminal

1. In Vercel, create a new project and import the `luish910/personal-apps` GitHub repository.
2. Set **Root Directory** to `bci-statement-parser`.
3. Add the environment variable `BCI_PARSER_API_KEY` with a long, random secret value. Keep it private.
4. Deploy the project. Vercel should detect the Python function under `api/parse.py`.
5. The endpoint will be available at `https://<your-project-domain>/api/parse`.

This folder is independent from `insurance-reimbursements`; do not change the reimbursement project's Vercel settings.

## Request size

The handler rejects PDFs larger than 4.5 MB to stay within Vercel's request-body limit. If real statements exceed that size, we should choose a different upload strategy before integrating Apps Script.

## Notes

- This parser does not classify transactions. Keep the current classification logic in Apps Script.
- Parsing is based on the regular expressions validated locally against the supplied BCI PDF. Test with the same statement after deployment before connecting it to the live workflow.
- Do not commit API keys, bank statements, or other sensitive documents to GitHub.
