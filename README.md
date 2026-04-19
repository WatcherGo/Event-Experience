# 🛡️ PromptWar — Real-Time Crowd Orchestration Engine

> **Live Demo:** [https://promptwar-engine-847386568861.us-central1.run.app](https://promptwar-engine-847386568861.us-central1.run.app)

Enhancing the physical event experience at large-scale sporting venues through a dynamic, AI-advised human-sensor network.

---

## 🏟️ Vertical: Physical Event Experience
**Role:** Stadium Crowd Coordinator  
**Problem:** Stadium bottlenecks cause safety risks, fan frustration, and lost revenue. Traditional entry systems are static and "blind" to real-time perimeter surges.
**Solution:** A 4-tier orchestration engine that dynamically routes attendees to the optimal gate in real-time, powered by a FastAPI backend and interactive frontend.

---

## 🧠 Approach & Logic

### 1. The ElasticEntry Algorithm
At the heart of the engine is the **ElasticEntry** algorithm. Unlike simple "nearest gate" logic, it calculates a **Friction Score** for every entry point based on:
- **Load vs. Capacity**: Real-time throughput at the gate.
- **Estimated Transit Velocity**: Derived from A/B scans by the human-sensor network.
- **Divergence Tolerance**: The distance an attendee is willing to move to save time.

### 2. The 4-Tier Human-Sensor Network
- **Host (Command Center)**: Monitors the "Stadium Pulse," views live heatmaps, and dispatches missions to volunteers.
- **Volunteer (Perimeter Sensor)**: Scans ticket QRs at perimeter points to track transit velocity and reports GPS location.
- **Attendee (Client)**: Receives dynamic QR codes and real-time gate re-assignments to avoid bottlenecks.
- **Service Provider (Inbound Logic)**: Updates stall availability (Food/Merch) to help the engine route fans through areas with low congestion.

---

## ⚙️ How the Solution Works

### Technical Stack
- **Frontend**: Vanilla JS, HTML5, CSS3 (Modern, mobile-responsive, zero-dependency).
- **Backend**: **FastAPI (Python)** (Asynchronous, high-concurrency API).
- **Real-Time**: **WebSockets** (Instant broadcasting of bottleneck alerts and mission dispatches).
- **Intelligence**: **Gemini AI Advisor** (Predictive analysis of bottleneck patterns based on current gate loads).

### Execution Flow
1. **Attendee** starts at a perimeter point and scans a QR code (simulated).
2. **Backend** calculates the current velocity of fans from Point A to Point B.
3. If a gate becomes a bottleneck, **WebSockets** broadcast an alert to the **Host**.
4. The **ElasticEntry** algorithm re-routes all incoming attendees to a faster gate.
5. **Host** dispatches a **Volunteer** to the bottleneck zone to assist with crowd flow.

---

## 📋 Assumptions
- **Static Infrastructure**: The stadium layout, gate capacities, and coordinates are pre-configured in `state.py` but can be dynamically updated via API.
- **Volunteer Compliance**: It is assumed that volunteers have GPS-enabled devices to provide perimeter data.
- **Simplified Transit**: Transit time between points is estimated linearly based on the last 10 scans (Velocity Algorithm).

---

## 🚀 Installation & Setup

### Requirements
- Python 3.12+
- Browser with WebSocket support

### Local Run
1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
2. Start Backend:
   ```bash
   uvicorn backend.main:app --reload --port 8000
   ```
3. Start Frontend:
   ```bash
   python -m http.server 3000
   ```
4. Access App: [http://localhost:3000](http://localhost:3000)

---

### *A PromptWar 2026 Challenge Entry*
