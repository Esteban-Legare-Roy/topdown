const path = require('path');
const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const app = express();
const http = require('http').createServer(app);
const { Server } = require('socket.io');
const io = new Server(http, { cors: { origin: '*' } });

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());
app.use(express.static(path.join(__dirname, 'public')));

let clients = new Map(); // id → state

io.on('connection', (socket) => {
  const isHost = io.engine.clientsCount === 1;
  clients.set(socket.id, { x: 480, y: 320, rot: 0, hp: 6, weapon: 'pistol' });
  socket.emit('welcome', { id: socket.id, isHost });

  socket.on('state', (st) => { const cur = clients.get(socket.id); if (!cur) return; clients.set(socket.id, { ...cur, ...st }); });
  socket.on('fire', (shots) => { if (!Array.isArray(shots)) return; shots.forEach(s => socket.broadcast.emit('remote_fire', s)); });
  socket.on('enemy_fire', (shots) => { socket.broadcast.emit('enemy_fire', shots); });
  socket.on('disconnect', () => { clients.delete(socket.id); });
});

setInterval(() => { const states = Array.from(clients.entries()).map(([id, s]) => ({ id, ...s })); io.emit('peers_state', states); }, 100);

const PORT = process.env.PORT || 3000; http.listen(PORT, () => console.log('Server listening on :' + PORT));
