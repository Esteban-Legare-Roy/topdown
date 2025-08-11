// =========================
// Client: Phaser + Socket.IO (LAN Co‑op)
// =========================
// Save as public/game.js and include in index.html:
// <script src="https://cdn.jsdelivr.net/npm/phaser@3/dist/phaser.js"></script>
// <script src="/socket.io/socket.io.js"></script>
// <script type="module" src="/game.js"></script>

/*
  Features
  • LAN co‑op via Socket.IO (movement + shots synced)
  • Procedural dungeon (rooms + corridors) when no Tiled map is present
  • Optional Tiled (.json) tilemap support (bg + solid layers)
  • Weapons: pistol (∞), shotgun (spread, ammo), rifle (fast, ammo) + pickups
  • Dodge roll with i‑frames, damage i‑frames, hit FX (shake, sparks, tiny freeze)
  • Boss in Level 2 with bullet‑hell patterns and phase change

  Controls (local)
  • Move: WASD
  • Aim:  Mouse
  • Fire: Left Mouse
  • Dodge Roll: Space
*/

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

class BaseLevelScene extends Phaser.Scene {
  constructor(key, nextKey, tileConfig) { super(key); this.sceneKey = key; this.nextKey = nextKey; this.tileConfig = tileConfig; }

  preload() {
    // Minimal placeholder art — plug your own sprites when ready
    this.load.image('player', 'assets/player.png');
    this.load.image('bullet', 'assets/bullet.png');
    this.load.image('enemy', 'assets/enemy.png');
    this.load.image('boss', 'assets/enemy.png');
    this.load.image('pickup', 'assets/gun.png');
    this.load.image('exit', 'assets/ground.png');

    // Tilemap (optional)
    if (this.tileConfig) {
      const { tilesetKey, tilesetPNG, mapKey, mapJSON } = this.tileConfig;
      this.load.image(tilesetKey, tilesetPNG);
      this.load.tilemapTiledJSON(mapKey, mapJSON);
    }

    // FX
    this.load.image('spark', 'assets/bullet.png');
    this.load.image('muzzle', 'assets/bullet.png');
  }

  create() {
    // Socket
    this.socket = window.io();
    this.playerId = null; this.peers = {};

    // Map or procedural dungeon
    this.createMapOrFallback();
    const bounds = this.worldBounds || new Phaser.Geom.Rectangle(0,0,2000,2000);
    this.physics.world.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);

    // Input
    this.pointer = this.input.activePointer;
    this.keys = this.input.keyboard.addKeys({ up:'W', left:'A', down:'S', right:'D', roll:'SPACE' });

    // Player (local)
    this.players = [];
    const me = this.spawnPlayer(bounds.centerX, bounds.centerY, 0x4ec9b0);
    me.isLocal = true; this.players.push(me);

    // Camera
    this.cameras.main.startFollow(me, true, 0.15, 0.15);
    this.cameras.main.setZoom(1.6);

    // FX emitters
    this.fx = {
      sparks: this.add.particles(0,0,'spark').setDepth(10),
      muzzle: this.add.particles(0,0,'muzzle').setDepth(10)
    };

    // Groups
    this.playerBullets = this.physics.add.group({ classType: Phaser.Physics.Arcade.Image, maxSize: 700 });
    this.enemyBullets  = this.physics.add.group({ classType: Phaser.Physics.Arcade.Image, maxSize: 700 });
    this.pickups = this.physics.add.group();
    this.enemies = this.physics.add.group();

    // Colliders / Overlaps
    if (this.solidLayer) {
      this.players.forEach(p => this.physics.add.collider(p, this.solidLayer));
      this.physics.add.collider(this.enemies, this.solidLayer);
    }
    if (this.walls) {
      this.players.forEach(p => this.physics.add.collider(p, this.walls));
      this.physics.add.collider(this.enemies, this.walls);
    }

    this.players.forEach(p => {
      p.setCollideWorldBounds(true);
      this.physics.add.overlap(this.enemyBullets, p, (bullet, player) => {
        bullet.disableBody(true, true); this.damagePlayer(player, 1);
      });
      this.physics.add.overlap(p, this.pickups, (player, pickup) => this.onPickup(player, pickup));
    });

    this.physics.add.overlap(this.playerBullets, this.enemies, (bullet, enemy) => {
      bullet.disableBody(true, true); this.hitSpark(bullet.x, bullet.y);
      enemy.hp -= 1; if (enemy.hp <= 0) enemy.destroy(); this.smallFreeze();
    });

    // Populate level
    this.populateLevel();

    // Exit pad
    this.exitPad = this.physics.add.staticSprite(bounds.width - 180, bounds.height - 180, 'exit').setScale(0.5);
    this.exitPad.alpha = 0.25; this.physics.add.overlap(me, this.exitPad, () => this.tryAdvanceLevel());

    // Host-ish enemy fire
    this.isHost = false; // server informs
    this.time.addEvent({ delay: 1100, loop: true, callback: () => { if (this.isHost || !this.playerId) this.enemiesFire(); } });

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
      // Procedural dungeon (no external tiles)
      this.buildProceduralDungeon();
    }
  }

  buildProceduralDungeon() {
    const W = 64, H = 40, TS = 32; // logical tiles & tile size
    const widthPx = W * TS, heightPx = H * TS;
    this.worldBounds = new Phaser.Geom.Rectangle(0, 0, widthPx, heightPx);

    // Floor
    this.add.graphics().fillStyle(0x121417, 1).fillRect(0, 0, widthPx, heightPx);

    // 1=wall, 0=floor
    const grid = Array.from({ length: H }, () => Array(W).fill(1));
    const rooms = []; const roomCount = 8;
    for (let i = 0; i < roomCount; i++) {
      const rw = Phaser.Math.Between(6, 12);
      const rh = Phaser.Math.Between(5, 9);
      const rx = Phaser.Math.Between(2, W - rw - 2);
      const ry = Phaser.Math.Between(2, H - rh - 2);
      rooms.push({ x: rx, y: ry, w: rw, h: rh });
      for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) grid[y][x] = 0;
    }
    // corridors between room centers
    const centers = rooms.map(r => ({ x: (r.x + r.w / 2) | 0, y: (r.y + r.h / 2) | 0 })).sort((a,b)=>a.x-b.x);
    for (let i = 0; i < centers.length - 1; i++) {
      const a = centers[i], b = centers[i + 1];
      for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) grid[a.y][x] = 0;
      for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) grid[y][b.x] = 0;
    }

    // Draw & collide walls
    this.walls = this.physics.add.staticGroup();
    const g = this.add.graphics().lineStyle(2, 0x2f3b45, 1).fillStyle(0x1a2229, 1);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (grid[y][x] === 1) {
          const px = x * TS, py = y * TS;
          g.fillRect(px, py, TS, TS).strokeRect(px, py, TS, TS);
          const wall = this.walls.create(px + TS/2, py + TS/2, null);
          wall.body.setSize(TS, TS).setOffset(-TS/2, -TS/2);
        }
      }
    }
  }

  // ---------- Population ----------
  populateLevel() {
    const enemyCount = this.sceneKey === 'Level2' ? 10 : 8;
    for (let i = 0; i < enemyCount; i++) {
      const x = Phaser.Math.Between(200, this.worldBounds.width - 200);
      const y = Phaser.Math.Between(200, this.worldBounds.height - 200);
      this.enemies.add(this.spawnEnemy(x, y));
    }
    if (this.sceneKey === 'Level2') {
      this.boss = this.spawnBoss(this.worldBounds.width * 0.7, this.worldBounds.height * 0.4);
    }
    this.spawnPickups();
  }

  // ---------- Entities ----------
  spawnPlayer(x, y, tint) {
    const p = this.physics.add.sprite(x, y, 'player');
    p.setTint(tint); p.baseSpeed = 240; p.speed = 240; p.hp = 6; p.lastFired = 0;
    p.weaponKey = 'pistol'; p.weapon = WEAPONS[p.weaponKey];
    p.roll = { cooldownMs: 900, rollingMs: 320, invulnMs: 380, speedMult: 3.1, lastEnd: -9999, isRolling: false, dir: new Phaser.Math.Vector2(1,0) };
    p.invulnUntil = 0; return p;
  }

  spawnEnemy(x, y) { const e = this.physics.add.sprite(x, y, 'enemy'); e.speed = 90; e.hp = 3; return e; }

  spawnBoss(x, y) {
    const b = this.physics.add.sprite(x, y, 'boss').setScale(1.3);
    b.speed = 80; b.maxHp = 80; b.hp = b.maxHp; b.phase = 1; b.nextPatternAt = 0; this.enemies.add(b); b.isBoss = true; return b;
  }

  spawnPickups() {
    const types = ['shotgun', 'rifle', Math.random() < 0.5 ? 'shotgun' : 'rifle'];
    const spots = [ [300, this.worldBounds.height-300], [this.worldBounds.width-300, 300], [this.worldBounds.centerX, this.worldBounds.centerY] ];
    types.forEach((t, i) => { const s = this.physics.add.staticSprite(spots[i][0], spots[i][1], 'pickup'); s.pickupWeapon = t; s.alpha = 0.9; this.pickups.add(s); });
  }

  // ---------- Networking ----------
  setupSocket() {
    this.socket.on('welcome', (data) => { this.playerId = data.id; this.isHost = data.isHost; });

    this.socket.on('peers_state', (states) => {
      states.forEach(s => {
        if (s.id === this.playerId) return;
        let peer = this.peers[s.id];
        if (!peer) { peer = this.spawnPlayer(s.x || this.worldBounds.centerX, s.y || this.worldBounds.centerY, 0xf78c6c); peer.isLocal = false; this.peers[s.id] = peer; this.players.push(peer); }
        peer.setPosition(s.x, s.y); peer.setRotation(s.rot || 0); peer.hp = s.hp ?? peer.hp; peer.weaponKey = s.weapon || peer.weaponKey;
      });
      Object.keys(this.peers).forEach(id => { if (!states.find(s => s.id === id)) { this.peers[id].destroy(); delete this.peers[id]; } });
    });

    this.socket.on('remote_fire', (payload) => { if (!payload) return; this.spawnBullet(payload.x, payload.y, payload.dx, payload.dy, payload.speed, this.playerBullets, true); });
    this.socket.on('enemy_fire', (list) => { list.forEach(p => this.spawnBullet(p.x, p.y, p.dx, p.dy, p.speed, this.enemyBullets, true)); });
  }

  // ---------- Update ----------
  update(time) {
    const me = this.players.find(p => p.isLocal); if (!me) return;

    // Movement + roll
    this.updateMovementAndRoll(me, time);

    // Aim
    const aim = new Phaser.Math.Vector2(this.pointer.worldX - me.x, this.pointer.worldY - me.y);
    if (aim.lengthSq() > 0.0001) { me.setRotation(aim.angle()); me.roll.dir.copy(aim).normalize(); }

    // Fire
    if (this.pointer.isDown) this.tryFire(me, aim, time);

    // Enemies track nearest
    this.enemies.children.iterate((e) => { if (!e) return; const t = this.getNearestPlayer(e); if (!t) return; this.physics.moveToObject(e, t, e.isBoss ? e.speed*0.8 : e.speed); });

    // Boss patterns (host-ish)
    if (this.isHost || !this.playerId) this.updateBossPatterns(time);

    // Sync (10/s)
    if (!this._lastSync || time - this._lastSync > 100) {
      this._lastSync = time; if (this.socket && this.playerId) this.socket.emit('state', { x: me.x, y: me.y, rot: me.rotation, hp: me.hp, weapon: me.weaponKey });
    }
  }

  updateMovementAndRoll(p, time) {
    const r = p.roll; const v = new Phaser.Math.Vector2(0,0);
    if (!r.isRolling) {
      if (this.keys.left.isDown) v.x -= 1; if (this.keys.right.isDown) v.x += 1; if (this.keys.up.isDown) v.y -= 1; if (this.keys.down.isDown) v.y += 1;
      if (v.lengthSq() > 0) v.normalize(); p.setVelocity(v.x * p.speed, v.y * p.speed);
      const canRoll = time > (r.lastEnd + r.cooldownMs);
      if (canRoll && Phaser.Input.Keyboard.JustDown(this.keys.roll)) {
        r.isRolling = true; r.rollStart = time; p.invulnUntil = Math.max(p.invulnUntil, time + r.invulnMs);
        const dir = r.dir.lengthSq() > 0 ? r.dir : new Phaser.Math.Vector2(1,0);
        p.setVelocity(dir.x * p.baseSpeed * r.speedMult, dir.y * p.baseSpeed * r.speedMult); this.cameras.main.shake(80, 0.002);
      }
    } else {
      if (time > r.rollStart + r.rollingMs) { r.isRolling = false; r.lastEnd = time; p.setVelocity(0,0); }
    }
  }

  // ---------- Combat ----------
  tryFire(shooter, aimVec, timeNow) {
    if (shooter.roll.isRolling) return;
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

  spawnBullet(x, y, dx, dy, speed, group) {
    const b = group.get(x, y, 'bullet'); if (!b) return;
    b.setActive(true).setVisible(true); this.physics.world.enable(b); b.body.allowGravity = false; b.setDepth(1);
    b.setVelocity(dx * speed, dy * speed); this.time.delayedCall(1200, () => b.disableBody(true, true));
  }

  enemiesFire() {
    const shots = [];
    this.enemies.children.iterate((e) => {
      if (!e || !e.active || e.isBoss) return; const t = this.getNearestPlayer(e); if (!t) return;
      const aim = new Phaser.Math.Vector2(t.x - e.x, t.y - e.y).normalize();
      shots.push({ x: e.x, y: e.y, dx: aim.x, dy: aim.y, speed: 440 });
    });
    shots.forEach(s => this.spawnBullet(s.x, s.y, s.dx, s.dy, s.speed, this.enemyBullets));
    if (this.socket && this.playerId && shots.length) this.socket.emit('enemy_fire', shots);
  }

  updateBossPatterns(time) {
    if (!this.boss || !this.boss.active) return; const b = this.boss;
    if (b.hp <= b.maxHp * 0.5) b.phase = 2; if (time < b.nextPatternAt) return;
    const t = this.getNearestPlayer(b); if (!t) return; const aim = new Phaser.Math.Vector2(t.x - b.x, t.y - b.y).normalize();

    if (b.phase === 1) {
      b.nextPatternAt = time + 1400; const bursts = 3, interval = 140;
      for (let i = 0; i < bursts; i++) this.time.delayedCall(i * interval, () => {
        [-0.15, 0, 0.15].forEach(a => { const d = aim.clone().rotate(a); this.spawnBullet(b.x, b.y, d.x, d.y, 480, this.enemyBullets); });
      });
    } else {
      b.nextPatternAt = time + 1600;
      const n = 20; for (let k = 0; k < n; k++) { const ang = (k / n) * Math.PI * 2; const d = new Phaser.Math.Vector2(Math.cos(ang), Math.sin(ang)); this.spawnBullet(b.x, b.y, d.x, d.y, 360, this.enemyBullets); }
      this.time.delayedCall(300, () => { const d = aim.clone(); this.spawnBullet(b.x, b.y, d.x, d.y, 600, this.enemyBullets); });
    }
  }

  getNearestPlayer(from) {
    let nearest = null, best = Infinity; for (const p of this.players) { if (!p.active) continue; const d2 = Phaser.Math.Distance.Squared(from.x, from.y, p.x, p.y); if (d2 < best) { best = d2; nearest = p; } } return nearest;
  }

  // ---------- Damage / FX ----------
  damagePlayer(player, amount) {
    const now = this.time.now; if (now < player.invulnUntil) return;
    player.hp -= amount; player.invulnUntil = now + 700; player.setTintFill(0xffffff); this.time.delayedCall(80, () => player.clearTint());
    this.cameras.main.shake(90, 0.004); if (player.hp <= 0) player.disableBody(true, true);
  }

  hitSpark(x, y) { const e = this.fx.sparks.createEmitter({ x, y, speed:{min:40,max:140}, lifespan:220, quantity:10, scale:{start:0.5,end:0}, angle:{min:0,max:360} }); this.time.delayedCall(120, () => e.stop()); }
  muzzleFlash(x, y, dir) { const e = this.fx.muzzle.createEmitter({ x:x+dir.x*14, y:y+dir.y*14, speed:{min:60,max:160}, lifespan:100, quantity:6, scale:{start:0.6,end:0}, angle:{min:-10,max:10} }); this.time.delayedCall(80, () => e.stop()); }
  smallFreeze() { this.time.timeScale = 0.85; this.time.delayedCall(50, () => { this.time.timeScale = 1; }); }

  onPickup(player, pickup) { const type = pickup.pickupWeapon; player.weaponKey = type; player.weapon = WEAPONS[type]; if (type !== 'pistol') player.weapon.ammo = (type === 'shotgun') ? 36 : 140; pickup.destroy(); }

  tryAdvanceLevel() { const bossAlive = this.boss && this.boss.active; const mobsAlive = this.enemies.countActive(); const canExit = bossAlive ? false : mobsAlive === 0; if (canExit && this.nextKey) this.scene.start(this.nextKey, this.tileConfigNext || undefined); }
}

class Level1 extends BaseLevelScene { constructor() { super('Level1', 'Level2', null /* plug tileConfig here if you add Tiled maps */); } }
class Level2 extends BaseLevelScene { constructor() { super('Level2', null,       null); } }

const config = {
  type: Phaser.AUTO,
  width: 960,
  height: 540,
  backgroundColor: '#0e0e12',
  physics: { default: 'arcade', arcade: { debug: false } },
  scene: [Level1, Level2]
};

new Phaser.Game(config);
