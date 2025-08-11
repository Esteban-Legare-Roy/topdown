# Top-Down Shooter Game

A multiplayer top-down shooter game built with **Phaser.js** and **Socket.IO** featuring LAN co-op gameplay, multiple weapons, and boss battles.

## 🎮 Features

- **LAN Multiplayer**: Play with friends on the same network
- **Multiple Weapons**: Pistol (infinite ammo), Shotgun (spread fire), Rifle (fast fire)
- **Combat System**: Dodge rolls with invincibility frames, hit effects, screen shake
- **Level Progression**: Multiple levels with increasing difficulty
- **Boss Battles**: Epic boss fights with bullet-hell patterns
- **Real-time Sync**: Player positions and shots synchronized across network

## 🚀 Quick Start

### Prerequisites
- Node.js (v14 or higher)
- Modern web browser

### Installation
1. Clone the repository:
```bash
git clone <your-repo-url>
cd TopDownGame
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm start
```

4. Open your browser and go to `http://localhost:3000`

### For LAN Play
1. Find your PC's IP address (e.g., `192.168.1.100`)
2. Other players on the same network can join at `http://192.168.1.100:3000`

## 🎯 Controls

- **Movement**: WASD keys
- **Aim**: Mouse
- **Fire**: Left Mouse Button
- **Dodge Roll**: Spacebar
- **Weapon Switch**: 1 (Pistol), 2 (Shotgun), 3 (Rifle)

## 🏗️ Project Structure

```
TopDownGame/
├── public/
│   ├── index.html          # Main game page
│   ├── game.js             # Game logic (Phaser scenes)
│   └── assets/             # Game assets (images, sounds)
├── server.js               # Node.js server with Socket.IO
├── package.json            # Dependencies and scripts
└── README.md              # This file
```

## 🛠️ Development

### Running in Development Mode
```bash
npm run dev
```
This will restart the server automatically when you make changes.

### Adding New Features
- **New Weapons**: Modify the `WEAPONS` object in `game.js`
- **New Levels**: Create new scene classes extending `BaseLevelScene`
- **New Enemies**: Add spawn logic in the `populateLevel` method

## 🌐 Network Architecture

The game uses Socket.IO for real-time communication:
- **Player Join/Leave**: Automatic player synchronization
- **Movement Sync**: Real-time position updates
- **Shooting Sync**: Bullet trajectories synchronized across clients
- **Game State**: Shared game state management

## 📝 License

MIT License - feel free to use this project for learning or commercial purposes.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 🎨 Customization

### Assets
Replace placeholder images in the `assets/` folder:
- `player.png` - Player character sprite
- `enemy.png` - Enemy sprites
- `bullet.png` - Projectile sprites
- `ground.png` - Background tiles

### Tilemaps
The game supports Tiled map editor:
1. Create maps in Tiled
2. Export as JSON
3. Place in `public/maps/`
4. Update tileConfig in scene constructors

---

**Enjoy the game!** 🎮✨
