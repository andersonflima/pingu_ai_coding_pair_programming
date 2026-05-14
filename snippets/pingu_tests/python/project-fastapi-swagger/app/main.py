from __future__ import annotations

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(
    title='Pingu Python API',
    version='1.0.0',
    description='API de exemplo para validação de comentários acionáveis do Pingu.',
)


class UserCreate(BaseModel):
    name: str
    email: str


users = [
    {"id": 1, "name": "Ana", "email": "ana@exemplo.com"},
    {"id": 2, "name": "Bruno", "email": "bruno@exemplo.com"},
]


@app.get('/health')
def health() -> dict[str, str]:
    return {"status": "ok", "service": "pingu-fastapi-swagger"}


@app.get('/users')
def list_users() -> list[dict[str, str | int]]:
    return users


@app.post('/users', status_code=201)
def create_user(payload: UserCreate) -> dict[str, str | int]:
    next_id = users[-1]['id'] + 1 if users else 1
    user = {"id": next_id, **payload.dict()}
    users.append(user)
    return user
