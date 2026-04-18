"""
backend/state.py
Singleton in-memory store seeded with demo data.
In production this would be replaced by Firestore listeners.
Thread-safety is handled via asyncio.Lock used in main.py routes.
"""
from __future__ import annotations
import time
import copy
from backend.models import Gate, GateStatus, Attendee, Volunteer, Stall, Mission, Event, StallStatus

# ── Seed Data ─────────────────────────────────────────────────────────────────
_SEED_EVENT = Event(
    id    = "ipl_2026_rcb_mi",
    name  = "IPL 2026 — RCB vs MI",
    venue = "M. Chinnaswamy Stadium, Bengaluru",
    date  = "Apr 13, 2026 · 19:30 IST",
)

_SEED_GATES = [
    Gate(id="G1", name="Gate 1", direction="North Gate", avg_transit_time=145,
         load=12, capacity=50, status=GateStatus.CLEAR),
    Gate(id="G2", name="Gate 2", direction="South Gate", avg_transit_time=255,
         load=30, capacity=50, status=GateStatus.WARNING),
    Gate(id="G3", name="Gate 3", direction="East Gate",  avg_transit_time=185,
         load=20, capacity=50, status=GateStatus.CLEAR),
    Gate(id="G4", name="Gate 4", direction="West Gate",  avg_transit_time=390,
         load=48, capacity=50, status=GateStatus.BOTTLENECK),
]

_SEED_VOLUNTEERS = [
    Volunteer(id="VOL001", name="Ravi K.",    initials="RK",
              lat=12.9794, lng=77.5996, scan_count=7),
    Volunteer(id="VOL002", name="Priya M.",   initials="PM",
              lat=12.9780, lng=77.6005, scan_count=12),
    Volunteer(id="VOL003", name="Santosh B.", initials="SB",
              lat=12.9802, lng=77.5988, scan_count=4),
]

_SEED_ATTENDEES = [
    Attendee(id="ATT001", name="Arjun S.",  initials="AS"),
    Attendee(id="ATT002", name="Meera R.",  initials="MR"),
    Attendee(id="ATT003", name="Vikram P.", initials="VP"),
    Attendee(id="ATT004", name="Divya L.",  initials="DL"),
    Attendee(id="ATT005", name="Rahul T.",  initials="RT"),
]

_SEED_STALLS = [
    Stall(id="STALL01", name="Blue Café",       zone="North Stand", status=StallStatus.OPEN, wait=5),
    Stall(id="STALL02", name="Spice Corner",    zone="South Stand", status=StallStatus.BUSY, wait=18),
    Stall(id="STALL03", name="Burger Hub",      zone="East Wing",   status=StallStatus.OPEN, wait=8),
    Stall(id="STALL04", name="Chai & Snacks",   zone="West Wing",   status=StallStatus.OPEN, wait=3),
    Stall(id="STALL05", name="RCB Merch Stall", zone="Main Lobby",  status=StallStatus.BUSY, wait=25),
    Stall(id="STALL06", name="Quick Bites",     zone="North Stand", status=StallStatus.OPEN, wait=6),
]


# ── Singleton In-Memory Store ─────────────────────────────────────────────────
class AppState:
    def __init__(self) -> None:
        self.event:         Event               = copy.deepcopy(_SEED_EVENT)
        self.gates:         dict[str, Gate]     = {g.id: copy.deepcopy(g) for g in _SEED_GATES}
        self.volunteers:    dict[str, Volunteer]= {v.id: copy.deepcopy(v) for v in _SEED_VOLUNTEERS}
        self.attendees:     dict[str, Attendee] = {a.id: copy.deepcopy(a) for a in _SEED_ATTENDEES}
        self.stalls:        dict[str, Stall]    = {s.id: copy.deepcopy(s) for s in _SEED_STALLS}
        self.missions:      dict[str, Mission]  = {}
        self.total_entered: int   = 0
        self.total_scans:   int   = 0

    # ── Convenience getters ───────────────────────────────────────────────
    def gate_list(self)      -> list[Gate]:      return list(self.gates.values())
    def volunteer_list(self) -> list[Volunteer]: return list(self.volunteers.values())
    def attendee_list(self)  -> list[Attendee]:  return list(self.attendees.values())
    def stall_list(self)     -> list[Stall]:     return list(self.stalls.values())
    def mission_list(self)   -> list[Mission]:   return list(self.missions.values())

    def reset(self) -> None:
        """Restore seed data — useful for demo resets."""
        self.__init__()


# Module-level singleton
state = AppState()
