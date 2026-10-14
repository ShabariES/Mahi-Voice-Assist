import os
from dotenv import load_dotenv

# Load variables from .env file
load_dotenv()

class Settings:
    APP_ENV: str = os.getenv("APP_ENV", "development").strip().lower()
    SEED_DEMO_DATA: bool = os.getenv("SEED_DEMO_DATA", "false").strip().lower() in {"1", "true", "yes"}
    BOOTSTRAP_ADMIN_EMAIL: str = os.getenv("BOOTSTRAP_ADMIN_EMAIL", "").strip().lower()
    BOOTSTRAP_ADMIN_PASSWORD: str = os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "")
    BOOTSTRAP_ADMIN_NAME: str = os.getenv("BOOTSTRAP_ADMIN_NAME", "System Admin").strip()
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./voice_form.db")
    JWT_SECRET: str = os.getenv("JWT_SECRET", "")
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24  # 24 hours
    
    ELEVENLABS_API_KEY: str = os.getenv("ELEVENLABS_API_KEY", "")
    ELEVENLABS_VOICE_ID: str = os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")  # Rachel voice
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    SARVAM_API_KEY: str = os.getenv("SARVAM_API_KEY", "")
    GROQ_NAV_MODEL: str = os.getenv("GROQ_NAV_MODEL", "openai/gpt-oss-20b")
    SMTP_HOST: str = os.getenv("SMTP_HOST", "")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USERNAME: str = os.getenv("SMTP_USERNAME", "")
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "")
    SMTP_FROM_EMAIL: str = os.getenv("SMTP_FROM_EMAIL", "")
    SMTP_SECURITY: str = os.getenv("SMTP_SECURITY", "starttls").lower()
    CORS_ALLOWED_ORIGINS: list[str] = [
        origin.strip()
        for origin in os.getenv(
            "CORS_ALLOWED_ORIGINS",
            "http://localhost:5174,http://127.0.0.1:5174,http://localhost:5173,http://127.0.0.1:5173",
        ).split(",")
        if origin.strip()
    ]
    PDF_OCR_LANG: str = os.getenv("PDF_OCR_LANG", "ta")

settings = Settings()

if not settings.JWT_SECRET:
    if settings.APP_ENV == "development":
        settings.JWT_SECRET = "local-development-only-change-this-secret"
    else:
        raise RuntimeError("JWT_SECRET must be configured outside development.")
if settings.APP_ENV != "development" and settings.JWT_SECRET == "local-development-only-change-this-secret":
    raise RuntimeError("The development JWT secret cannot be used outside development.")
