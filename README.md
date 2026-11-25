# Northstar Clinic — Voice Appointment Desk

A browser-based voice desk that lets a caller check doctor availability, book an appointment, and cancel an appointment in one conversation. The web dashboard stays in sync with the call and shows doctors, open slots, appointments, a live transcript, and confirmation feedback.

## What is included

- **Voice pipeline:** Pipecat 1.17.0 with ElevenLabs realtime STT, ElevenLabs TTS, OpenRouter LLM, and Silero VAD.
- **Browser calling:** `SmallWebRTCTransport` + `@pipecat-ai/client-js`. No phone line or third-party dialler is needed.
- **Frontend:** React 19 + Vite 8 + TypeScript, hand-written CSS, phone-style call UI.
- **Storage:** SQLite (`backend/data/appointments.db`) shared by the voice tools and the dashboard API.
- **Identity rule:** A number typed before the call is only a proposal. Tools refuse to book or cancel until `confirm_caller_phone()` runs after an explicit verbal "yes".

## Chosen LLM

`openai/gpt-4o-mini` through **OpenRouter**, using Pipecat's OpenAI-compatible `OpenAILLMService`. Change `OPENROUTER_MODEL` in `.env` to any other tool-calling model available on your OpenRouter account. Your OpenRouter key needs credits and access to that model.

## Pipeline in one paragraph

The browser sends microphone audio over WebRTC to the Pipecat runner. `ElevenLabsRealtimeSTTService` transcribes it, `SileroVADAnalyzer` handles turn-taking, and `OpenAILLMService` drives the conversation through OpenRouter with direct function tools: `check_doctor_availability`, `set_caller_phone`, `confirm_caller_phone`, `check_caller_appointments`, `book_appointment`, and `cancel_appointment`. Tool results are written to SQLite, and RTVI server messages (`caller_confirmed`, `appointment_created`, `appointment_cancelled`) push updates into the React UI.

## Setup

Requirements: Python 3.12+, Node 22+, an ElevenLabs API key, and an OpenRouter API key.

```powershell
# 1. Install backend dependencies
cd backend
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
cd ..

# 2. Create your local env file and fill in the keys
Copy-Item .env.example backend\.env

# 3. Install frontend dependencies
cd frontend
npm install
cd ..
```

`.env.example` contains:

```env
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
ELEVENLABS_STT_MODEL_ID=scribe_v2_realtime
ELEVENLABS_TTS_MODEL_ID=eleven_flash_v2_5

OPENROUTER_API_KEY=
OPENROUTER_MODEL=openai/gpt-4o-mini
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_SITE_URL=http://localhost:5173
OPENROUTER_APP_NAME=Northstar Voice Desk

DATABASE_PATH=./data/appointments.db
```

Never commit `backend/.env` or any key. The repository `.gitignore` already excludes it.

ElevenLabs note: premade/library voices require a paid ElevenLabs plan for API text-to-speech. If TTS returns `paid_plan_required`, upgrade the account or use a key with API TTS access. Realtime STT works with free-tier keys.

## Run locally

Terminal 1 — backend:

```powershell
cd backend
.\.venv\Scripts\python bot.py -t webrtc --allowed-origins http://localhost:5173
```

Terminal 2 — frontend:

```powershell
cd frontend
npm run dev
```

Open **http://localhost:5173**, click **Try Call**, enter a caller number, then click **Continue to call**. Allow microphone access when the browser asks.

The Vite dev server proxies `/api`, `/start`, and `/sessions` to the Pipecat runner on port `7860`. WebRTC requires HTTPS in production; `localhost` is allowed for this local demo.

## Demo script (under 3 minutes)

1. Click **Try Call** and enter `+1 (415) 555-0132`.
2. The agent reads the number back. Say **"Yes, that's correct."**
3. Say **"Check availability for tomorrow."** Pick a time from what the agent reads out.
4. Say **"Book the 10:30 slot."** Watch the dashboard row and confirmation card update.
5. Say **"Cancel my appointment."** Watch the row change to cancelled.
6. Click **End** and show the call summary: duration, booked count, cancelled count.

If you say the number is wrong, say **"No, use 415 555 0199"** instead. The agent reads the new number back and asks again before any booking or cancellation is allowed.

## API routes

The dashboard uses these routes on the same FastAPI server as WebRTC signaling:

- `GET /api/health`
- `GET /api/doctors`
- `GET /api/appointments`
- `GET /api/bootstrap`

`POST /start` receives the browser's session request. The proposed phone is sent as `body.proposed_phone`.

## Tests

```powershell
cd backend
.\.venv\Scripts\python -m pytest -q
```

The tests cover phone normalization, typed-number-without-confirmation rejection, booking after confirmation, slot removal, and double-cancel protection.

## Windows note

If the Visual C++ redistributable is missing, the native `loudness` and `onnxruntime` wheels may fail to import with a DLL error. `backend/app/_compat.py` installs small NumPy fallbacks so the demo still starts; installing the Microsoft Visual C++ Redistributable restores the native audio metrics and full Silero model accuracy.

## Submission

Assignment form: [Google Form](https://docs.google.com/forms/d/e/1FAIpQLSdruhcgKFC4LjnlwHfYDRZoGsa0r-qy4k68SJ8RsmxsPbYxpg/viewform?usp=publish-editor)
