from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
RUNNER = Path(__file__).resolve().parent / "tracer_runner.py"
DIST = ROOT / "frontend" / "dist"


def _load_env_file() -> None:
    """Load KEY=VALUE pairs from backend/.env into the environment if present.

    Values already set in the real environment take precedence. This keeps secrets
    out of source and avoids adding python-dotenv as a dependency.
    """
    env_path = Path(__file__).resolve().parent / ".env"
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_env_file()

# Optional LLM tutor. Configured entirely via environment variables (or backend/.env)
# so the project works fully offline by default. Any OpenAI-compatible Chat Completions
# endpoint works: NVIDIA NIM (default), OpenAI, local Ollama/LM Studio, gateways, etc.
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://integrate.api.nvidia.com/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "minimaxai/minimax-m3.1-flash")
LLM_ENABLED = bool(LLM_API_KEY)

app = FastAPI(title="MIMO Python Visual Playground", version="1.0.0")

class TraceRequest(BaseModel):
    code: str = Field(max_length=30000)
    inputs: list[str] = Field(default_factory=list, max_length=30)

class EventContext(BaseModel):
    line: int = 0
    type: str = ""
    source: str = ""
    function: str = ""
    variables: list[dict] = Field(default_factory=list, max_length=60)
    output: str = Field(default="", max_length=4000)
    error: dict | None = None

class TutorRequest(BaseModel):
    code: str = Field(max_length=30000)
    question: str = Field(default="", max_length=600)
    mode: str = Field(default="beginner")  # "beginner" | "technical"
    event: EventContext | None = None
    # Optional per-request provider config supplied by the user's browser. When present,
    # it overrides the server .env defaults. The key is used only to make this one request
    # and is never written to disk or logged.
    provider: str | None = None  # "openai" | "anthropic" | "openrouter" | "nvidia" | "custom"
    apiKey: str | None = Field(default=None, max_length=400)
    model: str | None = Field(default=None, max_length=200)
    baseUrl: str | None = Field(default=None, max_length=400)


# Default base URL per provider. "custom" and the server .env use LLM_BASE_URL.
PROVIDER_BASE_URLS = {
    "openai": "https://api.openai.com/v1",
    "openrouter": "https://openrouter.ai/api/v1",
    "nvidia": "https://integrate.api.nvidia.com/v1",
    "anthropic": "https://api.anthropic.com/v1",
}

# Fallback model per provider, used only when the user did not pick one. Never fall
# back to the server .env model for a *different* provider (that caused OpenRouter to
# receive an NVIDIA model id and reject it).
PROVIDER_DEFAULT_MODELS = {
    "openai": "gpt-4o-mini",
    "openrouter": "openrouter/free",  # OpenRouter's auto-selected free model
    "nvidia": "minimaxai/minimax-m3.1-flash",
    "anthropic": "claude-3-5-haiku-latest",
}


def resolve_model(provider: str, requested: str | None) -> str:
    requested = (requested or "").strip()
    if requested:
        return requested
    if provider in PROVIDER_DEFAULT_MODELS:
        return PROVIDER_DEFAULT_MODELS[provider]
    # server/custom providers fall back to the configured env model
    return LLM_MODEL


class ModelsRequest(BaseModel):
    provider: str | None = None
    apiKey: str | None = Field(default=None, max_length=400)
    baseUrl: str | None = Field(default=None, max_length=400)
    freeOnly: bool = False


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "sandbox": "subprocess", "tutor": "enabled" if LLM_ENABLED else "offline"}


TUTOR_SYSTEM = (
    "You are a patient Python tutor inside a learning playground. You help absolute "
    "beginners understand how their own code runs. Rules: explain in plain language, "
    "be concise (3-6 sentences), reference the actual variable values and line shown, "
    "never invent code the user did not write, and when there is an error, name the most "
    "likely cause and the smallest fix. Do not output large code blocks; prefer one short "
    "corrected line if needed."
)


def build_tutor_prompt(req: TutorRequest) -> str:
    parts = [f"The learner's full program:\n```python\n{req.code}\n```"]
    event = req.event
    if event:
        parts.append(
            f"They are currently paused at line {event.line} "
            f"(a '{event.type}' step in `{event.function or '<module>'}`): `{event.source}`."
        )
        if event.variables:
            shown = ", ".join(
                f"{v.get('name')}={v.get('value')}" for v in event.variables[:12]
            )
            parts.append(f"Current variable values: {shown}.")
        if event.output:
            parts.append(f"Output so far:\n{event.output[-800:]}")
        if event.error:
            parts.append(
                f"An error occurred: {event.error.get('type')}: {event.error.get('message')}."
            )
    question = req.question.strip() or "Explain what is happening at this step and why, for a beginner."
    parts.append(f"The learner asks: {question}")
    style = "Keep it beginner-friendly." if req.mode != "technical" else "A more technical explanation is fine."
    parts.append(style)
    return "\n\n".join(parts)


async def _call_openai_compatible(base_url: str, api_key: str, model: str, prompt: str,
                                  extra_headers: dict[str, str] | None = None) -> str:
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": TUTOR_SYSTEM},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3,
        # Headroom for models that spend part of the budget on hidden reasoning tokens.
        "max_tokens": 1024,
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    if extra_headers:
        headers.update(extra_headers)
    async with httpx.AsyncClient(timeout=45.0) as client:
        response = await client.post(
            f"{base_url.rstrip('/')}/chat/completions", json=payload, headers=headers
        )
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"LLM provider error ({response.status_code}): {response.text[:300]}")
    try:
        message = response.json()["choices"][0]["message"]
        answer = (message.get("content") or "").strip()
        if not answer:  # reasoning models sometimes place text here
            answer = (message.get("reasoning_content") or "").strip()
        return answer
    except (KeyError, IndexError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="LLM provider returned an unexpected response.") from exc


async def _call_anthropic(base_url: str, api_key: str, model: str, prompt: str) -> str:
    payload = {
        "model": model,
        "system": TUTOR_SYSTEM,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 1024,
        "temperature": 0.3,
    }
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    async with httpx.AsyncClient(timeout=45.0) as client:
        response = await client.post(f"{base_url.rstrip('/')}/messages", json=payload, headers=headers)
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Anthropic error ({response.status_code}): {response.text[:300]}")
    try:
        blocks = response.json().get("content", [])
        return "".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Anthropic returned an unexpected response.") from exc


@app.post("/api/tutor")
async def tutor(request: TutorRequest) -> dict:
    # Resolve config: an explicit per-request key (from the browser) wins over the
    # server .env. This lets each user bring their own provider and key.
    provider = (request.provider or "").lower().strip()
    api_key = (request.apiKey or "").strip() or LLM_API_KEY
    if not api_key:
        return {
            "enabled": False,
            "answer": (
                "No AI tutor is configured. Open Settings → AI tutor to paste an API key for "
                "OpenAI, Anthropic, OpenRouter, or NVIDIA, or set the LLM_API_KEY environment "
                "variable on the server. Until then the playground uses its built-in offline "
                "explanations."
            ),
        }

    # Determine base URL and model from the request, provider defaults, or env.
    if request.baseUrl:
        base_url = request.baseUrl.strip()
    elif provider in PROVIDER_BASE_URLS:
        base_url = PROVIDER_BASE_URLS[provider]
    else:
        base_url = LLM_BASE_URL
    model = resolve_model(provider, request.model)

    prompt = build_tutor_prompt(request)
    try:
        if provider == "anthropic":
            answer = await _call_anthropic(base_url, api_key, model, prompt)
        else:
            # OpenRouter benefits from attribution headers; harmless elsewhere.
            extra = {"HTTP-Referer": "https://mimo-playground.local", "X-Title": "MIMO Python Playground"} if provider == "openrouter" else None
            answer = await _call_openai_compatible(base_url, api_key, model, prompt, extra)
    except HTTPException:
        raise
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach the LLM provider: {exc}") from exc

    if not answer:
        answer = "The model did not return any text. Try asking again or rephrasing the question."
    return {"enabled": True, "answer": answer, "model": model, "provider": provider or "server"}


def _is_free(pricing: dict) -> bool:
    try:
        return float(pricing.get("prompt", "1") or "1") == 0.0 and float(pricing.get("completion", "1") or "1") == 0.0
    except (TypeError, ValueError):
        return False


@app.post("/api/tutor/models")
async def tutor_models(request: ModelsRequest) -> dict:
    """List selectable chat models for a provider so the UI can offer a dropdown
    instead of a free-text box. Anthropic has no public list endpoint, so a curated
    set is returned for it."""
    provider = (request.provider or "").lower().strip()
    api_key = (request.apiKey or "").strip() or LLM_API_KEY
    base_url = (request.baseUrl or "").strip() or PROVIDER_BASE_URLS.get(provider, LLM_BASE_URL)

    if provider == "anthropic":
        models = [
            {"id": "claude-3-5-haiku-latest", "name": "Claude 3.5 Haiku (fast, cheap)", "free": False},
            {"id": "claude-3-5-sonnet-latest", "name": "Claude 3.5 Sonnet", "free": False},
            {"id": "claude-3-haiku-20240307", "name": "Claude 3 Haiku", "free": False},
        ]
        return {"models": models}

    headers = {"Content-Type": "application/json"}
    # OpenRouter's /models is public; others need the key.
    if api_key and provider != "openrouter":
        headers["Authorization"] = f"Bearer {api_key}"
    if provider == "openrouter" and api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(f"{base_url.rstrip('/')}/models", headers=headers)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not fetch models: {exc}") from exc
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Model list error ({response.status_code}): {response.text[:200]}")

    rows = response.json().get("data", [])
    models: list[dict] = []
    for row in rows:
        mid = row.get("id")
        if not mid:
            continue
        pricing = row.get("pricing") or {}
        free = _is_free(pricing) or str(mid).endswith(":free")
        models.append({"id": mid, "name": row.get("name") or mid, "free": free})

    if request.freeOnly:
        models = [m for m in models if m["free"]]
    # Free models first, then alphabetical.
    models.sort(key=lambda m: (not m["free"], m["id"].lower()))
    # For OpenRouter, surface the auto free router as a convenient first choice.
    if provider == "openrouter":
        models.insert(0, {"id": "openrouter/free", "name": "Auto: a free model (OpenRouter picks)", "free": True})
    return {"models": models}


@app.post("/api/trace")
async def trace(request: TraceRequest) -> dict:
    try:
        process = await asyncio.create_subprocess_exec(
            sys.executable, "-I", str(RUNNER),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(ROOT),
            env={"PATH": os.environ.get("PATH", ""), "PYTHONIOENCODING": "utf-8"},
        )
        stdout, stderr = await asyncio.wait_for(
            process.communicate(json.dumps(request.model_dump()).encode("utf-8")), timeout=5.0
        )
    except TimeoutError:
        process.kill()
        await process.wait()
        return {"status": "stopped", "events": [], "structure": {"nodes": [], "edges": []}, "output": "", "error": {"type": "Timeout", "message": "Execution exceeded the 5 second server limit."}, "needsInput": None}
    if not stdout:
        detail = stderr.decode("utf-8", "replace")[-1000:] or "Sandbox returned no data"
        raise HTTPException(status_code=500, detail=detail)
    try:
        return json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="Sandbox returned an invalid trace") from exc

if DIST.exists():
    if (DIST / "assets").exists():
        app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    async def spa(path: str):
        candidate = DIST / path
        if path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(DIST / "index.html")
