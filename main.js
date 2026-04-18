/* ============================================================
   PROMPTWAR — MAIN APPLICATION LOGIC
   Version: 1.0.0 | Phase 1 MVP
   Demo Mode: BroadcastChannel cross-tab real-time simulation
   ============================================================ */

'use strict';

// ── Constants ────────────────────────────────────────────────
const CHANNEL_NAME    = 'promptwar-v1';
const STATE_KEY       = 'promptwar_state';
const SESSION_KEY     = 'promptwar_session';
const BOTTLENECK_SECS = 360; // 6 minutes
const WARNING_SECS    = 240; // 4 minutes
const GPS_INTERVAL_MS = 4000;
const VOL_SIM_JITTER  = 0.001; // ~100m GPS jitter for simulation

// ── Seed Data ────────────────────────────────────────────────
const SEED_EVENT = {
  id: 'ipl_2026_rcb_mi',
  name: 'IPL 2026 — RCB vs MI',
  venue: 'M. Chinnaswamy Stadium, Bengaluru',
  date: 'Apr 13, 2026 · 19:30 IST',
};

const SEED_GATES = [
  { id: 'G1', name: 'Gate 1',  direction: 'North Gate',  avgTransitTime: 145, load: 12, capacity: 50, status: 'clear',      history: [], svgPct: { x: 50, y: 5 } },
  { id: 'G2', name: 'Gate 2',  direction: 'South Gate',  avgTransitTime: 255, load: 30, capacity: 50, status: 'warning',    history: [], svgPct: { x: 50, y: 95 } },
  { id: 'G3', name: 'Gate 3',  direction: 'East Gate',   avgTransitTime: 185, load: 20, capacity: 50, status: 'clear',      history: [], svgPct: { x: 95, y: 50 } },
  { id: 'G4', name: 'Gate 4',  direction: 'West Gate',   avgTransitTime: 390, load: 48, capacity: 50, status: 'bottleneck', history: [], svgPct: { x: 5,  y: 50 } },
];

const SEED_VOLUNTEERS = [
  { id: 'VOL001', name: 'Ravi K.',    initials: 'RK', lat: 12.9794, lng: 77.5996, status: 'active',   mission: null, scanCount: 7  },
  { id: 'VOL002', name: 'Priya M.',   initials: 'PM', lat: 12.9780, lng: 77.6005, status: 'active',   mission: null, scanCount: 12 },
  { id: 'VOL003', name: 'Santosh B.', initials: 'SB', lat: 12.9802, lng: 77.5988, status: 'idle',     mission: null, scanCount: 4  },
];

const SEED_ATTENDEES = [
  { id: 'ATT001', name: 'Arjun S.',   initials: 'AS', state: 'waiting', assignedGate: null, perimeterTs: null, entryTs: null, seatNumber: null },
  { id: 'ATT002', name: 'Meera R.',   initials: 'MR', state: 'waiting', assignedGate: null, perimeterTs: null, entryTs: null, seatNumber: null },
  { id: 'ATT003', name: 'Vikram P.',  initials: 'VP', state: 'waiting', assignedGate: null, perimeterTs: null, entryTs: null, seatNumber: null },
  { id: 'ATT004', name: 'Divya L.',   initials: 'DL', state: 'waiting', assignedGate: null, perimeterTs: null, entryTs: null, seatNumber: null },
  { id: 'ATT005', name: 'Rahul T.',   initials: 'RT', state: 'waiting', assignedGate: null, perimeterTs: null, entryTs: null, seatNumber: null },
];

const SEED_STALLS = [
  { id: 'STALL01', name: 'Blue Café',       zone: 'North Stand', status: 'open', wait: 5  },
  { id: 'STALL02', name: 'Spice Corner',    zone: 'South Stand', status: 'busy', wait: 18 },
  { id: 'STALL03', name: 'Burger Hub',      zone: 'East Wing',   status: 'open', wait: 8  },
  { id: 'STALL04', name: 'Chai & Snacks',   zone: 'West Wing',   status: 'open', wait: 3  },
  { id: 'STALL05', name: 'RCB Merch Stall', zone: 'Main Lobby',  status: 'busy', wait: 25 },
  { id: 'STALL06', name: 'Quick Bites',     zone: 'North Stand', status: 'open', wait: 6  },
];

// ── Utility ──────────────────────────────────────────────────
function uid()    { return Math.random().toString(36).slice(2, 9).toUpperCase(); }
function now()    { return Date.now(); }
function fmtSecs(s) {
  if (!s || s <= 0) return '—';
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
  const a  = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Toast Notifications ──────────────────────────────────────
const Toast = {
  show(msg, type = 'info', duration = 3500) {
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${msg}</span>`;
    const container = document.getElementById('toast-container');
    container.appendChild(el);
    setTimeout(() => { el.classList.add('toast-exit'); setTimeout(() => el.remove(), 300); }, duration);
  }
};

// ── Backend Configuration ──────────────────────────────────
// For production, replace localhost with your Cloud Run URL
const BACKEND_URL = 'http://localhost:8000';
const API_BASE    = BACKEND_URL; 
const WS_URL      = BACKEND_URL.replace('http', 'ws') + '/ws';

// ══════════════════════════════════════════════════════════════
// BACKEND ENGINE — Connects to FastAPI + WebSocket
// ══════════════════════════════════════════════════════════════
class BackendEngine {
  constructor() {
    this._ws         = null;
    this._listeners  = {};
    this.state       = {
      event: SEED_EVENT,
      gates: [],
      volunteers: [],
      attendees: [],
      stalls: [],
      missions: [],
      totalEntered: 0,
      totalScans: 0,
    };
    this._connectWS();
  }

  async init() {
    await this.refreshState();
  }

  async refreshState() {
    try {
      const [gates, vols, atts, stalls, missions, stats] = await Promise.all([
        this.get('/gates'),
        this.get('/volunteers'),
        this.get('/attendees'),
        this.get('/stalls'),
        this.get('/missions'),
        this.get('/stats')
      ]);
      this.state.gates      = gates;
      this.state.volunteers = vols;
      this.state.attendees  = atts;
      this.state.stalls     = stalls;
      this.state.missions   = missions;
      this.state.totalEntered = stats.total_entered;
      this.state.totalScans   = stats.total_scans;
    } catch (err) {
      console.error('Failed to sync with backend:', err);
    }
  }

  // ── WebSocket ───────────────────────────────────────────
  _connectWS() {
    this._ws = new WebSocket(WS_URL);
    this._ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      this._dispatch(msg);
    };
    this._ws.onclose = () => setTimeout(() => this._connectWS(), 3000);
  }

  _dispatch(msg) {
    const handlers = this._listeners[msg.type] || [];
    handlers.forEach(h => h(msg.payload));
    (this._listeners['*'] || []).forEach(h => h(msg));
  }

  on(type, handler) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(handler);
    return () => { this._listeners[type] = this._listeners[type].filter(h => h !== handler); };
  }

  // ── API Helpers ────────────────────────────────────────
  async get(path) {
    const r = await fetch(`${API_BASE}${path}`);
    if (!r.ok) throw new Error(`GET ${path} failed: ${r.status}`);
    return r.json();
  }

  async post(path, body) {
    const r = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.json();
  }

  async patch(path, body) {
    const r = await fetch(`${API_BASE}${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.json();
  }

  async delete(path) {
    const r = await fetch(`${API_BASE}${path}`, { method: 'DELETE' });
    return r.json();
  }

  // ── Sync with controllers ───────────────────────────────
  getGates()      { return this.state.gates; }
  getVolunteers() { return this.state.volunteers; }
  getAttendees()  { return this.state.attendees; }
  getStalls()     { return this.state.stalls; }
  getMissions()   { return this.state.missions; }

  // These are now handled by API calls in the controllers
  broadcast(type, payload) {
    // In backend mode, broadcasting is usually a side-effect of an API call.
    // But we can manually push if needed.
    console.log(`Local broadcast: ${type}`, payload);
  }

  resetState() { return this.post('/admin/reset', {}); }
}

// ══════════════════════════════════════════════════════════════
// ROUTER
// ══════════════════════════════════════════════════════════════
class Router {
  constructor() {
    this._routes = {};
    window.addEventListener('hashchange', () => this._handle());
  }
  register(path, fn) { this._routes[path] = fn; return this; }
  navigate(path)     { window.location.hash = path; }
  start()            { this._handle(); }
  _handle() {
    const hash    = window.location.hash.split('?')[0] || '#/login';
    const handler = this._routes[hash];
    if (handler) handler();
    else this.navigate('#/login');
  }
}

// ══════════════════════════════════════════════════════════════
// QR CODE RENDERER (uses qrcode.js CDN)
// ══════════════════════════════════════════════════════════════
function renderQR(canvasId, data) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Fallback: draw a simple placeholder pattern if qrcode.js isn't available
  if (typeof QRCode === 'undefined') {
    ctx.fillStyle = '#0d0d20';
    ctx.fillRect(0, 0, 175, 175);
    ctx.fillStyle = '#00E5FF';
    ctx.font = '9px JetBrains Mono';
    ctx.fillText('QR: ' + data.slice(0, 20), 6, 20);
    return;
  }

  // Clear old  
  const tmp = document.createElement('div');
  new QRCode(tmp, {
    text: data,
    width: 175,
    height: 175,
    colorDark: '#F0F2F8',
    colorLight: '#0d0d20',
    correctLevel: QRCode.CorrectLevel.M,
  });
  setTimeout(() => {
    const img = tmp.querySelector('img') || tmp.querySelector('canvas');
    if (img && img.tagName === 'CANVAS') {
      ctx.drawImage(img, 0, 0, 175, 175);
    } else if (img) {
      const i = new Image();
      i.onload = () => ctx.drawImage(i, 0, 0, 175, 175);
      i.src = img.src;
    }
  }, 100);
}

// ══════════════════════════════════════════════════════════════
// SESSION MANAGEMENT
// ══════════════════════════════════════════════════════════════
const Session = {
  get() {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  },
  set(data) { sessionStorage.setItem(SESSION_KEY, JSON.stringify(data)); },
  clear()   { sessionStorage.removeItem(SESSION_KEY); },
};

// ══════════════════════════════════════════════════════════════
// SCREEN MANAGER
// ══════════════════════════════════════════════════════════════
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

// ══════════════════════════════════════════════════════════════
// HOST CONTROLLER
// ══════════════════════════════════════════════════════════════
class HostController {
  constructor(engine) {
    this.engine  = engine;
    this._unsubs = [];
    this._volSimInterval = null;
  }

  init() {
    this._renderGates();
    this._renderVolunteers();
    this._renderMissions();
    this._renderStats();
    this._updateAIReport();
    this._populateMissionVolSelect();
    this._attachEvents();
    this._startVolGpsSim();
    this._subscribeAll();
  }

  destroy() {
    this._unsubs.forEach(fn => fn());
    clearInterval(this._volSimInterval);
  }

  // ── Render ─────────────────────────────────────────────
  _renderGates() {
    const tbody = document.getElementById('host-gate-tbody');
    if (!tbody) return;
    const gates = this.engine.getGates();
    tbody.innerHTML = gates.map(g => {
      const cls  = g.status === 'bottleneck' ? 'row-bottleneck' : g.status === 'warning' ? 'row-warning' : '';
      const tCls = g.status === 'bottleneck' ? 'time-bottleneck' : g.status === 'warning' ? 'time-warning' : 'time-clear';
      const pCls = g.status === 'bottleneck' ? 'pill-bottleneck' : g.status === 'warning' ? 'pill-warning' : 'pill-clear';
      const pTxt = g.status === 'bottleneck' ? '🔴 BOTTLENECK' : g.status === 'warning' ? '🟡 WARNING' : '🟢 CLEAR';
      const loadPct = Math.round((g.load / g.capacity) * 100);
      const loadColor = loadPct > 80 ? 'var(--red)' : loadPct > 55 ? 'var(--amber)' : 'var(--green)';
      return `<tr class="gate-row ${cls}" data-gate="${g.id}">
        <td>
          <div class="gate-name">${g.name}</div>
          <div class="gate-zone">${g.direction}</div>
        </td>
        <td class="gate-time ${tCls}">${fmtSecs(g.avgTransitTime)}</td>
        <td>
          <div class="gate-load-bar">
            <div class="gate-load-fill" style="width:${loadPct}%;background:${loadColor}"></div>
          </div>
          <div style="font-size:0.6rem;color:var(--text-muted);margin-top:2px">${loadPct}%</div>
        </td>
        <td><span class="status-pill ${pCls}">${pTxt}</span></td>
      </tr>`;
    }).join('');
    // Update SVG gates
    gates.forEach(g => {
      const svgEl = document.getElementById(`svg-gate-${g.id}`);
      if (!svgEl) return;
      const rect = svgEl.querySelector('rect');
      if (!rect) return;
      const fill = g.status === 'bottleneck' ? 'rgba(239,68,68,0.85)' : g.status === 'warning' ? 'rgba(245,158,11,0.85)' : 'rgba(16,185,129,0.85)';
      rect.setAttribute('fill', fill);
    });
    document.getElementById('badge-gates').textContent = gates.length;
  }

  _renderVolunteers() {
    const vols = this.engine.getVolunteers();
    const container = document.getElementById('host-vol-dots');
    const listEl    = document.getElementById('host-volunteer-list');
    if (!container) return;

    // Map position dots
    container.innerHTML = vols.map(v => {
      // Map lat/lng to approximate SVG % positions
      // Chinnaswamy: 12.9784, 77.5996 — map center
      const centerLat = 12.9784, centerLng = 77.5996;
      const scale = 20000; // pixels per degree (rough)
      const dx = (v.lng - centerLng) * scale;
      const dy = (v.lat - centerLat) * scale;
      const pctX = Math.max(5, Math.min(95, 50 + dx));
      const pctY = Math.max(5, Math.min(95, 50 - dy));
      const missionClass = v.mission ? 'on-mission' : '';
      return `
        <div class="vol-dot-wrapper" id="vdot-${v.id}" style="left:${pctX}%;top:${pctY}%" title="${v.name}">
          <div class="vol-dot-ring"></div>
          <div class="vol-dot-ring vol-dot-ring-2"></div>
          <div class="vol-dot">${v.initials}</div>
          <div class="vol-dot-label ${missionClass}">${v.name}${v.mission ? ' 🚨' : ''}</div>
        </div>`;
    }).join('');

    // Volunteer list panel
    if (listEl) {
      if (vols.length === 0) {
        listEl.innerHTML = '<div class="empty-state">No volunteers active</div>';
      } else {
        listEl.innerHTML = vols.map(v => `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border)">
            <div style="width:30px;height:30px;border-radius:50%;background:var(--violet-50);border:1px solid var(--violet);display:flex;align-items:center;justify-content:center;font-size:0.62rem;font-weight:700;color:var(--violet);flex-shrink:0">${v.initials}</div>
            <div style="flex:1">
              <div style="font-size:0.8rem;font-weight:600">${v.name}</div>
              <div style="font-size:0.65rem;color:var(--text-muted);font-family:var(--font-mono)">${v.lat.toFixed(4)}, ${v.lng.toFixed(4)}</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px">
              <span style="font-size:0.6rem;font-weight:700;color:${v.status==='active'?'var(--green)':'var(--text-muted)'}">${v.status.toUpperCase()}</span>
              <span style="font-size:0.6rem;color:var(--text-muted)">${v.scanCount} scans</span>
            </div>
          </div>`).join('');
      }
    }
    document.getElementById('badge-volunteers').textContent = vols.length;
  }

  _renderStats() {
    this.engine.get('/stats').then(s => {
      document.getElementById('host-stat-entered').textContent    = s.total_entered;
      document.getElementById('host-stat-volunteers').textContent = s.active_volunteers;
      document.getElementById('host-stat-scans').textContent      = s.total_scans;
      document.getElementById('host-stat-avgwait').textContent = s.avg_wait_secs ? fmtSecs(s.avg_wait_secs) : '—';
    });
  }

  _updateAIReport() {
    const el = document.getElementById('ai-advisor-content');
    if (!el) return;
    
    // Simulate Gemini analysis of current state
    const gates = this.engine.getGates();
    const bottlenecks = gates.filter(g => g.status === 'bottleneck');
    
    if (bottlenecks.length === 0) {
      el.innerHTML = `
        <div class="ai-insight-line">
          <div class="ai-icon">✨</div>
          <div class="ai-text">Gemini Analysis: <em>Optimal flow detected</em>. No active bottlenecks. Capacity utilization at ${Math.round(this.engine.state.totalEntered/20)}%.</div>
        </div>`;
    } else {
      const g = bottlenecks[0];
      el.innerHTML = `
        <div class="ai-insight-line">
          <div class="ai-icon">🧠</div>
          <div class="ai-text">Gemini Insight: High friction at <em>${g.name}</em>. Predicting +15 min wait increase. Recommend <em>Sector ${g.direction}</em> diversion.</div>
        </div>`;
    }
  }

  _renderMissions() {
    const missions = this.engine.getMissions();
    const el = document.getElementById('host-missions-list');
    if (!el) return;
    if (missions.length === 0) {
      el.innerHTML = '<div class="empty-state">No active missions</div>';
    } else {
      el.innerHTML = missions.map(m => `
        <div class="mission-item">
          <div class="mission-urgency">⚡ URGENT</div>
          <div class="mission-vol">${m.volName}</div>
          <div class="mission-zone">📍 ${m.zone}</div>
          <div class="mission-time">${new Date(m.ts).toLocaleTimeString()}</div>
        </div>`).join('');
    }
    document.getElementById('badge-missions').textContent = missions.length;
  }

  _populateMissionVolSelect() {
    const sel = document.getElementById('mission-vol-select');
    if (!sel) return;
    const vols = this.engine.getVolunteers();
    sel.innerHTML = '<option value="">Select volunteer…</option>' +
      vols.map(v => `<option value="${v.id}">${v.name}</option>`).join('');
  }

  // ── Events ─────────────────────────────────────────────
  _attachEvents() {
    document.getElementById('dispatch-mission-btn')?.addEventListener('click', () => {
      const volId  = document.getElementById('mission-vol-select')?.value;
      const zone   = document.getElementById('mission-zone-select')?.value;
      if (!volId || !zone) { Toast.show('Select a volunteer and zone', 'warning'); return; }
      
      this.engine.post('/missions', { vol_id: volId, zone: zone }).then(() => {
        Toast.show(`Mission dispatched successfully`, 'success');
        this._renderMissions();
      });
    });

    document.getElementById('host-logout')?.addEventListener('click', () => app.logout());
  }

  // ── Real-time Subscriptions ────────────────────────────
  _subscribeAll() {
    this._unsubs = [
      this.engine.on('MISSION_DISPATCHED', () => { this._renderMissions(); this._renderVolunteers(); }),
      this.engine.on('VOLUNTEER_LOCATION', () => this._renderVolunteers()),
      this.engine.on('GATE_UPDATE',        () => { this._renderGates(); this._renderStats(); this._updateAIReport(); }),
      this.engine.on('ATTENDEE_SCANNED',   () => { this._renderStats(); }),
      this.engine.on('STALL_UPDATE',        () => {}),
      this.engine.on('BOTTLENECK_DETECTED', (p) => {
        Toast.show(`⚠️ Bottleneck at ${p.gateName}! Rerouting traffic.`, 'error', 5000);
        this._renderGates();
      }),
      this.engine.on('*', () => { this._renderStats(); }),
    ];
  }

  // ── GPS Simulation (volunteer dots drift) ───────────────
  _startVolGpsSim() {
    this._volSimInterval = setInterval(() => {
      const vols = this.engine.getVolunteers();
      vols.forEach(v => {
        if (!v.mission) {
          const jLat = (Math.random() - 0.5) * VOL_SIM_JITTER;
          const jLng = (Math.random() - 0.5) * VOL_SIM_JITTER;
          this.engine.updateVolunteer(v.id, { lat: v.lat + jLat, lng: v.lng + jLng });
        }
      });
      this._renderVolunteers();
    }, 3000);
  }
}

// ══════════════════════════════════════════════════════════════
// ATTENDEE CONTROLLER
// ══════════════════════════════════════════════════════════════
class AttendeeController {
  constructor(engine, session) {
    this.engine  = engine;
    this.session = session;
    this._unsubs = [];
    this.attendeeId = null;
  }

  init() {
    // Register attendee in state
    this.attendeeId = this.session.userId;
    const existing = this.engine.getAttendees().find(a => a.id === this.attendeeId);
    if (!existing) {
      this.engine.state.attendees.push({
        id: this.attendeeId, name: this.session.name, initials: this.session.name.slice(0,2).toUpperCase(),
        state: 'waiting', assignedGate: null, perimeterTs: null, entryTs: null, seatNumber: null,
      });
      this.engine.state._save && this.engine._save();
    }

    this._renderQR();
    this._renderStalls();
    this._restorePhase();
    this._subscribeAll();

    document.getElementById('att-id-display').textContent = `ID: ${this.attendeeId}`;
    document.getElementById('att-simulate-entry-btn')?.addEventListener('click', () => this._simulateEntry());
    document.getElementById('att-seat-save')?.addEventListener('click', () => {
      const seat = document.getElementById('att-seat-input')?.value.trim();
      if (seat) {
        this.engine.updateAttendee(this.attendeeId, { seatNumber: seat });
        Toast.show(`Seat ${seat} saved! 🎉`, 'success');
      }
    });
    document.getElementById('attendee-logout')?.addEventListener('click', () => app.logout());
  }

  destroy() { this._unsubs.forEach(fn => fn()); }

  _renderQR() {
    const data = JSON.stringify({ id: this.attendeeId, event: SEED_EVENT.id, state: 'awaiting_perimeter', ts: now() });
    renderQR('attendee-qr-canvas', data);
  }

  _restorePhase() {
    const att = this.engine.getAttendees().find(a => a.id === this.attendeeId);
    if (!att) return;
    if (att.state === 'entered') {
      this._showPhase('att-phase-stadium');
    } else if (att.state === 'gate_assigned') {
      this._revealGate(att.assignedGate);
    }
  }

  _showPhase(phaseId) {
    document.querySelectorAll('.attendee-phase').forEach(p => p.classList.remove('active'));
    document.getElementById(phaseId)?.classList.add('active');
  }

  _revealGate(gateId) {
    const gate = this.engine.getGates().find(g => g.id === gateId);
    if (!gate) return;
    document.getElementById('att-gate-number').textContent    = gate.id;
    document.getElementById('att-gate-direction').textContent = gate.direction;
    document.getElementById('att-gate-wait').textContent      = `~${fmtSecs(gate.avgTransitTime)} wait`;
    this._showPhase('att-phase-reveal');
    Toast.show(`Gate assigned: ${gate.name} — ${gate.direction}`, 'success');
  }

  _simulateEntry() {
    const att = this.engine.getAttendees().find(a => a.id === this.attendeeId);
    if (!att || !att.assignedGate) return;
    const entryTs = now();
    const delta = att.perimeterTs ? Math.round((entryTs - now()) / 1000) : 200;
    
    this.engine.post('/attendees/entry', {
      attendee_id: this.attendeeId,
      gate_id: att.assignedGate,
      transit_secs: Math.abs(delta) || 120
    }).then(() => {
      this._showPhase('att-phase-stadium');
      this._renderStalls();
      Toast.show('Entry confirmed! Enjoy the match! 🏏', 'success');
    });
  }

  _renderStalls() {
    const grid = document.getElementById('att-stalls-grid');
    if (!grid) return;
    const stalls = this.engine.getStalls();
    grid.innerHTML = stalls.map(s => `
      <div class="stall-card stall-${s.status}">
        <div class="stall-name">${s.name}</div>
        <div class="stall-zone">${s.zone}</div>
        <div class="stall-status-label">${s.status === 'open' ? '🟢 OPEN' : '🔴 BUSY'}</div>
        <div class="stall-wait">${s.wait} min wait</div>
      </div>`).join('');
  }

  _subscribeAll() {
    this._unsubs = [
      this.engine.on('ATTENDEE_SCANNED', (p) => {
        if (p.attendee_id !== this.attendeeId) return;
        const att = this.engine.getAttendees().find(a => a.id === this.attendeeId);
        if (att) {
          att.assignedGate = p.gate_id;
          att.state = 'gate_assigned';
          att.perimeterTs = now();
        }
        this._revealGate(p.gate_id);
      }),
      this.engine.on('STALL_UPDATE', () => this._renderStalls()),
      this.engine.on('ATTENDEE_ENTERED', (p) => {
         if (p.attendee_id === this.attendeeId) this._showPhase('att-phase-stadium');
      }),
    ];
  }
}

// ══════════════════════════════════════════════════════════════
// VOLUNTEER CONTROLLER
// ══════════════════════════════════════════════════════════════
class VolunteerController {
  constructor(engine, session) {
    this.engine      = engine;
    this.session     = session;
    this.volunteerId = session.userId;
    this._unsubs     = [];
    this._gpsWatch   = null;
    this._gpsInterval= null;
    this.scanCount   = 0;
    this.lastGate    = '—';
    this.scanLog     = [];
    this.mode        = 'demo'; // 'demo' | 'camera'
    this._qrReader   = null;
  }

  init() {
    // Register volunteer in backend
    this.engine.post('/volunteers', {
      id: this.volunteerId,
      name: this.session.name,
      initials: this.session.name.slice(0, 2).toUpperCase(),
      lat: 12.9784,
      lng: 77.5996,
      status: 'active'
    });

    document.getElementById('vol-name-display').textContent = this.session.name;
    this._renderScanList();
    this._updateStats();
    this._startGPS();
    this._subscribeAll();
    this._attachEvents();
  }

  destroy() {
    this._unsubs.forEach(fn => fn());
    if (this._gpsWatch !== null) navigator.geolocation.clearWatch(this._gpsWatch);
    clearInterval(this._gpsInterval);
    if (this._qrReader) { try { this._qrReader.stop(); } catch { /* ignore */ } }
  }

  setMode(mode) {
    this.mode = mode;
    document.getElementById('mode-demo-btn').classList.toggle('active', mode === 'demo');
    document.getElementById('mode-camera-btn').classList.toggle('active', mode === 'camera');
    
    document.getElementById('vol-demo-panel').style.display   = mode === 'demo' ? '' : 'none';
    document.getElementById('vol-camera-panel').style.display = mode === 'camera' ? '' : 'none';
    
    if (mode === 'camera') this._startCameraScanner();
    else { if (this._qrReader) { try { this._qrReader.stop(); } catch { /* ignore */ } } }
  }

  triggerMockScan() {
    const statusEl = document.querySelector('.mock-scanner-status span');
    const container = document.querySelector('.mock-scanner-container');
    if (!container) return;

    if (statusEl) statusEl.textContent = 'SCANNING...';
    
    // Simulate thinking/scanning delay
    setTimeout(() => {
      // Find someone to scan (prioritize waiting, then anyone)
      const attendees = this.engine.getAttendees().filter(a => a.state === 'waiting');
      const target = attendees.length > 0 
        ? attendees[Math.floor(Math.random() * attendees.length)]
        : this.engine.getAttendees()[0];

      if (!target) {
        Toast.show('No attendees available to scan', 'warning');
        if (statusEl) statusEl.textContent = 'READY';
        return;
      }
      
      // Success flash animation
      const flash = document.createElement('div');
      flash.className = 'scanner-success-flash flash-active';
      container.appendChild(flash);
      setTimeout(() => flash.remove(), 600);
      
      // Perform the actual scan logic
      this._scanAttendee(target.id);
      
      if (statusEl) statusEl.textContent = 'SUCCESS';
      setTimeout(() => { 
        if (this.mode === 'mock' && statusEl) statusEl.textContent = 'READY'; 
      }, 2000);
    }, 1200);
  }

  _renderScanList() {
    const panel = document.getElementById('vol-demo-panel');
    if (!panel) return;
    const attendees = this.engine.getAttendees();
    if (attendees.length === 0) {
      panel.innerHTML = '<div class="empty-state">No attendees in system yet</div>';
      return;
    }
    panel.innerHTML = attendees.map(a => {
      const scanned  = a.state !== 'waiting';
      const stateCls = a.state === 'entered' ? 'state-entered' : a.state === 'gate_assigned' ? 'state-scanned' : 'state-waiting';
      const stateTxt = a.state === 'entered' ? 'Entered' : a.state === 'gate_assigned' ? `Gate ${a.assignedGate}` : 'Awaiting';
      return `
        <div class="scan-item ${scanned ? 'scanned' : ''}" id="scan-item-${a.id}">
          <div class="scan-item-avatar">${a.initials}</div>
          <div class="scan-item-info">
            <div class="scan-item-name">${a.name}</div>
            <div class="scan-item-id">${a.id}</div>
            <div class="scan-item-state ${stateCls}">${stateTxt}</div>
          </div>
          <button class="scan-btn" onclick="app.vol._scanAttendee('${a.id}')" ${scanned ? 'disabled' : ''}>
            ${scanned ? '✓ Done' : '⚡ SCAN'}
          </button>
        </div>`;
    }).join('');
  }

  _scanAttendee(attendeeId) {
    this.engine.post('/attendees/scan', {
      volunteer_id: this.volunteerId,
      attendee_id: attendeeId
    }).then(res => {
      if (res.detail) { Toast.show(res.detail, 'error'); return; }
      
      this.scanCount++;
      this.lastGate = res.assigned_gate_id;
      
      const logEntry = { attendeeId, name: attendeeId, gateId: res.assigned_gate_id, ts: new Date().toLocaleTimeString() };
      this.scanLog.unshift(logEntry);
      
      this._updateStats();
      this._renderScanLog();
      Toast.show(`✅ Assigned to ${res.gate_name}`, 'success');
    });
  }

  _updateStats() {
    const el1 = document.getElementById('vol-scan-count');
    const el2 = document.getElementById('vol-last-gate');
    if (el1) el1.textContent = this.scanCount;
    if (el2) el2.textContent = this.lastGate;
  }

  _renderScanLog() {
    const el = document.getElementById('vol-scan-log-entries');
    if (!el) return;
    if (this.scanLog.length === 0) {
      el.innerHTML = '<div style="font-size:0.72rem;color:var(--text-muted)">No scans yet</div>';
      return;
    }
    el.innerHTML = this.scanLog.map(e => `
      <div class="scan-log-entry">
        <span>${e.name} → <span class="log-gate">${e.gateId}</span></span>
        <span>${e.ts}</span>
      </div>`).join('');
  }

  _startGPS() {
    const updateGPSUI = (lat, lng) => {
      const el = document.getElementById('vol-gps-coords');
      if (el) el.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      document.getElementById('vol-gps-status').textContent = 'GPS Active';
      document.getElementById('gps-dot').style.background = 'var(--green)';
      
      this.engine.patch(`/volunteers/${this.volunteerId}/location?lat=${lat}&lng=${lng}`, {});
    };

    if ('geolocation' in navigator) {
      this._gpsWatch = navigator.geolocation.watchPosition(
        (pos) => updateGPSUI(pos.coords.latitude, pos.coords.longitude),
        () => this._startGPSSim(),
        { enableHighAccuracy: true, maximumAge: 5000 }
      );
    } else {
      this._startGPSSim();
    }
  }

  _startGPSSim() {
    // Simulate GPS near Chinnaswamy
    let lat = 12.9784 + (Math.random() - 0.5) * 0.003;
    let lng = 77.5996 + (Math.random() - 0.5) * 0.003;
    const el = document.getElementById('vol-gps-coords');
    if (el) el.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)} (sim)`;
    this._gpsInterval = setInterval(() => {
      lat += (Math.random() - 0.5) * VOL_SIM_JITTER;
      lng += (Math.random() - 0.5) * VOL_SIM_JITTER;
      if (el) el.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)} (sim)`;
      this.engine.patch(`/volunteers/${this.volunteerId}/location?lat=${lat}&lng=${lng}`, {});
    }, GPS_INTERVAL_MS);
  }

  _startCameraScanner() {
    if (typeof Html5Qrcode === 'undefined') {
      Toast.show('Camera scanner requires HTTPS & html5-qrcode library', 'warning');
      return;
    }
    this._qrReader = new Html5Qrcode('vol-qr-reader');
    this._qrReader.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: 220 },
      (decodedText) => {
        try {
          const data = JSON.parse(decodedText);
          if (data.id) this._scanAttendee(data.id);
        } catch { Toast.show('Invalid QR code', 'error'); }
      },
      () => {}
    ).catch(() => Toast.show('Camera access denied — use Demo mode', 'warning'));
  }

  _attachEvents() {
    document.getElementById('vol-mission-accept')?.addEventListener('click', () => {
      const banner = document.getElementById('vol-mission-banner');
      if (banner) banner.style.display = 'none';
      const missions = this.engine.getMissions();
      const mine = missions.find(m => m.volId === this.volunteerId);
      if (mine) this.engine.delete(`/missions/${mine.id}`);
      Toast.show('Mission accepted — en route 🏃', 'info');
    });
    document.getElementById('volunteer-logout')?.addEventListener('click', () => app.logout());
  }

  _subscribeAll() {
    this._unsubs = [
      this.engine.on('MISSION_DISPATCHED', (m) => {
        if (m.volId !== this.volunteerId) return;
        document.getElementById('vol-mission-title').textContent = `Mission: ${m.zone}`;
        document.getElementById('vol-mission-desc').textContent  = `Report to ${m.zone} immediately for crowd control.`;
        const banner = document.getElementById('vol-mission-banner');
        if (banner) banner.style.display = 'flex';
        Toast.show(`🚨 Mission assigned: ${m.zone}`, 'warning', 5000);
      }),
      this.engine.on('ATTENDEE_SCANNED', () => this._renderScanList()),
      this.engine.on('ATTENDEE_ENTERED',  () => this._renderScanList()),
    ];
  }
}

// ══════════════════════════════════════════════════════════════
// PROVIDER CONTROLLER
// ══════════════════════════════════════════════════════════════
class ProviderController {
  constructor(engine, session) {
    this.engine  = engine;
    this.session = session;
    this._unsubs = [];
  }

  init() {
    document.getElementById('prov-name-display').textContent = this.session.name;
    this._renderStalls();
    this._subscribeAll();
    document.getElementById('provider-logout')?.addEventListener('click', () => app.logout());
  }

  destroy() { this._unsubs.forEach(fn => fn()); }

  _renderStalls() {
    const grid = document.getElementById('provider-stalls-grid');
    if (!grid) return;
    const stalls = this.engine.getStalls();
    grid.innerHTML = stalls.map(s => {
      const isOpen = s.status === 'open';
      return `
        <div class="provider-stall-card status-${s.status}" id="prov-card-${s.id}">
          <div class="prov-stall-info">
            <div class="prov-stall-name">${s.name}</div>
            <div class="prov-stall-zone">📍 ${s.zone}</div>
            <div class="prov-stall-wait">
              ⏱ Wait:
              <select class="wait-select" onchange="app.prov._updateWait('${s.id}', this.value)">
                ${[3,5,8,10,15,20,30].map(v => `<option value="${v}" ${s.wait==v?'selected':''}>${v} min</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="big-toggle-wrapper">
            <div class="big-toggle ${isOpen ? 'on' : 'off'}" id="toggle-${s.id}" onclick="app.prov._toggleStall('${s.id}')">
              <div class="big-toggle-knob"></div>
            </div>
            <div class="big-toggle-label" id="toggle-label-${s.id}">${isOpen ? 'OPEN' : 'BUSY'}</div>
          </div>
        </div>`;
    }).join('');
  }

  _toggleStall(stallId) {
    const stall = this.engine.getStalls().find(s => s.id === stallId);
    if (!stall) return;
    const newStatus = stall.status === 'open' ? 'busy' : 'open';
    this.engine.patch(`/stalls/${stallId}`, { status: newStatus });

    // Animate toggle
    const toggle = document.getElementById(`toggle-${stallId}`);
    const label  = document.getElementById(`toggle-label-${stallId}`);
    const card   = document.getElementById(`prov-card-${stallId}`);
    if (toggle) { toggle.classList.toggle('on', newStatus === 'open'); toggle.classList.toggle('off', newStatus !== 'open'); }
    if (label)  label.textContent = newStatus === 'open' ? 'OPEN' : 'BUSY';
    if (card)   { card.classList.toggle('status-open', newStatus === 'open'); card.classList.toggle('status-busy', newStatus !== 'open'); }

    Toast.show(`${stall.name} is now ${newStatus.toUpperCase()}`, newStatus === 'open' ? 'success' : 'warning');
  }

  _updateWait(stallId, wait) {
    this.engine.patch(`/stalls/${stallId}`, { wait: Number(wait) });
  }

  _subscribeAll() {
    this._unsubs = [
      this.engine.on('STALL_UPDATE', (p) => {
        // Re-render only changed card if needed
        const stall = this.engine.getStalls().find(s => s.id === p.stallId);
        if (!stall) return;
        const card = document.getElementById(`prov-card-${p.stallId}`);
        if (card) {
          const toggle = card.querySelector(`#toggle-${p.stallId}`);
          if (toggle) { toggle.classList.toggle('on', stall.status==='open'); toggle.classList.toggle('off', stall.status!=='open'); }
        }
      }),
    ];
  }
}

// ══════════════════════════════════════════════════════════════
// APPLICATION
// ══════════════════════════════════════════════════════════════
const app = (() => {
  const engine = new BackendEngine();
  const router = new Router();
  let host = null, att = null, vol = null, prov = null;

  const self = {
    vol:  null,
    prov: null,
    logout,
    engine,
    boot
  };

  function logout() {
    if (host) { host.destroy(); host = null; }
    if (att)  { att.destroy();  att  = null; }
    if (vol)  { vol.destroy();  vol  = null; }
    if (prov) { prov.destroy(); prov = null; }
    self.vol  = null;
    self.prov = null;
    Session.clear();
    router.navigate('#/login');
  }

  function initLogin() {
    showScreen('screen-login');
    let selectedRole = null;
    const cards = document.querySelectorAll('.role-card');
    const enterBtn = document.getElementById('login-enter-btn');

    cards.forEach(card => {
      card.addEventListener('click', () => {
        cards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedRole = card.dataset.role;
        enterBtn.disabled = false;
        enterBtn.textContent = `Enter as ${capitalize(selectedRole)} →`;
      });
    });

    enterBtn.addEventListener('click', () => {
      if (!selectedRole) return;
      const names = { host: 'Event Host', attendee: `Visitor ${uid().slice(0,4)}`, volunteer: `Vol. ${uid().slice(0,3)}`, provider: 'Stall Operator' };
      const userId = selectedRole === 'host' ? 'HOST_001' : `${selectedRole.toUpperCase()}_${uid()}`;
      Session.set({ role: selectedRole, userId, name: names[selectedRole] });
      router.navigate(`#/${selectedRole}`);
    });
  }

  function initHost() {
    if (host) { host.destroy(); }
    showScreen('screen-host');
    host = new HostController(engine);
    host.init();
  }

  function initAttendee() {
    const session = Session.get();
    if (!session) { router.navigate('#/login'); return; }
    showScreen('screen-attendee');
    if (att) { att.destroy(); }
    att = new AttendeeController(engine, session);
    att.init();
  }

  function initVolunteer() {
    const session = Session.get();
    if (!session) { router.navigate('#/login'); return; }
    showScreen('screen-volunteer');
    if (vol) { vol.destroy(); }
    vol = new VolunteerController(engine, session);
    vol.init();
    self.vol = vol;
  }

  function initProvider() {
    const session = Session.get();
    if (!session) { router.navigate('#/login'); return; }
    showScreen('screen-provider');
    if (prov) { prov.destroy(); }
    prov = new ProviderController(engine, session);
    prov.init();
    self.prov = prov;
  }

  // ── Boot ─────────────────────────────────────────────────
  function boot() {
    router
      .register('#/login',     initLogin)
      .register('#/host',      initHost)
      .register('#/attendee',  initAttendee)
      .register('#/volunteer', initVolunteer)
      .register('#/provider',  initProvider);

    // Show loading briefly, then boot engine, then route
    setTimeout(async () => {
      await engine.init();
      const session = Session.get();
      if (session && session.role) {
        router.navigate(`#/${session.role}`);
      } else {
        router.navigate('#/login');
      }
      router.start();
    }, 800);
  }

  return self;
})();

// ── Helpers ──────────────────────────────────────────────────
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

// Expose for inline onclick handlers
window.app = app;

// ── Start ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => app.boot());
