"""Admin-only bulk PDF extraction and form-session creation."""

import re
import unicodedata
from io import BytesIO
from typing import Any

from fastapi import APIRouter, Depends, File, Form as FormParameter, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.ai import process_field_answer
from app.auth import get_current_user, require_role
from app.database import get_db
from app.models import Form, FormAnswer, FormField, FormSession, User
from app.pdf_ocr import extract_pdf_structure
from app.schemas import BulkPdfImportRequest
from pypdf import PdfReader

router = APIRouter(prefix="/api/admin/bulk-pdf", tags=["Admin PDF Import"])
MAX_FILE_BYTES = 12 * 1024 * 1024
MAX_PAGES = 40

COMMON_ALIASES = {
    "email": ["email", "email address", "e mail", "mail"],
    "full_name": ["name", "full name", "employee name", "applicant name", "candidate name"],
    "first_name": ["first name", "given name", "forename"],
    "last_name": ["last name", "surname", "family name"],
    "phone": ["phone", "phone number", "mobile", "mobile number", "telephone"],
}


def _normalize(value: str) -> str:
    value = unicodedata.normalize("NFKD", str(value or ""))
    value = "".join(char for char in value if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def _field_aliases(field: FormField) -> list[str]:
    aliases = {_normalize(field.field_name), _normalize(field.question)}
    aliases.update(_normalize(item) for item in COMMON_ALIASES.get(_normalize(field.field_name).replace(" ", "_"), []))
    question = _normalize(field.question)
    for prefix in ("what is ", "what s ", "how many ", "how long ", "are you ", "do you ", "please enter ", "enter ", "your "):
        if question.startswith(prefix):
            aliases.add(question[len(prefix):])
    return sorted((alias for alias in aliases if alias), key=len, reverse=True)


def _column_alias(field: FormField, header: str) -> bool:
    normalized = _normalize(header)
    return any(normalized == alias or normalized.startswith(alias + " ") or normalized.endswith(" " + alias)
               for alias in _field_aliases(field))


def _clean_cell(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("<br>", " ").replace("<br/>", " ")).strip()


def _row_record(headers: list[str], cells: list[str], fields: list[FormField]) -> dict[str, Any]:
    record: dict[str, Any] = {"values": {}, "email": "", "name": ""}
    for index, header in enumerate(headers):
        value = _clean_cell(cells[index]) if index < len(cells) else ""
        if not value or re.fullmatch(r":?-{2,}:?", value):
            continue
        normalized_header = _normalize(header)
        if normalized_header in {_normalize(item) for item in COMMON_ALIASES["email"]}:
            record["email"] = value.lower()
        if normalized_header in {_normalize(item) for item in COMMON_ALIASES["full_name"]}:
            record["name"] = value
        for field in fields:
            if _column_alias(field, header):
                record["values"][field.id] = value
                if field.field_type.lower() == "email" or "email" in _normalize(field.field_name):
                    record["email"] = value.lower()
        # A full name column can supply split first/last fields too.
        if normalized_header in {_normalize(item) for item in COMMON_ALIASES["full_name"]}:
            parts = value.split()
            for field in fields:
                key = _normalize(field.field_name).replace(" ", "_")
                if key == "first_name" and parts:
                    record["values"].setdefault(field.id, parts[0])
                elif key == "last_name" and len(parts) > 1:
                    record["values"].setdefault(field.id, " ".join(parts[1:]))
    return record


def _parse_tables(text: str, fields: list[FormField]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    rows: list[list[str]] = []

    def flush() -> None:
        nonlocal rows
        if len(rows) >= 2:
            headers = rows[0]
            if not all(re.fullmatch(r":?-{2,}:?", cell) for cell in headers):
                for cells in rows[1:]:
                    if all(re.fullmatch(r":?-{2,}:?", cell) for cell in cells):
                        continue
                    record = _row_record(headers, cells, fields)
                    if record["email"] or record["name"] or record["values"]:
                        records.append(record)
        rows = []

    for line in text.splitlines():
        stripped = line.strip()
        if "|" not in stripped:
            flush()
            continue
        cells = stripped.strip("|").split("|")
        rows.append([_clean_cell(cell) for cell in cells])
    flush()
    return records


def _parse_labeled_sections(text: str, fields: list[FormField]) -> list[dict[str, Any]]:
    label_to_field: dict[str, int] = {}
    identity_labels = {
        "email": "email",
        "email address": "email",
        "e mail": "email",
        "name": "name",
        "full name": "name",
    }
    for field in fields:
        for alias in _field_aliases(field):
            label_to_field[alias] = field.id
    all_labels = sorted(set(label_to_field) | set(identity_labels), key=len, reverse=True)
    current: dict[str, Any] = {"values": {}, "email": "", "name": ""}
    records: list[dict[str, Any]] = []

    def flush() -> None:
        nonlocal current
        if current["email"] or current["name"] or current["values"]:
            records.append(current)
        current = {"values": {}, "email": "", "name": ""}

    label_re = re.compile(r"^\s*(.+?)\s*[:=]\s*(.*?)\s*$")
    for line in text.splitlines():
        match = label_re.match(line)
        if not match:
            continue
        label = _normalize(match.group(1))
        value = _clean_cell(match.group(2))
        if not value:
            continue
        matched_label = next((alias for alias in all_labels if label == alias), None)
        if not matched_label:
            continue
        identity = identity_labels.get(matched_label)
        if identity and current[identity]:
            flush()
        if identity == "email":
            current["email"] = value.lower()
        elif identity == "name":
            current["name"] = value
        field_id = label_to_field.get(matched_label)
        if field_id:
            current["values"][field_id] = value
        if identity == "name":
            parts = value.split()
            for field in fields:
                key = _normalize(field.field_name).replace(" ", "_")
                if key == "first_name" and parts:
                    current["values"].setdefault(field.id, parts[0])
                elif key == "last_name" and len(parts) > 1:
                    current["values"].setdefault(field.id, " ".join(parts[1:]))
    flush()
    return records


def _parse_linear_table(text: str, fields: list[FormField]) -> list[dict[str, Any]]:
    """Parse PDFs whose table text is emitted one cell per line by pypdf."""
    lines = [_clean_cell(line) for line in text.splitlines() if _clean_cell(line)]
    header_start = None
    headers: list[str] = []
    for index, line in enumerate(lines):
        if line.strip().lower() not in {"#", "no", "number", "id"}:
            continue
        candidate = [line]
        mapped_ids: set[int] = set()
        for header in lines[index + 1:index + 1 + len(fields) + 3]:
            matched = next((field for field in fields if _column_alias(field, header)), None)
            if matched is None:
                break
            candidate.append(header)
            mapped_ids.add(matched.id)
        if len(mapped_ids) >= min(3, len(fields)):
            header_start = index
            headers = candidate
            break
    if header_start is None:
        return []

    width = len(headers)
    cursor = header_start + width
    records = []
    while cursor + width <= len(lines):
        first_cell = lines[cursor]
        if not re.fullmatch(r"\d+", first_cell):
            break
        cells = lines[cursor:cursor + width]
        record = _row_record(headers, cells, fields)
        if record["email"] or record["name"] or record["values"]:
            records.append(record)
        cursor += width
    return records


def parse_people_records(text: str, fields: list[FormField]) -> list[dict[str, Any]]:
    table_records = _parse_tables(text, fields)
    labeled_records = _parse_labeled_sections(text, fields)
    linear_records = _parse_linear_table(text, fields)
    records = max((table_records, labeled_records, linear_records), key=len)
    # De-duplicate repeated rows from page headers or overlapping OCR blocks.
    deduped: list[dict[str, Any]] = []
    seen: set[tuple[str, str, tuple[tuple[int, str], ...]]] = set()
    for record in records:
        if not record["name"]:
            first = next((record["values"].get(field.id, "") for field in fields if _normalize(field.field_name).replace(" ", "_") == "first_name"), "")
            last = next((record["values"].get(field.id, "") for field in fields if _normalize(field.field_name).replace(" ", "_") == "last_name"), "")
            record["name"] = " ".join(part for part in (first, last) if part)
        signature = (record["email"], _normalize(record["name"]), tuple(sorted(record["values"].items())))
        if signature in seen:
            continue
        seen.add(signature)
        deduped.append(record)
    return deduped


def _match_user(record: dict[str, Any], users: list[User]) -> tuple[User | None, str | None]:
    email = (record.get("email") or "").strip().lower()
    if email:
        matches = [user for user in users if user.email.lower() == email]
        return (matches[0], None) if len(matches) == 1 else (None, "No registered user has this email address.")
    name = _normalize(record.get("name", ""))
    matches = [user for user in users if _normalize(user.name) == name] if name else []
    if len(matches) == 1:
        return matches[0], None
    if len(matches) > 1:
        return None, "More than one registered user has this name; match by email or select manually."
    return None, "No unique registered user match."


class PreviewRecord(BaseModel):
    source_file: str
    name: str
    email: str
    user_id: int | None = None
    user_name: str | None = None
    user_email: str | None = None
    match_error: str | None = None
    answers: list[dict[str, Any]]


class PreviewResponse(BaseModel):
    records: list[PreviewRecord]
    files_processed: int


async def _read_and_ocr(file: UploadFile, fields: list[FormField]) -> tuple[str, str]:
    filename = file.filename or "upload.pdf"
    if not filename.lower().endswith(".pdf") and file.content_type != "application/pdf":
        raise HTTPException(status_code=415, detail=f"{filename}: choose a PDF file.")
    content = await file.read(MAX_FILE_BYTES + 1)
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail=f"{filename}: PDF exceeds the 12 MB limit.")
    if not content.startswith(b"%PDF-"):
        raise HTTPException(status_code=415, detail=f"{filename}: file is not a valid PDF.")
    try:
        reader = PdfReader(BytesIO(content), strict=False)
        if reader.is_encrypted:
            raise HTTPException(status_code=422, detail=f"{filename}: password-protected PDFs are not supported.")
        if len(reader.pages) > MAX_PAGES:
            raise HTTPException(status_code=413, detail=f"{filename}: PDF exceeds the 40-page limit.")
        native_text = "\n".join(page.extract_text() or "" for page in reader.pages).strip()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"{filename}: could not open the PDF.") from exc
    if native_text and parse_people_records(native_text, fields):
        return filename, native_text
    try:
        result = await run_in_threadpool(extract_pdf_structure, content)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"{filename}: PP-StructureV3 could not process this PDF.") from exc
    if not result.get("text"):
        raise HTTPException(status_code=422, detail=f"{filename}: no readable text or tables were found.")
    return filename, result["text"]


@router.post("/preview", response_model=PreviewResponse)
async def preview_bulk_pdf(
    form_id: int = FormParameter(...),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    _: User = Depends(require_role(["admin"])),
):
    if not files:
        raise HTTPException(status_code=422, detail="Choose at least one PDF.")
    if len(files) > 20:
        raise HTTPException(status_code=413, detail="Upload no more than 20 PDFs at a time.")
    form = db.query(Form).filter(Form.id == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found.")
    fields = list(form.fields)
    users = db.query(User).filter(User.role == "user").all()
    previews: list[PreviewRecord] = []
    for file in files:
        filename, text = await _read_and_ocr(file, fields)
        records = parse_people_records(text, fields)
        for record in records:
            user, match_error = _match_user(record, users)
            previews.append(PreviewRecord(
                source_file=filename,
                name=record.get("name", ""),
                email=record.get("email", ""),
                user_id=user.id if user else None,
                user_name=user.name if user else None,
                user_email=user.email if user else None,
                match_error=match_error,
                answers=[{"field_id": field.id, "field_name": field.field_name, "value": record["values"].get(field.id, "")} for field in fields],
            ))
    if not previews:
        raise HTTPException(status_code=422, detail="No person records were recognized. Use a table with labeled columns or labeled record sections.")
    return PreviewResponse(records=previews, files_processed=len(files))


@router.post("/import")
def import_bulk_pdf_records(
    import_in: BulkPdfImportRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(["admin"])),
):
    form = db.query(Form).filter(Form.id == import_in.form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found.")
    fields = list(form.fields)
    fields_by_id = {field.id: field for field in fields}
    user_ids = [record.user_id for record in import_in.records]
    if len(set(user_ids)) != len(user_ids):
        raise HTTPException(status_code=422, detail="A user can appear only once in a bulk import.")
    users = {user.id: user for user in db.query(User).filter(User.id.in_(user_ids), User.role == "user").all()}
    if set(users) != set(user_ids):
        raise HTTPException(status_code=422, detail="Every selected record must match a registered user account.")

    created = []
    rejected = []
    for record in import_in.records:
        seen: set[int] = set()
        accepted: list[tuple[FormField, str]] = []
        problems = []
        for answer in record.answers:
            field = fields_by_id.get(answer.field_id)
            if answer.field_id in seen:
                problems.append(f"Field {answer.field_id} was included more than once.")
                continue
            seen.add(answer.field_id)
            if not field:
                problems.append(f"Field {answer.field_id} does not belong to the selected form.")
                continue
            if not answer.answer.strip():
                if field.required:
                    problems.append(f"{field.field_name}: This answer is required.")
                continue
            valid, value, error = process_field_answer(field.field_type, field.question, field.options, answer.answer, field.required)
            if not valid:
                problems.append(f"{field.field_name}: {error or 'invalid value'}")
                continue
            accepted.append((field, value))
        if not accepted:
            problems.append("This record has no extracted answers.")
        if problems:
            rejected.append({"user_id": record.user_id, "user_email": users[record.user_id].email, "errors": problems})
            continue
        answers_by_id = {field.id: value for field, value in accepted}
        missing_required = [field for field in fields if field.required and field.id not in answers_by_id]
        missing_fields = [field for field in fields if field.id not in answers_by_id]
        next_field = next((field for field in fields if field.id not in answers_by_id), None)
        session = FormSession(
            user_id=record.user_id,
            form_id=form.id,
            current_field=next_field.field_order if next_field else (fields[-1].field_order if fields else 1),
            status="completed" if not missing_fields else "in_progress",
        )
        db.add(session)
        db.flush()
        db.add_all(FormAnswer(session_id=session.id, field_id=field.id, answer=value) for field, value in accepted)
        created.append({"user_id": record.user_id, "user_email": users[record.user_id].email, "session_id": session.id, "status": session.status, "imported_count": len(accepted), "missing_required": [field.field_name for field in missing_required], "missing_fields": [field.field_name for field in missing_fields]})
    if created:
        db.commit()
    return {"created": created, "rejected": rejected, "created_count": len(created)}
