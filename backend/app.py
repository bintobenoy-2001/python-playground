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


def build_tutor_prompt(req: "TutorRequest") -> str:
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


@app.post("/api/tutor")
async def tutor(request: TutorRequest) -> dict:
    if not LLM_ENABLED:
        return {
            "enabled": False,
            "answer": (
                "The AI tutor is not configured on this server, so the playground is using its "
                "built-in offline explanations. To enable the AI tutor, set the LLM_API_KEY "
                "environment variable (and optionally LLM_BASE_URL and LLM_MODEL)."
            ),
        }
    payload = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": TUTOR_SYSTEM},
            {"role": "user", "content": build_tutor_prompt(request)},
        ],
        "temperature": 0.3,
        # Headroom for models that spend part of the budget on hidden reasoning tokens
        # before producing the visible answer.
        "max_tokens": 1024,
    }
    headers = {"Authorization": f"Bearer {LLM_API_KEY}", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(
                f"{LLM_BASE_URL.rstrip('/')}/chat/completions", json=payload, headers=headers
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach the LLM provider: {exc}") from exc
    if response.status_code >= 400:
        detail = response.text[:300]
        raise HTTPException(status_code=502, detail=f"LLM provider error ({response.status_code}): {detail}")
    try:
        data = response.json()
        message = data["choices"][0]["message"]
        answer = (message.get("content") or "").strip()
        # Some NVIDIA/reasoning models return the visible text under reasoning_content
        # when content is empty.
        if not answer:
            answer = (message.get("reasoning_content") or "").strip()
    except (KeyError, IndexError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="LLM provider returned an unexpected response.") from exc
    if not answer:
        answer = "The model did not return any text. Try asking again or rephrasing the question."
    return {"enabled": True, "answer": answer, "model": LLM_MODEL}

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
    except asyncio.TimeoutError:
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
