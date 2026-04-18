"""
backend/test_backend.py
Pytest suite — covers ElasticEntry, VelocityEngine, and every REST endpoint.
Run:
    pip install pytest httpx
    pytest backend/test_backend.py -v
"""
import time
import pytest
from fastapi.testclient import TestClient

# Use the package correctly when run from project root
from backend.main         import app
from backend.state        import state
from backend.elastic_entry import elastic_entry, update_velocity, crowd_density_pct
from backend.models       import Gate, GateStatus


# ── Fixtures ──────────────────────────────────────────────────────────────────
@pytest.fixture(autouse=True)
def reset_state():
    """Restore seed data before every test."""
    state.reset()
    yield


client = TestClient(app)


# ════════════════════════════════════════════════════════════════════════════
# 1. ElasticEntry Algorithm
# ════════════════════════════════════════════════════════════════════════════
class TestElasticEntry:

    def test_picks_clearest_gate(self):
        """G1 (145s, load 12) should beat G2 (255s, load 30) and G3 (185s, load 20)."""
        best, score = elastic_entry(state.gate_list())
        assert best.id == "G1", f"Expected G1, got {best.id}"
        assert score < 300

    def test_excludes_bottleneck(self):
        """G4 is seeded as BOTTLENECK — must never be chosen when alternatives exist."""
        best, _ = elastic_entry(state.gate_list())
        assert best.id != "G4"

    def test_fallback_all_bottlenecked(self):
        """When every gate is bottlenecked, return the one with lowest transit time."""
        for g in state.gates.values():
            g.status = GateStatus.BOTTLENECK
        best, _ = elastic_entry(state.gate_list())
        # G1 has the lowest avg_transit_time (145 s)
        assert best.id == "G1"

    def test_score_is_load_adjusted(self):
        """Increase G1's load to max — G3 should then win."""
        state.gates["G1"].load = 50   # 100 % occupied
        best, _ = elastic_entry(state.gate_list())
        assert best.id != "G1"


# ════════════════════════════════════════════════════════════════════════════
# 2. Velocity Engine
# ════════════════════════════════════════════════════════════════════════════
class TestVelocityEngine:

    def test_status_becomes_warning(self):
        gate = state.gates["G1"]
        result = update_velocity(gate, 250)   # > WARNING_SECS=240
        assert result.new_status == GateStatus.WARNING

    def test_status_becomes_bottleneck(self):
        gate = state.gates["G1"]
        result = update_velocity(gate, 400)   # > BOTTLENECK_SECS=360
        assert result.new_status == GateStatus.BOTTLENECK
        assert result.bottleneck_triggered is True

    def test_rolling_window_cleared(self):
        """Feeding 21 entries should cap history at 20."""
        gate = state.gates["G1"]
        for _ in range(21):
            update_velocity(gate, 100)
        assert len(gate.history) == 20

    def test_no_bottleneck_trigger_if_already_bottlenecked(self):
        gate = state.gates["G4"]   # already bottlenecked
        result = update_velocity(gate, 400)
        assert result.bottleneck_triggered is False

    def test_crowd_density(self):
        gate = state.gates["G1"]   # load=12, capacity=50
        assert crowd_density_pct(gate) == pytest.approx(24.0, rel=0.01)


# ════════════════════════════════════════════════════════════════════════════
# 3. REST Endpoints
# ════════════════════════════════════════════════════════════════════════════
class TestEndpoints:

    # ── Health ────────────────────────────────────────────────────────────
    def test_health(self):
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    # ── Event ─────────────────────────────────────────────────────────────
    def test_get_event(self):
        r = client.get("/event")
        assert r.status_code == 200
        assert r.json()["id"] == "ipl_2026_rcb_mi"

    # ── Gates ─────────────────────────────────────────────────────────────
    def test_list_gates(self):
        r = client.get("/gates")
        assert r.status_code == 200
        assert len(r.json()) == 4

    def test_get_gate(self):
        r = client.get("/gates/G1")
        assert r.status_code == 200
        assert r.json()["id"] == "G1"

    def test_get_gate_not_found(self):
        r = client.get("/gates/ZZZZ")
        assert r.status_code == 404

    def test_gate_density(self):
        r = client.get("/gates/G1/density")
        assert r.status_code == 200
        assert "density_pct" in r.json()

    # ── Attendees ─────────────────────────────────────────────────────────
    def test_list_attendees(self):
        r = client.get("/attendees")
        assert r.status_code == 200
        assert len(r.json()) == 5

    def test_scan_assigns_gate(self):
        r = client.post("/attendees/scan", json={
            "volunteer_id": "VOL001",
            "attendee_id":  "ATT001",
        })
        assert r.status_code == 200
        data = r.json()
        assert data["attendee_id"]      == "ATT001"
        assert data["assigned_gate_id"] in ("G1", "G2", "G3")  # not G4 (bottleneck)
        assert data["assigned_gate_id"] != "G4"

    def test_scan_conflict_second_scan(self):
        """Scanning the same attendee twice should return 409."""
        client.post("/attendees/scan", json={"volunteer_id": "VOL001", "attendee_id": "ATT001"})
        r2 = client.post("/attendees/scan", json={"volunteer_id": "VOL001", "attendee_id": "ATT001"})
        assert r2.status_code == 409

    def test_scan_unknown_attendee(self):
        r = client.post("/attendees/scan", json={"volunteer_id": "VOL001", "attendee_id": "GHOST"})
        assert r.status_code == 404

    def test_entry_updates_velocity(self):
        # First assign a gate
        scan = client.post("/attendees/scan", json={"volunteer_id": "VOL001", "attendee_id": "ATT001"})
        gate_id = scan.json()["assigned_gate_id"]
        r = client.post("/attendees/entry", json={
            "attendee_id": "ATT001",
            "gate_id":     gate_id,
            "transit_secs": 120,
        })
        assert r.status_code == 200
        assert r.json()["ok"] is True

    # ── Volunteers ────────────────────────────────────────────────────────
    def test_list_volunteers(self):
        r = client.get("/volunteers")
        assert r.status_code == 200
        assert len(r.json()) == 3

    def test_register_volunteer(self):
        r = client.post("/volunteers", json={
            "id": "VOL999", "name": "Test V.", "initials": "TV",
            "lat": 12.978, "lng": 77.600,
        })
        assert r.status_code == 200
        assert r.json()["id"] == "VOL999"

    def test_update_volunteer_location(self):
        r = client.patch("/volunteers/VOL001/location?lat=12.9791&lng=77.5999")
        assert r.status_code == 200
        assert state.volunteers["VOL001"].lat == pytest.approx(12.9791)

    # ── Stalls ────────────────────────────────────────────────────────────
    def test_list_stalls(self):
        r = client.get("/stalls")
        assert r.status_code == 200
        assert len(r.json()) == 6

    def test_toggle_stall_status(self):
        r = client.patch("/stalls/STALL01", json={"status": "busy"})
        assert r.status_code == 200
        assert r.json()["status"] == "busy"

    def test_update_stall_wait(self):
        r = client.patch("/stalls/STALL01", json={"wait": 15})
        assert r.status_code == 200
        assert r.json()["wait"] == 15

    # ── Missions ──────────────────────────────────────────────────────────
    def test_dispatch_mission(self):
        r = client.post("/missions", json={"vol_id": "VOL001", "zone": "North Stand"})
        assert r.status_code == 200
        data = r.json()
        assert data["vol_id"] == "VOL001"
        assert data["zone"]   == "North Stand"

    def test_resolve_mission(self):
        post = client.post("/missions", json={"vol_id": "VOL001", "zone": "South Stand"})
        mid  = post.json()["id"]
        r    = client.delete(f"/missions/{mid}")
        assert r.status_code == 200
        assert r.json()["resolved"] == mid

    def test_dispatch_unknown_volunteer(self):
        r = client.post("/missions", json={"vol_id": "GHOST_VOL", "zone": "East Gate"})
        assert r.status_code == 404

    # ── Stats ─────────────────────────────────────────────────────────────
    def test_stats(self):
        r = client.get("/stats")
        assert r.status_code == 200
        data = r.json()
        assert "total_entered"     in data
        assert "avg_wait_secs"     in data
        assert "bottleneck_gates"  in data
        assert "G4" in data["bottleneck_gates"]

    # ── Admin ─────────────────────────────────────────────────────────────
    def test_reset(self):
        # Mutate state
        state.total_entered = 999
        r = client.post("/admin/reset")
        assert r.status_code == 200
        assert state.total_entered == 0
