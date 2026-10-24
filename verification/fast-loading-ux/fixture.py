"""Local UI fixtures only. No real accounts, inference, or external actions.

Run on port 3219 and start Next with BACKEND_INTERNAL_URL=http://127.0.0.1:3219.
POST /__state with {"delay": 3, "error": false, "lounge": true} controls reads.
"""
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

state = {"delay": 0, "error": False, "lounge": True}
bot = {"id": "fixture-agent", "name": "Researcher", "role": "Research", "description": "Synthetic UI fixture", "status": "idle", "llm_provider": "openai", "llm_model": "gpt-6.1-sol", "system_prompt": "Synthetic fixture", "tools_enabled": []}
room = {"id": "fixture-room", "title": "Agent lounge", "is_group": True, "bot_ids": [bot["id"]]}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def send_json(self, data, status=200):
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        try:
            self.wfile.write(payload)
        except BrokenPipeError:
            pass

    def do_POST(self):
        if self.path == "/__state":
            state.update(json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0)))))
            self.send_json(state)
        else:
            self.send_json({"detail": "Fixture does not allow actions"}, 405)

    def do_GET(self):
        path = urlsplit(self.path).path.removeprefix("/api")
        current = state.copy()
        if path == "/runtime":
            self.send_json({"model_configured": True, "model_transport": "omniroute"} if not current["error"] else {"detail": "Synthetic runtime unavailable"}, 200 if not current["error"] else 503)
            return
        time.sleep(current["delay"])
        if current["error"]:
            self.send_json({"detail": "Synthetic connection failure. Try again."}, 503)
            return
        data = []
        if path == "/bots":
            data = [bot]
        elif path == "/conversations":
            data = [room] if current["lounge"] else []
        elif path.endswith("/sync"):
            data = {"messages": [{"id": "fixture-message", "conversation_id": room["id"], "sender_type": "bot", "sender_bot_id": bot["id"], "message_type": "text", "content": "**Synthetic fixture.** Your conversation is ready.\n\n- Existing messages remain readable.\n- New panels load when you open them.", "created_at": "2026-10-24T19:00:00Z"}], "tasks": []}
        elif path == "/workspace/runs":
            data = [{"id": "fixture-run", "title": "Review the launch plan (fixture)", "status": "completed", "conversation_id": room["id"], "created_at": "2026-10-24T19:00:00Z"}]
        elif path == "/workspace/settings":
            data = {}
        elif path == "/device/status":
            data = {"enrolled": False}
        elif path == "/plugins/catalog/sync":
            data = None
        elif path == "/accounts/status":
            data = {}
        elif path == "/plugins/catalog":
            data = [{"id": "fixture-service", "name": "Fixture service", "description": "Synthetic service for layout verification.", "category": "Testing", "url": "https://fixture.invalid/mcp", "domains": ["fixture.invalid"]}]
        elif path == "/plugins":
            data = [{"id": "fixture-plugin", "name": "Fixture service", "url": "https://fixture.invalid/mcp", "enabled": True, "authenticated": True, "verification": {"status": "passed", "checked_at": "2026-10-24T19:00:00Z"}, "tools": [{"name": "list_fixture", "description": "Synthetic read-only tool", "enabled": True}]}]
        elif path == "/plugins/directory":
            data = {"items": [], "categories": [], "offset": 0, "limit": 24, "total": 0, "count": 0}
        self.send_json(data)


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 3219), Handler).serve_forever()
