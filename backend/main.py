"""
backend/main.py
FastAPI application — PromptWar Crowd Orchestration Engine
=========================================================
REST + WebSocket server that backs the frontend web app.

Run from project root:
    uvicorn backend.main:app --reload --port 8000

Docs:
    http://localhost:8000/docs   (Swagger UI)
    http://localhost:8000/redoc  (ReDoc)
"""
from __future__ import annotations

import asyncio
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from backend.elastic_entry import elastic_entry, update_velocity, crowd_density_pct, recommended_diversion
from backend.models import (
    AttendeeState,
    EntryRequest,
    Gate,
    MissionRequest,
    ScanRequest,
    ScanResponse,
    StallUpdateRequest,
    StatsResponse,
    Volunteer,
    VolunteerStatus,
    WSMessage,
)
from backend.state import state


# ══════════════════════════════════════════════════════════════════════════════
# WebSocket Connection Manager
# ══════════════════════════════════════════════════════════════════════════════
class ConnectionManager:
    """Broadcast-channel equivalent for the Python backend."""

    def __init__(self) -> None:
        self._connections: list[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._connections.append(ws)

    def disconnect(self, ws: WebSocket) -> None:
        if ws in self._connections:
            self._connections.remove(ws)

    async def broadcast(self, msg: WSMessage) -> None:
        dead: list[WebSocket] = []
        for ws in self._connections:
            try:
                await ws.send_text(msg.model_dump_json())
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    @property
    def count(self) -> int:
        return len(self._connections)


manager = ConnectionManager()
_lock   = asyncio.Lock()   # protect shared state mutations


# ══════════════════════════════════════════════════════════════════════════════
# App lifecycle
# ══════════════════════════════════════════════════════════════════════════════
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown hooks."""
    print("[OK] PromptWar backend started -> http://localhost:8000/docs")
    yield
    print("[--] PromptWar backend shutting down.")


app = FastAPI(
    title       = "PromptWar — Crowd Orchestration API",
    description = (
        "Real-time crowd management API for large-scale sporting venues. "
        "Implements ElasticEntry routing, A/B velocity tracking, "
        "mission dispatch, and WebSocket push."
    ),
    version     = "1.0.0",
    lifespan    = lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins  = ["*"],   # tightened to internal origins in a real stadium setup
    allow_methods  = ["*"],
    allow_headers  = ["*"],
)

@app.middleware("http")
async def add_security_headers(request, call_next):
    """Add standard security headers to every response."""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    return response


# ══════════════════════════════════════════════════════════════════════════════
# Helper
# ══════════════════════════════════════════════════════════════════════════════
async def _push(event_type: str, payload: dict[str, Any]) -> None:
    """Build a WSMessage and broadcast it to all connected clients."""
    msg = WSMessage(type=event_type, payload=payload)
    await manager.broadcast(msg)


# ══════════════════════════════════════════════════════════════════════════════
# ── WebSocket ────────────────────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    """
    Persistent WebSocket connection for real-time push.
    All state changes broadcast a typed event (same contract as JS BroadcastChannel).
    Clients receive: GATE_UPDATE, ATTENDEE_SCANNED, VOLUNTEER_LOCATION,
                     STALL_UPDATE, MISSION_DISPATCHED, BOTTLENECK_DETECTED, ATTENDEE_ENTERED.
    """
    await manager.connect(ws)
    await ws.send_text(WSMessage(type="CONNECTED", payload={"clients": manager.count}).model_dump_json())
    try:
        while True:
            # Keep-alive: accept pings from client
            data = await ws.receive_text()
            if data == "ping":
                await ws.send_text(WSMessage(type="pong", payload={}).model_dump_json())
    except WebSocketDisconnect:
        manager.disconnect(ws)


# ══════════════════════════════════════════════════════════════════════════════
# ── Event ────────────────────────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/event", tags=["Event"])
async def get_event():
    """Return the current active event details."""
    return state.event


# ══════════════════════════════════════════════════════════════════════════════
# ── Gates ────────────────────────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/gates", response_model=list[Gate], tags=["Gates"])
async def list_gates():
    """Return all gate objects with live load and status."""
    return state.gate_list()


@app.get("/gates/{gate_id}", response_model=Gate, tags=["Gates"])
async def get_gate(gate_id: str):
    gate = state.gates.get(gate_id)
    if not gate:
        raise HTTPException(status_code=404, detail=f"Gate {gate_id!r} not found")
    return gate


@app.get("/gates/{gate_id}/density", tags=["Gates"])
async def gate_density(gate_id: str):
    """Return current crowd density % for one gate."""
    gate = state.gates.get(gate_id)
    if not gate:
        raise HTTPException(status_code=404, detail="Gate not found")
    return {"gate_id": gate_id, "density_pct": crowd_density_pct(gate)}


# ══════════════════════════════════════════════════════════════════════════════
# ── Attendees ─────────────────────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/attendees", tags=["Attendees"])
async def list_attendees():
    return state.attendee_list()


@app.get("/attendees/{att_id}", tags=["Attendees"])
async def get_attendee(att_id: str):
    att = state.attendees.get(att_id)
    if not att:
        raise HTTPException(status_code=404, detail="Attendee not found")
    return att


@app.post("/attendees/scan", response_model=ScanResponse, tags=["Attendees"])
async def scan_attendee(req: ScanRequest):
    """
    Volunteer scans an attendee's QR code at the perimeter.
    Runs ElasticEntry to pick the optimal gate, updates attendee state,
    broadcasts ATTENDEE_SCANNED, and returns the gate assignment.
    """
    async with _lock:
        att = state.attendees.get(req.attendee_id)
        if not att:
            raise HTTPException(status_code=404, detail="Attendee not found")
        if att.state != AttendeeState.WAITING:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Attendee already in state '{att.state}'"
            )

        vol = state.volunteers.get(req.volunteer_id)
        if not vol:
            raise HTTPException(status_code=404, detail="Volunteer not found")

        # ── ElasticEntry ──────────────────────────────────────────────────
        best_gate, score = elastic_entry(state.gate_list())

        # Mutate attendee
        att.state         = AttendeeState.GATE_ASSIGNED
        att.assigned_gate = best_gate.id
        att.perimeter_ts  = time.time()

        # Update gate load
        best_gate.load = min(best_gate.load + 1, best_gate.capacity)

        # Update volunteer scan count
        vol.scan_count += 1
        state.total_scans += 1

    await _push("ATTENDEE_SCANNED", {
        "attendee_id": att.id,
        "gate_id":     best_gate.id,
        "vol_id":      vol.id,
        "score":       round(score, 2),
    })

    return ScanResponse(
        attendee_id     = att.id,
        assigned_gate_id= best_gate.id,
        gate_name       = best_gate.name,
        gate_direction  = best_gate.direction,
        est_wait_secs   = best_gate.avg_transit_time,
        elastic_score   = round(score, 2),
    )


@app.post("/attendees/entry", tags=["Attendees"])
async def record_entry(req: EntryRequest):
    """
    Attendee arrives at the turnstile (gate entry confirmed).
    Updates the A/B velocity engine and marks the attendee as 'entered'.
    Broadcasts GATE_UPDATE (and BOTTLENECK_DETECTED if applicable).
    """
    async with _lock:
        att = state.attendees.get(req.attendee_id)
        if not att:
            raise HTTPException(status_code=404, detail="Attendee not found")
        gate = state.gates.get(req.gate_id)
        if not gate:
            raise HTTPException(status_code=404, detail="Gate not found")

        att.state    = AttendeeState.ENTERED
        att.entry_ts = time.time()
        state.total_entered += 1

        vel = update_velocity(gate, req.transit_secs)

    await _push("ATTENDEE_ENTERED", {"attendee_id": att.id, "gate_id": gate.id})
    await _push("GATE_UPDATE", {
        "gate_id":        vel.gate_id,
        "avg_transit":    vel.new_avg_transit,
        "status":         vel.new_status,
    })

    if vel.bottleneck_triggered:
        # Suggest diversion
        diversion = recommended_diversion(state.gate_list(), gate.id)
        await _push("BOTTLENECK_DETECTED", {
            "gate_id":   gate.id,
            "gate_name": gate.name,
            "diversion": diversion.id if diversion else None,
        })

    return {"ok": True, "velocity": vel}


# ══════════════════════════════════════════════════════════════════════════════
# ── Volunteers ────────────────────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/volunteers", tags=["Volunteers"])
async def list_volunteers():
    return state.volunteer_list()


@app.post("/volunteers", response_model=Volunteer, tags=["Volunteers"])
async def register_volunteer(vol: Volunteer):
    """Register a new volunteer (called from the volunteer's browser on role-select)."""
    async with _lock:
        state.volunteers[vol.id] = vol
    await _push("VOLUNTEER_JOINED", {"vol_id": vol.id, "name": vol.name})
    return vol


@app.patch("/volunteers/{vol_id}/location", tags=["Volunteers"])
async def update_volunteer_location(vol_id: str, lat: float, lng: float):
    """GPS heartbeat — volunteer broadcasts their position every 4 s."""
    async with _lock:
        vol = state.volunteers.get(vol_id)
        if not vol:
            raise HTTPException(status_code=404, detail="Volunteer not found")
        vol.lat    = lat
        vol.lng    = lng
        vol.status = VolunteerStatus.ACTIVE

    await _push("VOLUNTEER_LOCATION", {"vol_id": vol_id, "lat": lat, "lng": lng})
    return {"ok": True}


# ══════════════════════════════════════════════════════════════════════════════
# ── Stalls ───────────────────────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/stalls", tags=["Stalls"])
async def list_stalls():
    return state.stall_list()


@app.patch("/stalls/{stall_id}", tags=["Stalls"])
async def update_stall(stall_id: str, req: StallUpdateRequest):
    """Service provider toggles stall open/busy or adjusts wait time."""
    async with _lock:
        stall = state.stalls.get(stall_id)
        if not stall:
            raise HTTPException(status_code=404, detail="Stall not found")
        if req.status is not None:
            stall.status = req.status
        if req.wait is not None:
            stall.wait = req.wait

    await _push("STALL_UPDATE", {
        "stall_id": stall_id,
        "status":   stall.status,
        "wait":     stall.wait,
    })
    return stall


# ══════════════════════════════════════════════════════════════════════════════
# ── Missions ─────────────────────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/missions", tags=["Missions"])
async def list_missions():
    return state.mission_list()


@app.post("/missions", tags=["Missions"])
async def dispatch_mission(req: MissionRequest):
    """
    Host dispatches a crowd-control mission to a specific volunteer.
    Broadcasts MISSION_DISPATCHED so the volunteer's device gets an alert.
    """
    async with _lock:
        vol = state.volunteers.get(req.vol_id)
        if not vol:
            raise HTTPException(status_code=404, detail="Volunteer not found")

        from .models import Mission
        m = Mission(
            id       = str(uuid.uuid4())[:8].upper(),
            vol_id   = vol.id,
            vol_name = vol.name,
            zone     = req.zone,
        )
        state.missions[m.id] = m
        vol.mission = req.zone

    await _push("MISSION_DISPATCHED", {
        "mission_id": m.id,
        "vol_id":     vol.id,
        "vol_name":   vol.name,
        "zone":       req.zone,
    })
    return m


@app.delete("/missions/{mission_id}", tags=["Missions"])
async def resolve_mission(mission_id: str):
    """Volunteer accepts / host resolves a mission."""
    async with _lock:
        m = state.missions.pop(mission_id, None)
        if not m:
            raise HTTPException(status_code=404, detail="Mission not found")
        vol = state.volunteers.get(m.vol_id)
        if vol:
            vol.mission = None
    return {"ok": True, "resolved": mission_id}


# ══════════════════════════════════════════════════════════════════════════════
# ── Stats Dashboard ───────────────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/stats", response_model=StatsResponse, tags=["Dashboard"])
async def get_stats():
    """Aggregate KPIs used by the Host dashboard."""
    gates       = state.gate_list()
    clear_gates = [g for g in gates if g.status != "bottleneck"]
    avg_wait    = (
        sum(g.avg_transit_time for g in clear_gates) / len(clear_gates)
        if clear_gates else 0.0
    )
    bottlenecks = [g.id for g in gates if g.status == "bottleneck"]
    active_vols = sum(1 for v in state.volunteer_list() if v.status == VolunteerStatus.ACTIVE)

    return StatsResponse(
        total_entered     = state.total_entered,
        total_scans       = state.total_scans,
        active_volunteers = active_vols,
        avg_wait_secs     = round(avg_wait, 1),
        bottleneck_gates  = bottlenecks,
    )


# ══════════════════════════════════════════════════════════════════════════════
# ── Admin ─────────────────────────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════
@app.post("/admin/reset", tags=["Admin"])
async def reset_state():
    """Reset all in-memory state to seed data (demo convenience endpoint)."""
    async with _lock:
        state.reset()
    await _push("STATE_RESET", {})
    return {"ok": True, "message": "State reset to seed data"}


@app.get("/health", tags=["Admin"])
async def health():
    return {
        "status":  "ok",
        "ws_clients": manager.count,
        "gates":      len(state.gates),
        "attendees":  len(state.attendees),
        "volunteers": len(state.volunteers),
    }


# ── Integrated Gateway (For Cloud Run Preview) ─────────────────────
@app.get("/", include_in_schema=False)
async def serve_ui():
    return FileResponse("index.html")

@app.get("/{file_path:path}", include_in_schema=False)
async def serve_assets(file_path: str):
    import os
    if file_path in ["main.js", "styles.css"]:
        if os.path.exists(file_path):
            return FileResponse(file_path)
    raise HTTPException(status_code=404, detail="Not found")
if __name__ == "__main__":
    import sys
    print("\n[!] ERROR: Do not run this file directly with 'python backend/main.py'.")
    print("[!] Instead, run from the project root using uvicorn:")
    print("    uvicorn backend.main:app --reload --port 8000\n")
    sys.exit(1)
