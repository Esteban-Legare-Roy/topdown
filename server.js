const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static('public'));

// Game state
const gameState = {
  players: {},
  bullets: {},
  enemies: {},
  pickups: {}
};

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
  
  // Handle player join
  socket.on('playerJoin', (playerData) => {
    gameState.players[socket.id] = {
      id: socket.id,
      x: playerData.x || 1000,
      y: playerData.y || 1000,
      tint: playerData.tint || 0x4ec9b0,
      name: playerData.name || 'Player'
    };
    
    // Broadcast to all other players
    socket.broadcast.emit('playerJoined', gameState.players[socket.id]);
    
    // Send current game state to new player
    socket.emit('gameState', gameState);
  });
  
  // Handle player movement
  socket.on('playerMove', (data) => {
    if (gameState.players[socket.id]) {
      gameState.players[socket.id].x = data.x;
      gameState.players[socket.id].y = data.y;
      socket.broadcast.emit('playerMoved', {
        id: socket.id,
        x: data.x,
        y: data.y
      });
    }
  });
  
  // Handle shooting
  socket.on('playerShoot', (bulletData) => {
    const bulletId = Date.now() + Math.random();
    gameState.bullets[bulletId] = {
      id: bulletId,
      x: bulletData.x,
      y: bulletData.y,
      dx: bulletData.dx,
      dy: bulletData.dy,
      speed: bulletData.speed,
      playerId: socket.id
    };
    
    io.emit('bulletFired', gameState.bullets[bulletId]);
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    delete gameState.players[socket.id];
    io.emit('playerLeft', socket.id);
  });
});

// Serve the main game page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} to play locally`);
  console.log(`For LAN play, use your PC's IP address instead of localhost`);
});
