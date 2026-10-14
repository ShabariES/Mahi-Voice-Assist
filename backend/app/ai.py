import json
import re
import httpx
from difflib import SequenceMatcher
from typing import Optional, Tuple
from app.config import settings

# ----------------- Spoken Number Words Mapping -----------------
NUMBER_WORDS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
    "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20
}

# ----------------- Normal Programming Validation & Extraction -----------------

def clean_spoken_text(text: str) -> str:
    """Trim and remove trailing punctuation like periods from speech transcripts."""
    cleaned = text.strip()
    if cleaned.endswith(".") or cleaned.endswith("?"):
        cleaned = cleaned[:-1].strip()
    return cleaned

def extract_email(text: str) -> Tuple[bool, Optional[str], Optional[str]]:
    """
    Normal programming logic to extract and validate email.
    Handles spoken variants like 'john at gmail dot com' -> 'john@gmail.com'
    """
    normalized = text.lower()
    normalized = re.sub(r'\s+at\s+', '@', normalized)
    normalized = re.sub(r'\s+dot\s+', '.', normalized)
    normalized = re.sub(r'\s+(?:underscore|under score)\s+', '_', normalized)
    normalized = re.sub(r'\s+(?:hyphen|dash)\s+', '-', normalized)
    normalized = re.sub(r'\s+plus\s+', '+', normalized)
    normalized = normalized.replace(" ", "")

    match = re.search(r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+', normalized)
    if match:
        email = match.group(0)
        return True, email, None
    return False, None, "Please provide a valid email address."

def extract_phone(text: str) -> Tuple[bool, Optional[str], Optional[str]]:
    """
    Normal programming logic to extract phone number digits from speech.
    e.g., 'My phone number is 9876543210' -> '9876543210'
    """
    # Look for 7 to 15 contiguous or separated digits
    digits = re.sub(r'[^\d]', '', text)
    if len(digits) >= 7:
        return True, digits, None
    return False, None, "Please provide a valid phone number (at least 7 digits)."

def extract_yes_no(text: str) -> Tuple[bool, Optional[str], Optional[str]]:
    """
    Normal programming logic for Yes/No without calling LLM.
    """
    lowered = text.lower().strip()
    yes_signals = ["yes", "yeah", "yep", "of course", "sure", "absolutely", "definitely", "true", "correct", "affirmative", "i am", "i do"]
    no_signals = ["no", "nope", "nah", "not really", "never", "false", "negative", "i am not", "i don't"]

    # Check negative phrases first: "I am not employed" also contains the
    # affirmative phrase "I am" and must not be classified as true.
    for signal in no_signals:
        if re.search(rf"\b{re.escape(signal)}\b", lowered):
            return True, "false", None

    for signal in yes_signals:
        if re.search(rf"\b{re.escape(signal)}\b", lowered):
            return True, "true", None

    return False, None, "Please answer with Yes or No."

def extract_number(text: str, question: str = "") -> Tuple[bool, Optional[str], Optional[str]]:
    """
    Normal programming logic to extract numerical answer.
    """
    lowered = text.lower().strip()
    # Check digits first
    match = re.search(r'\b\d+(\.\d+)?\b', lowered)
    if match:
        return True, match.group(0), None

    # Check spoken number words
    for word, num in NUMBER_WORDS.items():
        if re.search(rf"\b{word}\b", lowered):
            return True, str(num), None

    # In a years-of-experience question, Whisper can mistake the homophones
    # "four"/"for" and "two"/"to"/"do". Correct only a short whole-answer
    # match so ordinary phrases containing those words are not changed.
    if re.search(r"\b(year|years|experience)\b", question.lower()):
        alias_match = re.fullmatch(
            r"(?:i\s+(?:have|had)\s+)?(for|to|too|do)(?:\s+years?(?:\s+of\s+experience)?)?",
            lowered.rstrip(" .!?"),
        )
        if alias_match:
            if alias_match.group(1) == "for":
                return True, "4", None
            return True, "2", None

    return False, None, "Please provide a valid number."

def extract_date(text: str) -> Tuple[bool, Optional[str], Optional[str]]:
    """
    Extract date in YYYY-MM-DD or standard recognizable format.
    """
    cleaned = clean_spoken_text(text)
    # Check for YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY
    match = re.search(r'\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b|\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b', cleaned)
    if match:
        return True, match.group(0), None
    if len(cleaned) >= 4:
        return True, cleaned, None
    return False, None, "Please provide a valid date."

def extract_name_or_text(text: str, question: str) -> str:
    """
    Clean conversational prefixes like 'My name is John', 'I am Sarah', 'It is Developer'
    """
    cleaned = clean_spoken_text(text)
    # Common conversational fillers
    patterns = [
        r"^(?:my\s+(?:first\s+|last\s+)?name\s+is\s+)(.+)$",
        r"^(?:my\s+answer\s+is\s+)(.+)$",
        r"^(?:i\s+am\s+)(.+)$",
        r"^(?:it\s+is\s+)(.+)$",
        r"^(?:i\s+live\s+in\s+)(.+)$"
    ]
    for pattern in patterns:
        m = re.match(pattern, cleaned, re.IGNORECASE)
        if m:
            cleaned = m.group(1).strip()
            break

    # Keep a spelled surname such as "E S" as the two initials "ES".
    if "last name" in question.lower():
        letters = cleaned.split()
        if 1 <= len(letters) <= 5 and all(re.fullmatch(r"[A-Za-z]\.?", letter) for letter in letters):
            return "".join(letter.rstrip(".").upper() for letter in letters)
    return cleaned

# ----------------- Token-Optimized LLM Semantic Interpretation -----------------

def semantic_choice_match(question: str, options_str: str, user_answer: str) -> Optional[str]:
    """
    Attempts deterministic match first.
    If no direct match, calls token-optimized LLM (or smart heuristic fallback).
    Never sends full conversations or full forms.
    """
    options = [opt.strip() for opt in re.split(r"[,;|\n]+", options_str) if opt.strip()]
    cleaned_user = user_answer.lower().strip()

    # Step 1: Normal programming direct match
    for opt in options:
        if opt.lower() == cleaned_user or opt.lower() in cleaned_user:
            return opt

    # Step 2: If LLM is configured, do token-optimized call
    if settings.OPENAI_API_KEY:
        try:
            prompt = (
                f"Question: {question}\n"
                f"Allowed values: {', '.join(options)}\n"
                f"User answer: \"{user_answer}\"\n"
                "Choose a label only when the answer matches it by meaning, pronunciation, or a clear translation. "
                "If no option matches, return {\"value\": null, \"confidence\": 0}. "
                "Return JSON as {\"value\": \"<exact label or null>\", \"confidence\": 0.0}"
            )
            with httpx.Client(timeout=4.0) as client:
                res = client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": "gpt-4o-mini",
                        "messages": [
                            {"role": "system", "content": "You are a concise form field value matcher. Output JSON only."},
                            {"role": "user", "content": prompt}
                        ],
                        "temperature": 0.0,
                        "max_tokens": 50
                    }
                )
                if res.status_code == 200:
                    data = res.json()
                    content = data["choices"][0]["message"]["content"]
                    parsed = json.loads(re.search(r'\{.*\}', content, re.DOTALL).group(0))
                    val = parsed.get("value")
                    confidence = float(parsed.get("confidence") or 0)
                    if val and confidence >= 0.65 and any(val.lower() == o.lower() for o in options):
                        # Match exact case from options
                        for o in options:
                            if o.lower() == val.lower():
                                return o
        except Exception:
            pass  # Fallback to heuristic

    # Step 3: Heuristic smart keyword fallback (e.g. software engineer/working -> employed)
    if any(word in cleaned_user for word in ["working", "job", "developer", "engineer", "software", "company"]):
        for opt in options:
            if "employ" in opt.lower():
                return opt

    # Catch small recognition errors such as "Nayakan" for "Nayagan", but
    # reject ambiguous/weak matches instead of silently choosing the first item.
    def choice_key(value: str) -> str:
        return "".join(character for character in value.casefold() if character.isalnum())

    spoken_key = choice_key(user_answer)
    ranked = sorted(
        ((SequenceMatcher(None, spoken_key, choice_key(option)).ratio(), option) for option in options),
        reverse=True,
    )
    if ranked and ranked[0][0] >= 0.76:
        if len(ranked) == 1 or ranked[0][0] - ranked[1][0] >= 0.08:
            return ranked[0][1]

    return None

# ----------------- Master Process Answer Function -----------------

def process_field_answer(
    field_type: str,
    question: str,
    options: Optional[str],
    raw_answer: str,
    required: bool = True
) -> Tuple[bool, Optional[str], Optional[str]]:
    """
    Validates and processes answer based on field type.
    Returns (is_valid, processed_value, error_message).
    """
    trimmed = raw_answer.strip()
    if not trimmed:
        if required:
            return False, None, "This answer is required."
        return True, "", None

    ftype = field_type.lower()

    if ftype == "email":
        return extract_email(trimmed)

    elif ftype == "phone":
        return extract_phone(trimmed)

    elif ftype == "yes_no":
        return extract_yes_no(trimmed)

    elif ftype == "number":
        return extract_number(trimmed, question)

    elif ftype == "date":
        return extract_date(trimmed)

    elif ftype == "choice":
        if not options:
            return True, trimmed, None
        chosen = semantic_choice_match(question, options, trimmed)
        if chosen is None:
            available = [value.strip() for value in re.split(r"[,;|\n]+", options) if value.strip()]
            return False, None, f"I couldn't match that to an option. Please say or select one of: {', '.join(available)}."
        return True, chosen, None

    elif ftype in ["text", "textarea"]:
        processed = extract_name_or_text(trimmed, question)
        if "first name" in question.lower() and processed:
            processed = processed[0].upper() + processed[1:]
        return True, processed, None

    # Fallback default
    return True, trimmed, None
