import datetime
import json

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.orm import Session, joinedload, selectinload

from app.auth import require_role
from app.database import get_db
from app.models import Form, FormAnswer, FormSession, IssueReport, User

router = APIRouter(prefix="/api/admin", tags=["Administration"])


def isoformat(value):
    return value.isoformat() if value else None


@router.get("/export")
def export_all_admin_data(
    db: Session = Depends(get_db),
    _: User = Depends(require_role(["admin"])),
):
    users = db.query(User).order_by(User.id).all()
    forms = db.query(Form).options(selectinload(Form.fields)).order_by(Form.id).all()
    sessions = (
        db.query(FormSession)
        .options(
            joinedload(FormSession.user),
            joinedload(FormSession.form),
            selectinload(FormSession.answers).joinedload(FormAnswer.field),
        )
        .order_by(FormSession.id)
        .all()
    )
    reports = (
        db.query(IssueReport)
        .options(joinedload(IssueReport.reporter), joinedload(IssueReport.responder))
        .order_by(IssueReport.id)
        .all()
    )

    export_data = {
        "exported_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "users": [
            {
                "id": user.id,
                "name": user.name,
                "email": user.email,
                "role": user.role,
                "preferred_language": user.preferred_language,
                "created_at": isoformat(user.created_at),
            }
            for user in users
        ],
        "forms": [
            {
                "id": form.id,
                "name": form.name,
                "description": form.description,
                "language_code": form.language_code,
                "source_name": form.source_name,
                "source_description": form.source_description,
                "source_language_code": form.source_language_code,
                "created_at": isoformat(form.created_at),
                "fields": [
                    {
                        "id": field.id,
                        "field_name": field.field_name,
                        "question": field.question,
                        "field_type": field.field_type,
                        "required": field.required,
                        "field_order": field.field_order,
                        "options": field.options,
                        "source_question": field.source_question,
                        "source_options": field.source_options,
                    }
                    for field in form.fields
                ],
            }
            for form in forms
        ],
        "sessions": [
            {
                "id": session.id,
                "user_id": session.user_id,
                "user_name": session.user.name if session.user else None,
                "user_email": session.user.email if session.user else None,
                "form_id": session.form_id,
                "form_name": session.form.name if session.form else None,
                "current_field": session.current_field,
                "status": session.status,
                "created_at": isoformat(session.created_at),
                "answers": [
                    {
                        "id": answer.id,
                        "field_id": answer.field_id,
                        "field_name": answer.field.field_name if answer.field else None,
                        "question": answer.field.question if answer.field else None,
                        "answer": answer.answer,
                        "created_at": isoformat(answer.created_at),
                    }
                    for answer in session.answers
                ],
            }
            for session in sessions
        ],
        "issue_reports": [
            {
                "id": report.id,
                "user_id": report.user_id,
                "reporter_name": report.reporter.name if report.reporter else None,
                "reporter_email": report.reporter.email if report.reporter else None,
                "subject": report.subject,
                "description": report.description,
                "status": report.status,
                "admin_reply": report.admin_reply,
                "responded_by_id": report.responded_by_id,
                "responder_name": report.responder.name if report.responder else None,
                "responder_email": report.responder.email if report.responder else None,
                "created_at": isoformat(report.created_at),
                "updated_at": isoformat(report.updated_at),
            }
            for report in reports
        ],
    }
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return Response(
        content=json.dumps(export_data, ensure_ascii=False, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="mahi-admin-export-{timestamp}.json"'},
    )
