# MIMO Python Visual Playground

**See how Python thinks.** MIMO turns a real Python execution trace into a step-by-step visual story: source line, names and values, heap references, stack frames, output, calls, returns, loops, recursion, and exceptions.

## Architecture

- **Frontend:** React + TypeScript, a dependency-free syntax-aware Python editor, and custom interactive SVG/CSS visualisations. A local zero-install bundler produces the browser build. The trace is immutable and replayed for time travel.
- **Execution API:** FastAPI starts a fresh isolated Python process for every run.
- **Tracing:** `sys.settrace` captures actual `call`, `line`, `return`, and `exception` events. Standard output and controlled `input()` become trace events. AST data adds possible program structure; runtime events show only what actually happened.
- **Safety:** source validation, restricted built-ins/imports, no file/network/process APIs, isolated subprocess, CPU/address-space/file-descriptor/process/output/event/recursion limits, and a server timeout.

> The built-in subprocess isolation is appropriate for local learning and trusted classroom deployments. For a public multi-tenant service, run each trace in a locked-down container or microVM with an unprivileged user, read-only filesystem, seccomp/AppArmor, disabled network, and per-tenant quotas. Python object introspection is not a formal security boundary by itself.

## Run locally

Requirements to run the checked-in build: Python 3.11+. Node.js 20+ is only needed when rebuilding the frontend. The browser build uses no third-party CDN runtime.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.app:app --reload --host 127.0.0.1 --port 8000
```

Open <http://localhost:8000>. Use **Run & visualise** or `Ctrl/Cmd+Enter`.

## Explanations and the optional AI tutor

Every step ships with **context-aware offline explanations** generated from the AST and the real
before/after runtime state (for example, "`total` changed from 30 to 60. Next, Python takes the
next item from the sequence and binds it to `number`."). Common runtime errors also come with a
plain-language hint about the likely cause and smallest fix. These require no network access and run
entirely inside the restricted sandbox.

An **optional AI tutor** lives in the Explain tab. It answers free-form questions about the current
line, value, or error. It runs only in the FastAPI parent process (never inside the sandbox) and is
configured with environment variables or a git-ignored `backend/.env` file. If no key is set, the
playground silently falls back to the offline explanations above.

The default provider is **NVIDIA NIM** (`https://integrate.api.nvidia.com/v1`), which is
OpenAI-compatible, with `minimaxai/minimax-m3.1-flash` as the default model. Any OpenAI-compatible
endpoint also works (OpenAI, local Ollama/LM Studio, gateways) by overriding the base URL and model.

Create `backend/.env` (already in `.gitignore`):

```bash
LLM_API_KEY=nvapi-...                               # your NVIDIA API key
LLM_BASE_URL=https://integrate.api.nvidia.com/v1    # optional (this is the default)
LLM_MODEL=minimaxai/minimax-m3.1-flash              # optional (this is the default)
```

Or export the same variables in your shell before launching uvicorn. Real environment variables take
precedence over the `.env` file.

`GET /api/health` reports `"tutor": "enabled"` or `"offline"` so you can confirm the configuration.

> Not every model listed by `GET /v1/models` is provisioned for every account, some return HTTP 404
> on invocation. `minimaxai/minimax-m3.1-flash` was verified working and fast. Heavy reasoning models
> (e.g. `nvidia/nemotron-3.5-lightning-30b-a3b`) can spend the whole token budget on hidden reasoning
> and return empty visible content; the tutor endpoint falls back to `reasoning_content` when needed.

## Rebuild the frontend

```bash
cd frontend
npm install
npm run build
cd ..
uvicorn backend.app:app --host 0.0.0.0 --port 8000
```

FastAPI serves `frontend/dist` when the production build exists.

## Tests

```bash
pytest backend/tests -q
cd frontend && npm test
cd frontend && npm run build
```

The backend suite covers the supplied arithmetic, loop, condition, function, recursion, shared-reference, exception, input, and transformation programs.

## Supported in v1

- Variables, reassignment, arithmetic, comparisons, Booleans, strings, lists, tuples, dictionaries, sets
- `if` / `elif` / `else`, `for`, `while`, `break`, `continue`
- Functions, parameters, local/global state, returns, recursion
- Standard output and controlled `input()` replay
- Exceptions and `try` / `except`
- Basic classes, instances, attributes, methods, comprehensions
- Safe modules: `math`, `statistics`, `random`, `string`, `collections`, `itertools`, `functools`, `decimal`, `fractions`, `operator`, `re`

## Deliberately unsupported or experimental

- Filesystem, environment, shell/process, socket/network access
- Async execution, threads, multiprocessing
- Third-party/native packages
- Generators are traced at line level but do not yet have a dedicated generator visualisation
- Exact sub-expression tracing is shown through state transitions and source structure; CPython does not expose every intermediate operand through `sys.settrace`
- A breakpoint pauses **trace playback**, not the already completed sandbox process

## Interaction notes

- Editing code invalidates the old trace instead of applying old events to new source.
- Input pauses the user experience; after a value is entered, the restricted process is replayed deterministically with the recorded inputs.
- Use the view switcher without losing the current event: Flow, Memory, Call stack, Data journey, Loop focus, and Recursion.
- Use the inspector for state diffs, heap expansion, frames, beginner explanations, and technical explanations.
- The example library includes beginner, intermediate, and AI-engineering foundations.
