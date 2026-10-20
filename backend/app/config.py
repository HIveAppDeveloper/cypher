from typing import Annotated
import json
import re
from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

class Settings(BaseSettings):
    DATABASE_URL: str = Field(default="sqlite+aiosqlite:///./grokbot.db", validation_alias=AliasChoices("GROKBOT_DATABASE_URL", "HIVE_DATABASE_URL", "HIVE_POSTGRES_URL", "DATABASE_URL", "POSTGRES_URL"))
    DATABASE_SCHEMA: str = "grokbot"
    REDIS_URL: str = "redis://localhost:6379/0"
    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_ACCESS_KEY: str = Field(default="minioadmin", validation_alias=AliasChoices("MINIO_ACCESS_KEY", "MINIO_ROOT_USER"))
    MINIO_SECRET_KEY: str = Field(default="minioadmin", validation_alias=AliasChoices("MINIO_SECRET_KEY", "MINIO_ROOT_PASSWORD"))
    LLM_PROVIDER: str = "gemini"
    LLM_API_KEY: str = ""
    LLM_API_BASE: str | None = None
    LLM_MODEL: str = "gemini-2.5-flash"
    SANDBOX_IMAGE: str = "open-grokbot-sandbox:latest"
    BACKEND_API_TOKEN: str = ""
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
