// =========================
// Client: Phaser + Socket.IO (LAN Co‑op)
// =========================

console.log('Game script loading...');

// Simple game initialization
const config = {
  type: Phaser.AUTO,
  width: 960,
  height: 540,
  backgroundColor: '#0e0e12',
  physics: { default: 'arcade', arcade: { debug: false } },
  scene: {
    preload: preload,
    create: create,
    update: update
  }
};

let game;
let player;
let cursors;
let socket;

function preload() {
  console.log('Preload started');
  // Load placeholder assets
  this.load.image('player', 'assets/player.png');
  this.load.image('bullet', 'assets/bullet.png');
  this.load.image('enemy', 'assets/enemy.png');
}

function create() {
  console.log('Game scene created!');
  
  // Create a simple player
  player = this.physics.add.sprite(480, 270, 'player');
  player.setScale(10); // Make the tiny placeholder visible
  
  // Add some text to show the game is working
  this.add.text(480, 100, 'GAME LOADED!', { 
    fontSize: '32px', 
    fill: '#fff' 
  }).setOrigin(0.5);
  
  this.add.text(480, 150, 'Use WASD to move', { 
    fontSize: '16px', 
    fill: '#aaa' 
  }).setOrigin(0.5);
  
  // Setup controls
  cursors = this.input.keyboard.createCursorKeys();
  
  // Try to connect to socket
  try {
    socket = io();
    socket.on('connect', () => {
      console.log('Connected to server!');
      this.add.text(480, 200, 'Connected to server!', { 
        fontSize: '16px', 
        fill: '#0f0' 
      }).setOrigin(0.5);
    });
  } catch (e) {
    console.log('Socket connection failed:', e);
  }
}

function update() {
  if (!player) return;
  
  // Simple movement
  const speed = 200;
  if (cursors.left.isDown) {
    player.setVelocityX(-speed);
  } else if (cursors.right.isDown) {
    player.setVelocityX(speed);
  } else {
    player.setVelocityX(0);
  }
  
  if (cursors.up.isDown) {
    player.setVelocityY(-speed);
  } else if (cursors.down.isDown) {
    player.setVelocityY(speed);
  } else {
    player.setVelocityY(0);
  }
}

// Start the game
console.log('About to start Phaser game...');
try {
  if (typeof Phaser === 'undefined') {
    throw new Error('Phaser.js not loaded!');
  }
  
  game = new Phaser.Game(config);
  console.log('Phaser game started successfully!');
} catch (error) {
  console.error('Failed to start game:', error);
  // Fallback: show error on page
  document.body.innerHTML = `
    <div style="color: white; text-align: center; padding: 50px; font-family: Arial, sans-serif;">
      <h1>Game Failed to Load</h1>
      <p>Error: ${error.message}</p>
      <p>Check the browser console for more details.</p>
      <p>Make sure Phaser.js loaded correctly.</p>
    </div>
  `;
}
