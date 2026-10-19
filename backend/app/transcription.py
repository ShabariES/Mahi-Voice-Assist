import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


async def transcribe_with_fallback(content: bytes, filename: str, content_type: str, prompt: str, language_code: str = "en-IN") -> dict:
    providers = []
    sarvam_key = settings.SARVAM_API_KEY.strip()
    groq_key = settings.GROQ_API_KEY.strip()
    openai_key = settings.OPENAI_API_KEY.strip()
    if sarvam_key:
        sarvam_mode = "transcribe" if language_code == "ta-IN" else "translate"
        sarvam_language = language_code if sarvam_mode == "transcribe" else "unknown"
        providers.append((
            "sarvam_saaras_v4",
            "https://api.sarvam.ai/speech-to-text",
            {"api-subscription-key": sarvam_key},
            {"model": "saaras:v4", "mode": sarvam_mode, "language_code": sarvam_language},
        ))
    if groq_key:
        providers.append((
            "groq_whisper_translation",
            "https://api.groq.com/openai/v1/audio/translations",
            {"Authorization": f"Bearer {groq_key}"},
            {"model": "whisper-large-v3", "temperature": 0, "prompt": prompt},
        ))
    if openai_key:
        providers.append((
            "openai_whisper_translation",
            "https://api.openai.com/v1/audio/translations",
            {"Authorization": f"Bearer {openai_key}"},
            {"model": "whisper-1", "temperature": 0, "prompt": prompt},
        ))
    if not providers:
        return {"text": "", "success": False, "error": "Configure SARVAM_API_KEY, GROQ_API_KEY, or OPENAI_API_KEY on the backend."}

    last_error = "Speech transcription is temporarily unavailable."
    async with httpx.AsyncClient(timeout=25.0) as client:
        for index, (provider, url, headers, data) in enumerate(providers):
            try:
                response = await client.post(
                    url,
                    headers=headers,
                    data=data,
                    files={"file": (filename, content, content_type)},
                )
                if response.is_success:
                    result = response.json()
                    transcript = (result.get("transcript") or result.get("text") or "").strip()
                    model = data.get("model", "unknown")
                    transcript = transcript
                    if language_code != "en-IN" and provider != "sarvam_saaras_v4" and sarvam_key and transcript:
                        async with httpx.AsyncClient(timeout=20.0) as translator:
                            try:
                                translated = await translator.post(
                                    "https://api.sarvam.ai/translate",
                                    headers={"api-subscription-key": sarvam_key},
                                    json={
                                        "input": transcript[:2000],
                                        "source_language_code": "en-IN",
                                        "target_language_code": language_code,
                                        "model": "sarvam-translate:v1",
                                    },
                                )
                                translated.raise_for_status()
                                transcript = translated.json().get("translated_text", transcript).strip()
                            except (httpx.HTTPError, ValueError):
                                pass
                    return {
                        "text": transcript,
                        "success": bool(transcript),
                        "provider": provider,
                        "model": model,
                        **({"language_code": result["language_code"]} if result.get("language_code") else {}),
                    }
                last_error = f"{provider} error ({response.status_code})"
                logger.warning("%s returned HTTP %s for speech transcription", provider, response.status_code)
            except (httpx.HTTPError, ValueError) as exc:
                last_error = f"{provider} connection failed ({type(exc).__name__})"
                logger.warning("%s transcription request failed (%s)", provider, type(exc).__name__)

            if index + 1 < len(providers):
                logger.info("Trying the next configured speech transcription provider")

    return {"text": "", "success": False, "error": f"{last_error}. Check the provider key or network settings and try again."}
