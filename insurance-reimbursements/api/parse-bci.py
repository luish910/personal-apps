import io
import json
import os
import re
import hmac
from http.server import BaseHTTPRequestHandler

import pdfplumber


def num(value):
    """Convert Chilean/Spanish formatted amounts to a JSON number."""
    return float(value.replace("$", "").replace(".", "").replace(",", "."))


NAT = re.compile(
    r"(?P<date>\d{2}/\d{2}/\d{2})\s+(?P<post>\d{4})\s+(?P<ref>\d{8})\s+"
    r"(?P<desc>.+?)\s+\$(?P<amt>-?[\d.]+)\s+\$(?P<total>-?[\d.]+)\s+"
    r"(?P<cuota>\d{2}/\d{2})\s+\$(?P<monthly>-?[\d.]+)$"
)

INT = re.compile(
    r"(?P<ref>\d{4}\s\d{20,})\s+(?P<date>\d{2}/\d{2}/\d{2})\s+(?P<desc>.+?)\s+"
    r"(?P<country>[A-Z]{2})\s+(?P<orig>[\d.]+,\d{2})\s+(?P<usd>-?[\d.]*,\d{2})$"
)


def parse(pdf_bytes, password=None):
    out = {"national": [], "international": [], "totals": {}}
    mode = None

    with pdfplumber.open(io.BytesIO(pdf_bytes), password=password or None) as pdf:
        for page in pdf.pages:
            for line in (page.extract_text() or "").splitlines():
                if "ESTADO DE CUENTA NACIONAL" in line:
                    mode = "national"
                elif "ESTADO DE CUENTA INTERNACIONAL" in line:
                    mode = "international"

                if mode == "national":
                    match = NAT.search(line)
                    if match:
                        row = match.groupdict()
                        row["amt"] = num(row["amt"])
                        row["monthly"] = num(row["monthly"])
                        row["total"] = num(row["total"])
                        # Classification intentionally remains in Google Apps Script.
                        out["national"].append(row)

                elif mode == "international":
                    match = INT.search(line)
                    if match:
                        row = match.groupdict()
                        row["orig"] = num(row["orig"])
                        row["usd"] = num(row["usd"])
                        out["international"].append(row)

                # Reconciliation anchors from the statement.
                patterns = [
                    ("A", r"MONTO FACTURADO A PAGAR \(PERÍODO ANTERIOR\) \(A\) \$([\d.]+)"),
                    ("B", r"1\.TOTAL OPERACIONES \(B\) \$([\d.]+)"),
                    ("C", r"\(C\) \$([\d.]+)"),
                    ("D", r"\(D\) \$([\d.]+)"),
                    ("billed", r"MONTO TOTAL FACTURADO A PAGAR \(A \+ B \+ C \+D\) \$([\d.]+)"),
                    ("tarjeta", r"TOTAL TARJETA XXXX XXXX XXXX 94 \$([\d.]+)"),
                    ("cuotas", r"TOTAL COMPRAS EN CUOTAS A LA CUENTA \$([\d.]+)"),
                ]
                if mode == "national":
                    for key, pattern in patterns:
                        found = re.search(pattern, line)
                        if found:
                            out["totals"][key] = num(found.group(1))

                found_usd = re.search(r"DEUDA TOTAL US\$\s*([\d.,]+)", line)
                if found_usd:
                    out["totals"]["usd_total"] = num(found_usd.group(1))

    return out


class handler(BaseHTTPRequestHandler):
    def _respond(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._respond(200, {
            "ok": True,
            "service": "bci-pdf-parser",
            "usage": "POST a raw PDF with Content-Type: application/pdf"
        })

    def do_POST(self):
        expected_key = os.environ.get("BCI_PARSER_API_KEY", "")
        provided_key = self.headers.get("Authorization", "")
        if not expected_key:
            self._respond(503, {"ok": False, "error": "BCI parser API key is not configured."})
            return
        if not hmac.compare_digest(provided_key, "Bearer " + expected_key):
            self._respond(401, {"ok": False, "error": "Unauthorized."})
            return

        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/pdf":
            self._respond(415, {"ok": False, "error": "Content-Type must be application/pdf."})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0

        # Vercel Functions currently impose a 4.5 MB request-body limit.
        if length <= 0:
            self._respond(400, {"ok": False, "error": "The PDF request body is empty."})
            return
        if length > 4_500_000:
            self._respond(413, {"ok": False, "error": "PDF exceeds the request size limit."})
            return

        pdf_bytes = self.rfile.read(length)
        if not pdf_bytes.startswith(b"%PDF-"):
            self._respond(400, {"ok": False, "error": "Request body is not a valid PDF."})
            return

        try:
            result = parse(pdf_bytes, password=self.headers.get("X-PDF-Password"))
            self._respond(200, {
                "ok": True,
                "counts": {
                    "national": len(result["national"]),
                    "international": len(result["international"]),
                },
                "data": result,
            })
        except Exception as exc:
            # Avoid exposing stack traces or PDF internals to the caller.
            message = str(exc)
            if "password" in message.lower() or "encrypt" in message.lower():
                self._respond(422, {"ok": False, "error": "Could not open the PDF. Check the PDF password."})
            else:
                self._respond(422, {"ok": False, "error": "PDF parsing failed.", "detail": message[:300]})

    def log_message(self, format, *args):
        # Vercel captures stdout/stderr; avoid logging request headers or PDF data.
        print("bci-parser:", format % args)
