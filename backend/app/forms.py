from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
import re

from app.database import get_db
from app.models import Form, FormField, FormSession, FormAnswer, User
from app.schemas import FormResponse, FormSummary, FormCreate, FormUpdate, SessionAnswersResponse, SessionAnswerDetail
from app.auth import get_current_user, require_role
from app.languages import SUPPORTED_LANGUAGES

router = APIRouter(prefix="/api/forms", tags=["Forms"])

def ensure_supported_language(language_code: str) -> None:
    if language_code not in SUPPORTED_LANGUAGES:
        raise HTTPException(status_code=422, detail="Choose English or Tamil for the form.")

def validate_form_content(form_in: FormCreate | FormUpdate) -> None:
    if not form_in.name.strip():
        raise HTTPException(status_code=422, detail="Form name is required.")
    if not form_in.fields or len(form_in.fields) > 100:
        raise HTTPException(status_code=422, detail="A form must contain between 1 and 100 fields.")
    allowed_types = {"text", "email", "phone", "number", "date", "yes_no", "choice", "textarea"}
    names: set[str] = set()
    for field in form_in.fields:
        name = field.field_name.strip()
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,99}", name):
            raise HTTPException(status_code=422, detail="Field names must start with a letter and contain only letters, numbers, or underscores.")
        normalized = name.lower()
        if normalized in names:
            raise HTTPException(status_code=422, detail="Field names must be unique within a form.")
        names.add(normalized)
        if not field.question.strip():
            raise HTTPException(status_code=422, detail="Every field needs a question.")
        if field.field_type not in allowed_types:
            raise HTTPException(status_code=422, detail=f"Unsupported field type: {field.field_type}.")
        if field.field_type == "choice" and not any(option.strip() for option in re.split(r"[,\n]", field.options or "")):
            raise HTTPException(status_code=422, detail="Choice fields need at least one option.")

@router.get("", response_model=List[FormSummary])
def get_forms(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Retrieve list of all available forms."""
    forms = db.query(Form).all()
    summaries = []
    for f in forms:
        summaries.append(FormSummary(
            id=f.id,
            name=f.name,
            description=f.description,
            language_code=f.language_code,
            created_at=f.created_at,
            total_fields=len(f.fields)
        ))
    return summaries

@router.get("/{form_id}", response_model=FormResponse)
def get_form_by_id(form_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Retrieve a single form by ID along with its fields."""
    form = db.query(Form).filter(Form.id == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    return form

@router.post("", response_model=FormResponse)
def create_form(
    form_in: FormCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "form_manager"]))
):
    """Create a new form with fields (Admin & Form Manager only)."""
    ensure_supported_language(form_in.language_code)
    ensure_supported_language(form_in.source_language_code)
    validate_form_content(form_in)
    new_form = Form(name=form_in.name, description=form_in.description, language_code=form_in.language_code,
                    source_name=form_in.source_name or form_in.name,
                    source_description=form_in.source_description if form_in.source_description is not None else form_in.description,
                    source_language_code=form_in.source_language_code)
    db.add(new_form)
    db.commit()
    db.refresh(new_form)

    # Add fields
    for idx, field_data in enumerate(form_in.fields):
        new_field = FormField(
            form_id=new_form.id,
            field_name=field_data.field_name,
            question=field_data.question,
            field_type=field_data.field_type,
            required=field_data.required,
            field_order=field_data.field_order or (idx + 1),
            options=field_data.options,
            source_question=field_data.source_question or field_data.question,
            source_options=field_data.source_options if field_data.source_options is not None else field_data.options
        )
        db.add(new_field)
    
    db.commit()
    db.refresh(new_form)
    return new_form

@router.put("/{form_id}", response_model=FormResponse)
def update_form(
    form_id: int,
    form_in: FormUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "form_manager"]))
):
    """Update an existing form and replace its fields (Admin & Form Manager only)."""
    form = db.query(Form).filter(Form.id == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    ensure_supported_language(form_in.language_code)
    ensure_supported_language(form_in.source_language_code)
    validate_form_content(form_in)
    form.name = form_in.name
    form.description = form_in.description
    form.language_code = form_in.language_code
    form.source_name = form_in.source_name or form_in.name
    form.source_description = form_in.source_description if form_in.source_description is not None else form_in.description
    form.source_language_code = form_in.source_language_code

    # Keep field IDs stable so historic answers remain attached to the same field.
    existing = {field.field_name: field for field in form.fields}
    incoming_names = {field.field_name for field in form_in.fields}
    removed_with_answers = [field.field_name for field in form.fields
                            if field.field_name not in incoming_names and field.answers]
    if removed_with_answers:
        raise HTTPException(status_code=409, detail="Cannot remove fields that already have submitted answers. Keep those fields to preserve submission history.")
    for old_field in form.fields:
        if old_field.field_name not in incoming_names:
            db.delete(old_field)
    for idx, field_data in enumerate(form_in.fields):
        target = existing.get(field_data.field_name)
        if target is None:
            target = FormField(form_id=form.id, field_name=field_data.field_name)
            db.add(target)
        target.question = field_data.question
        target.field_type = field_data.field_type
        target.required = field_data.required
        target.field_order = field_data.field_order or (idx + 1)
        target.options = field_data.options
        target.source_question = field_data.source_question or field_data.question
        target.source_options = field_data.source_options if field_data.source_options is not None else field_data.options

    db.commit()
    db.refresh(form)
    return form

@router.delete("/{form_id}")
def delete_form(
    form_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "form_manager"]))
):
    """Delete a form (Admin & Form Manager only)."""
    form = db.query(Form).filter(Form.id == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    db.delete(form)
    db.commit()
    return {"message": "Form deleted successfully"}

@router.get("/{form_id}/submissions", response_model=List[SessionAnswersResponse])
def get_form_submissions(
    form_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "form_manager"]))
):
    """View all submitted answers for a form."""
    sessions = db.query(FormSession).filter(FormSession.form_id == form_id).all()
    results = []
    for s in sessions:
        answer_details = []
        for ans in s.answers:
            f = ans.field
            answer_details.append(SessionAnswerDetail(
                id=ans.id,
                field_id=f.id,
                field_name=f.field_name,
                question=f.question,
                field_type=f.field_type,
                answer=ans.answer,
                created_at=ans.created_at
            ))
        results.append(SessionAnswersResponse(
            session_id=s.id,
            form_id=s.form_id,
            form_name=s.form.name,
            user_name=s.user.name,
            user_email=s.user.email,
            status=s.status,
            created_at=s.created_at,
            answers=answer_details
        ))
    return results
