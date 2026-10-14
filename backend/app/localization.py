import asyncio

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import get_current_user
from app.config import settings
from app.languages import SUPPORTED_LANGUAGES
from app.models import User

router = APIRouter(prefix="/api/localization", tags=["Localization"])
_translation_cache: dict[tuple[str, str, str], str] = {}


class TranslateRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=80)
    source_language_code: str = Field(default="en-IN", min_length=2, max_length=20)
    target_language_code: str = Field(min_length=2, max_length=20)


@router.post("/translate")
async def translate_texts(body: TranslateRequest, _: User = Depends(get_current_user)):
    if body.source_language_code not in SUPPORTED_LANGUAGES or body.target_language_code not in SUPPORTED_LANGUAGES:
        raise HTTPException(status_code=422, detail="Choose English, Hindi, or Tamil.")
    if body.source_language_code == body.target_language_code:
        return {"translations": body.texts}
    if any(len(text) > 2000 for text in body.texts):
        raise HTTPException(status_code=422, detail="Each text must be 2,000 characters or fewer.")
    api_key = settings.SARVAM_API_KEY.strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="Language translation is not configured. Add SARVAM_API_KEY to backend/.env.")

    semaphore = asyncio.Semaphore(4)
    batches: list[list[str]] = []
    current: list[str] = []
    current_size = 0
    for value in body.texts:
        if "\n" in value:
            if current:
                batches.append(current)
                current, current_size = [], 0
            batches.append([value])
        else:
            if current and (len(current) >= 8 or current_size + len(value) + 1 > 1700):
                batches.append(current)
                current, current_size = [], 0
            current.append(value)
            current_size += len(value) + 1
    if current:
        batches.append(current)

    async with httpx.AsyncClient(timeout=20.0) as client:
        async def call_sarvam(input_text: str) -> str:
            async with semaphore:
                response = await client.post(
                    "https://api.sarvam.ai/translate",
                    headers={"api-subscription-key": api_key},
                    json={
                        "input": input_text,
                        "source_language_code": body.source_language_code,
                        "target_language_code": body.target_language_code,
                        "model": "sarvam-translate:v1",
                    },
                )
            response.raise_for_status()
            return (response.json().get("translated_text") or "").strip()

        async def translate_batch(values: list[str]) -> list[str]:
            keys = [(body.source_language_code, body.target_language_code, value) for value in values]
            misses = [(key, value) for key, value in zip(keys, values) if key not in _translation_cache]
            if misses:
                try:
                    output = await call_sarvam("\n".join(value for _, value in misses))
                    lines = [output] if len(misses) == 1 else output.splitlines()
                    if len(lines) != len(misses) or any(not line.strip() for line in lines):
                        # Retry separately if the service changes line breaks in a grouped response.
                        lines = await asyncio.gather(*(call_sarvam(value) for _, value in misses))
                    for (key, _), line in zip(misses, lines):
                        _translation_cache[key] = line.strip()
                except (httpx.HTTPError, ValueError) as exc:
                    raise HTTPException(status_code=502, detail="Could not translate the requested text. Try again.") from exc
            return [_translation_cache[key] for key in keys]

        try:
            translated_batches = await asyncio.gather(*(translate_batch(batch) for batch in batches))
        except HTTPException:
            raise
        except (httpx.HTTPError, ValueError) as exc:
            raise HTTPException(status_code=502, detail="Could not translate the requested text. Try again.") from exc

    by_text = {value: translated for batch, translated in zip(batches, translated_batches) for value, translated in zip(batch, translated)}
    return {"translations": [by_text.get(value, value) for value in body.texts]}
