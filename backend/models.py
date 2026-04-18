"""
backend/models.py
Pydantic v2 data models for PromptWar – Real-Time Crowd Orchestration Engine.
"""
from __future__ import annotations
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field
import time


# ─── Enumerations ────────────────────────────────────────────────────────────

class GateStatus(str, Enum):
    CLEAR      = "clear"
    WARNING    = "warning"
    BOTTLENECK = "bottleneck"


class AttendeeState(str, Enum):
    WAITING      = "waiting"
    GATE_ASSIGNED = "gate_assigned"
    ENTERED      = "entered"


class VolunteerStatus(str, Enum):
    ACTIVE = "active"
    IDLE   = "idle"


class StallStatus(str, Enum):
    OPEN = "open"
    BUSY = "busy"


# ─── Core Domain Models ───────────────────────────────────────────────────────

class Gate(BaseModel):
    id: str
    name: str
    direction: str
    avg_transit_time: int            # seconds
    load: int
    capacity: int
    status: GateStatus = GateStatus.CLEAR
    history: list[int] = Field(default_factory=list)  # rolling window of transit secs


class Attendee(BaseModel):
    id: str
    name: str
    initials: str
    state: AttendeeState = AttendeeState.WAITING
    assigned_gate: Optional[str] = None
    perimeter_ts: Optional[float] = None   # Unix timestamp
    entry_ts: Optional[float] = None
    seat_number: Optional[str] = None


class Volunteer(BaseModel):
    id: str
    name: str
    initials: str
    lat: float
    lng: float
    status: VolunteerStatus = VolunteerStatus.ACTIVE
    mission: Optional[str] = None
    scan_count: int = 0


class Stall(BaseModel):
    id: str
    name: str
    zone: str
    status: StallStatus = StallStatus.OPEN
    wait: int = 5   # minutes


class Mission(BaseModel):
    id: str
    vol_id: str
    vol_name: str
    zone: str
    accepted: bool = False
    ts: float = Field(default_factory=time.time)


class Event(BaseModel):
    id: str
    name: str
    venue: str
    date: str


# ─── Request / Response Schemas ───────────────────────────────────────────────

class ScanRequest(BaseModel):
    volunteer_id: str
    attendee_id: str


class ScanResponse(BaseModel):
    attendee_id: str
    assigned_gate_id: str
    gate_name: str
    gate_direction: str
    est_wait_secs: int
    elastic_score: float


class MissionRequest(BaseModel):
    vol_id: str
    zone: str


class StallUpdateRequest(BaseModel):
    status: Optional[StallStatus] = None
    wait: Optional[int] = None


class EntryRequest(BaseModel):
    attendee_id: str
    gate_id: str
    transit_secs: int


class StatsResponse(BaseModel):
    total_entered: int
    total_scans: int
    active_volunteers: int
    avg_wait_secs: float
    bottleneck_gates: list[str]


class VelocityUpdateResponse(BaseModel):
    gate_id: str
    new_avg_transit: int
    new_status: GateStatus
    bottleneck_triggered: bool


class WSMessage(BaseModel):
    type: str
    payload: dict
    ts: float = Field(default_factory=time.time)
