
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, {'content-type': 'text/plain'});
    return res.end('ok');
  }
  res.writeHead(404);
  res.end('not found');
});

const wss = new WebSocket.Server({
  server,
  maxPayload: 2048
});

const rooms = new Map();

function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

wss.on('connection', (ws) => {
  ws.id = crypto.randomBytes(8).toString('hex');
  ws.room = null;
  ws.role = null;

  ws.on('message', (raw) => {
    let m;
    try {
      m = JSON.parse(raw.toString());
    } catch {
      return send(ws, {type: 'error', message: 'Invalid JSON'});
    }

    if (m.type === 'join') {
      const room = String(m.room || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 8);

      const role = ['ipad', 'iphone'].includes(m.role)
        ? m.role : null;

      if (room.length < 4 || !role) {
        return send(ws, {type: 'error', message: 'Invalid room or role'});
      }

      if (ws.room) {
        const old = rooms.get(ws.room);
        if (old) {
          old.delete(ws);
          if (!old.size) rooms.delete(ws.room);
        }
      }

      if (!rooms.has(room)) rooms.set(room, new Set());
      const peers = rooms.get(room);

      for (const p of peers) {
        if (p.role === role) {
          return send(ws, {type: 'error', message: 'Role already connected'});
        }
      }

      ws.room = room;
      ws.role = role;
      peers.add(ws);

      send(ws, {type: 'joined', room, role});

      for (const p of peers) {
        send(p, {
          type: 'presence',
          iphone: [...peers].some(x => x.role === 'iphone'),
          ipad: [...peers].some(x => x.role === 'ipad')
        });
      }
      return;
    }

    if (!ws.room) {
      return send(ws, {type: 'error', message: 'Join a room first'});
    }

    if (
      m.type === 'key' &&
      typeof m.key === 'string' &&
      m.key.length <= 20 &&
      typeof m.down === 'boolean'
    ) {
      const peers = rooms.get(ws.room) || new Set();
      for (const p of peers) {
        if (p !== ws && p.role !== ws.role) {
          send(p, {type: 'key', key: m.key, down: m.down});
        }
      }
    }

    if (m.type === 'ping') send(ws, {type: 'pong'});
  });

  ws.on('close', () => {
    if (!ws.room) return;
    const peers = rooms.get(ws.room);
    if (!peers) return;

    peers.delete(ws);

    for (const p of peers) {
      send(p, {
        type: 'presence',
        iphone: [...peers].some(x => x.role === 'iphone'),
        ipad: [...peers].some(x => x.role === 'ipad')
      });
    }

    if (!peers.size) rooms.delete(ws.room);
  });
});

const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => {
  console.log('Alien 3 relay listening on ' + port);
});
