import httpx
from fastapi import APIRouter, HTTPException, Depends, Response, UploadFile, File, Form
from pydantic import BaseModel
from typing import Optional

from app.config import settings
from app.auth import get_current_user
from app.models import User
from app.transcription import transcribe_with_fallback
from app.languages import SUPPORTED_LANGUAGES

router = APIRouter(prefix="/api/voice", tags=["Voice"])

class TTSRequestBody(BaseModel):
    text: str
    voice_id: Optional[str] = None
    language_code: str = "en-IN"

@router.get("/config")
def get_voice_config():
    """
    Returns voice service configuration status.
    Keeps API key secure on the backend while informing frontend of capabilities.
    """
    has_key = bool(settings.ELEVENLABS_API_KEY and len(settings.ELEVENLABS_API_KEY.strip()) > 5)
    return {
        "elevenlabs_configured": has_key,
        "default_voice_id": settings.ELEVENLABS_VOICE_ID,
        "stt_model": "scribe_v2_realtime",
        "tts_model": "eleven_flash_v2_5",
        "fallback_available": True
    }

@router.post("/scribe-token")
def get_scribe_token(current_user: User = Depends(get_current_user)):
    """
    Provides connection credentials for ElevenLabs Scribe v2 realtime STT.
    If ELEVENLABS_API_KEY is not configured, provides fallback to browser Web Speech API.
    """
    api_key = settings.ELEVENLABS_API_KEY.strip() if settings.ELEVENLABS_API_KEY else ""

    if not api_key:
        return {
            "provider": "browser_fallback",
            "message": "ElevenLabs API key not set. Using browser Web Speech API (zero setup needed!)."
        }

    # Attempt to request single-use auth token from ElevenLabs API
    try:
        with httpx.Client(timeout=5.0) as client:
            resp = client.post(
                "https://api.elevenlabs.io/v1/single-use-token",
                headers={"xi-api-key": api_key},
                json={"type": "speech_to_text"}
            )
            if resp.status_code == 200:
                data = resp.json()
                token = data.get("token")
                return {
                    "provider": "elevenlabs",
                    "token": token,
                    "url": f"wss://api.elevenlabs.io/v1/speech-to-text/streaming?token={token}&model_id=scribe_v2_realtime"
                }
    except Exception:
        pass

    # If single-use token endpoint is not active for this tier, return elevenlabs mode with proxy notice or fallback
    return {
        "provider": "elevenlabs",
        "url": "wss://api.elevenlabs.io/v1/speech-to-text/streaming?model_id=scribe_v2_realtime",
        "message": "ElevenLabs Scribe active"
    }

@router.post("/tts")
def text_to_speech(body: TTSRequestBody, current_user: User = Depends(get_current_user)):
    """
    Converts question text to spoken audio using ElevenLabs eleven_flash_v2_5 model.
    If no key configured or error, gracefully instructs frontend to use browser speech synthesis.
    """
    api_key = settings.ELEVENLABS_API_KEY.strip() if settings.ELEVENLABS_API_KEY else ""
    sarvam_key = settings.SARVAM_API_KEY.strip()
    if sarvam_key and body.language_code in {"en-IN", "ta-IN"}:
        try:
            response = httpx.post(
                "https://api.sarvam.ai/text-to-speech",
                headers={"api-subscription-key": sarvam_key},
                json={"text": body.text[:2500], "model": "bulbul:v4-flash", "language_code": body.language_code},
                timeout=20.0,
            )
            response.raise_for_status()
            audio_data = response.json().get("audios", [])[0]
            import base64
            return Response(content=base64.b64decode(audio_data), media_type="audio/wav")
        except (httpx.HTTPError, ValueError, IndexError, KeyError):
            pass
    voice_id = body.voice_id or settings.ELEVENLABS_VOICE_ID or "21m00Tcm4TlvDq8ikWAM"

    if not api_key:
        return {
            "use_browser_tts": True,
            "text": body.text,
            "message": "ElevenLabs API key not provided in backend .env. Using browser TTS fallback."
        }

    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    headers = {
        "xi-api-key": api_key,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg"
    }
    payload = {
        "text": body.text,
        "model_id": "eleven_flash_v2_5",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75
        }
    }

    try:
        with httpx.Client(timeout=8.0) as client:
            res = client.post(url, json=payload, headers=headers)
            if res.status_code == 200:
                return Response(content=res.content, media_type="audio/mpeg")
            else:
                # If ElevenLabs returned error (e.g. invalid key or quota reached)
                return {
                    "use_browser_tts": True,
                    "text": body.text,
                    "message": f"ElevenLabs API error ({res.status_code}). Using browser fallback."
                }
    except Exception as e:
        return {
            "use_browser_tts": True,
            "text": body.text,
            "message": f"Connection error to ElevenLabs: {str(e)}. Using browser fallback."
        }

@router.post("/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    field_type: str = Form(default=""),
    question: str = Form(default=""),
    options: str = Form(default=""),
    language_code: str = Form(default="en-IN"),
    current_user: User = Depends(get_current_user)
):
    """
    Translates multilingual recorded audio to English and uses the active
    question and choices as recognition context.
    """
    content = await file.read()
    if language_code not in SUPPORTED_LANGUAGES:
        raise HTTPException(status_code=422, detail="Choose English or Tamil.")
    if not content or len(content) < 100:
        return {"text": "", "message": "Audio file was too short or empty."}

    filename = file.filename or "recording.webm"
    field_context = f"Form answer to: {question.strip()}" if question.strip() else "Form answer"
    if field_type.lower() == "choice" and options.strip():
        prompt = (
            f"{field_context}. Spoken audio may be in any language; translate the answer into English. "
            f"The allowed choice labels are: {options.strip()}. Match the label the speaker means, "
            "but preserve exact movie titles, names, and choice labels instead of translating them. "
            "Do not invent a choice."
        )
    elif field_type.lower() == "email":
        prompt = (
            f"{field_context}. The speaker may use any language. This is an email address. "
            "Preserve each spoken letter and digit exactly; "
            "write spoken at as @ and dot as .; do not guess or autocorrect names."
        )
    elif field_type.lower() in {"text", "textarea"} and "name" in question.lower():
        prompt = (
            f"{field_context}. The speaker may use any language. This is a personal name. "
            "Preserve uncommon names exactly; "
            "do not replace them with familiar words. If the speaker says letters one by one, "
            "transcribe each as a separate capital letter. Translate surrounding words into English."
        )
    elif field_type.lower() == "number":
        prompt = (
            f"{field_context}. The speaker may use any language. Translate the answer into English and "
            "transcribe its number accurately. Distinguish four from for, and two from to or do."
        )
    elif field_type.lower() == "phone":
        prompt = (
            f"{field_context}. The speaker may use any language. This is a phone number. "
            "Preserve every spoken digit in order; "
            "do not convert digits into words or omit repeated digits."
        )
    else:
        prompt = (
            f"{field_context}. The speaker may use any language. Translate the answer into clear English. "
            "Preserve proper names, titles, and numbers; do not invent details."
        )
    return await transcribe_with_fallback(
        content=content,
        filename=filename,
        content_type=file.content_type or "audio/webm",
        prompt=prompt,
        language_code="en-IN" if field_type.lower() in {"email", "phone", "number"} else language_code,
    )
