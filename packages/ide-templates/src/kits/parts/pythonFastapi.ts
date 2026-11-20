/**
 * The `python-fastapi` backend part: FastAPI served by uvicorn, Postgres through pg8000.
 * pg8000 is pure Python, the driver the browser runtime's Python reaches Postgres with
 * (psycopg/asyncpg need native code it cannot load).
 */
import { BACKEND_INGRESS_PATH } from '@builderforce/app-detect/manifest';
import type { KitPart } from '../types';
import { ITEMS_MIGRATION, MEMORY_NOTE } from './backendContract';
import { backendFragment, KIT_API_PORT } from './fragments';

const REQUIREMENTS = `fastapi>=0.115
pg8000>=1.31
uvicorn>=0.32
`;

const MAIN_PY = `import os
from pathlib import Path
from urllib.parse import unquote, urlparse

import pg8000.native
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

DATABASE_URL = os.environ.get("DATABASE_URL")
MIGRATION = Path(__file__).parent / ${JSON.stringify(ITEMS_MIGRATION)}
MEMORY_NOTE = ${JSON.stringify(MEMORY_NOTE)}

app = FastAPI()
memory: list[dict] = []
_connection = None


class NewItem(BaseModel):
    name: str


def storage() -> str:
    return "postgres" if DATABASE_URL else "memory"


def connection():
    """One connection, opened on first use; it creates the items table when it is missing."""
    global _connection
    if _connection is None:
        url = urlparse(DATABASE_URL)
        _connection = pg8000.native.Connection(
            user=unquote(url.username or "postgres"),
            password=unquote(url.password) if url.password else None,
            host=url.hostname or "localhost",
            port=url.port or 5432,
            database=(url.path or "/postgres").lstrip("/") or "postgres",
        )
        _connection.run(MIGRATION.read_text())
    return _connection


@app.get("/health")
@app.get("/api/health")
async def health():
    return {"status": "ok", "runtime": "python", "storage": storage()}


@app.get("/api/items")
async def list_items():
    if not DATABASE_URL:
        return {"items": memory, "storage": "memory", "note": MEMORY_NOTE}
    rows = connection().run("SELECT id, name FROM items ORDER BY id")
    return {"items": [{"id": row[0], "name": row[1]} for row in rows], "storage": "postgres"}


@app.post("/api/items", status_code=201)
async def add_item(item: NewItem):
    name = item.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    if not DATABASE_URL:
        created = {"id": len(memory) + 1, "name": name}
        memory.append(created)
        return created
    row = connection().run("INSERT INTO items (name) VALUES (:name) RETURNING id, name", name=name)[0]
    return {"id": row[0], "name": row[1]}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "${KIT_API_PORT}")))
`;

export const PYTHON_FASTAPI: KitPart = {
  id: 'python-fastapi',
  kind: 'backend',
  label: 'Python (FastAPI)',
  aliases: ['fastapi', 'python'],
  serviceId: 'api',
  root: '/api',
  ingress: BACKEND_INGRESS_PATH,
  files: { 'requirements.txt': REQUIREMENTS, 'main.py': MAIN_PY },
  manifest: backendFragment({
    runtime: 'python',
    command: `uvicorn main:app --host 0.0.0.0 --port ${KIT_API_PORT}`,
    install: 'pip install -r requirements.txt',
  }),
};
