#!/usr/bin/env python3
"""Meme Desk paper-trading web app. No wallets, keys, or real orders."""

from __future__ import annotations

import asyncio
import hmac
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
DATA_DIR = ROOT / "data"
STATE_PATH = DATA_DIR / "state.json"
PRAGUE = ZoneInfo("Europe/Prague")

DEFAULT_CONTROL = {"desired": "run", "updated_at_cet": None, "updated_by": None}

_state: dict[str, Any] = {
    "snapshot": None,
    "control": dict(DEFAULT_CONTROL),
    "ingested_at": None,
    "ingested_at_cet": None,
}
_lock = asyncio.Lock()
_subscribers: set[asyncio.Queue] = set()


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_env_file(ROOT / ".env.local")


def desk_token() -> str:
    return os.environ.get("DESK_TOKEN") or ""


def app_pin() -> str:
    return os.environ.get("APP_PIN") or ""


def now_cet() -> str:
    local = datetime.now(tz=PRAGUE)
    label = "CEST" if local.utcoffset() and local.utcoffset().total_seconds() == 7200 else "CET"
    return f"{local.strftime('%Y-%m-%d %H:%M:%S')} {label}"


def now_utc_iso() -> str:
    return datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def secure_equal(a: str | None, b: str) -> bool:
    if not a or not b:
        return False
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def public_state() -> dict[str, Any]:
    return {
        "snapshot": _state["snapshot"],
        "control": _state["control"],
        "ingested_at": _state["ingested_at"],
        "ingested_at_cet": _state["ingested_at_cet"],
        "paper_only": True,
    }


def persist() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps({
        "snapshot": _state["snapshot"],
        "control": _state["control"],
        "ingested_at": _state["ingested_at"],
        "ingested_at_cet": _state["ingested_at_cet"],
    }, ensure_ascii=False, indent=2) + "\n")
    tmp.replace(STATE_PATH)


def restore() -> None:
    if not STATE_PATH.exists():
        return
    try:
        data = json.loads(STATE_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        return
    if not isinstance(data, dict):
        return
    if "snapshot" in data:
        _state["snapshot"] = data.get("snapshot")
    if isinstance(data.get("control"), dict) and data["control"].get("desired") in ("run", "stop"):
        _state["control"] = {
            "desired": data["control"]["desired"],
            "updated_at_cet": data["control"].get("updated_at_cet"),
            "updated_by": data["control"].get("updated_by"),
        }
    _state["ingested_at"] = data.get("ingested_at")
    _state["ingested_at_cet"] = data.get("ingested_at_cet")


def require_token(token: str | None) -> None:
    expected = desk_token()
    if not expected:
        raise HTTPException(status_code=503, detail="DESK_TOKEN is not configured")
    if not secure_equal(token, expected):
        raise HTTPException(status_code=401, detail="invalid token")


def require_pin(pin: str | None) -> None:
    expected = app_pin()
    if not expected:
        raise HTTPException(status_code=503, detail="APP_PIN is not configured")
    if not secure_equal(pin, expected):
        raise HTTPException(status_code=401, detail="invalid pin")


async def broadcast() -> None:
    payload = json.dumps(public_state(), ensure_ascii=False)
    stale: list[asyncio.Queue] = []
    for queue in list(_subscribers):
        try:
            queue.put_nowait(payload)
        except asyncio.QueueFull:
            stale.append(queue)
    for queue in stale:
        _subscribers.discard(queue)


restore()

app = FastAPI(title="Meme Desk", docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


@app.get("/manifest.webmanifest")
def manifest() -> FileResponse:
    return FileResponse(STATIC / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/sw.js")
def service_worker() -> FileResponse:
    return FileResponse(STATIC / "sw.js", media_type="text/javascript")


@app.get("/icon-192.png")
def icon_192() -> FileResponse:
    return FileResponse(STATIC / "icon-192.png", media_type="image/png")


@app.get("/icon-512.png")
def icon_512() -> FileResponse:
    return FileResponse(STATIC / "icon-512.png", media_type="image/png")


@app.get("/apple-touch-icon.png")
def apple_icon() -> FileResponse:
    return FileResponse(STATIC / "icon-192.png", media_type="image/png")


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "paper_only": True, "has_snapshot": _state["snapshot"] is not None}


@app.get("/api/state")
def get_state() -> JSONResponse:
    return JSONResponse(public_state())


@app.get("/api/stream")
async def stream(request: Request) -> StreamingResponse:
    queue: asyncio.Queue = asyncio.Queue(maxsize=8)
    _subscribers.add(queue)

    async def events():
        try:
            yield f"event: state\ndata: {json.dumps(public_state(), ensure_ascii=False)}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=15)
                    yield f"event: state\ndata: {payload}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            _subscribers.discard(queue)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/ingest")
async def ingest(request: Request, x_desk_token: str | None = Header(default=None)) -> dict[str, Any]:
    require_token(x_desk_token)
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid json") from exc
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="snapshot must be an object")
    async with _lock:
        _state["snapshot"] = body
        _state["ingested_at"] = now_utc_iso()
        _state["ingested_at_cet"] = now_cet()
        persist()
    await broadcast()
    return {"ok": True, "ingested_at_cet": _state["ingested_at_cet"]}


@app.get("/api/control")
def get_control(x_desk_token: str | None = Header(default=None)) -> dict[str, Any]:
    require_token(x_desk_token)
    return {"ok": True, **_state["control"]}


@app.post("/api/control")
async def set_control(request: Request, x_app_pin: str | None = Header(default=None)) -> dict[str, Any]:
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid json") from exc
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="invalid body")
    pin = x_app_pin or body.get("pin")
    require_pin(pin if isinstance(pin, str) else None)
    desired = body.get("desired")
    if desired not in ("run", "stop"):
        raise HTTPException(status_code=400, detail="desired must be 'run' or 'stop'")
    async with _lock:
        _state["control"] = {
            "desired": desired,
            "updated_at_cet": now_cet(),
            "updated_by": "app",
        }
        persist()
    await broadcast()
    return {"ok": True, **_state["control"]}
