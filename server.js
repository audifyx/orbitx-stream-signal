// orbitx-stream-signal — personal WebRTC signaling server.
//
// One broadcaster per room, any number of viewers. NO media passes through
// here: only SDP offers/answers and ICE candidates are relayed between peers.
// Media itself is peer-to-peer (WebRTC) between the broadcaster's phone and
// each viewer's browser.
//
// Deploy: Render free web service (HTTP + WebSocket only).
//   build: npm ci
//   start: node server.js
//   health check: GET /health
// Env: PORT (set by Render), ROOM is chosen by clients (default "live").

const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;

// room name -> { broadcaster: {id, ws} | null, viewers: Map(id -> {id, ws}) }
const rooms = new Map();
let nextId = 1;

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function send(ws, obj) {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  } catch (e) {
    // peer gone; cleanup handles it
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'orbitx-stream-signal', rooms: rooms.size }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  const id = 'p' + (nextId++);
  let room = null;
  let role = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }

    if (msg.type === 'ping') {
      send(ws, { type: 'pong' });
      return;
    }

    if (msg.type === 'join') {
      room = String(msg.room || 'live').slice(0, 64);
      role = msg.role === 'broadcaster' ? 'broadcaster' : 'viewer';
      if (!rooms.has(room)) rooms.set(room, { broadcaster: null, viewers: new Map() });
      const r = rooms.get(room);

      if (role === 'broadcaster') {
        if (r.broadcaster && r.broadcaster.ws !== ws) {
          try { r.broadcaster.ws.close(4000, 'broadcaster replaced'); } catch (e) {}
        }
        r.broadcaster = { id, ws };
        log('broadcaster', id, 'joined room', room);
        for (const v of r.viewers.values()) send(v.ws, { type: 'broadcaster-ready' });
      } else {
        r.viewers.set(id, { id, ws });
        log('viewer', id, 'joined room', room);
        if (r.broadcaster) {
          send(r.broadcaster.ws, { type: 'viewer-joined', viewerId: id });
          send(ws, { type: 'broadcaster-ready' });
        } else {
          send(ws, { type: 'broadcaster-absent' });
        }
      }
      send(ws, { type: 'joined', peerId: id, room, role });
      return;
    }

    // Relay a signaling message to one peer in the same room.
    if (!room || !rooms.has(room)) return;
    const r = rooms.get(room);
    const target =
      msg.to === 'broadcaster' ? r.broadcaster
      : msg.to ? r.viewers.get(msg.to) : null;
    if (target) send(target.ws, { ...msg, from: id });
  });

  const cleanup = () => {
    if (!room || !rooms.has(room)) return;
    const r = rooms.get(room);
    if (role === 'broadcaster' && r.broadcaster && r.broadcaster.id === id) {
      r.broadcaster = null;
      for (const v of r.viewers.values()) send(v.ws, { type: 'broadcaster-left' });
      log('broadcaster', id, 'left room', room);
    } else if (role === 'viewer') {
      r.viewers.delete(id);
      if (r.broadcaster) send(r.broadcaster.ws, { type: 'viewer-left', viewerId: id });
      log('viewer', id, 'left room', room);
    }
    if (!r.broadcaster && r.viewers.size === 0) rooms.delete(room);
  };

  ws.on('close', cleanup);
  ws.on('error', () => {});
});

server.listen(PORT, () => {
  log('orbitx-stream-signal listening on port ' + PORT);
});
