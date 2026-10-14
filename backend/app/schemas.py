import datetime
from typing import List, Optional
from pydantic import BaseModel, EmailStr, Field

# ----------------- User Schemas -----------------
class UserRegister(BaseModel):
    name: str
    email: EmailStr
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: int
    name: str
    email: str
    role: str
    preferred_language: str = "en-IN"
    created_at: datetime.datetime

    class Config:
        from_attributes = True

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse

# ----------------- Form Field Schemas -----------------
class FormFieldBase(BaseModel):
    field_name: str
    question: str
    field_type: str  # text, email, phone, number, date, yes_no, choice, textarea
    required: bool = True
    field_order: int = 1
    options: Optional[str] = None
    source_question: Optional[str] = None
    source_options: Optional[str] = None

class FormFieldCreate(FormFieldBase):
    pass

class FormFieldResponse(FormFieldBase):
    id: int
    form_id: int

    class Config:
        from_attributes = True

# ----------------- Form Schemas -----------------
class FormBase(BaseModel):
    name: str
    description: Optional[str] = None
    language_code: str = "en-IN"
    source_name: Optional[str] = None
    source_description: Optional[str] = None
    source_language_code: str = "en-IN"

class FormCreate(FormBase):
    fields: Optional[List[FormFieldCreate]] = []

class FormUpdate(FormBase):
    fields: Optional[List[FormFieldCreate]] = []

class FormResponse(FormBase):
    id: int
    created_at: datetime.datetime
    fields: List[FormFieldResponse] = []

    class Config:
        from_attributes = True

class FormSummary(FormBase):
    id: int
    created_at: datetime.datetime
    total_fields: int = 0


# ----------------- Session & Answer Schemas -----------------
class SessionCreate(BaseModel):
    form_id: int

class SessionResponse(BaseModel):
    id: int
    user_id: int
    form_id: int
    current_field: int
    status: str
    created_at: datetime.datetime
    form_name: Optional[str] = None
    total_fields: Optional[int] = 0
    current_question: Optional[str] = None
    current_field_type: Optional[str] = None
    current_field_options: Optional[str] = None
    current_field_required: Optional[bool] = True
    form_language_code: str = "en-IN"
    preferred_language: str = "en-IN"

    class Config:
        from_attributes = True

class AnswerSubmit(BaseModel):
    answer: str

class LanguagePreferenceUpdate(BaseModel):
    preferred_language: str = Field(default="en-IN", min_length=2, max_length=20)

class UserRoleUpdate(BaseModel):
    role: str = Field(min_length=4, max_length=20)

class ImportedAnswer(BaseModel):
    field_id: int
    answer: str

class SessionImportRequest(BaseModel):
    answers: List[ImportedAnswer]

class ImportedAnswerRejection(BaseModel):
    field_id: int
    error: str

class SessionImportResponse(BaseModel):
    imported_count: int
    rejected: List[ImportedAnswerRejection] = []
    status: str
    current_field: int
    current_question: Optional[str] = None
    current_field_type: Optional[str] = None
    current_field_options: Optional[str] = None
    current_field_required: Optional[bool] = True

class BulkPdfAnswer(BaseModel):
    field_id: int
    answer: str

class BulkPdfRecordImport(BaseModel):
    user_id: int
    answers: List[BulkPdfAnswer]

class BulkPdfImportRequest(BaseModel):
    form_id: int
    records: List[BulkPdfRecordImport] = Field(min_length=1, max_length=100)

class AnswerResponse(BaseModel):
    success: bool
    answer: str
    completed: bool
    next_question: Optional[str] = None
    current_field: Optional[int] = None
    field_type: Optional[str] = None
    field_options: Optional[str] = None
    error: Optional[str] = None
    email_status: Optional[str] = None

class SessionAnswerDetail(BaseModel):
    id: int
    field_id: int
    field_name: str
    question: str
    field_type: str
    answer: str
    created_at: datetime.datetime

    class Config:
        from_attributes = True

class SessionAnswersResponse(BaseModel):
    session_id: int
    form_id: int
    form_name: str
    user_name: str
    user_email: str
    status: str
    created_at: datetime.datetime
    answers: List[SessionAnswerDetail] = []

# ----------------- Voice Schemas -----------------
class TTSRequest(BaseModel):
    text: str
    voice_id: Optional[str] = None

class ScribeTokenResponse(BaseModel):
    token: Optional[str] = None
    url: Optional[str] = None
    provider: str = "elevenlabs"  # or 'browser_fallback'
    message: Optional[str] = None


class IssueReportCreate(BaseModel):
    subject: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=8, max_length=5000)


class IssueReportResponse(BaseModel):
    id: int
    user_id: int
    user_name: str
    user_email: str
    subject: str
    description: str
    status: str
    admin_reply: Optional[str] = None
    created_at: datetime.datetime
    updated_at: Optional[datetime.datetime] = None


class IssueReportReply(BaseModel):
    subject: str = Field(min_length=3, max_length=200)
    message: str = Field(min_length=2, max_length=5000)


class IssueReportStatusUpdate(BaseModel):
    status: str
