from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text

from app.config import settings
from app.database import engine, Base, SessionLocal
from app.models import User, Form, FormField
from app.auth import hash_password, router as auth_router
from app.forms import router as forms_router
from app.sessions import router as sessions_router
from app.voice import router as voice_router
from app.issues import router as issues_router
from app.bulk_pdf import router as bulk_pdf_router
from app.assistant import router as assistant_router
from app.localization import router as localization_router
from app.admin import router as admin_router

def ensure_language_columns():
    inspector = inspect(engine)
    with engine.begin() as connection:
        for table, column in (("users", "preferred_language"), ("forms", "language_code")):
            if table in inspector.get_table_names() and column not in {item["name"] for item in inspector.get_columns(table)}:
                connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} VARCHAR(20) NOT NULL DEFAULT 'en-IN'"))
        additions = {
            "forms": (("source_name", "VARCHAR(150)"), ("source_description", "TEXT"), ("source_language_code", "VARCHAR(20) NOT NULL DEFAULT 'en-IN'")),
            "form_fields": (("source_question", "VARCHAR(255)"), ("source_options", "TEXT")),
        }
        for table, columns in additions.items():
            if table not in inspector.get_table_names():
                continue
            existing = {item["name"] for item in inspector.get_columns(table)}
            for column, sql_type in columns:
                if column not in existing:
                    connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {sql_type}"))
                    if table == "forms" and column == "source_language_code":
                        # Legacy forms already contain localized text, so its current language is the source.
                        connection.execute(text("UPDATE forms SET source_language_code = language_code"))

def seed_initial_data():
    """Optionally seed local demos or provision a first admin from explicit environment values."""
    db = SessionLocal()
    try:
        seed_demos = settings.APP_ENV == "development" and settings.SEED_DEMO_DATA
        if not seed_demos:
            if (settings.BOOTSTRAP_ADMIN_EMAIL and settings.BOOTSTRAP_ADMIN_PASSWORD
                    and not db.query(User).filter(User.role == "admin").first()):
                db.add(User(
                    name=settings.BOOTSTRAP_ADMIN_NAME or "System Admin",
                    email=settings.BOOTSTRAP_ADMIN_EMAIL,
                    password_hash=hash_password(settings.BOOTSTRAP_ADMIN_PASSWORD),
                    role="admin",
                ))
                db.commit()
            return
        # 1. Seed Users if not present
        # Seed a default admin only when the database has no administrator.
        # This prevents recreating the default login after its email is changed.
        if not db.query(User).filter(User.role == "admin").first():
            admin = User(
                name="System Admin",
                email="admin@voiceform.com",
                password_hash=hash_password("admin123"),
                role="admin"
            )
            db.add(admin)

        if not db.query(User).filter(User.email == "manager@voiceform.com").first():
            manager = User(
                name="Form Manager",
                email="manager@voiceform.com",
                password_hash=hash_password("manager123"),
                role="form_manager"
            )
            db.add(manager)

        if not db.query(User).filter(User.email == "user@voiceform.com").first():
            user = User(
                name="Jane Doe",
                email="user@voiceform.com",
                password_hash=hash_password("user123"),
                role="user"
            )
            db.add(user)

        db.commit()

        # 2. Seed Sample "Employee Registration" Form if not present
        if not db.query(Form).filter(Form.name == "Employee Registration").first():
            emp_form = Form(
                name="Employee Registration",
                description="Official voice-driven intake form for new employees and contractor candidates."
            )
            db.add(emp_form)
            db.commit()
            db.refresh(emp_form)

            fields = [
                FormField(
                    form_id=emp_form.id,
                    field_name="first_name",
                    question="What is your first name?",
                    field_type="text",
                    required=True,
                    field_order=1
                ),
                FormField(
                    form_id=emp_form.id,
                    field_name="last_name",
                    question="What is your last name?",
                    field_type="text",
                    required=True,
                    field_order=2
                ),
                FormField(
                    form_id=emp_form.id,
                    field_name="email",
                    question="What is your email address?",
                    field_type="email",
                    required=True,
                    field_order=3
                ),
                FormField(
                    form_id=emp_form.id,
                    field_name="phone",
                    question="What is your phone number?",
                    field_type="phone",
                    required=True,
                    field_order=4
                ),
                FormField(
                    form_id=emp_form.id,
                    field_name="employment_status",
                    question="What is your employment status?",
                    field_type="choice",
                    options="employed, unemployed, student, retired",
                    required=True,
                    field_order=5
                ),
                FormField(
                    form_id=emp_form.id,
                    field_name="years_experience",
                    question="How many years of experience do you have?",
                    field_type="number",
                    required=True,
                    field_order=6
                ),
                FormField(
                    form_id=emp_form.id,
                    field_name="currently_employed",
                    question="Are you currently employed?",
                    field_type="yes_no",
                    required=True,
                    field_order=7
                ),
            ]
            db.add_all(fields)
            db.commit()

        # 3. Seed Sample "Patient Check-in" Form as a second example
        if not db.query(Form).filter(Form.name == "Quick Feedback Survey").first():
            fb_form = Form(
                name="Quick Feedback Survey",
                description="Simple 3-question survey for gathering user reviews."
            )
            db.add(fb_form)
            db.commit()
            db.refresh(fb_form)

            fb_fields = [
                FormField(
                    form_id=fb_form.id,
                    field_name="full_name",
                    question="What is your full name?",
                    field_type="text",
                    required=True,
                    field_order=1
                ),
                FormField(
                    form_id=fb_form.id,
                    field_name="rating",
                    question="How would you rate our service on a scale of 1 to 5?",
                    field_type="number",
                    required=True,
                    field_order=2
                ),
                FormField(
                    form_id=fb_form.id,
                    field_name="recommend",
                    question="Would you recommend us to a friend?",
                    field_type="yes_no",
                    required=True,
                    field_order=3
                )
            ]
            db.add_all(fb_fields)
            db.commit()

    finally:
        db.close()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize database tables
    Base.metadata.create_all(bind=engine)
    ensure_language_columns()
    # Seed initial test users and forms
    seed_initial_data()
    yield

app = FastAPI(
    title="Voice-Driven Form Filling API",
    description="FastAPI Backend for voice-driven form completion with ElevenLabs STT & TTS",
    version="1.0.0",
    lifespan=lifespan
)

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(auth_router)
app.include_router(forms_router)
app.include_router(sessions_router)
app.include_router(voice_router)
app.include_router(issues_router)
app.include_router(bulk_pdf_router)
app.include_router(assistant_router)
app.include_router(localization_router)
app.include_router(admin_router)

@app.get("/")
def root():
    return {
        "status": "online",
        "message": "Voice-Driven Form Filling Backend is running!",
        "docs": "/docs"
    }
