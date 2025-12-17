import './style.css'
import { db } from './firebase.js';
import { collection, doc, setDoc, getDoc, updateDoc, increment, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp, getDocs, where } from "firebase/firestore";


// --- CONFIGURATION & CONSTANTS ---
const CONF = {
  FPS: 60,
  WORLD: {
    WIDTH: 2500,
    HEIGHT: 2500
  },
  PLAYER: {
    RADIUS: 12,
    COLOR: '#ff3e3e',
    BASE_SPEED: 4.4, // +10%
    BASE_HP: 50, // Reduced to 50
    BASE_DAMAGE: 15,
    BASE_FIRE_RATE: 18, // Faster (lower cd)
    BASE_PROJECTILE_SPEED: 13.2, // +10%
  },
  ENEMIES: {
    TYPE1: { color: '#00f0ff', radius: 10, hp: 30, speed: 2.2, score: 10, gold: 1, name: "Drone", desc: "Rapide et faible." },
    TYPE2: { color: '#ffff00', radius: 8, hp: 15, speed: 5.5, score: 20, gold: 3, name: "Scout", desc: "Très rapide, très fragile." },
    TYPE3: { color: '#bf00ff', radius: 18, hp: 160, speed: 1.32, score: 50, gold: 2, name: "Tank", desc: "Lent mais très résistant." },
    TYPE4: { color: '#00ff00', radius: 12, hp: 40, speed: 1.65, score: 30, gold: 3, range: 600, projectileSpeed: 6.6, name: "Sniper", desc: "Tire à distance." },
    TYPE5: { color: '#ff00ff', radius: 10, hp: 40, speed: 1.1, score: 40, gold: 2, name: "Spectre", desc: "Se téléporte aléatoirement." },
    TYPE6: { color: 'rgba(200, 200, 255, 0.4)', radius: 12, hp: 60, speed: 1.65, score: 60, gold: 4, phase: true, name: "Fantôme", desc: "Invulnérable quand tu bouges !" },
    TYPE7: { color: '#ff0000', radius: 14, hp: 50, speed: 0.55, score: 45, gold: 5, name: "Laser", desc: "Charge un rayon mortel global." },
    BOSS: { color: '#ffffff', radius: 40, hp: 1000, speed: 0.88, score: 500, gold: 50, name: "RSB-01", desc: "Le patron ultime." },
  },
  WAVE: {
    baseCount: 15,
    spawnInterval: 50,
    difficultyMultiplier: 1.07,
  },
  COLORS: {
    GOLD: '#ffd700',
    BG: '#050505',
    GRID: '#1a1a1a'
  }
};

// --- UTILS ---
const $ = (s) => document.querySelector(s);
const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
const rand = (min, max) => Math.random() * (max - min) + min;

// Line-Point Distance for Laser Collision
const distToSegment = (p, v, w) => {
  const l2 = dist(v.x, v.y, w.x, w.y) ** 2;
  if (l2 === 0) return dist(p.x, p.y, v.x, v.y);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(p.x, p.y, v.x + t * (w.x - v.x), v.y + t * (w.y - v.y));
};

// --- CLASSES ---

class Particle {
  constructor(x, y, color, speed, size) {
    this.x = x;
    this.y = y;
    this.color = color;
    this.vx = (Math.random() - 0.5) * speed;
    this.vy = (Math.random() - 0.5) * speed;
    this.alpha = 1;
    this.size = size;
  }
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.alpha -= 0.02;
  }
  draw(ctx) {
    if (this.alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.alpha);
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

class FloatingText {
  constructor(x, y, text, color) {
    this.x = x;
    this.y = y;
    this.text = text;
    this.color = color;
    this.alpha = 1;
    this.vy = -1;
  }
  update() {
    this.y += this.vy;
    this.alpha -= 0.02;
  }
  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle = this.color;
    ctx.font = 'bold 12px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(this.text, this.x, this.y);
    ctx.restore();
  }
}

class WaveAnnouncement {
  constructor(wave) {
    this.text = "VAGUE " + wave;
    this.life = 100;
    this.maxLife = 100;
  }
  update() {
    this.life--;
  }
  draw(ctx, width, height) {
    if (this.life <= 0) return;
    ctx.save();
    let alpha = 1;
    if (this.life > 90) alpha = (100 - this.life) / 10;
    else if (this.life < 20) alpha = this.life / 20;

    ctx.globalAlpha = alpha * 0.4;
    ctx.font = '900 80px "Outfit", sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.text, width / 2, height / 3);
    ctx.restore();
  }
}

class PowerUp {
  constructor(x, y, type) {
    this.x = x;
    this.y = y;
    this.type = type;
    this.radius = 12;
    this.timer = 0;
    this.bobOffset = 0;
    this.lifetime = 15;
    this.maxLifetime = 15;
  }

  update(dt) {
    this.timer += 0.1;
    this.bobOffset = Math.sin(this.timer) * 3;
    this.lifetime -= dt;
  }

  draw(ctx) {
    if (this.lifetime <= 0) return;

    ctx.save();
    ctx.shadowBlur = 10;

    // Timer Bar
    const lifePct = Math.max(0, this.lifetime / this.maxLifetime);
    ctx.fillStyle = '#fff';
    ctx.fillRect(this.x - 10, this.y + 20, 20, 3);
    ctx.fillStyle = this.type === 'HEAL' ? '#0f0' : (this.type === 'RAGE' ? '#f90' : '#ffd700');
    ctx.fillRect(this.x - 10, this.y + 20, 20 * lifePct, 3);

    if (this.type === 'HEAL') {
      ctx.fillStyle = '#00ff00';
      ctx.shadowColor = '#00ff00';
      const s = 6;
      ctx.fillRect(this.x - 2, this.y - s + this.bobOffset, 4, s * 2);
      ctx.fillRect(this.x - s, this.y - 2 + this.bobOffset, s * 2, 4);
    } else if (this.type === 'RAGE') {
      ctx.fillStyle = '#ff9900';
      ctx.shadowColor = '#ff9900';
      ctx.beginPath();
      ctx.arc(this.x, this.y + this.bobOffset, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('⚡', this.x, this.y + 4 + this.bobOffset);
    } else if (this.type === 'COIN') {
      ctx.fillStyle = '#ffd700';
      ctx.shadowColor = '#ffd700';
      ctx.beginPath();
      ctx.arc(this.x, this.y + this.bobOffset, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('$', this.x, this.y + 4 + this.bobOffset);
    }
    ctx.restore();
  }
}

class Projectile {
  constructor(x, y, angle, damage, speed, color = '#ffaaaa', isEnemy = false) {
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.damage = damage;
    this.radius = 4;
    this.color = color;
    this.isEnemy = isEnemy;
    this.markedForDeletion = false;
  }

  update(worldWidth, worldHeight) {
    this.x += this.vx;
    this.y += this.vy;

    if (this.x < 0 || this.x > worldWidth || this.y < 0 || this.y > worldHeight) {
      this.markedForDeletion = true;
    }
  }

  draw(ctx) {
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 10;
    ctx.shadowColor = this.color;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

class Player {
  constructor(startPos) {
    this.x = startPos.x;
    this.y = startPos.y;
    this.radius = CONF.PLAYER.RADIUS;
    this.color = CONF.PLAYER.COLOR;

    this.maxHp = CONF.PLAYER.BASE_HP;
    this.hp = this.maxHp;
    this.speed = CONF.PLAYER.BASE_SPEED;
    this.damage = CONF.PLAYER.BASE_DAMAGE;
    this.fireRate = CONF.PLAYER.BASE_FIRE_RATE;
    this.multiShot = 0;
    this.regen = 0;

    this.cooldown = 0;
    this.isDead = false;

    this.isDashing = false;
    this.dashTime = 0;
    this.dashCooldownTimer = 0;

    this.isMoving = false;
  }

  dash() {
    if (this.dashCooldownTimer <= 0) {
      this.isDashing = true;
      this.dashTime = 12;
      this.dashCooldownTimer = 60;
      return true;
    }
    return false;
  }

  upgrade(stat, value) {
    if (stat === 'fireRate') this.fireRate = Math.max(5, this.fireRate - value);
    if (stat === 'damage') this.damage += value;
    if (stat === 'speed') this.speed += value;
    if (stat === 'multiShot') this.multiShot += value;
    if (stat === 'maxHp') {
      this.maxHp += value;
      this.hp += value;
    }
    if (stat === 'regen') this.regen += value;
  }

  heal(amount) {
    this.hp = Math.min(this.hp + amount, this.maxHp);
  }

  takeDamage(amount) {
    this.hp -= amount;
    if (this.hp <= 0) this.isDead = true;
  }

  update(keys, width, height) {
    if (this.dashCooldownTimer > 0) this.dashCooldownTimer--;

    let currentSpeed = this.speed;
    if (this.isDashing) {
      currentSpeed *= 3.5;
      this.dashTime--;
      if (this.dashTime <= 0) this.isDashing = false;
    }

    let dx = 0;
    let dy = 0;

    if (keys['ArrowUp'] || keys['KeyW']) dy = -1;
    if (keys['ArrowDown'] || keys['KeyS']) dy = 1;
    if (keys['ArrowLeft'] || keys['KeyA']) dx = -1;
    if (keys['ArrowRight'] || keys['KeyD']) dx = 1;

    this.isMoving = (dx !== 0 || dy !== 0);

    if (this.isMoving) {
      const len = Math.hypot(dx, dy);
      dx /= len;
      dy /= len;
      this.x += dx * currentSpeed;
      this.y += dy * currentSpeed;
    }

    this.x = Math.max(this.radius, Math.min(width - this.radius, this.x));
    this.y = Math.max(this.radius, Math.min(height - this.radius, this.y));

    if (this.cooldown > 0) this.cooldown--;
  }

  draw(ctx) {
    ctx.shadowBlur = 15;
    ctx.shadowColor = this.color;

    if (this.isDashing) {
      ctx.shadowBlur = 30;
      ctx.fillStyle = '#fff';
    } else {
      ctx.fillStyle = this.color;
    }

    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Cooldown Bar
    if (this.dashCooldownTimer > 0) {
      const pct = 1 - (this.dashCooldownTimer / 60);
      ctx.fillStyle = '#00f0ff';
      ctx.fillRect(this.x - 10, this.y + 26, 20 * pct, 2);
    }
    // Ready
    if (this.dashCooldownTimer <= 0 && !this.isDashing) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(this.x - 2, this.y + 26, 4, 4);
    }

    // HP
    const hpPct = Math.max(0, this.hp / this.maxHp);
    ctx.fillStyle = '#333';
    ctx.fillRect(this.x - 15, this.y + 20, 30, 4);
    ctx.fillStyle = '#0f0';
    ctx.fillRect(this.x - 15, this.y + 20, 30 * hpPct, 4);
  }
}

class Enemy {
  constructor(type, worldW, worldH, player) {
    this.type = type;

    // Laser Enemy Position Logic
    if (this.type === 'TYPE7') {
      // Spawn on edge
      if (Math.random() < 0.5) {
        this.x = Math.random() < 0.5 ? 20 : worldW - 20;
        this.y = Math.random() * worldH;
      } else {
        this.x = Math.random() * worldW;
        this.y = Math.random() < 0.5 ? 20 : worldH - 20;
      }
    } else {
      let safe = false;
      let attempts = 0;
      while (!safe && attempts < 10) {
        this.x = Math.random() * worldW;
        this.y = Math.random() * worldH;
        if (dist(this.x, this.y, player.x, player.y) > 600) {
          safe = true;
        }
        attempts++;
      }
    }

    if (!CONF.ENEMIES[type]) type = 'TYPE1';

    const props = CONF.ENEMIES[type];

    this.radius = props.radius;
    this.color = props.color;
    this.maxHp = props.hp;
    this.hp = this.maxHp;
    this.speed = props.speed;
    this.scoreValue = props.score;
    this.goldValue = props.gold;

    this.range = props.range || 0;
    this.projectileSpeed = props.projectileSpeed || 0;
    this.cooldown = 100 + Math.random() * 60;
    this.angleOffset = 0;
    this.teleportTimer = 0;
    this.bossAngle = 0;
    this.phase = props.phase || false;

    // Laser specific
    this.laserState = 0; // 0: Idle, 1: Charging, 2: Firing
    this.laserTimer = 0;
    this.laserTarget = { x: 0, y: 0 };
  }

  update(worldW, worldH, player, gameProjectiles, waveLevel = 1) {
    const d = dist(this.x, this.y, player.x, player.y);
    let angle = Math.atan2(player.y - this.y, player.x - this.x);

    let shouldMove = true;

    if (this.type === 'TYPE4') { // Shooter
      if (d < this.range && d < 600) {
        shouldMove = false;
        if (this.cooldown <= 0) {
          gameProjectiles.push(new Projectile(this.x, this.y, angle, 10, this.projectileSpeed, '#00ff00', true));
          this.cooldown = 120;
        }
      }
      this.cooldown--;
    } else if (this.type === 'TYPE5') { // Teleporter
      this.teleportTimer++;
      if (this.teleportTimer > 180) {
        const skewX = (Math.random() - 0.5) * 200;
        const skewY = (Math.random() - 0.5) * 200;
        this.x = (this.x + player.x) / 2 + skewX;
        this.y = (this.y + player.y) / 2 + skewY;
        this.teleportTimer = 0;
        this.x = Math.max(0, Math.min(worldW, this.x));
        this.y = Math.max(0, Math.min(worldH, this.y));
      }
    } else if (this.type === 'BOSS') {
      this.cooldown--;
      this.bossAngle += 0.02;
      if (this.cooldown <= 0) {
        let baseShots = 8;
        let extraShots = Math.floor(waveLevel / 10);
        let shots = Math.min(24, baseShots + extraShots); // Cap at 24 shots

        let cdBase = 100;
        if (waveLevel >= 10) cdBase = 85;

        for (let i = 0; i < shots; i++) {
          const a = this.bossAngle + (Math.PI * 2 * i) / shots;
          gameProjectiles.push(new Projectile(this.x, this.y, a, 15, 5, '#fff', true));
        }
        this.cooldown = cdBase;
      }
    } else if (this.type === 'TYPE7') { // Laser
      shouldMove = false; // Static or slow drift
      if (this.laserState === 0) {
        // Cooldown before charge
        this.laserTimer++;
        if (this.laserTimer > 150) {
          this.laserState = 1;
          this.laserTimer = 0;
          // Lock target direction
          const tAngle = Math.atan2(player.y - this.y, player.x - this.x);
          const len = 10000;
          this.laserTarget = { x: this.x + Math.cos(tAngle) * len, y: this.y + Math.sin(tAngle) * len };
        }
      } else if (this.laserState === 1) {
        // Charging (1 second = 60 frames)
        this.laserTimer++;
        if (this.laserTimer > 60) {
          this.laserState = 2;
          this.laserTimer = 0;
          // Fire damage frame
          if (distToSegment(player, this, this.laserTarget) < 20) {
            player.takeDamage(25); // Heavy damage
          }
        }
      } else if (this.laserState === 2) {
        // Firing visual duration
        this.laserTimer++;
        if (this.laserTimer > 15) {
          this.laserState = 0;
          this.laserTimer = 0;
        }
      }
    }

    if (shouldMove) {
      if (this.type === 'TYPE2') {
        this.angleOffset += 0.1;
        angle += Math.sin(this.angleOffset) * 0.5;
      }
      this.x += Math.cos(angle) * this.speed;
      this.y += Math.sin(angle) * this.speed;
    }

    this.x = Math.max(0, Math.min(worldW, this.x));
    this.y = Math.max(0, Math.min(worldH, this.y));
  }

  draw(ctx, playerMoving) {
    if (this.phase && playerMoving) {
      ctx.globalAlpha = 0.3;
    } else {
      ctx.globalAlpha = 1.0;
    }

    ctx.save();

    // Laser visual
    if (this.type === 'TYPE7') {
      if (this.laserState === 1) { // Charging
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(this.laserTarget.x, this.laserTarget.y);
        ctx.lineWidth = 2 + Math.random() * 2;
        ctx.strokeStyle = `rgba(255, 0, 0, ${0.3 + Math.random() * 0.2})`;
        ctx.stroke();
      } else if (this.laserState === 2) { // Firing
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(this.laserTarget.x, this.laserTarget.y);
        ctx.lineWidth = 8;
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#f00';
        ctx.strokeStyle = '#f00';
        ctx.stroke();
      }
    }

    ctx.shadowBlur = 10;
    ctx.shadowColor = this.color;
    ctx.fillStyle = this.color;

    if (this.type === 'TYPE3') {
      ctx.fillRect(this.x - this.radius, this.y - this.radius, this.radius * 2, this.radius * 2);
    } else if (this.type === 'TYPE2') {
      ctx.beginPath();
      ctx.moveTo(this.x, this.y - this.radius);
      ctx.lineTo(this.x + this.radius, this.y + this.radius);
      ctx.lineTo(this.x - this.radius, this.y + this.radius);
      ctx.closePath();
      ctx.fill();
    } else if (this.type === 'TYPE4') {
      ctx.beginPath();
      ctx.moveTo(this.x, this.y - this.radius);
      ctx.lineTo(this.x + this.radius, this.y);
      ctx.lineTo(this.x, this.y + this.radius);
      ctx.lineTo(this.x - this.radius, this.y);
      ctx.closePath();
      ctx.fill();
    } else if (this.type === 'TYPE5') {
      ctx.beginPath();
      ctx.moveTo(this.x - 10, this.y - 10);
      ctx.lineTo(this.x + 10, this.y + 10);
      ctx.moveTo(this.x + 10, this.y - 10);
      ctx.lineTo(this.x - 10, this.y + 10);
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 4;
      ctx.stroke();
    } else if (this.type === 'BOSS') {
      ctx.fillStyle = '#000080'; // Navy Blue
      ctx.font = '900 30px "Outfit", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('RSB', this.x, this.y);
    } else if (this.type === 'TYPE6') {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.type === 'TYPE7') {
      ctx.fillRect(this.x - 10, this.y - 10, 20, 20);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(this.x - 10, this.y - 10, 20, 20);
    } else {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
    ctx.globalAlpha = 1.0;

    if (this.hp < this.maxHp) {
      const hpPct = Math.max(0, this.hp / this.maxHp);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.fillRect(this.x - 15, this.y - this.radius - 10, 30, 4);
      ctx.fillStyle = '#f00';
      ctx.fillRect(this.x - 15, this.y - this.radius - 10, 30 * hpPct, 4);
    }
  }
}

// --- CLASSES ---

class UserManager {
  constructor() {
    this.currentUser = null;
  }

  async exists(pseudo) {
    if (typeof db === 'undefined') { console.error("Firebase DB undefined"); return false; }
    const docRef = doc(db, "users", pseudo);
    const docSnap = await getDoc(docRef);
    return docSnap.exists();
  }

  async create(pseudo, pin) {
    try {
      const exists = await this.exists(pseudo);
      if (exists) return false;

      await setDoc(doc(db, "users", pseudo), {
        pseudo: pseudo,
        pin: pin,
        bestScore: 0,
        totalGames: 0,
        createdAt: serverTimestamp()
      });
      return true;
    } catch (e) {
      console.error("Error creating user:", e);
      return false;
    }
  }

  async login(pseudo, pin) {
    try {
      const docRef = doc(db, "users", pseudo);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.pin === pin) {
          this.currentUser = data;
          return true;
        }
      }
      return false;
    } catch (e) {
      console.error("Login error:", e);
      return false;
    }
  }

  async addMatch(pseudo, kills, wave) {
    if (!pseudo) return;

    try {
      // Update User Stats (Best Score & Total Games & Total Kills)
      const userRef = doc(db, "users", pseudo);
      const userSnap = await getDoc(userRef);

      if (userSnap.exists()) {
        const data = userSnap.data();
        const updates = {
          totalGames: increment(1),
          totalKills: increment(kills) // CUMULATIVE KILLS
        };
        if (kills > (data.bestScore || 0)) {
          updates.bestScore = kills;
        }
        await updateDoc(userRef, updates);

        // Update local currentUser
        if (this.currentUser && this.currentUser.pseudo === pseudo) {
          this.currentUser.totalGames = (this.currentUser.totalGames || 0) + 1;
          this.currentUser.totalKills = (this.currentUser.totalKills || 0) + kills;
          if (kills > this.currentUser.bestScore) this.currentUser.bestScore = kills;
        }
      }

      // Add to History Collection
      await addDoc(collection(db, "games"), {
        pseudo: pseudo,
        kills: kills,
        wave: wave,
        date: serverTimestamp()
      });

    } catch (e) {
      console.error("Error adding match:", e);
    }
  }

  async getStats(pseudo) {
    let userData = null;
    let history = [];

    // 1. Fetch User Data
    try {
      const docRef = doc(db, "users", pseudo);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        userData = docSnap.data();
      } else {
        return null;
      }
    } catch (e) {
      console.error("Error fetching user data:", e);
      return null;
    }

    // 2. Fetch History (Client-side filter to avoid Index Requirement)
    try {
      // Fetch specifically only this user's games if index exists, 
      // otherwise we might need index.
      // TRICK: To avoid "Missing Index" on (pseudo + date), we fetch global recent games 
      // and filter. LIMIT 100 should be enough for a small user base to find recent games.
      // LONG TERM: User must create the index in Firebase Console.

      const q = query(
        collection(db, "games"),
        orderBy("date", "desc"),
        limit(100)
      );
      const snap = await getDocs(q);

      // Filter in JS
      const allGames = [];
      snap.forEach(doc => allGames.push(doc.data()));
      history = allGames.filter(g => g.pseudo === pseudo).slice(0, 10);

    } catch (e) {
      console.warn("History fetch failed:", e);
    }

    return {
      bestScore: userData.bestScore || 0,
      totalGames: userData.totalGames || 0,
      totalKills: userData.totalKills || 0,
      history: history
    };
  }
}

// ... Particle, FloatingText, WaveAnnouncement, PowerUp, Projectile, Player classes remain same ...

class ChatProject {
  constructor(game) {
    this.game = game;
    this.msgList = $('#chat-messages');
    this.input = $('#chatInput');
    this.sendBtn = $('#chatSendBtn');
    this.lastSent = 0;

    if (this.sendBtn) this.sendBtn.onclick = () => this.sendMessage();
    if (this.input) this.input.onkeydown = (e) => {
      if (e.key === 'Enter') this.sendMessage();
    };

    // Listen to Firestore
    const q = query(collection(db, "chat"), orderBy("timestamp", "desc"), limit(50));
    this.unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          const data = change.doc.data();
          // We need to prepend because we fetch desc (newest first)
          // But usually chat is appended.
          // Let's fetch desc (newest first) to get the last 50, but display them correctly.
          // Actually, for a chat, we want to listen to NEW messages. 
          // 'onSnapshot' gives initial state then updates.
          // The simplest way: Clear list and re-render or handle insert.
          // DESC order means index 0 is NEWEST.

          // Allow simple logic: append if it's new (timestamp > init). 
          // or just render all reversed?
          // Let's just append data for now, user asked for "200 messages history".
        }
      });
      // Simpler: Just clear and render the last 50 reversed
      const msgs = [];
      snapshot.forEach((doc) => msgs.push(doc.data()));
      this.renderBatch(msgs.reverse());
    });
  }

  renderBatch(msgs) {
    if (!this.msgList) return;
    this.msgList.innerHTML = '';
    msgs.forEach(m => this.renderMessage(m.pseudo, m.message));
    this.msgList.scrollTop = this.msgList.scrollHeight;
  }

  async sendMessage() {
    if (!this.input) return;
    const now = Date.now();
    if (now - this.lastSent < 2000) { // Reduced to 2s for better UX
      this.addSystemMessage(`Doucement !`, true);
      return;
    }

    const txt = this.input.value.trim();
    if (!txt) return;
    if (txt.length > 100) return;

    const user = this.game.userManager.currentUser ? this.game.userManager.currentUser.pseudo : "INVITÉ";

    try {
      await addDoc(collection(db, "chat"), {
        pseudo: user,
        message: txt,
        timestamp: serverTimestamp()
      });
      this.input.value = '';
      this.lastSent = now;
    } catch (e) {
      console.error("Chat error", e);
      this.addSystemMessage("Erreur d'envoi.", true);
    }
  }

  renderMessage(user, text) {
    if (!this.msgList) return;
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<span class="chat-author">${user}:</span><span class="chat-text">${text}</span>`;
    this.msgList.appendChild(div);
  }

  addSystemMessage(text, ephemeral = false) {
    if (!this.msgList) return;
    const div = document.createElement('div');
    div.className = 'chat-msg system';
    div.innerText = text;
    this.msgList.appendChild(div);
    this.msgList.scrollTop = this.msgList.scrollHeight;

    if (ephemeral) {
      setTimeout(() => {
        div.style.transition = "opacity 0.5s";
        div.style.opacity = "0";
        setTimeout(() => div.remove(), 500);
      }, 1000);
    }
  }
}

class Game {
  constructor() {
    this.canvas = $('#gameCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());

    // Managers
    this.userManager = new UserManager();
    this.chat = new ChatProject(this);

    // Initial State
    this.state = 'LOGIN';
    this.setupLogin();

    // ...
    // ...
    this.camera = { x: 0, y: 0 };
    this.player = null;
    this.enemies = [];
    this.projectiles = [];
    this.particles = [];
    this.powerups = [];
    this.texts = [];

    this.keys = {};
    this.setupInput();

    this.wave = 1;
    this.waveTimer = 0;
    this.enemiesSpawned = 0;
    this.enemiesToSpawn = 15;
    this.hasDashed = false;
    this.waveAnnounce = null;
    this.healthDroppedInWave = false;

    this.gold = 0;
    this.kills = 0;
    this.totalKills = 0;
    this.waveKills = 0;
    this.scoreTime = 0;
    this.rageTimer = 0;

    this.xp = 0;
    this.level = 1;
    this.xpToNextLevel = 100;

    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);

    const bind = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
    bind('#startBtn', () => this.startGame());
    bind('#restartBtn', () => this.startRestartSequence());
    bind('#nextWaveBtn', () => this.closeShopAndContinue());
    bind('#ingameShopBtn', () => this.toggleShop());
    bind('#monsterListBtn', () => this.openMonsterList());
    bind('#closeMonsterListBtn', () => this.closeMonsterList());

    bind('#profile-display', () => this.openProfile());
    bind('#closeProfileBtn', () => this.closeProfile());

    window.addEventListener('keydown', e => {
      if (document.activeElement && (document.activeElement.tagName === 'INPUT')) return;
      if (e.code === 'Space') {
        this.toggleShop();
      }
    });

    // Upgrades...
    this.upgrades = [
      {
        id: 'dmg', name: 'Gros Calibre', desc: '+ Dégâts', cost: 15, costMult: 1.6,
        getValue: (p) => p.damage.toFixed(0), getNext: (p) => (p.damage + 2).toFixed(0),
        apply: (p) => p.upgrade('damage', 2)
      },

      {
        id: 'rate', name: 'Canon Rotatif', desc: '+ Cadence de tir', cost: 25, costMult: 1.7,
        getValue: (p) => (60 / p.fireRate).toFixed(1) + '/s', getNext: (p) => (60 / Math.max(5, p.fireRate - 1)).toFixed(1) + '/s',
        apply: (p) => p.upgrade('fireRate', 1)
      },

      {
        id: 'hp', name: 'Blindage', desc: '+ PV Max.', cost: 15, costMult: 1.15, maxLevel: 20,
        getValue: (p) => p.maxHp, getNext: (p) => Math.min(150, p.maxHp + 5),
        apply: (p) => { if (p.maxHp < 150) p.upgrade('maxHp', 5); }
      },

      {
        id: 'heal', name: 'Pack de Soin', desc: 'Soin immédiat (+50 HP)', cost: 100, costMult: 1.0, isConsumable: true,
        getValue: (p) => Math.floor(p.hp) + '/' + Math.floor(p.maxHp), getNext: (p) => "Max",
        apply: (p) => p.heal(50)
      },

      {
        id: 'multi', name: 'Tir Latéral', desc: 'Ajoute 1 canon sur le côté', cost: 200, costMult: 100, maxLevel: 1,
        getValue: (p) => p.multiShot + 'x', getNext: (p) => (p.multiShot + 1) + 'x',
        apply: (p) => p.upgrade('multiShot', 1)
      },
    ];
    this.shopLevels = {};
    this.upgrades.forEach(u => this.shopLevels[u.id] = 1);
  }

  setupInput() {
    window.addEventListener('keydown', e => {
      if (document.activeElement === $('#chatInput')) return;

      if (e.key === 'Shift') {
        if (this.player && !this.player.isDead) {
          if (this.player.dash()) this.hasDashed = true;
        }
      }
      if (e.code === 'Space') return;

      this.keys[e.code] = true; // Use Code to ignore CapsLock/Layout shifts
    });
    window.addEventListener('keyup', e => this.keys[e.code] = false);
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const container = $('#game-container');
    if (container) {
      this.canvas.width = container.clientWidth || 800;
      this.canvas.height = container.clientHeight || 600;
      if (this.canvas.width < 100) this.canvas.width = 800;
      if (this.canvas.height < 100) this.canvas.height = 600;
    }
  }

  startRestartSequence() {
    const overlay = $('#countdown-overlay');
    const num = $('#countdownValue');
    if (overlay) overlay.classList.remove('hidden');

    let count = 3;
    if (num) num.innerText = count;

    const intv = setInterval(() => {
      count--;
      if (count <= 0) {
        clearInterval(intv);
        if (overlay) overlay.classList.add('hidden');
        this.resetGame();
      } else {
        if (num) num.innerText = count;
      }
    }, 1000);
  }

  resetGame() {
    this.player = new Player({ x: CONF.WORLD.WIDTH / 2, y: CONF.WORLD.HEIGHT / 2 });
    this.enemies = [];
    this.projectiles = [];
    this.particles = [];
    this.powerups = [];
    this.texts = [];
    this.gold = 0;
    this.kills = 0;
    this.totalKills = 0;
    this.waveKills = 0;
    this.scoreTime = 0;
    this.rageTimer = 0;
    this.hasDashed = false;
    this.shopLevels = {};
    this.upgrades.forEach(u => this.shopLevels[u.id] = 1);
    this.healthDroppedInWave = false;

    // Reset Score Saved Flag
    this.scoreSaved = false;

    this.xp = 0;
    this.level = 1;
    this.xpToNextLevel = 100;
    this.wave = 1;

    this.startGame();
  }


  startGame() {
    if (!this.player) this.resetGame();

    // Ensure we hide ALL screens
    document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));

    // Explicitly hide Login/Start if they stuck
    $('#login-screen').classList.add('hidden');
    $('#start-screen').classList.add('hidden');

    const hud = $('#hud');
    if (hud) hud.classList.remove('hidden');
    const shopBtn = $('#ingameShopBtn');
    if (shopBtn) shopBtn.classList.remove('hidden');

    this.state = 'PLAYING';
    this.enemiesSpawned = 0;

    const calc = Math.floor(CONF.WAVE.baseCount * Math.pow(CONF.WAVE.difficultyMultiplier, this.wave - 1));
    this.enemiesToSpawn = calc > 0 ? calc : 15;

    this.waveKills = 0;
    this.waveTimer = 0;

    const wv = $('#waveValue');
    if (wv) wv.innerText = this.wave;
    this.updateXpBar();
    this.waveAnnounce = new WaveAnnouncement(this.wave);
  }

  // ... (rest of class)

  updateXpBar() {
    const pct = Math.min(100, (this.xp / this.xpToNextLevel) * 100);
    const bg = $('#xpBarFill');
    if (bg) bg.style.width = `${pct}%`;
    const lvl = $('#levelValue');
    if (lvl) lvl.innerText = this.level;
  }

  gainXp(amount) {
    this.xp += amount;
    if (this.xp >= this.xpToNextLevel) {
      this.xp -= this.xpToNextLevel;
      this.level++;
      this.xpToNextLevel = Math.floor(this.xpToNextLevel * 1.2);
      this.spawnText(this.player.x, this.player.y - 50, "NIVEAU UP!", "#00f0ff");
    }
    this.updateXpBar();
  }

  closeShopAndContinue() {
    this.state = 'PLAYING';
    document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
    const hud = $('#hud');
    if (hud) hud.classList.remove('hidden');
  }

  toggleShop() {
    if (this.state === 'SHOP') {
      this.closeShopAndContinue();
    } else if (this.state === 'PLAYING') {
      this.state = 'SHOP';
      $('#shop-screen').classList.remove('hidden');
      $('#shopGold').innerText = Math.floor(this.gold);
      const btn = $('#nextWaveBtn');
      if (btn) btn.innerHTML = 'RETOUR AU JEU <span style="font-size:0.5em; opacity:0.7">[ESPACE]</span>';
      this.renderShop();
    }
  }

  enterForcedShop() {
    this.state = 'SHOP';
    $('#shop-screen').classList.remove('hidden');
    $('#shopGold').innerText = Math.floor(this.gold);
    const btn = $('#nextWaveBtn');
    if (btn) btn.innerHTML = 'VAGUE SUIVANTE <span style="font-size:0.5em; opacity:0.7">[ESPACE]</span>';
    this.renderShop();

    if (this.player.regen > 0) {
      this.player.heal(this.player.regen);
    }
  }

  renderShop() {
    const grid = $('#upgradesGrid');
    if (!grid) return;
    grid.innerHTML = '';

    this.upgrades.forEach(u => {
      const level = this.shopLevels[u.id];
      const maxed = u.maxLevel && level > u.maxLevel;

      // Cost Always Shown
      const currentCost = Math.floor(u.cost * Math.pow(u.costMult, level - 1));
      let canBuy = this.gold >= currentCost;

      if (u.id === 'multi' && this.player.multiShot >= 1) canBuy = false;

      const currentVal = u.getValue(this.player);
      let nextVal = u.getNext(this.player);

      let levelDisplay = `Niv. ${level}`;
      if (u.isConsumable) levelDisplay = "Conso.";
      if (u.id === 'multi' && this.player.multiShot >= 1) {
        levelDisplay = "MAX";
        nextVal = "MAX";
        canBuy = false;
      }
      if (maxed && !u.isConsumable && u.id !== 'multi') {
        levelDisplay = "MAX";
        nextVal = "MAX";
      }

      const card = document.createElement('div');
      card.className = `upgrade-card ${canBuy ? '' : 'disabled'}`;
      card.innerHTML = `
        <div class="card-header">
           <div class="level-badge">${levelDisplay}</div>
           <h4>${u.name}</h4>
        </div>
        <div class="card-body">
            <p class="desc">${u.desc}</p>
            <div class="stats-row">
                <span class="curr">${currentVal}</span>
                <span class="arrow">${u.isConsumable ? '' : '➜'}</span>
                <span class="next">${u.isConsumable ? '' : nextVal}</span>
            </div>
            <div class="cost-row">
                <span class="cost-label">COÛT</span>
                <div class="cost">${maxed && !u.isConsumable ? '-' : currentCost}</div>
            </div>
        </div>
      `;
      card.onclick = () => {
        if (canBuy) {
          this.gold -= currentCost;
          u.apply(this.player);
          if (!u.isConsumable) {
            this.shopLevels[u.id]++;
          }
          const sg = $('#shopGold'); if (sg) sg.innerText = Math.floor(this.gold);
          const gv = $('#goldValue'); if (gv) gv.innerText = Math.floor(this.gold);
          this.renderShop();
          this.checkShopButton();
        }
      };
      grid.appendChild(card);
    });
  }

  checkShopButton() {
    let canAfford = false;
    this.upgrades.forEach(u => {
      const level = this.shopLevels[u.id];
      const maxed = u.maxLevel && level > u.maxLevel;
      const cost = Math.floor(u.cost * Math.pow(u.costMult, level - 1));
      if (maxed && !u.isConsumable) return;
      if (u.id === 'multi' && this.player.multiShot >= 1) return;
      if (this.gold >= cost) canAfford = true;
    });

    const btn = $('#ingameShopBtn');
    if (!btn) return;
    if (canAfford) btn.classList.add('can-buy');
    else btn.classList.remove('can-buy');
  }

  spawnEnemy() {
    if (this.wave % 10 === 0 && this.enemiesSpawned === 0) {
      if (this.enemies.filter(e => e.type === 'BOSS').length === 0) {
        const boss = new Enemy('BOSS', CONF.WORLD.WIDTH, CONF.WORLD.HEIGHT, this.player);
        boss.maxHp = 1000 * (1 + (this.wave * 0.2));
        boss.hp = boss.maxHp;
        this.enemies.push(boss);
        this.enemiesToSpawn = 1;
        this.spawnText(this.player.x, this.player.y - 100, "⚠️ BOSS ⚠️", "#ff0000");
        return;
      }
    }

    const r = Math.random();
    let type = 'TYPE1';
    if (this.wave > 1 && r > 0.7) type = 'TYPE2';
    if (this.wave > 2 && r > 0.85) type = 'TYPE4';
    if (this.wave > 4 && r > 0.90) type = 'TYPE5';
    if (this.wave > 3 && r > 0.95) type = 'TYPE3';
    if (this.wave > 4 && r > 0.92 && r < 0.97) type = 'TYPE6';
    // Laser Enemy Chance > Wave 6
    if (this.wave > 6 && r > 0.88 && r < 0.92) type = 'TYPE7';

    if (!CONF.ENEMIES[type]) type = 'TYPE1';

    const enemy = new Enemy(type, CONF.WORLD.WIDTH, CONF.WORLD.HEIGHT, this.player);
    enemy.maxHp *= (1 + (this.wave * 0.1));
    enemy.hp = enemy.maxHp;
    this.enemies.push(enemy);
  }

  handlePlayerShooting() {
    if (this.player.cooldown <= 0) {
      let nearest = null;
      let minDst = Infinity;

      for (const e of this.enemies) {
        const d = dist(this.player.x, this.player.y, e.x, e.y);
        const inCamX = e.x >= this.camera.x && e.x <= this.camera.x + this.canvas.width;
        const inCamY = e.y >= this.camera.y && e.y <= this.camera.y + this.canvas.height;
        if (!inCamX || !inCamY) continue;
        if (d < minDst) {
          minDst = d;
          nearest = e;
        }
      }

      const range = 600;
      if (nearest && minDst < range) {
        const angle = Math.atan2(nearest.y - this.player.y, nearest.x - this.player.x);
        let speed = CONF.PLAYER.BASE_PROJECTILE_SPEED;
        let color = '#ffaaaa';
        if (this.rageTimer > 0) {
          speed *= 1.5;
          color = '#ffaa00';
          speed = 18;
        }
        this.projectiles.push(new Projectile(this.player.x, this.player.y, angle, this.player.damage, speed, color, false));
        if (this.player.multiShot > 0) {
          const spread = 0.3;
          for (let i = 1; i <= this.player.multiShot; i++) {
            this.projectiles.push(new Projectile(this.player.x, this.player.y, angle - (spread * i), this.player.damage * 0.7, speed, color, false));
            this.projectiles.push(new Projectile(this.player.x, this.player.y, angle + (spread * i), this.player.damage * 0.7, speed, color, false));
          }
        }
        let rate = this.player.fireRate;
        if (this.rageTimer > 0) rate /= 2;
        this.player.cooldown = rate;
      }
    }
  }

  setupLogin() {
    const pseudoInput = $('#loginPseudo');
    const pinInput = $('#loginPin');
    const pinConfirmInput = $('#loginPinConfirm');
    const btn = $('#loginBtn');
    const errorMsg = $('#login-error');
    const pinSection = $('#pin-section');
    const confirmSection = $('#pin-confirm-section');

    let isRegistering = false;

    if (pinSection) pinSection.classList.add('hidden');
    if (confirmSection) confirmSection.classList.add('hidden');

    // Debounced check or manual check
    const checkUser = async () => {
      try {
        if (!pseudoInput) return;
        const pseudo = pseudoInput.value.trim().toUpperCase();
        if (pseudo.length < 3) return;

        $('#pin-instruction').innerText = "Vérification disponibilité...";

        // Check DB
        const exists = await this.userManager.exists(pseudo);

        if (exists) {
          isRegistering = false;
          pinSection.classList.remove('hidden');
          confirmSection.classList.add('hidden');
          $('#pin-instruction').innerText = "Compte trouvé. Entrez votre PIN.";
        } else {
          isRegistering = true;
          pinSection.classList.remove('hidden');
          confirmSection.classList.remove('hidden');
          $('#pin-instruction').innerText = "Nouveau compte. Créez un PIN (4 chiffres).";
        }
      } catch (e) {
        console.error("CheckUser Error:", e);
        $('#pin-instruction').innerText = "Erreur de connexion (Check).";
      }
    };

    if (pseudoInput) {
      pseudoInput.onblur = checkUser;
      pseudoInput.onkeyup = (e) => {
        if (e.key === 'Enter') checkUser();
      };
    }

    if (btn) btn.onclick = async () => {
      const pseudo = pseudoInput.value.trim().toUpperCase();
      const pin = pinInput.value.trim();

      if (!pseudo || pseudo.length > 12) {
        errorMsg.innerText = "Pseudo invalide (3-12 caractères).";
        return;
      }
      if (!pin || pin.length !== 4 || isNaN(pin)) {
        errorMsg.innerText = "Le PIN doit faire 4 chiffres.";
        return;
      }

      const originalText = btn.innerText;
      btn.innerText = "Connexion...";
      btn.disabled = true;

      try {
        if (isRegistering) {
          const confirm = pinConfirmInput.value.trim();
          if (pin !== confirm) {
            throw new Error("Les PINs ne correspondent pas.");
          }
          const success = await this.userManager.create(pseudo, pin);
          if (success) {
            await this.userManager.login(pseudo, pin);
            this.onLoginSuccess();
          } else {
            throw new Error("Impossible de créer le compte (Pseudo pris ?).");
          }
        } else {
          const success = await this.userManager.login(pseudo, pin);
          if (success) {
            this.onLoginSuccess();
          } else {
            throw new Error("PIN incorrect ou utilisateur introuvable.");
          }
        }
      } catch (e) {
        console.error("Login Action Error:", e);
        errorMsg.innerText = e.message || "Erreur inconnue.";
        btn.innerText = originalText;
        btn.disabled = false;
      }
    };
  }

  onLoginSuccess() {
    // Transition to Start Screen
    const loginScr = $('#login-screen');
    const startScr = $('#start-screen'); // Ensure this ID is correct in HTML

    if (loginScr) loginScr.classList.add('hidden');
    if (startScr) startScr.classList.remove('hidden');

    const pDisplay = $('#playerPseudo');
    if (pDisplay && this.userManager.currentUser) {
      pDisplay.innerText = this.userManager.currentUser.pseudo;
    }

    this.state = 'MENU';
    this.updateLeaderboard();
  }

  startGame() {
    try {
      if (!this.player) this.resetGame();

      // Hide UI Screens
      ['#login-screen', '#start-screen', '#game-over-screen', '#shop-screen', '#profile-modal'].forEach(sel => {
        const el = $(sel);
        if (el) el.classList.add('hidden');
      });

      // Show HUD
      const hud = $('#hud');
      if (hud) hud.classList.remove('hidden');
      const shopBtn = $('#ingameShopBtn');
      if (shopBtn) shopBtn.classList.remove('hidden');

      this.state = 'PLAYING';
      this.enemiesSpawned = 0;

      const calc = Math.floor(CONF.WAVE.baseCount * Math.pow(CONF.WAVE.difficultyMultiplier, this.wave - 1));
      this.enemiesToSpawn = calc > 0 ? calc : 15;

      this.waveKills = 0;
      this.waveTimer = 0;

      const wv = $('#waveValue');
      if (wv) wv.innerText = this.wave;
      this.updateXpBar();
      this.waveAnnounce = new WaveAnnouncement(this.wave);

      console.log("Game Started. State:", this.state);
    } catch (e) {
      console.error("StartGame Error:", e);
      alert("Erreur au lancement du jeu: " + e.message);
    }
  }

  async updateLeaderboard() {
    // #rank-game = "TOP TUEURS (PARTIE)" -> We want BEST SCORE (Unique Player)
    // #rank-total = "LÉGENDES (TOTAL)" -> We want TOTAL KILLS (Cumulative)

    const bestScoreList = $('#rank-game');
    const totalKillsList = $('#rank-total');

    if (bestScoreList) bestScoreList.innerHTML = '<li style="color:#888; text-align:center;">Chargement...</li>';
    if (totalKillsList) totalKillsList.innerHTML = '<li style="color:#888; text-align:center;">Chargement...</li>';

    // 1. TOP TUEURS (Best Score Unique)
    try {
      const q = query(collection(db, "users"), orderBy("bestScore", "desc"), limit(8));
      const snap = await getDocs(q);

      if (bestScoreList) {
        bestScoreList.innerHTML = '';
        if (snap.empty) {
          bestScoreList.innerHTML = '<li style="color:#555; text-align:center;">Aucun score.</li>';
        } else {
          let rank = 1;
          snap.forEach(doc => {
            const d = doc.data();
            if ((d.bestScore || 0) > 0) {
              const li = document.createElement('li');
              li.innerHTML = `<span>${rank}. ${d.pseudo}</span> <span>${d.bestScore}</span>`;
              bestScoreList.appendChild(li);
              rank++;
            }
          });
        }
      }
    } catch (e) {
      console.error("Best Score Error:", e);
      if (bestScoreList) bestScoreList.innerHTML = '<li style="color:red; font-size:0.7rem;">Erreur index (bestScore).</li>';
    }

    // 2. LÉGENDES (Total Kills Cumulative)
    // We need an index on 'totalKills' desc.
    try {
      const q2 = query(collection(db, "users"), orderBy("totalKills", "desc"), limit(5));
      const snap2 = await getDocs(q2);

      if (totalKillsList) {
        totalKillsList.innerHTML = '';
        if (snap2.empty) {
          totalKillsList.innerHTML = '<li style="color:#555; text-align:center;">Aucune légende.</li>';
        } else {
          let rank = 1;
          snap2.forEach(doc => {
            const d = doc.data();
            // Show only if they have kills
            if ((d.totalKills || 0) > 0) {
              const li = document.createElement('li');
              li.innerHTML = `<span>${rank}. ${d.pseudo}</span> <span>${d.totalKills}</span>`;
              totalKillsList.appendChild(li);
              rank++;
            }
          });
        }
      }
    } catch (e) {
      console.error("Total Kills Error:", e);
      if (totalKillsList) totalKillsList.innerHTML = '<li style="color:red; font-size:0.7rem;">Erreur index (totalKills).</li>';
    }
  }

  closeProfile() {
    const modal = $('#profile-modal');
    if (modal) modal.classList.add('hidden');

    // Resume logic
    if (this.player && !this.player.isDead) {
      this.state = 'PLAYING';
    } else {
      // If we are in menu (no player), stay in MENU
      this.state = 'MENU';
    }
  }


  // Re-verify openProfile isn't broken
  async openProfile() {
    if (!this.userManager.currentUser) return;
    const modal = $('#profile-modal');
    const currentUser = this.userManager.currentUser;

    // Basic Fill
    const pStats = modal.querySelector('.profile-stats');
    if (pStats) {
      pStats.innerHTML = `
              <h3>INFO JOUEUR</h3>
              <div class="stat-block"><span style="font-size:0.8rem; color:#888;">PSEUDO</span><span class="stat-value highlight">${currentUser.pseudo}</span></div>
              <div style="text-align:center; margin-top:10px; color:#666;">Récupération stats...</div>
          `;
    }

    modal.classList.remove('hidden');
    this.state = 'PAUSED';

    // Async Fetch
    const stats = await this.userManager.getStats(currentUser.pseudo);

    if (pStats && stats) {
      pStats.innerHTML = `
              <h3>INFO JOUEUR</h3>
              <div class="stat-block">
                  <span style="font-size:0.8rem; color:#888;">PSEUDO</span>
                  <span class="stat-value highlight">${currentUser.pseudo}</span>
              </div>
              <div class="stat-block">
                  <span style="font-size:0.8rem; color:#888;">MEILLEUR SCORE</span>
                  <span class="stat-value">${stats.bestScore}</span>
              </div>
              <div class="stat-block">
                  <span style="font-size:0.8rem; color:#888;">PARTIES JOUÉES</span>
                  <span class="stat-value">${stats.totalGames}</span>
              </div>
          `;
    }

    // History
    const hList = $('#matchHistoryList');
    if (hList) {
      hList.innerHTML = '';
      if (stats && stats.history && stats.history.length > 0) {
        stats.history.forEach(m => {
          const li = document.createElement('li');
          const date = m.date && m.date.toDate ? m.date.toDate() : new Date();
          const dStr = `${date.getDate()}/${date.getMonth() + 1}`;
          li.innerHTML = `<span>${dStr}</span> <span>Vague ${m.wave} • <span style="color:#00f0ff">${m.kills} Kills</span></span>`;
          hList.appendChild(li);
        });
      } else {
        hList.innerHTML = '<li style="justify-content:center; color:#555;">Aucun historique.</li>';
      }
    }
  }

  spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      this.particles.push(new Particle(x, y, color, 5, Math.random() * 3));
    }
  }

  spawnText(x, y, text, color = '#fff') {
    this.texts.push(new FloatingText(x, y, text, color));
  }

  updateCamera() {
    if (!this.player) return;
    this.camera.x = this.player.x - this.canvas.width / 2;
    this.camera.y = this.player.y - this.canvas.height / 2;
    this.camera.x = Math.max(0, Math.min(this.camera.x, CONF.WORLD.WIDTH - this.canvas.width));
    this.camera.y = Math.max(0, Math.min(this.camera.y, CONF.WORLD.HEIGHT - this.canvas.height));
  }

  openMonsterList() {
    const modal = $('#monster-list-modal');
    const grid = $('#monster-grid');
    if (modal && grid) {
      modal.classList.remove('hidden');
      grid.innerHTML = '';
      Object.keys(CONF.ENEMIES).forEach(key => {
        const e = CONF.ENEMIES[key];
        const card = document.createElement('div');
        card.className = 'monster-card';

        let preview = '';
        if (key === 'BOSS') preview = `<span style="color:#000080; font-weight:900;">RSB</span>`;
        else if (key === 'TYPE7') preview = `<div style="width:15px; height:15px; background:red; border:1px solid white;"></div>`
        else preview = `<div style="width:20px; height:20px; border-radius:50%; background:${e.color}"></div>`;

        card.innerHTML = `
                  <div class="monster-preview">${preview}</div>
                  <div class="monster-name">${e.name || key}</div>
                  <div class="monster-desc">${e.desc || 'Pas de données.'}</div>
                  <div style="font-size:0.7rem; opacity:0.6; margin-top:5px;">HP: ${e.hp} | VIT: ${e.speed}</div>
              `;
        grid.appendChild(card);
      });
    }
    this.state = 'PAUSED';
  }

  closeMonsterList() {
    const modal = $('#monster-list-modal');
    if (modal) modal.classList.add('hidden');
    this.state = 'PLAYING';
  }

  update() {
    if (this.state === 'PAUSED' || this.state === 'LOGIN' || this.state === 'MENU') return;

    // If Game Over, only update visuals (particles/texts) and stop game logic
    if (this.state === 'GAMEOVER') {
      this.particles = this.particles.filter(p => p.alpha > 0);
      this.particles.forEach(p => p.update());
      this.texts = this.texts.filter(t => t.alpha > 0);
      this.texts.forEach(t => t.update());
      return;
    }

    if (this.state !== 'PLAYING' && this.state !== 'SHOP') return;

    if (this.state === 'SHOP') {
      return;
    }

    if (!this.player) return;

    this.scoreTime += 1 / 60;
    if (this.rageTimer > 0) this.rageTimer--;
    if (this.waveAnnounce) this.waveAnnounce.update();

    if (performance.now() % 500 < 20) this.checkShopButton();

    this.waveTimer++;
    if (this.waveTimer > CONF.WAVE.spawnInterval && this.enemiesSpawned < this.enemiesToSpawn) {
      this.spawnEnemy();
      this.enemiesSpawned++;
      this.waveTimer = 0;
    }

    if (this.enemiesSpawned >= this.enemiesToSpawn && this.enemies.length === 0) {
      if (this.wave % 10 === 0) {
        this.enterForcedShop();
        this.wave++;
        this.healthDroppedInWave = false;
        this.enemiesSpawned = 0;
        this.waveKills = 0;

        const calc = Math.floor(CONF.WAVE.baseCount * Math.pow(CONF.WAVE.difficultyMultiplier, this.wave - 1));
        this.enemiesToSpawn = calc > 0 ? calc : 15;

        this.waveTimer = 0;
        return;
      } else {
        this.wave++;
        this.healthDroppedInWave = false;
        this.enemiesSpawned = 0;
        this.waveKills = 0;

        const calc = Math.floor(CONF.WAVE.baseCount * Math.pow(CONF.WAVE.difficultyMultiplier, this.wave - 1));
        this.enemiesToSpawn = calc > 0 ? calc : 15;

        this.waveTimer = 0;
        const wv = $('#waveValue'); if (wv) wv.innerText = this.wave;
        this.waveAnnounce = new WaveAnnouncement(this.wave);
        if (this.player.regen > 0) this.player.heal(this.player.regen * 0.2);
      }
    }

    this.player.update(this.keys, CONF.WORLD.WIDTH, CONF.WORLD.HEIGHT);
    this.updateCamera();
    this.handlePlayerShooting();

    this.powerups.forEach((p, index) => {
      p.update(1 / 60);
      if (p.lifetime <= 0) {
        this.powerups.splice(index, 1);
        return;
      }
      if (dist(this.player.x, this.player.y, p.x, p.y) < this.player.radius + p.radius) {
        if (p.type === 'HEAL') {
          this.player.heal(10);
          this.spawnText(this.player.x, this.player.y, "+10 HP", "#00ff00");
        } else if (p.type === 'RAGE') {
          this.rageTimer = 600;
          this.spawnText(this.player.x, this.player.y, "RAGE MODE!", "#ff9900");
        } else if (p.type === 'COIN') {
          const val = Math.floor(rand(1, 4));
          this.gold += val;
          this.spawnText(this.player.x, this.player.y, `+${val} OR`, "#ffd700");
        }
        this.powerups.splice(index, 1);
      }
    });

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.update(CONF.WORLD.WIDTH, CONF.WORLD.HEIGHT);
      if (p.markedForDeletion) {
        this.projectiles.splice(i, 1);
        continue;
      }
      if (p.isEnemy) {
        if (dist(p.x, p.y, this.player.x, this.player.y) < this.player.radius + p.radius) {
          this.player.takeDamage(10);
          this.spawnText(this.player.x, this.player.y - 20, "-10", "#ff0000");
          p.markedForDeletion = true;
          this.spawnParticles(this.player.x, this.player.y, '#ff0000', 3);
        }
      } else {
        for (const e of this.enemies) {
          if (dist(p.x, p.y, e.x, e.y) < e.radius + p.radius) {
            // Ghost Logic (immune while player moves)
            if (e.phase && this.player.isMoving) break;

            e.hp -= p.damage;
            p.markedForDeletion = true;
            this.spawnParticles(e.x, e.y, e.color, 2);
            if (e.hp <= 0 && !e.dead) {
              e.dead = true;

              // Drop Logic
              const r = Math.random();
              if (r < 0.05) {
                let type = 'COIN';
                // Healing rarity 30% of drops IF not dropped this wave
                if (!this.healthDroppedInWave && Math.random() < 0.3) {
                  type = 'HEAL';
                  this.healthDroppedInWave = true;
                } else if (Math.random() < 0.3) {
                  type = 'RAGE';
                }
                this.powerups.push(new PowerUp(e.x, e.y, type));
              }

              this.gainXp(e.scoreValue);
            }
            break;
          }
        }
      }
    }

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) {
        this.gold += e.goldValue;
        this.kills++;
        this.totalKills++;
        this.waveKills++;
        this.enemies.splice(i, 1);
        this.spawnParticles(e.x, e.y, e.color, 10);
        continue;
      }
      e.update(CONF.WORLD.WIDTH, CONF.WORLD.HEIGHT, this.player, this.projectiles, this.wave);
      if (dist(e.x, e.y, this.player.x, this.player.y) < e.radius + this.player.radius) {
        this.player.takeDamage(1);
      }
    }

    this.particles = this.particles.filter(p => p.alpha > 0);
    this.particles.forEach(p => p.update());
    this.texts = this.texts.filter(t => t.alpha > 0);
    this.texts.forEach(t => t.update());

    if (this.player.isDead) {
      this.state = 'GAMEOVER';
      const gos = $('#game-over-screen'); if (gos) gos.classList.remove('hidden');
      const hud = $('#hud'); if (hud) hud.classList.add('hidden');
      const btn = $('#ingameShopBtn'); if (btn) btn.classList.add('hidden');

      const ft = $('#finalTime');
      // No time display

      const fk = $('#finalKills');
      if (fk) fk.innerText = this.kills;

      // SAVE SCORE
      if (this.userManager.currentUser && !this.scoreSaved) {
        this.userManager.addMatch(this.userManager.currentUser.pseudo, this.kills, this.wave);
        this.scoreSaved = true;
        this.updateLeaderboard(); // Refresh UI immediately
      }
    }

    const sv = $('#scoreValue'); if (sv) sv.classList.add('hidden');
    const kv = $('#killsValue'); if (kv) kv.innerText = this.waveKills;
    const tv = $('#sessionKillsValue'); if (tv) tv.innerText = this.totalKills;
    const tev = $('#totalEnemiesValue'); if (tev) tev.innerText = this.enemiesToSpawn;
    const gVal = $('#goldValue'); if (gVal) gVal.innerText = Math.floor(this.gold);
  }

  draw() {
    this.ctx.globalAlpha = 1;
    this.ctx.fillStyle = CONF.COLORS.BG;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.ctx.save();
    if (this.camera) this.ctx.translate(-this.camera.x, -this.camera.y);

    this.ctx.strokeStyle = '#1a1a1a';
    this.ctx.lineWidth = 1;
    const gridSize = 60;

    if (this.canvas.width) {
      const startX = Math.floor(this.camera.x / gridSize) * gridSize;
      const startY = Math.floor(this.camera.y / gridSize) * gridSize;
      const endX = startX + this.canvas.width + gridSize;
      const endY = startY + this.canvas.height + gridSize;

      this.ctx.beginPath();
      for (let x = startX; x < endX; x += gridSize) {
        this.ctx.moveTo(x, startY);
        this.ctx.lineTo(x, endY);
      }
      for (let y = startY; y < endY; y += gridSize) {
        this.ctx.moveTo(startX, y);
        this.ctx.lineTo(endX, y);
      }
      this.ctx.stroke();
    }

    this.ctx.strokeStyle = '#333';
    this.ctx.lineWidth = 5;
    this.ctx.strokeRect(0, 0, CONF.WORLD.WIDTH, CONF.WORLD.HEIGHT);

    if (this.state === 'PLAYING' || this.state === 'SHOP') {
      this.powerups.forEach(p => p.draw(this.ctx));

      if (this.player && !this.player.isDead) this.player.draw(this.ctx);
      this.enemies.forEach(e => e.draw(this.ctx, this.player && this.player.isMoving));
      this.projectiles.forEach(p => p.draw(this.ctx));
      this.particles.forEach(p => p.draw(this.ctx));
      this.texts.forEach(t => t.draw(this.ctx));

      if (this.rageTimer > 0) {
        const pct = this.rageTimer / 600;
        this.ctx.fillStyle = '#ff9900';
        this.ctx.fillRect(this.player.x - 20, this.player.y + 30, 40 * pct, 3);
      }

      if (!this.hasDashed) {
        this.ctx.fillStyle = 'rgba(0, 240, 255, 0.7)';
        this.ctx.font = 'bold 20px "Outfit"';
        this.ctx.textAlign = 'center';
        this.ctx.fillText("SHIFT pour DASH !", this.player.x, this.player.y + 60);
      }
    }

    this.ctx.restore();

    if (this.state === 'PLAYING') {
      this.drawMinimap(this.ctx);
      if (this.waveAnnounce) this.waveAnnounce.draw(this.ctx, this.canvas.width, this.canvas.height);
    }
  }

  drawMinimap(ctx) {
    const size = 150;
    const scaleX = size / CONF.WORLD.WIDTH;
    const scaleY = size / CONF.WORLD.HEIGHT;
    // Moved down to avoid sleek UI collision
    const x = 20;
    const y = 220;

    ctx.save();
    ctx.translate(x, y);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeRect(0, 0, size, size);

    this.enemies.forEach(e => {
      let color = e.color;
      if (e.type === 'BOSS') color = '#ff0000';
      if (e.type === 'TYPE7') color = '#f00';
      ctx.fillStyle = color;
      const es = e.type === 'BOSS' ? 6 : 3;
      ctx.fillRect(e.x * scaleX - es / 2, e.y * scaleY - es / 2, es, es);
    });

    if (this.player) {
      ctx.fillStyle = '#ff3e3e';
      ctx.beginPath();
      ctx.arc(this.player.x * scaleX, this.player.y * scaleY, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(this.camera.x * scaleX, this.camera.y * scaleY, this.canvas.width * scaleX, this.canvas.height * scaleY);

    ctx.restore();
  }

  loop(timestamp) {
    this.update();
    this.draw();
    requestAnimationFrame(this.loop);
  }
}

window.onload = () => {
  new Game();
};
