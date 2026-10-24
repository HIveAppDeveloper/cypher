from typing import Annotated, Literal
import json
import re
from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

class Settings(BaseSettings):
    DATABASE_URL: str = Field(default="sqlite+aiosqlite:///./grokbot.db", validation_alias=AliasChoices("GROKBOT_DATABASE_URL", "HIVE_DATABASE_URL", "HIVE_POSTGRES_URL", "DATABASE_URL", "POSTGRES_URL"))
    DATABASE_SCHEMA: str = "grokbot"
    REDIS_URL: str | None = None  # Optional cache; PostgreSQL owns persisted work.
    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_ACCESS_KEY: str = Field(default="minioadmin", validation_alias=AliasChoices("MINIO_ACCESS_KEY", "MINIO_ROOT_USER"))
    MINIO_SECRET_KEY: str = Field(default="minioadmin", validation_alias=AliasChoices("MINIO_SECRET_KEY", "MINIO_ROOT_PASSWORD"))
    LLM_PROVIDER: str = "openai"
    LLM_API_KEY: str = ""
    LLM_API_BASE: str | None = None
    LLM_MODEL: str = "gpt-6.1-sol"
    # Optional, explicitly configured backup. Never discard unsupported inputs.
    LLM_FALLBACK_MODEL: str | None = None
    LLM_FALLBACK_PROVIDER: str | None = None
    RUN_EMBEDDED_WORKER: bool = True
    OMNIROUTE_URL: str | None = None
    OMNIROUTE_API_KEY: str = Field(default="", repr=False)
    OMNIROUTE_PROTECTION_BYPASS: str = Field(default="", repr=False)
    OMNIROUTE_CONTROL_KEY: str = Field(default="", repr=False)
    MODEL_ROUTING_POLICY: Literal["standard", "codex_and_free"] = "codex_and_free"
    # Only verified, connected routes belong here; a catalog listing alone does
    # not establish that a provider account can actually serve requests.
    OMNIROUTE_MODEL_MAP: dict[str, str] = {
        "openai/gpt-6.1-sol": "cx/gpt-6.1-sol",
        "openai/gpt-6-astra": "cx/gpt-6-astra",
        "openai/gpt-6-luna": "cx/gpt-6-luna-low",
    }
    AUDIO_TRANSCRIPTION_MODEL: str = "openai/gpt-4o-mini-transcribe"
    IMAGE_MODEL: str = "openai/gpt-image-2"
    # Server-only Akta key. Prospecting uses this only after a per-run opt-in.
    AKTA_API_KEY: str = Field(default="", repr=False)
    SANDBOX_BACKEND: Literal["docker", "vercel"] = "docker"
    SANDBOX_IMAGE: str = "open-grokbot-sandbox:latest"
    BACKEND_API_TOKEN: str = ""
    AUTH_SESSION_SECRET: str = ""
    REQUIRE_USER_AUTH: bool = False
    # A separate, opt-in inference boundary. No existing backend/browser key
    # grants access, and configuring a key alone does not activate sharing.
    GROKBOT_ATLAS_ENGINE_ENABLED: bool = False
    ATLAS_ENGINE_SIGNING_KEY: str = Field(default="", repr=False)
    GROKBOT_ATLAS_ENGINE_PROVIDER: str = ""
    GROKBOT_ATLAS_ENGINE_MODEL: str = ""
    GROKBOT_ATLAS_ENGINE_TRANSPORT: Literal["direct", "omniroute"] = "direct"
    GROKBOT_ATLAS_ENGINE_ADMISSION: Literal["postgres", "local-memory"] = "postgres"
    GROKBOT_ATLAS_ENGINE_ALLOW_LOCAL_ADMISSION: bool = False
    GROKBOT_PUBLIC_URL: str = "http://localhost:3000"
    GROKBOT_AUTH_FROM: str = "no-reply@send.hivesales.info"
    AUTH_MAGIC_LINK_TTL_MINUTES: int = 15
    LEGACY_OWNER_EMAIL: str = ""
    SECRET_KEY: str = "local-only-change-before-exposure"
    CORS_ORIGINS: Annotated[list[str], NoDecode] = ["http://localhost:3000"]

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_origins(cls, value):
        if isinstance(value, str):
            return json.loads(value) if value.lstrip().startswith("[") else [v.strip() for v in value.split(",") if v.strip()]
        return value

    @field_validator("DATABASE_SCHEMA")
    @classmethod
    def validate_schema(cls, value):
        if not re.fullmatch(r"[a-z_][a-z0-9_]*", value):
            raise ValueError("DATABASE_SCHEMA must be a lowercase SQL identifier")
        return value

    model_config = SettingsConfigDict(env_file=(".env.vercel.local", ".env"), extra="ignore", populate_by_name=True)

settings = Settings()
