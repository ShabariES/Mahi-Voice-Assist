import datetime
import secrets
from typing import Optional
import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from app.config import settings
from app.database import get_db
from app.models import User
from app.schemas import GoogleCredential, UserRegister, UserLogin, UserResponse, TokenResponse, LanguagePreferenceUpdate, UserRoleUpdate

router = APIRouter(prefix="/api/auth", tags=["Authentication"])
security = HTTPBearer(auto_error=False)

# ----------------- Password Utilities -----------------
def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False

# ----------------- JWT Utilities -----------------
def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.datetime.utcnow() + datetime.timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt

# ----------------- Current User Dependency -----------------
def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token required"
        )
    token = credentials.credentials
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    user = db.query(User).filter(User.id == int(user_id)).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user

def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> Optional[User]:
    if not credentials:
        return None
    try:
        payload = jwt.decode(credentials.credentials, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        user_id = payload.get("sub")
        if user_id:
            return db.query(User).filter(User.id == int(user_id)).first()
    except Exception:
        return None
    return None

def require_role(allowed_roles: list[str]):
    def role_checker(current_user: User = Depends(get_current_user)):
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access forbidden: requires one of {allowed_roles}"
            )
        return current_user
    return role_checker

# ----------------- Auth Routes -----------------
@router.post("/register", response_model=TokenResponse)
def register(user_in: UserRegister, db: Session = Depends(get_db)):
    # Check if email is already taken
    existing_user = db.query(User).filter(User.email == user_in.email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    # Public registration must never grant privileged roles. Administrators
    # should be provisioned through a trusted administrative workflow.
    role = "user"

    new_user = User(
        name=user_in.name,
        email=user_in.email,
        password_hash=hash_password(user_in.password),
        role=role
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    token = create_access_token({"sub": str(new_user.id), "role": new_user.role})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": new_user
    }

@router.post("/login", response_model=TokenResponse)
def login(user_in: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == user_in.email).first()
    if not user or not verify_password(user_in.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect email or password")

    token = create_access_token({"sub": str(user.id), "role": user.role})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": user
    }

@router.post("/google", response_model=TokenResponse)
def login_with_google(body: GoogleCredential, db: Session = Depends(get_db)):
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured.")
    try:
        claims = google_id_token.verify_oauth2_token(
            body.credential,
            google_requests.Request(),
            settings.GOOGLE_CLIENT_ID,
        )
    except Exception as exc:
        # Do not expose token-validation details to callers.
        raise HTTPException(status_code=401, detail="Google sign-in could not be verified.") from exc

    google_sub = claims.get("sub")
    email = (claims.get("email") or "").strip().lower()
    name = (claims.get("name") or "Google user").strip()[:100]
    if not google_sub or not email or len(email) > 100 or claims.get("email_verified") is not True:
        raise HTTPException(status_code=401, detail="Google did not provide a verified account.")

    user = db.query(User).filter(User.google_sub == google_sub).first()
    if user is None:
        user = db.query(User).filter(User.email == email).first()
        if user is not None:
            if user.google_sub and user.google_sub != google_sub:
                raise HTTPException(status_code=409, detail="This email is already linked to another Google account.")
            if not user.google_sub and not (email.endswith("@gmail.com") or claims.get("hd")):
                raise HTTPException(status_code=409, detail="This email already has an account. Sign in with its password first.")
            user.google_sub = google_sub
        else:
            user = User(
                name=name,
                email=email,
                google_sub=google_sub,
                # Google-only users have no usable password login.
                password_hash=hash_password(secrets.token_urlsafe(48)),
                role="user",
            )
            db.add(user)
        try:
            db.commit()
            db.refresh(user)
        except IntegrityError as exc:
            db.rollback()
            raise HTTPException(status_code=409, detail="This Google account could not be linked. Please try again.") from exc

    token = create_access_token({"sub": str(user.id), "role": user.role})
    return {"access_token": token, "token_type": "bearer", "user": user}

@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user

@router.patch("/me/language", response_model=UserResponse)
def update_preferred_language(
    body: LanguagePreferenceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.languages import SUPPORTED_LANGUAGES
    if body.preferred_language not in SUPPORTED_LANGUAGES:
        raise HTTPException(status_code=422, detail="Choose English or Tamil.")
    current_user.preferred_language = body.preferred_language
    db.commit()
    db.refresh(current_user)
    return current_user

@router.get("/users", response_model=list[UserResponse])
def get_all_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin"]))
):
    return db.query(User).all()

@router.patch("/users/{user_id}/role", response_model=UserResponse)
def update_user_role(
    user_id: int,
    body: UserRoleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin"])),
):
    if body.role not in {"user", "form_manager", "admin"}:
        raise HTTPException(status_code=422, detail="Choose user, form manager, or admin.")
    target = db.query(User).filter(User.id == user_id).first()
    if target is None:
        raise HTTPException(status_code=404, detail="User not found.")
    if target.id == current_user.id and body.role != "admin":
        raise HTTPException(status_code=409, detail="You cannot remove your own administrator access.")
    if target.role == "admin" and body.role != "admin":
        admin_count = db.query(User).filter(User.role == "admin").count()
        if admin_count <= 1:
            raise HTTPException(status_code=409, detail="The last administrator cannot be demoted.")
    target.role = body.role
    db.commit()
    db.refresh(target)
    return target
