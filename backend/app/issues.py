import datetime
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user, require_role
from app.database import get_db
from app.email_service import send_email
from app.models import IssueReport, User
from app.schemas import IssueReportCreate, IssueReportReply, IssueReportResponse, IssueReportStatusUpdate

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/issues", tags=["Issue reports"])


def to_response(report: IssueReport) -> IssueReportResponse:
    return IssueReportResponse(
        id=report.id,
        user_id=report.user_id,
        user_name=report.reporter.name,
        user_email=report.reporter.email,
        subject=report.subject,
        description=report.description,
        status=report.status,
        admin_reply=report.admin_reply,
        created_at=report.created_at,
        updated_at=report.updated_at,
    )


@router.post("", response_model=IssueReportResponse, status_code=201)
def create_issue_report(
    body: IssueReportCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    subject = body.subject.strip()
    description = body.description.strip()
    if len(subject) < 3 or len(description) < 8:
        raise HTTPException(status_code=422, detail="Please include a short title and describe the issue.")

    report = IssueReport(
        user_id=current_user.id,
        subject=subject,
        description=description,
        status="open",
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return to_response(report)


@router.get("", response_model=list[IssueReportResponse])
def get_issue_reports(
    db: Session = Depends(get_db),
    _: User = Depends(require_role(["admin", "form_manager"])),
):
    reports = (
        db.query(IssueReport)
        .options(joinedload(IssueReport.reporter))
        .order_by(IssueReport.created_at.desc())
        .all()
    )
    return [to_response(report) for report in reports]


@router.patch("/{report_id}/status", response_model=IssueReportResponse)
def update_issue_status(
    report_id: int,
    body: IssueReportStatusUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(["admin", "form_manager"])),
):
    if body.status not in {"open", "in_progress", "resolved"}:
        raise HTTPException(status_code=422, detail="Status must be open, in progress, or resolved.")
    report = db.query(IssueReport).options(joinedload(IssueReport.reporter)).filter(IssueReport.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Issue report not found.")
    report.status = body.status
    report.updated_at = datetime.datetime.utcnow()
    db.commit()
    db.refresh(report)
    return to_response(report)


@router.post("/{report_id}/reply", response_model=IssueReportResponse)
def reply_to_issue_report(
    report_id: int,
    body: IssueReportReply,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin"])),
):
    report = db.query(IssueReport).options(joinedload(IssueReport.reporter)).filter(IssueReport.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Issue report not found.")

    subject = body.subject.strip()
    message = body.message.strip()
    if not subject or not message:
        raise HTTPException(status_code=422, detail="A subject and message are required.")

    email_body = (
        f"Hello {report.reporter.name},\n\n"
        f"We are following up on your issue report: {report.subject}\n\n"
        f"{message}\n\n"
        "Regards,\nMahi Support"
    )
    try:
        send_email(report.reporter.email, subject, email_body)
    except Exception as exc:
        logger.exception("Failed to send issue report reply for report %s", report.id)
        raise HTTPException(status_code=503, detail="The email could not be sent. Check SMTP configuration and try again.") from exc

    report.admin_reply = message
    report.responded_by_id = current_user.id
    report.status = "resolved"
    report.updated_at = datetime.datetime.utcnow()
    db.commit()
    db.refresh(report)
    return to_response(report)
