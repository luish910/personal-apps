import io
import json
import os
import re
import hmac
from datetime import datetime
from http.server import BaseHTTPRequestHandler

import pdfplumber

MAX_PDF_BYTES = 4_500_000

def num(s):
    return float(s.replace("$", "").replace(" ", "").replace(".", "").replace(",", "."))

ROW = re.compile(
    r"^(?:(?P<place>.+?)\s+)?(?P<date>\d{2}/\d{2}/\d{4})\s+(?P<desc>.+?)\s+\$\s*(?P<amt>-?[\d.]+)$"
)
BARE = re.compile(r"^\$\s*(?P<amt>-?[\d.]+)$")
ANCHORS = {
    "prior_final": r"Saldo Adeudado Final Período Anterior \$ (-?[\d.]+)",
    "billed":      r"Monto Total Facturado \$ (-?[\d.]+)",
    "min_pay":     r"Monto Mínimo a Pagar\*? \$ (-?[\d.]+)",
}

def classify(desc, section):
    if desc.strip() == "PAGO":
        return "payment"
    if re.search(r"DCTO|COM ADM|MANTENCION|COMISION|IMPUESTO|INTERES", desc):
        return "fee"
    if section == "charges":
        return "credit"
    return "purchase"

def parse(pdf_bytes, password=None):
    rows, subs, totals = [], {}, {}
    section = None  # lider | otros | charges | payments
    with pdfplumber.open(io.BytesIO(pdf_bytes), password=password or None) as pdf:
        for page in pdf.pages:
            for line in (page.extract_text() or "").splitlines():
                line = line.strip()
                if line == "LIDER":
                    section = "lider"
                    continue
                if line == "OTROS COMERCIOS":
                    section = "otros"
                    continue
                if line.startswith("3. Cargos"):
                    section = "charges"
                    continue
                for key, pattern in ANCHORS.items():
                    match = re.search(pattern, line)
                    if match and key not in totals:
                        totals[key] = num(match.group(1))
                match = re.search(r"Período Facturado (\d{2}/\d{2}/\d{4}) (\d{2}/\d{2}/\d{4})", line)
                if match:
                    totals["period"] = match.groups()
                if section is None:
                    continue
                match = ROW.match(line)
                if match:
                    row = match.groupdict()
                    if row["desc"].strip() == "PAGO":
                        section = "payments"
                    row["place"] = (row["place"] or "").replace(" CL", "").strip()
                    row["desc"] = row["desc"].strip()
                    row["merchant"] = re.sub(r"\s*\(T\)$", "", row["desc"])
                    row["amt"] = num(row["amt"])
                    row["type"] = classify(row["desc"], section)
                    row["date_iso"] = datetime.strptime(row["date"], "%d/%m/%Y").date().isoformat()
                    rows.append(row)
                else:
                    match = BARE.match(line)
                    if match:
                        subs[section] = num(match.group("amt"))
    return {"rows": rows, "subtotals": subs, "totals": totals}

def validate(result):
    rows, subtotals, totals = result["rows"], result["subtotals"], result["totals"]
    total = lambda predicate: sum(row["amt"] for row in rows if predicate(row))
    checks = {}
    if "lider" in subtotals:
        checks["LIDER block == subtotal"] = total(
            lambda row: row["type"] == "purchase" and row["merchant"].startswith("LIDER DOMICILIO")
        ) == subtotals["lider"]
    if "otros" in subtotals:
        checks["OTROS COMERCIOS == subtotal"] = total(
            lambda row: row["type"] == "purchase" and not row["merchant"].startswith("LIDER DOMICILIO")
        ) == subtotals["otros"]
    if "charges" in subtotals:
        checks["Charges/credits == subtotal"] = total(
            lambda row: row["type"] in ("credit", "fee")
        ) == subtotals["charges"]
    if "payments" in subtotals:
        checks["Payments == subtotal"] = total(lambda row: row["type"] == "payment") == subtotals["payments"]
    if "prior_final" in totals and "billed" in totals:
        checks["prior_final + rows == billed"] = totals["prior_final"] + total(lambda row: True) == totals["billed"]
    return checks

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
            "service": "lider-statement-parser",
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
            result = parse(pdf_bytes, self.headers.get("X-PDF-Password"))
            checks = validate(result)
        except Exception:
            self.send_json(422, {"ok": False, "error": "Could not parse this PDF. Check that it is a readable Lider statement and that any password is correct."})
            return

        self.send_json(200, {
            "ok": True,
            "counts": {"rows": len(result["rows"])},
            "data": result,
            "validation": checks,
        })

    def log_message(self, format, *args):
        return
