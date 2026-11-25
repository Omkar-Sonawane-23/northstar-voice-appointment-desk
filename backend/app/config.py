from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
ROOT_DIR = BACKEND_DIR.parent

# backend/.env wins over root .env
load_dotenv(ROOT_DIR / ".env")
load_dotenv(BACKEND_DIR / ".env", override=True)


@dataclass(frozen=True)
class Settings:
    elevenlabs_api_key: str = os.getenv("ELEVENLABS_API_KEY", "")
    elevenlabs_voice_id: str = os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
    elevenlabs_stt_model: str = os.getenv("ELEVENLABS_STT_MODEL_ID", "scribe_v2_realtime")
    elevenlabs_tts_model: str = os.getenv("ELEVENLABS_TTS_MODEL_ID", "eleven_flash_v2_5")
    google_api_key: str = os.getenv("GOOGLE_API_KEY", "")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
    database_path: Path = BACKEND_DIR / os.getenv("DATABASE_PATH", "data/appointments.db")

    def require_voice_keys(self) -> None:
        missing = []
        if not self.elevenlabs_api_key:
            missing.append("ELEVENLABS_API_KEY")
        if not self.google_api_key:
            missing.append("GOOGLE_API_KEY")
        if missing:
            raise RuntimeError("Missing required environment variables: " + ", ".join(missing))


settings = Settings()
