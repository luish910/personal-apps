import io
import json
import os
import re
import hmac
from http.server import BaseHTTPRequestHandler

import pdfplumber

MAX_PDF_BYTES = 4_500_000

NAT = re.compile(
    r"(?P<date>\d{2}/\d{2}/\d{2})\s+(?P<post>\d{4})\s+(?P<ref>\d{8})\s+"
    r"(?P<desc>.+?)\s+\$(?P<amt>-?[\d.]+)\s+\$(?P<total>-?[\d.]+)\s+"
    r"(?P<cuota>\d{2}/\d{2})\s+\$(?P<monthly>-?[\d.]+)$"
)
INT = re.compile(
    r"(?P<ref>\d{4}\s\d{20,})\s+(?P<date>\d{2}/\d{2}/\d{2})\s+(?P<desc>.+?)\s+"
    r"(?P<country>[A-Z]{2})\s+(?P<orig>[\d.]+,\d{2})\s+(?P<usd>-?[\d.]*,\d{2})$"
)

TOTAL_PATTERNS = [
    ("A", r"MONTO FACTURADO A PAGAR \(PERÍODO ANTERIOR\) \(A\) \$([\d.]+)"),
    ("B", r"1\.TOTAL OPERACIONES \(B\) \$([\d.]+)"),
    ("C", r"\(C\) \$([\d.]+)"),
    ("D", r"\(D\) \$([\d.]+)"),
    ("billed", r"MONTO TOTAL FACTURADO A PAGAR \(A \+ B \+ C \+D\) \$([\d.]+)"),
    ("tarjeta", r"TOTAL TARJETA XXXX XXXX XXXX 94 \$([\d.]+)"),
    ("cuotas", r"TOTAL COMPRAS EN CUOTAS A LA CUENTA \$([\d.]+)"),
]


def parse_number(value):
    return float(value.replace("$", "").replace(".", "").replace(",", "."))


def parse_pdf(pdf_bytes, password=None):
    result = {"national": [], "international": [], "totals": {}}
    mode = None

    with pdfplumber.open(io.BytesIO(pdf_bytes), password=password or None) as pdf:
        for page in pdf.pages:
            for line in (page.extract_text() or "").splitlines():
                if "ESTADO DE CUENTA NACIONAL" in line:
                    mode = "national"
                elif "ESTADO DE CUENTA INTERNACIONAL" in line:
                    mode = "international"
                elif mode == "national":
                    match = NAT.search(line)
                    if match:
                        row = match.groupdict()
                        row["amt"] = parse_number(row["amt"])
                        row["monthly"] = parse_number(row["monthly"])
                        row["total"] = parse_number(row["total"])
                        result["national"].append(row)
                elif mode == "international":
                    match = INT.search(line)
                    if match:
                        row = match.groupdict()
                        row["orig"] = parse_number(row["orig"])
                        row["usd"] = parse_number(row["usd"])
                        result["international"].append(row)

                if mode == "national":
                    for key, pattern in TOTAL_PATTERNS:
                        match = re.search(pattern, line)
                        if match:
                            result["totals"][key] = parse_number(match.group(1))

                match = re.search(r"DEUDA TOTAL US\$ ([\d.,]+)", line)
                if match:
                    result["totals"]["usd_total"] = parse_number(match.group(1))

    return result


class handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.send_json(200, {
            "ok": True,
            "service": "bci-statement-parser",
            "usage": "POST the original PDF as application/pdf to this endpoint."
        })

    def do_POST(self):
        expected_key = os.environ.get("BCI_PARSER_API_KEY")
        authorization = self.headers.get("Authorization", "")
        supplied_key = authorization.removeprefix("Bearer ").strip()

        if not expected_key:
            self.send_json(500, {"ok": False, "error": "Server API key is not configured."})
            return
        if not authorization.startswith("Bearer ") or not hmac.compare_digest(supplied_key, expected_key):
            self.send_json(401, {"ok": False, "error": "Unauthorized."})
            return

        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/pdf":
            self.send_json(415, {"ok": False, "error": "Send the original PDF with Content-Type: application/pdf."})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(400, {"ok": False, "error": "Invalid Content-Length."})
            return

        if content_length <= 0:
            self.send_json(400, {"ok": False, "error": "Request body is empty."})
            return
        if content_length > MAX_PDF_BYTES:
            self.send_json(413, {"ok": False, "error": "PDF exceeds the 4.5 MB request limit."})
            return

        pdf_bytes = self.rfile.read(content_length)
        if not pdf_bytes.startswith(b"%PDF-"):
            self.send_json(400, {"ok": False, "error": "Request body does not look like a PDF."})
            return

        try:
            data = parse_pdf(pdf_bytes, self.headers.get("X-PDF-Password"))
        except Exception as exc:
            # Keep internal exception details out of the public response.
            self.send_json(422, {"ok": False, "error": "Could not parse this PDF. Check that it is a readable BCI statement and that any password is correct."})
            return

        self.send_json(200, {
            "ok": True,
            "counts": {
                "national": len(data["national"]),
                "international": len(data["international"]),
            },
            "data": data,
        })

    def log_message(self, format, *args):
        # Avoid logging request headers or other potentially sensitive details.
        return
