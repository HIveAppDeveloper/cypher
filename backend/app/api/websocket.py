from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict, List
from uuid import UUID
import secrets
from app.config import settings

router = APIRouter()

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[UUID, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, conversation_id: UUID):
        await websocket.accept()
        if conversation_id not in self.active_connections:
            self.active_connections[conversation_id] = []
        self.active_connections[conversation_id].append(websocket)

    def disconnect(self, websocket: WebSocket, conversation_id: UUID):
        if conversation_id in self.active_connections:
            self.active_connections[conversation_id].remove(websocket)

    async def broadcast(self, message: str, conversation_id: UUID):
        if conversation_id in self.active_connections:
            for connection in self.active_connections[conversation_id]:
                await connection.send_text(message)

manager = ConnectionManager()

@router.websocket("/ws/{conversation_id}")
async def websocket_endpoint(websocket: WebSocket, conversation_id: UUID):
    if settings.BACKEND_API_TOKEN and not secrets.compare_digest(websocket.headers.get("authorization", ""), "Bearer " + settings.BACKEND_API_TOKEN):
        await websocket.close(code=1008)
        return
    await manager.connect(websocket, conversation_id)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(websocket, conversation_id)
