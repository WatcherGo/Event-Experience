"""
backend/elastic_entry.py
Core algorithmic layer:
  1. ElasticEntry  — picks the optimal gate for each arriving attendee
  2. VelocityEngine — rolling A→B transit window + bottleneck detection
"""
from __future__ import annotations
from typing import List
from backend.models import Gate, GateStatus, VelocityUpdateResponse

# ── Constants ─────────────────────────────────────────────────────────────────
BOTTLENECK_SECS = 360   # 6 min → gate is marked bottleneck
WARNING_SECS    = 240   # 4 min → gate is marked warning
HISTORY_WINDOW  = 20    # keep last N transit samples per gate


# ─────────────────────────────────────────────────────────────────────────────
# 1. ELASTIC ENTRY ALGORITHM
# ─────────────────────────────────────────────────────────────────────────────
def elastic_entry(gates: List[Gate]) -> tuple[Gate, float]:
    """
    Select the best gate for the next incoming attendee.

    Scoring formula (lower = better):
        score = avg_transit_time × (1 + load / max(capacity, 1))

    Bottlenecked gates are excluded unless ALL gates are bottlenecked
    (fallback: pick the one with the shortest raw transit time).

    Returns (best_gate, elastic_score).
    """
    available = [g for g in gates if g.status != GateStatus.BOTTLENECK]

    if not available:
        # Failsafe: every gate is bottlenecked — return least-bad
        best = min(gates, key=lambda g: g.avg_transit_time)
        score = _score(best)
        return best, score

    best = min(available, key=_score)
    return best, _score(best)


def _score(gate: Gate) -> float:
    """Composite load-adjusted transit score (lower is better)."""
    load_ratio = gate.load / max(gate.capacity, 1)
    return gate.avg_transit_time * (1.0 + load_ratio)


# ─────────────────────────────────────────────────────────────────────────────
# 2. A/B VELOCITY ENGINE
# ─────────────────────────────────────────────────────────────────────────────
def update_velocity(gate: Gate, transit_secs: int) -> VelocityUpdateResponse:
    """
    Push a new A→B transit measurement into the gate's rolling history
    and recompute its status.

    Mutates `gate` in-place and returns a VelocityUpdateResponse describing
    what changed (caller is responsible for persisting).
    """
    history = list(gate.history)
    history.append(transit_secs)
    if len(history) > HISTORY_WINDOW:
        history.pop(0)

    avg = round(sum(history) / len(history))

    if avg >= BOTTLENECK_SECS:
        new_status = GateStatus.BOTTLENECK
    elif avg >= WARNING_SECS:
        new_status = GateStatus.WARNING
    else:
        new_status = GateStatus.CLEAR

    bottleneck_triggered = (
        new_status == GateStatus.BOTTLENECK and gate.status != GateStatus.BOTTLENECK
    )

    # Mutate gate
    gate.history          = history
    gate.avg_transit_time = avg
    gate.status           = new_status
    gate.load             = min(gate.load + 1, gate.capacity)

    return VelocityUpdateResponse(
        gate_id              = gate.id,
        new_avg_transit      = avg,
        new_status           = new_status,
        bottleneck_triggered = bottleneck_triggered,
    )


# ─────────────────────────────────────────────────────────────────────────────
# 3. CROWD DENSITY ESTIMATOR (bonus utility)
# ─────────────────────────────────────────────────────────────────────────────
def crowd_density_pct(gate: Gate) -> float:
    """Return gate occupancy as a 0–100 percentage."""
    return round(min(gate.load / max(gate.capacity, 1), 1.0) * 100, 1)


def recommended_diversion(gates: List[Gate], overloaded_gate_id: str) -> Gate | None:
    """
    When a specific gate is overloaded, suggest the best alternative.
    Returns None if no alternative exists.
    """
    alts = [
        g for g in gates
        if g.id != overloaded_gate_id and g.status != GateStatus.BOTTLENECK
    ]
    if not alts:
        return None
    return min(alts, key=_score)
