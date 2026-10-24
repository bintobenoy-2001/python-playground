#!/usr/bin/env bash
set -e

PROJECT_DIR="/home/bintobenoy/mimo-python-visual-playground"
URL="http://127.0.0.1:8000"
LOG_FILE="$PROJECT_DIR/server.log"

# Function to check if server is responsive
is_server_ready() {
    curl -s --max-time 1 "$URL/api/health" | grep -q '"status":"ok"'
}

# Start server if not running
if ! is_server_ready; then
    echo "Starting MIMO backend server..."
    cd "$PROJECT_DIR"
    nohup "$PROJECT_DIR/.venv/bin/uvicorn" backend.app:app --host 127.0.0.1 --port 8000 > "$LOG_FILE" 2>&1 &
    
    # Wait for server to become ready (up to 10s)
    RETRIES=20
    while ! is_server_ready; do
        sleep 0.5
        RETRIES=$((RETRIES - 1))
        if [ "$RETRIES" -le 0 ]; then
            echo "Failed to start MIMO server. Check $LOG_FILE for details."
            exit 1
        fi
    done
    echo "Server is ready."
fi

# Open in standalone desktop app window using Chrome if available, otherwise xdg-open
if command -v google-chrome >/dev/null 2>&1; then
    exec google-chrome --app="$URL" "$@"
elif command -v xdg-open >/dev/null 2>&1; then
    exec xdg-open "$URL"
else
    echo "Server is live at $URL"
fi
