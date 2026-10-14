from io import BytesIO

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from pypdf import PdfReader
from sqlalchemy.orm import Session
from typing import List
from starlette.concurrency import run_in_threadpool

from app.database import get_db
from app.models import Form, FormField, FormSession, FormAnswer, User
from app.schemas import (
    SessionCreate, SessionResponse, AnswerSubmit, AnswerResponse,
    SessionAnswersResponse, SessionAnswerDetail, SessionImportRequest,
    SessionImportResponse, ImportedAnswerRejection
)
from app.auth import get_current_user
from app.ai import process_field_answer
from app.email_service import send_form_welcome_email, welcome_email_configured
from app.pdf_ocr import extract_pdf_structure

router = APIRouter(prefix="/api/sessions", tags=["Form Sessions"])


@router.post("/pdf/structure")
async def structure_pdf_for_import(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """OCR a scanned PDF and preserve tables as Markdown for field suggestions."""
    filename = (file.filename or "").lower()
    if not filename.endswith(".pdf") and file.content_type != "application/pdf":
        raise HTTPException(status_code=415, detail="Choose a PDF file to continue.")

    content = await file.read(12 * 1024 * 1024 + 1)
    if len(content) > 12 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="PDF files must be 12 MB or smaller.")
    if not content.startswith(b"%PDF-"):
        raise HTTPException(status_code=415, detail="The selected file is not a valid PDF.")
    try:
        reader = PdfReader(BytesIO(content), strict=False)
        if reader.is_encrypted:
            raise HTTPException(status_code=422, detail="Password-protected PDFs are not supported.")
        if len(reader.pages) > 40:
            raise HTTPException(status_code=413, detail="PDF files must have 40 pages or fewer.")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail="The PDF file could not be opened.") from exc

    try:
        result = await run_in_threadpool(extract_pdf_structure, content)
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail="PDF OCR is not installed. Install PaddlePaddle and paddleocr[doc-parser] on the backend.",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="The PDF could not be processed by PP-StructureV3. Try a clearer or shorter PDF.",
        ) from exc

    if not result["text"]:
        raise HTTPException(status_code=422, detail="No readable text or tables were found in this PDF.")
    return result

def get_field_by_order(form_id: int, order: int, db: Session):
    """Retrieve the field corresponding to field_order (1-indexed)."""
    return db.query(FormField).filter(
        FormField.form_id == form_id,
        FormField.field_order == order
    ).first()

@router.post("", response_model=SessionResponse)
def start_form_session(
    session_in: SessionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a new form session for the user and return the first question."""
    form = db.query(Form).filter(Form.id == session_in.form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    if not form.fields:
        raise HTTPException(status_code=400, detail="Form has no fields to fill")

    # Create new session starting at field 1
    session = FormSession(
        user_id=current_user.id,
        form_id=form.id,
        current_field=1,
        status="in_progress"
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    # First field info
    first_field = get_field_by_order(form.id, 1, db)

    return SessionResponse(
        id=session.id,
        user_id=session.user_id,
        form_id=session.form_id,
        current_field=1,
        status=session.status,
        created_at=session.created_at,
        form_name=form.name,
        total_fields=len(form.fields),
        current_question=first_field.question if first_field else "",
        current_field_type=first_field.field_type if first_field else "text",
        current_field_options=first_field.options if first_field else None,
        current_field_required=first_field.required if first_field else True,
        form_language_code=form.language_code,
        preferred_language=current_user.preferred_language,
    )

@router.get("/my", response_model=List[SessionResponse])
def get_my_sessions(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Retrieve all form sessions belonging to the current user."""
    sessions = db.query(FormSession).filter(FormSession.user_id == current_user.id).order_by(FormSession.created_at.desc()).all()
    results = []
    for s in sessions:
        field = get_field_by_order(s.form_id, s.current_field, db)
        results.append(SessionResponse(
            id=s.id,
            user_id=s.user_id,
            form_id=s.form_id,
            current_field=s.current_field,
            status=s.status,
            created_at=s.created_at,
            form_name=s.form.name,
            total_fields=len(s.form.fields),
            current_question=field.question if field else None,
            current_field_type=field.field_type if field else None,
            current_field_options=field.options if field else None,
            current_field_required=field.required if field else True,
            form_language_code=s.form.language_code,
            preferred_language=current_user.preferred_language,
        ))
    return results

@router.get("/{session_id}", response_model=SessionResponse)
def get_session(session_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Get active session details and current question."""
    session = db.query(FormSession).filter(FormSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Ensure user owns session or is admin/manager
    if session.user_id != current_user.id and current_user.role not in ["admin", "form_manager"]:
        raise HTTPException(status_code=403, detail="Not authorized to access this session")

    field = get_field_by_order(session.form_id, session.current_field, db)

    return SessionResponse(
        id=session.id,
        user_id=session.user_id,
        form_id=session.form_id,
        current_field=session.current_field,
        status=session.status,
        created_at=session.created_at,
        form_name=session.form.name,
        total_fields=len(session.form.fields),
        current_question=field.question if field else None,
        current_field_type=field.field_type if field else None,
        current_field_options=field.options if field else None,
        current_field_required=field.required if field else True,
        form_language_code=session.form.language_code,
        preferred_language=current_user.preferred_language,
    )

@router.post("/{session_id}/import-answers", response_model=SessionImportResponse)
def import_session_answers(
    session_id: int,
    import_in: SessionImportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Validate and save user-reviewed PDF suggestions, then resume at the first unanswered field."""
    session = db.query(FormSession).filter(FormSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != current_user.id and current_user.role not in ["admin", "form_manager"]:
        raise HTTPException(status_code=403, detail="Not authorized to update this session")
    if session.status == "completed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This form session is already completed")

    fields = db.query(FormField).filter(FormField.form_id == session.form_id).all()
    fields_by_id = {field.id: field for field in fields}
    seen_ids = set()
    rejected = []
    imported_count = 0

    for candidate in import_in.answers:
        if candidate.field_id in seen_ids:
            rejected.append(ImportedAnswerRejection(field_id=candidate.field_id, error="This field was included more than once."))
            continue
        seen_ids.add(candidate.field_id)
        field = fields_by_id.get(candidate.field_id)
        if not field:
            rejected.append(ImportedAnswerRejection(field_id=candidate.field_id, error="This field does not belong to this form."))
            continue

        is_valid, processed_value, error_message = process_field_answer(
            field_type=field.field_type,
            question=field.question,
            options=field.options,
            raw_answer=candidate.answer,
            required=field.required
        )
        if not is_valid:
            rejected.append(ImportedAnswerRejection(field_id=field.id, error=error_message or "Please check this value."))
            continue

        saved_answer = db.query(FormAnswer).filter(
            FormAnswer.session_id == session.id,
            FormAnswer.field_id == field.id
        ).first()
        if saved_answer:
            saved_answer.answer = processed_value
        else:
            db.add(FormAnswer(session_id=session.id, field_id=field.id, answer=processed_value))
        imported_count += 1

    db.flush()
    saved_field_ids = {
        answer.field_id for answer in db.query(FormAnswer).filter(FormAnswer.session_id == session.id).all()
    }
    next_field = next((field for field in sorted(fields, key=lambda item: item.field_order) if field.id not in saved_field_ids), None)

    if next_field:
        session.current_field = next_field.field_order
        session.status = "in_progress"
    else:
        session.status = "completed"
    db.commit()

    return SessionImportResponse(
        imported_count=imported_count,
        rejected=rejected,
        status=session.status,
        current_field=session.current_field,
        current_question=next_field.question if next_field else None,
        current_field_type=next_field.field_type if next_field else None,
        current_field_options=next_field.options if next_field else None,
        current_field_required=next_field.required if next_field else None
    )

@router.post("/{session_id}/answer", response_model=AnswerResponse)
def answer_field(
    session_id: int,
    answer_in: AnswerSubmit,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Submits an answer for the current field.
    1. Validates and processes the answer using normal logic (or AI when needed).
    2. Stores answer in database.
    3. Advances current_field.
    4. Returns next question or completed status.
    """
    session = db.query(FormSession).filter(FormSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.status == "completed":
        return AnswerResponse(
            success=False,
            answer="",
            completed=True,
            error="This form session is already completed."
        )

    field = get_field_by_order(session.form_id, session.current_field, db)
    if not field:
        raise HTTPException(status_code=400, detail="Current field not found")

    # Process and validate the raw spoken or typed answer
    is_valid, processed_val, error_msg = process_field_answer(
        field_type=field.field_type,
        question=field.question,
        options=field.options,
        raw_answer=answer_in.answer,
        required=field.required
    )

    if not is_valid:
        return AnswerResponse(
            success=False,
            answer=answer_in.answer,
            completed=False,
            current_field=session.current_field,
            field_type=field.field_type,
            field_options=field.options,
            error=error_msg or "Invalid answer format."
        )

    # Save or update answer in FormAnswer table
    existing_answer = db.query(FormAnswer).filter(
        FormAnswer.session_id == session.id,
        FormAnswer.field_id == field.id
    ).first()

    if existing_answer:
        existing_answer.answer = processed_val
    else:
        new_ans = FormAnswer(
            session_id=session.id,
            field_id=field.id,
            answer=processed_val
        )
        db.add(new_ans)

    db.commit()

    # Determine next field
    next_order = session.current_field + 1
    next_field = get_field_by_order(session.form_id, next_order, db)

    if next_field:
        # Move to next field
        session.current_field = next_order
        db.commit()

        return AnswerResponse(
            success=True,
            answer=processed_val,
            completed=False,
            next_question=next_field.question,
            current_field=next_order,
            field_type=next_field.field_type,
            field_options=next_field.options
        )
    else:
        # All questions finished
        session.status = "completed"
        db.commit()

        email_field = db.query(FormField).filter(
            FormField.form_id == session.form_id,
            FormField.field_type.ilike("email"),
        ).order_by(FormField.field_order).first()
        form_email = None
        if email_field:
            form_email = db.query(FormAnswer.answer).filter(
                FormAnswer.session_id == session.id,
                FormAnswer.field_id == email_field.id,
            ).scalar()
        recipient = (form_email or "").strip() or current_user.email
        email_status = "not_configured"
        if welcome_email_configured():
            background_tasks.add_task(
                send_form_welcome_email,
                recipient,
                current_user.name,
                session.form.name,
            )
            email_status = "queued"

        return AnswerResponse(
            success=True,
            answer=processed_val,
            completed=True,
            next_question=None,
            current_field=session.current_field,
            email_status=email_status,
        )

@router.put("/{session_id}/answers/{field_id}", response_model=SessionAnswerDetail)
def update_completed_answer(
    session_id: int,
    field_id: int,
    answer_in: AnswerSubmit,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Allow a user to correct a saved answer from the completed-form review."""
    session = db.query(FormSession).filter(FormSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != current_user.id and current_user.role not in ["admin", "form_manager"]:
        raise HTTPException(status_code=403, detail="Not authorized to edit these answers")
    if session.status != "completed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Answers can be edited after the form is completed")

    field = db.query(FormField).filter(
        FormField.id == field_id,
        FormField.form_id == session.form_id
    ).first()
    saved_answer = db.query(FormAnswer).filter(
        FormAnswer.session_id == session.id,
        FormAnswer.field_id == field_id
    ).first()
    if not field or not saved_answer:
        raise HTTPException(status_code=404, detail="Answer not found")

    is_valid, processed_value, error_message = process_field_answer(
        field_type=field.field_type,
        question=field.question,
        options=field.options,
        raw_answer=answer_in.answer,
        required=field.required
    )
    if not is_valid:
        raise HTTPException(status_code=422, detail=error_message or "Invalid answer")

    saved_answer.answer = processed_value
    db.commit()
    db.refresh(saved_answer)
    return SessionAnswerDetail(
        id=saved_answer.id,
        field_id=field.id,
        field_name=field.field_name,
        question=field.question,
        field_type=field.field_type,
        answer=saved_answer.answer,
        created_at=saved_answer.created_at
    )


@router.get("/{session_id}/answers", response_model=SessionAnswersResponse)
def get_session_answers(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """View all answers recorded for a given session."""
    session = db.query(FormSession).filter(FormSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.user_id != current_user.id and current_user.role not in ["admin", "form_manager"]:
        raise HTTPException(status_code=403, detail="Not authorized to view these answers")

    answer_details = []
    for ans in session.answers:
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

    return SessionAnswersResponse(
        session_id=session.id,
        form_id=session.form_id,
        form_name=session.form.name,
        user_name=session.user.name,
        user_email=session.user.email,
        status=session.status,
        created_at=session.created_at,
        answers=answer_details
    )
