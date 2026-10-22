"""Bounded inputs for persisted multimodal jobs."""
import base64
from typing import Literal
from pydantic import BaseModel, Field, field_validator

MAX_TOTAL_BYTES = 3 * 1024 * 1024
class Attachment(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    mime: Literal['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain', 'audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'audio/flac', 'video/mp4', 'video/webm', 'video/quicktime']
    data: str = Field(max_length=4 * 1024 * 1024)

    @field_validator('data')
    @classmethod
    def valid_base64(cls, value):
        try: decoded = base64.b64decode(value, validate=True)
        except Exception: raise ValueError('Attachment must be base64 data')
        if not decoded or len(decoded) > MAX_TOTAL_BYTES:
            raise ValueError('Each attachment must be between 1 byte and 3 MB')
        return value

class RunOptions(BaseModel):
    routing: Literal['auto', 'manual'] = 'auto'
    allow_tools: bool = True
    steering: str = Field(default='', max_length=6000)
    output: Literal['text', 'image'] = 'text'
    aspect_ratio: Literal['1:1', '16:9', '9:16'] = '16:9'
    duration: Literal[4, 6, 8] = 4
    temperature: float = Field(default=0.5, ge=0, le=1.5)
    max_tokens: int = Field(default=2048, ge=256, le=8192)
    max_iterations: int = Field(default=10, ge=1, le=25)
    team_rounds: int = Field(default=1, ge=1, le=4)
    model: str | None = Field(default=None, min_length=1, max_length=160)
    provider: Literal['openai', 'gemini', 'anthropic', 'ollama', 'deepseek', 'xai', 'spacexai'] | None = None
    reasoning_effort: Literal['none', 'low', 'medium', 'high', 'xhigh', 'max'] | None = None

    @field_validator('model', mode='before')
    @classmethod
    def valid_model(cls, value):
        if isinstance(value, str):
            value = value.strip()
            if not value:
                raise ValueError('Choose a non-empty model ID')
        return value

def content_parts(text, attachments):
    if not attachments: return text
    parts = [{'type': 'text', 'text': text or 'Review the attached files.'}]
    for a in attachments:
        url = f"data:{a['mime']};base64,{a['data']}"
        if a['mime'].startswith('image/'):
            parts.append({'type':'text','text':f"Attached image: {a['name']}"})
            parts.append({'type': 'image_url', 'image_url': {'url': url}})
        elif a['mime'] == 'text/plain':
            decoded = base64.b64decode(a['data']).decode('utf-8', errors='replace')
            parts.append({'type': 'text', 'text': f"Attached document: {a['name']}\n{decoded}"})
        elif a['mime'] == 'application/pdf':
            parts.append({'type': 'file', 'file': {'file_data': url, 'filename': a['name']}})
        else:
            parts.append({'type': 'input_audio', 'input_audio': {'data': a['data'], 'format': 'wav' if a['mime'] == 'audio/wav' else 'mp3'}})
    return parts
