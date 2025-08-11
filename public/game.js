// =========================
// Client: Phaser + Socket.IO (LAN Co‑op)
// =========================
// Put this file as public/game.js and include in index.html like:
// <script src="https://cdn.jsdelivr.net/npm/phaser@3/dist/phaser.js"></script>
// <script src="/socket.io/socket.io.js"></script>
// <script type="module" src="/game.js"></script>

/*
  LAN Co‑op How-To
  1) Run the Node server below (server.js). It serves the static files and manages sockets.
  2) Both players open http://YOUR_PC_IP:3000 on the same LAN Wi‑Fi.
  3) You now see each other as separate colored players.

  Local Controls
  ──────────────
  Move:  WASD (local), Arrows (optional local test)  
  Aim:   Mouse  
  Fire:  Left Mouse  
  Dodge Roll:  SPACE (i‑frames)  

  New Features
  ────────────
  • LAN co‑op via Socket.IO (position + shots synced)
  • Weapons: pistol (∞), shotgun (spread, ammo), rifle (fast, ammo)
  • Hit FX: screenshake, muzzle sparks, hit sparks, brief freeze
  • Dodge roll with invincibility frames + cooldown
  • Player i‑frames on damage
  • Tilemap support (Tiled .json) with collision (optional fallback)
  • Boss in Level 2 with bullet-hell patterns + phase change
*/

// ===============
// Utility structs
// ===============
class Weapon {
  constructor(key, fireDelayMs, bulletSpeed, bulletsPerShot = 1, spreadDeg = 0, ammo = Infinity) {
    this.key = key; this.fireDelayMs = fireDelayMs; this.bulletSpeed = bulletSpeed;
    this.bulletsPerShot = bulletsPerShot; this.spreadDeg = spreadDeg; this.ammo = ammo;
  }
}

const WEAPONS = {
  pistol:  new Weapon('pistol', 180, 560, 1, 0, Infinity),
  shotgun: new Weapon('shotgun', 620, 560, 6, 22, 36),
  rifle:   new Weapon('rifle', 90, 760, 1, 0, 140)
};

// =====================
// Shared base level scene
// =====================
class BaseLevelScene extends Phaser.Scene {
  constructor(key, nextKey, tileConfig) { super(key); this.sceneKey = key; this.nextKey = nextKey; this.tileConfig = tileConfig; }

  preload() {
    // Placeholder art — swap with your spritesheets
    this.load.image('player', 'assets/player.png');
    this.load.image('bullet', 'assets/bullet.png');
    this.load.image('enemy', 'assets/enemy.png');
    this.load.image('boss', 'assets/enemy.png');
    this.load.image('pickup', 'assets/gun.png');
    this.load.image('fallbackGround', 'assets/ground.png');
    this.load.image('exit', 'assets/ground.png');

    // Tilemap (optional):
    // Provide: public/tiles/roguelike.png and public/maps/levelX.json exported from Tiled.
    if (this.tileConfig) {
      const { tilesetKey, tilesetPNG, mapKey, mapJSON } = this.tileConfig;
      this.load.image(tilesetKey, tilesetPNG);           // e.g., 'tileset', 'tiles/roguelike.png'
      this.load.tilemapTiledJSON(mapKey, mapJSON);       // e.g., 'map1', 'maps/level1.json'
    }

    // Particles
    this.load.image('spark', 'assets/bullet.png'); // tiny placeholder
    this.load.image('muzzle', 'assets/bullet.png');
  }

  create() {
    // Socket
    this.socket = window.io();
    this.playerId = null; this.peers = {};

    // Map or fallback ground
    this.createMapOrFallback();

    // Physics bounds (match map or fallback)
    const bounds = this.worldBounds || new Phaser.Geom.Rectangle(0,0,2000,2000);
    this.physics.world.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);

    // Input
    this.pointer = this.input.activePointer;
    this.keysP1 = this.input.keyboard.addKeys({ up: 'W', left: 'A', down: 'S', right: 'D', roll: 'SPACE' });

    // Gamepad
    this.pad = null; this.input.gamepad.once('connected', (pad) => { this.pad = pad; });

    // Players
    this.players = [];
    const me = this.spawnPlayer(bounds.centerX, bounds.centerY, 0x4ec9b0); // local
    me.isLocal = true; me.name = 'local'; this.players.push(me);

    // Camera
    this.cameras.main.startFollow(me, true, 0.15, 0.15);
    this.cameras.main.setZoom(1.6);

    // FX systems
    this.fx = {
      sparks: this.add.particles(0,0,'spark').setDepth(10),
      muzzle: this.add.particles(0,0,'muzzle').setDepth(10)
    };

    // Groups
    this.playerBullets = this.physics.add.group({ classType: Phaser.Physics.Arcade.Image, runChildUpdate: false, maxSize: 700 });
    this.enemyBullets  = this.physics.add.group({ classType: Phaser.Physics.Arcade.Image, runChildUpdate: false, maxSize: 700 });
    this.pickups = this.physics.add.group();
    this.enemies = this.physics.add.group();

    // Colliders / overlaps
    this.players.forEach(p => {
      p.setCollideWorldBounds(true);
      if (this.solidLayer) this.physics.add.collider(p, this.solidLayer);
      this.physics.add.overlap(this.enemyBullets, p, (bullet, player) => {
        bullet.disableBody(true, true);
        this.damagePlayer(player, 1);
      });
      this.physics.add.overlap(p, this.pickups, (player, pickup) => this.onPickup(player, pickup));
    });

    if (this.solidLayer) this.physics.add.collider(this.enemies, this.solidLayer);

    this.physics.add.overlap(this.playerBullets, this.enemies, (bullet, enemy) => {
      bullet.disableBody(true, true);
      this.hitSpark(bullet.x, bullet.y);
      enemy.hp -= 1; if (enemy.hp <= 0) enemy.destroy();
      this.smallFreeze();
    });

    // Populate
    this.populateLevel();

    // Exit pad
    this.exitPad = this.physics.add.staticSprite(bounds.width - 180, bounds.height - 180, 'exit').setScale(0.5);
    this.exitPad.alpha = 0.25; if (this.solidLayer) this.exitPad.setDepth(5);
    this.physics.add.overlap(me, this.exitPad, () => this.tryAdvanceLevel());

    // Enemy fire timer (host-ish)
    this.isHost = false; // server tells us
    this.enemyTimer = this.time.addEvent({ delay: 1100, loop: true, callback: () => { if (this.isHost || !this.playerId) this.enemiesFire(); } });

    // Socket wiring
    this.setupSocket();
  }

  // ---------- Map helpers ----------
  createMapOrFallback() {
    const cfg = this.tileConfig;
    if (cfg && this.cache.tilemap.exists(cfg.mapKey)) {
      const map = this.make.tilemap({ key: cfg.mapKey });
      const tiles = map.addTilesetImage(cfg.tilesetName || 'tiles', cfg.tilesetKey);
      const bg = map.createLayer(cfg.bgLayer || 'bg', tiles, 0, 0); if (bg) bg.setDepth(0);
      const solids = map.createLayer(cfg.solidLayer || 'solid', tiles, 0, 0);
      if (solids) { solids.setCollisionByProperty({ collides: true }); this.solidLayer = solids; solids.setDepth(1); }
      this.worldBounds = new Phaser.Geom.Rectangle(0, 0, map.widthInPixels, map.heightInPixels);
    } else {
      // Fallback ground
      this.add.tileSprite(0, 0, 2000, 2000, 'fallbackGround').setOrigin(0).setDepth(0);
      this.worldBounds = new Phaser.Geom.Rectangle(0,0,2000,2000);
    }
  }

  // ---------- Population ----------
  populateLevel() {
    // Enemies
    const enemyCount = this.sceneKey === 'Level2' ? 10 : 8;
    for (let i = 0; i < enemyCount; i++) {
      const x = Phaser.Math.Between(200, this.worldBounds.width - 200);
      const y = Phaser.Math.Between(200, this.worldBounds.height - 200);
      this.enemies.add(this.spawnEnemy(x, y));
    }
    // Boss only in Level 2
    if (this.sceneKey === 'Level2') {
      this.boss = this.spawnBoss(this.worldBounds.width * 0.7, this.worldBounds.height * 0.4);
    }
    // Pickups
    this.spawnPickups();
  }

  // ---------- Entities ----------
  spawnPlayer(x, y, tint) {
    const p = this.physics.add.sprite(x, y, 'player');
    p.setTint(tint); p.speed = 240; p.baseSpeed = 240; p.hp = 6; p.lastFired = 0;
    p.weaponKey = 'pistol'; p.weapon = WEAPONS[p.weaponKey];
    p.roll = { cooldownMs: 900, rollingMs: 320, invulnMs: 380, speedMult: 3.1, lastEnd: -9999, isRolling: false, dir: new Phaser.Math.Vector2(1,0) };
    p.invulnUntil = 0;
    return p;
  }

  spawnEnemy(x, y) {
    const e = this.physics.add.sprite(x, y, 'enemy');
    e.speed = 90; e.hp = 3; e.shootEvery = 1600 + Phaser.Math.Between(-400, 400); return e;
  }

  spawnBoss(x, y) {
    const b = this.physics.add.sprite(x, y, 'boss').setScale(1.3);
    b.speed = 80; b.maxHp = 80; b.hp = b.maxHp; b.phase = 1; b.nextPatternAt = 0;
    this.enemies.add(b); b.isBoss = true; return b;
  }

  spawnPickups() {
    const types = ['shotgun', 'rifle', Math.random() < 0.5 ? 'shotgun' : 'rifle'];
    const spots = [ [300, this.worldBounds.height-300], [this.worldBounds.width-300, 300], [this.worldBounds.centerX, this.worldBounds.centerY] ];
    types.forEach((t, i) => {
      const s = this.physics.add.staticSprite(spots[i][0], spots[i][1], 'pickup');
      s.pickupWeapon = t; s.alpha = 0.9; this.pickups.add(s);
    });
  }

  // ---------- Net ----------
  setupSocket() {
    this.socket.on('welcome', (data) => { this.playerId = data.id; this.isHost = data.isHost; });

    this.socket.on('peers_state', (states) => {
      states.forEach(s => {
        if (s.id === this.playerId) return; let sprite = this.peers[s.id];
        if (!sprite) { sprite = this.spawnPlayer(s.x || this.worldBounds.centerX, s.y || this.worldBounds.centerY, 0xf78c6c); sprite.isLocal = false; this.peers[s.id] = sprite; this.players.push(sprite); }
        sprite.setPosition(s.x, s.y); sprite.setRotation(s.rot || 0); sprite.hp = s.hp ?? sprite.hp; sprite.weaponKey = s.weapon || sprite.weaponKey;
      });
      Object.keys(this.peers).forEach(id => { if (!states.find(s => s.id === id)) { this.peers[id].destroy(); delete this.peers[id]; } });
    });

    this.socket.on('remote_fire', (payload) => { if (!payload) return; this.spawnBullet(payload.x, payload.y, payload.dx, payload.dy, payload.speed, this.playerBullets, true); });
    this.socket.on('enemy_fire', (list) => { list.forEach(p => this.spawnBullet(p.x, p.y, p.dx, p.dy, p.speed, this.enemyBullets, true)); });
  }

  // ---------- Update ----------
  update(time, delta) {
    const me = this.players.find(p => p.isLocal); if (!me) return;

    // Movement & roll
    this.updateMovementAndRoll(me, time);

    // Aim
    const aim = new Phaser.Math.Vector2(this.pointer.worldX - me.x, this.pointer.worldY - me.y);
    if (aim.lengthSq() > 0.0001) {
      me.setRotation(aim.angle());
      me.roll.dir.copy(aim).normalize();
    }

    // Fire
    if (this.pointer.isDown) this.tryFire(me, aim, time);

    // Enemy steering
    this.enemies.children.iterate((e) => {
      if (!e) return; const target = this.getNearestPlayer(e); if (!target) return;
      this.physics.moveToObject(e, target, e.isBoss ? e.speed * 0.8 : e.speed);
    });

    // Boss patterns (host-ish)
    if (this.isHost || !this.playerId) this.updateBossPatterns(time);

    // State sync (10/s)
    if (!this._lastSync || time - this._lastSync > 100) {
      this._lastSync = time;
      if (this.socket && this.playerId) this.socket.emit('state', { x: me.x, y: me.y, rot: me.rotation, hp: me.hp, weapon: me.weaponKey });
    }
  }

  updateMovementAndRoll(p, time) {
    const r = p.roll; const v = new Phaser.Math.Vector2(0,0);
    const keys = this.keysP1;
    if (!r.isRolling) {
      if (keys.left.isDown) v.x -= 1; if (keys.right.isDown) v.x += 1; if (keys.up.isDown) v.y -= 1; if (keys.down.isDown) v.y += 1;
      if (v.lengthSq() > 0) v.normalize();
      p.setVelocity(v.x * p.speed, v.y * p.speed);

      const canRoll = time > (r.lastEnd + r.cooldownMs);
      if (canRoll && Phaser.Input.Keyboard.JustDown(keys.roll)) {
        r.isRolling = true; r.rollStart = time; p.invulnUntil = Math.max(p.invulnUntil, time + r.invulnMs);
        const dir = r.dir.lengthSq() > 0 ? r.dir : new Phaser.Math.Vector2(1,0);
        p.setVelocity(dir.x * p.baseSpeed * r.speedMult, dir.y * p.baseSpeed * r.speedMult);
        this.cameras.main.shake(80, 0.002);
      }
    } else {
      // Rolling
      if (time > r.rollStart + r.rollingMs) { r.isRolling = false; r.lastEnd = time; p.setVelocity(0,0); }
    }
  }

  // ---------- Combat ----------
  tryFire(shooter, aimVec, timeNow) {
    if (shooter.roll.isRolling) return; // no shooting during roll
    const w = shooter.weapon; if (!w) return; if (timeNow <= shooter.lastFired) return;
    if (w.ammo !== Infinity && w.ammo <= 0) { shooter.weaponKey = 'pistol'; shooter.weapon = WEAPONS.pistol; return; }

    shooter.lastFired = timeNow + w.fireDelayMs;

    const shots = [];
    for (let i = 0; i < w.bulletsPerShot; i++) {
      const spreadRad = Phaser.Math.DEG_TO_RAD * (w.spreadDeg * (Math.random() - 0.5));
      const dir = aimVec.clone().normalize().rotate(spreadRad);
      this.spawnBullet(shooter.x, shooter.y, dir.x, dir.y, w.bulletSpeed, this.playerBullets);
      this.muzzleFlash(shooter.x, shooter.y, dir);
      shots.push({ x: shooter.x, y: shooter.y, dx: dir.x, dy: dir.y, speed: w.bulletSpeed });
    }

    if (this.socket && this.playerId) this.socket.emit('fire', shots);
    if (w.ammo !== Infinity) w.ammo -= w.bulletsPerShot;
  }

  spawnBullet(x, y, dx, dy, speed, group, remote = false) {
    const b = group.get(x, y, 'bullet'); if (!b) return;
    b.setActive(true).setVisible(true); this.physics.world.enable(b); b.body.allowGravity = false; b.setDepth(1);
    b.setVelocity(dx * speed, dy * speed); this.time.delayedCall(1200, () => b.disableBody(true, true));
  }

  enemiesFire() {
    const shots = [];
    this.enemies.children.iterate((e) => {
      if (!e || !e.active) return; if (e.isBoss) return; // boss handled separately
      const target = this.getNearestPlayer(e); if (!target) return;
      const aim = new Phaser.Math.Vector2(target.x - e.x, target.y - e.y).normalize();
      shots.push({ x: e.x, y: e.y, dx: aim.x, dy: aim.y, speed: 440 });
    });
    if (!shots.length) return;
    shots.forEach(s => this.spawnBullet(s.x, s.y, s.dx, s.dy, s.speed, this.enemyBullets));
    if (this.socket && this.playerId) this.socket.emit('enemy_fire', shots);
  }

  updateBossPatterns(time) {
    if (!this.boss || !this.boss.active) return;
    const b = this.boss;
    if (b.hp <= b.maxHp * 0.5) b.phase = 2;

    if (time < b.nextPatternAt) return;

    const target = this.getNearestPlayer(b); if (!target) return;
    const aim = new Phaser.Math.Vector2(target.x - b.x, target.y - b.y).normalize();

    if (b.phase === 1) {
      // Aimed triple burst
      b.nextPatternAt = time + 1400;
      const bursts = 3; const interval = 140;
      for (let i = 0; i < bursts; i++) {
        this.time.delayedCall(i * interval, () => {
          const angles = [-0.15, 0, 0.15];
          angles.forEach(a => {
            const dir = aim.clone().rotate(a);
            this.spawnBullet(b.x, b.y, dir.x, dir.y, 480, this.enemyBullets);
          });
        });
      }
    } else {
      // Phase 2: radial ring + aimed spear
      b.nextPatternAt = time + 1600;
      // Radial ring
      const n = 20; for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2; const dir = new Phaser.Math.Vector2(Math.cos(ang), Math.sin(ang));
        this.spawnBullet(b.x, b.y, dir.x, dir.y, 360, this.enemyBullets);
      }
      // Aimed spear after a beat
      this.time.delayedCall(300, () => {
        const spear = aim.clone(); this.spawnBullet(b.x, b.y, spear.x, spear.y, 600, this.enemyBullets);
      });
    }

    if (this.socket && this.playerId) {
      // Broadcast enemy bullets the boss just spawned
      // (For simplicity we don’t capture and send every bullet here; in real game, server-authoritative is best.)
    }
  }

  getNearestPlayer(from) {
    let nearest = null, best = Infinity;
    for (const p of this.players) { if (!p.active) continue; const d2 = Phaser.Math.Distance.Squared(from.x, from.y, p.x, p.y); if (d2 < best) { best = d2; nearest = p; } }
    return nearest;
  }

  // ---------- Damage / FX ----------
  damagePlayer(player, amount) {
    const now = this.time.now;
    if (now < player.invulnUntil) return; // i-frames
    player.hp -= amount; player.invulnUntil = now + 700; // post-hit i-frames
    player.setTintFill(0xffffff); this.time.delayedCall(80, () => player.clearTint());
    this.cameras.main.shake(90, 0.004);
    if (player.hp <= 0) { player.disableBody(true, true); }
  }

  hitSpark(x, y) {
    const emitter = this.fx.sparks.createEmitter({ x, y, speed: { min: 40, max: 140 }, lifespan: 220, quantity: 10, scale: { start: 0.5, end: 0 }, angle: { min: 0, max: 360 } });
    this.time.delayedCall(120, () => emitter.stop());
  }

  muzzleFlash(x, y, dir) {
    const emitter = this.fx.muzzle.createEmitter({ x: x + dir.x * 14, y: y + dir.y * 14, speed: { min: 60, max: 160 }, lifespan: 100, quantity: 6, scale: { start: 0.6, end: 0 }, angle: { min: -10, max: 10 } });
    this.time.delayedCall(80, () => emitter.stop());
  }

  smallFreeze() {
    this.time.timeScale = 0.85; this.time.delayedCall(50, () => { this.time.timeScale = 1; });
  }

  onPickup(player, pickup) {
    const type = pickup.pickupWeapon; player.weaponKey = type; player.weapon = WEAPONS[type];
    if (type !== 'pistol') player.weapon.ammo = (type === 'shotgun') ? 36 : 140;
    pickup.destroy();
  }

  tryAdvanceLevel() {
    // If boss exists, require killing boss; else clear mobs
    const bossAlive = this.boss && this.boss.active;
    const mobsAlive = this.enemies.countActive();
    const canExit = bossAlive ? false : mobsAlive === 0;
    if (canExit && this.nextKey) this.scene.start(this.nextKey, this.tileConfigNext || undefined);
  }
}

// Level configs (tilemap optional)
class Level1 extends BaseLevelScene {
  constructor() { super('Level1', 'Level2', { tilesetKey: 'tileset', tilesetPNG: 'tiles/roguelike.png', mapKey: 'map1', mapJSON: 'maps/level1.json', tilesetName: 'tiles', bgLayer: 'bg', solidLayer: 'solid' }); }
}
class Level2 extends BaseLevelScene {
  constructor() { super('Level2', null,       { tilesetKey: 'tileset', tilesetPNG: 'tiles/roguelike.png', mapKey: 'map2', mapJSON: 'maps/level2.json', tilesetName: 'tiles', bgLayer: 'bg', solidLayer: 'solid' }); }
}

const config = {
  type: Phaser.AUTO,
  width: 960,
  height: 540,
  backgroundColor: '#0e0e12',
  physics: { default: 'arcade', arcade: { debug: false } },
  scene: [Level1, Level2]
};

new Phaser.Game(config);

// =========================
// Server: Node + Express + Socket.IO
// =========================
// Save as server.js at project root and run:  node server.js
// Folder layout:
//  project/
//   server.js
//   public/
//     index.html  (includes phaser + socket.io script tags as shown at top)
//     game.js
//     assets/
//       player.png bullet.png enemy.png ground.png gun.png
//     tiles/roguelike.png
//     maps/level1.json  maps/level2.json  (Tiled exports with layers: bg, solid; set tile property {collides:true} for solid tiles)

/* server.js */
/*
const path = require('path');
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const { Server } = require('socket.io');
const io = new Server(http, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

let clients = new Map(); // id → {x,y,rot,hp,weapon}

io.on('connection', (socket) => {
  const isHost = io.engine.clientsCount === 1;
  clients.set(socket.id, { x: 480, y: 320, rot: 0, hp: 6, weapon: 'pistol' });
  socket.emit('welcome', { id: socket.id, isHost });

  socket.on('state', (st) => { const cur = clients.get(socket.id); if (!cur) return; clients.set(socket.id, { ...cur, ...st }); });

  socket.on('fire', (shots) => {
    // Relay to others (send each shot)
    if (!Array.isArray(shots)) return;
    shots.forEach(s => socket.broadcast.emit('remote_fire', s));
  });

  socket.on('enemy_fire', (shots) => { socket.broadcast.emit('enemy_fire', shots); });

  socket.on('disconnect', () => { clients.delete(socket.id); });
});

setInterval(() => {
  const states = Array.from(clients.entries()).map(([id, s]) => ({ id, ...s }));
  io.emit('peers_state', states);
}, 100);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log('Server listening on :' + PORT));
*/
