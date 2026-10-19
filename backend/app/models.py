import datetime
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), default="user", nullable=False)  # 'admin', 'form_manager', 'user'
    preferred_language = Column(String(20), nullable=False, default="en-IN")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # Relationships
    sessions = relationship("FormSession", back_populates="user", cascade="all, delete-orphan")


class Form(Base):
    __tablename__ = "forms"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), nullable=False)
    description = Column(Text, nullable=True)
    language_code = Column(String(20), nullable=False, default="en-IN")
    source_name = Column(String(150), nullable=True)
    source_description = Column(Text, nullable=True)
    source_language_code = Column(String(20), nullable=False, default="en-IN")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # Relationships
    fields = relationship("FormField", back_populates="form", order_by="FormField.field_order", cascade="all, delete-orphan")
    sessions = relationship("FormSession", back_populates="form", cascade="all, delete-orphan")


class FormField(Base):
    __tablename__ = "form_fields"

    id = Column(Integer, primary_key=True, index=True)
    form_id = Column(Integer, ForeignKey("forms.id"), nullable=False)
    field_name = Column(String(100), nullable=False)
    question = Column(String(255), nullable=False)
    field_type = Column(String(50), nullable=False)  # text, email, phone, number, date, yes_no, choice, textarea
    required = Column(Boolean, default=True)
    field_order = Column(Integer, nullable=False, default=1)
    options = Column(Text, nullable=True)  # Comma-separated or JSON string for choice options
    source_question = Column(String(255), nullable=True)
    source_options = Column(Text, nullable=True)

    # Relationships
    form = relationship("Form", back_populates="fields")
    answers = relationship("FormAnswer", back_populates="field", cascade="all, delete-orphan")


class FormSession(Base):
    __tablename__ = "form_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    form_id = Column(Integer, ForeignKey("forms.id"), nullable=False)
    current_field = Column(Integer, default=1)  # current field_order (1-indexed)
    status = Column(String(20), default="in_progress")  # 'in_progress', 'completed'
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="sessions")
    form = relationship("Form", back_populates="sessions")
    answers = relationship("FormAnswer", back_populates="session", cascade="all, delete-orphan")


class FormAnswer(Base):
    __tablename__ = "form_answers"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("form_sessions.id"), nullable=False)
    field_id = Column(Integer, ForeignKey("form_fields.id"), nullable=False)
    answer = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # Relationships
    session = relationship("FormSession", back_populates="answers")
    field = relationship("FormField", back_populates="answers")


class IssueReport(Base):
    __tablename__ = "issue_reports"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    subject = Column(String(200), nullable=False)
    description = Column(Text, nullable=False)
    status = Column(String(30), nullable=False, default="open", index=True)
    admin_reply = Column(Text, nullable=True)
    responded_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, nullable=True)

    reporter = relationship("User", foreign_keys=[user_id])
    responder = relationship("User", foreign_keys=[responded_by_id])
