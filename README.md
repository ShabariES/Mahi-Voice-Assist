# 🎙️ Voice-Driven Form Filling Application

A full-stack web application for voice-driven forms, PDF-assisted entry, and multilingual form prompts. Built with **React**, **FastAPI**, and **SQLAlchemy**. Speech and translation features depend on configured provider API keys, with browser speech features as fallbacks.

---

## 🌟 How the Voice Flow Works

```text
Application asks a question
        ↓
Text-to-Speech (TTS) speaks the question aloud (ElevenLabs eleven_flash_v2_5)
        ↓
User speaks their answer into microphone
        ↓
Speech-to-Text (STT) streams real-time transcript (ElevenLabs Scribe v2)
        ↓
Application validates and extracts the answer (Normal Logic / AI)
        ↓
Answer is saved into SQLite database
        ↓
Backend decides and returns the next question
        ↓
Repeat until the form is completed!
```

---

## 🏗️ Technology Stack

### Frontend
- **Framework**: React 18+ (Vite)
- **Language**: JavaScript (JSX)
- **Routing**: React Router v6
- **API Client**: Axios
- **Styling**: Plain CSS3 with custom design system, glassmorphism, flexbox/grid, and micro-animations (pulsating microphone, animated audio waves).

### Backend
- **Framework**: FastAPI (Python 3.12+)
- **ORM & Database**: SQLAlchemy with SQLite
- **Validation**: Pydantic v2
- **Authentication**: JWT (JSON Web Tokens) + Bcrypt
- **Voice STT**: Sarvam Saaras v4, with Groq/OpenAI Whisper fallbacks; browser speech recognition may be used when available
- **Voice TTS**: Sarvam Bulbul v4 Flash, then ElevenLabs Flash v2.5, then browser speech synthesis
- **AI / LLM**: Token-optimized semantic choice matching (invoked only when necessary)

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- **Node.js**: v18+ (v20+ recommended)
- **Python**: 3.12+

---

### 2. Backend Setup

```bash
cd backend

# 1. Activate virtual environment (Windows PowerShell)
.\venv\Scripts\activate

# Or create a new one if needed:
# python -m venv venv
# .\venv\Scripts\activate
# pip install -r requirements.txt

# 2. Copy .env.example to .env and set a private JWT_SECRET
# DATABASE_URL=sqlite:///./voice_form.db
# JWT_SECRET=<long-random-secret>
# Set provider keys for the speech/translation services you want to use.
# Demo accounts and sample forms are opt-in with SEED_DEMO_DATA=true (development only).

# 3. Run the FastAPI development server
uvicorn app.main:app --reload --port 8000
```

The backend starts at `http://localhost:8000`.
- **Interactive Swagger API Docs**: `http://localhost:8000/docs`

#### Scanned PDF and table import

Selectable PDF text is extracted in the browser first. When a PDF is scanned or no fields can be matched, the authenticated backend uses PaddleOCR PP-StructureV3 to OCR pages and preserve table structure for field suggestions. Files are limited to 12 MB and 40 pages, are processed in a temporary directory, and are deleted after parsing. Users review extracted values before importing them.

The backend requirements include the CPU PaddlePaddle runtime, `paddleocr[doc-parser]`, and `pypdf` for PDF validation. The OCR models are downloaded by PaddleOCR the first time a scanned PDF is processed. Set `PDF_OCR_LANG=ta` for Tamil/English documents or choose another language supported by PaddleOCR. OCR is CPU-intensive; for production traffic, deploy it on a service with enough memory/CPU or run OCR as a separate worker. The initial model download and first inference can be slower than later requests.

Admins can also use **Bulk PDF Fill** in the management console to upload up to 20 PDFs at once. A PDF may contain multiple people when the records are in a labeled table or repeated labeled sections. The preview matches records to registered users by email, or by a unique exact name when email is absent. Review or correct extracted values and account matches before importing. The system creates one form session per selected user; sessions stay in progress if the PDF did not contain every field.

#### Automatic form-completion email

When the final answer is saved, the backend queues a welcome/confirmation email to the email field in the completed form. If that form has no email field or no value was supplied, it uses the signed-in account email. Configure an SMTP server in `backend/.env` to enable delivery:

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USERNAME=your-smtp-username
SMTP_PASSWORD=your-smtp-password
SMTP_FROM_EMAIL=verified-sender@example.com
SMTP_SECURITY=starttls
```

Use `SMTP_SECURITY=ssl` for an implicit-TLS SMTP server, commonly on port 465. After changing `.env`, restart the backend. Without SMTP host and sender settings, the form still completes, and the completion screen explains that email delivery is not configured.

---

### 3. Frontend Setup

```bash
cd frontend

# 1. Install dependencies (already installed)
npm install

# 2. Run the Vite development server
npm run dev
```

The frontend runs at `http://localhost:5173`.

---

## 👥 Account Roles & Local Bootstrap

Public registration creates a standard user account. An admin can assign `user`, `form_manager`, or `admin` roles in Management → User Accounts; the API prevents self-demotion and demotion of the last admin. To bootstrap the first admin on a fresh database, set `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL`, and a strong `BOOTSTRAP_ADMIN_PASSWORD`, start the backend once, then remove the password from `.env`. Demo accounts and sample forms are disabled by default; enable `SEED_DEMO_DATA=true` only for a local development database. Do not use demo accounts or demo data in a shared or production environment.

---

## 📋 Pre-Seeded Sample Forms

1. **Employee Registration** (7 Questions)
   - Question 1: *"What is your first name?"* (`text`)
   - Question 2: *"What is your last name?"* (`text`)
   - Question 3: *"What is your email address?"* (`email` with spoken address normalization)
   - Question 4: *"What is your phone number?"* (`phone` with digit extraction)
   - Question 5: *"What is your employment status?"* (`choice` with semantic extraction)
   - Question 6: *"How many years of experience do you have?"* (`number` with number-word parsing)
   - Question 7: *"Are you currently employed?"* (`yes_no` with affirmative/negative mapping)

2. **Quick Feedback Survey** (3 Questions)
   - Rating, full name, and recommendation.

---

## 🧠 Answer Processing & Token Optimization

To keep voice form filling fast, robust, and cost-effective:
1. **Normal Programming First**:
   - **Email**: Cleans spoken words like *"john at gmail dot com"* into `john@gmail.com` and checks regex.
   - **Phone**: Extracts 7–15 digits from conversational phrases like *"My phone number is 9876543210"*.
   - **Yes/No**: Deterministically maps affirmative words (`yes`, `yeah`, `yep`, `of course`, `sure`, `absolutely`) to `true`, and negative words (`no`, `nope`, `nah`, `not really`) to `false`.
   - **Numbers**: Extracts digits or spoken words (`five` -> `5`).
   - **Names**: Strips conversational speech fillers (`"My name is John"` -> `"John"`).
2. **Token-Optimized LLM (Only when semantic matching is needed)**:
   - For choices like employment status where the user answers *"I am working as a software developer"*, the backend maps this to `"employed"`.
   - **Rule**: Never sends partial transcripts, entire forms, or full conversation history. Only sends the current question, allowed choices, and user's answer.

---

## 🎙️ Speech Provider Fallbacks

- **Speech-to-Text (STT)**:
  - Audio is submitted for transcription after recording ends; it is not a realtime streaming pipeline.
  - Sarvam Saaras v4 is tried first, with Groq and OpenAI Whisper fallbacks when configured. Provider, network, language, and microphone quality affect latency and accuracy.
- **Text-to-Speech (TTS)**:
  - Questions use Sarvam Bulbul v4 Flash, then ElevenLabs Flash v2.5 when configured, and browser speech synthesis as a fallback.
  - Browser speech support and installed voices vary. No provider or fallback guarantees perfect accuracy or availability.
- **Manual Input**:
  - A `"Type Answer Instead"` toggle allows switching to manual keyboard input at any time while retaining the exact same backend validation pipeline.

---

## 🧪 Running Automated Tests

Run backend integration tests:
```bash
cd backend
.\venv\Scripts\python tests\test_api.py
```
This tests:
- User login & authentication tokens
- Form retrieval
- Starting sessions
- Normal programming answer validations (name cleaning, email validation, phone extraction, number parsing, yes/no conversion, choice selection)
- Session completion and answer review.

---

## ☁️ Deploying to Render

This repository includes a `render.yaml` Blueprint for a static React frontend, a FastAPI API service, and a PostgreSQL database. In Render, choose **New → Blueprint**, connect this GitHub repository, and apply the Blueprint. Render will ask for the administrator email and password; enter a strong unique password. Provider and SMTP keys are optional and can be added in the API service's Environment settings. Never commit local `.env` files or API keys.

The Blueprint uses free plans for an evaluation deployment. Free web services can sleep after inactivity, and the free PostgreSQL database expires after 30 days; this setup is not suitable for production or durable user data. OCR model inference is CPU and memory intensive, so scanned-PDF extraction may need a larger service plan. Upgrade the database and API service before relying on the hosted app for persistent or production use.

Render deploys the API and frontend at these service URLs:

- Frontend: `https://mahi-voice-assist-web.onrender.com`
- API and Swagger docs: `https://mahi-voice-assist-api.onrender.com/docs`

If these names are already taken in your Render workspace, change both service names in `render.yaml` and update the matching frontend API URL and backend CORS origin before applying the Blueprint.

## 🌐 Hosting the frontend on GitHub Pages

The React frontend can also be hosted on GitHub Pages. A GitHub Actions workflow builds and deploys `frontend/` whenever frontend files are pushed to `main`. In the GitHub repository, open **Settings → Pages** and select **GitHub Actions** as the build and deployment source. The site URL will be `https://shabaries.github.io/Mahi-Voice-Assist/`.

GitHub Pages only hosts static files; it does not run FastAPI or store application data. The frontend needs a live backend. The workflow defaults to `https://mahi-voice-assist-api.onrender.com`; set the repository Actions variable `VITE_API_BASE_URL` if the backend has a different URL. Configure the backend CORS allowlist with the Pages origin `https://shabaries.github.io`.
