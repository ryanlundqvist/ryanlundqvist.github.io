const { useState, useRef, useEffect, useCallback } = React;

// ═══════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════
const W = 780, H = 480, CELL = 4;
const COLS = Math.floor(W / CELL), ROWS = Math.floor(H / CELL);

const START_TOXIC_COLOR = { r: 95, g: 80, b: 105 };
const START_NONTOXIC_COLORS = {
  nontoxic_a: { r: 90, g: 100, b: 50 },
  nontoxic_b: { r: 120, g: 110, b: 55 },
};
const NONTOXIC_SPECIES = ["nontoxic_a", "nontoxic_b"];
const START_BIRD_GENOME = {
  avoidColor: { r: 128, g: 128, b: 128 },
  avoidSharpness: 50,
  caution: 0.12,
};

const CFG = {
  toxicSnakes: 20,
  nonToxicPerSpecies: 20,
  birds: 20,
  snakeLen: 5,
  birdFov: Math.PI / 2.5,
  birdRange: 26,
  snakeMutRate: 6,
  birdMutRate: 8,
  birdEnMax: 600,
  birdEnGain: 80,
  birdEnLoss: 0.35,
  snakeReprAge: 60,
  snakeReprChance: 0.06,
  snakeMateRange: 20,
  birdReprEn: 590,
  birdBonusAge: 1100,
  minBirdPop: 4,
  minSnakePop: 6,
  maxSnakes: 9999,
  maxBirds: 9999,
  snakeMoveEvery: 2,
  birdMoveEvery: 1,
  snakeCarryingCap: 150,
  snakeMaxAge: 600,
  birdMaxAge: 1400,
};

// ═══════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════
const isToxic = (sp) => sp === "toxic";
const isNontoxic = (sp) => sp.startsWith("nontoxic");
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));

function colorDist(c1, c2) {
  return Math.sqrt((c1.r - c2.r) ** 2 + (c1.g - c2.g) ** 2 + (c1.b - c2.b) ** 2);
}

function mutColor(c, rate) {
  return {
    r: clamp(c.r + rand(-rate, rate), 0, 255),
    g: clamp(c.g + rand(-rate, rate), 0, 255),
    b: clamp(c.b + rand(-rate, rate), 0, 255),
  };
}

function blendColor(c1, c2, rate) {
  return mutColor({
    r: (c1.r + c2.r) / 2 + rand(-5, 5),
    g: (c1.g + c2.g) / 2 + rand(-5, 5),
    b: (c1.b + c2.b) / 2 + rand(-5, 5),
  }, rate);
}

function avgColor(entities, key = "color") {
  if (!entities.length) return { r: 128, g: 128, b: 128 };
  const sum = entities.reduce((a, e) => {
    const c = key === "color" ? e.color : e.genome.avoidColor;
    return { r: a.r + c.r, g: a.g + c.g, b: a.b + c.b };
  }, { r: 0, g: 0, b: 0 });
  return {
    r: Math.round(sum.r / entities.length),
    g: Math.round(sum.g / entities.length),
    b: Math.round(sum.b / entities.length),
  };
}

function cssColor(c) {
  return `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`;
}

// ═══════════════════════════════════════════
// BACKGROUND
// ═══════════════════════════════════════════
function generateBackground() {
  const bg = new Uint8Array(COLS * ROWS * 3);
  for (let i = 0; i < COLS * ROWS; i++) {
    bg[i * 3] = rand(35, 55);
    bg[i * 3 + 1] = rand(65, 90);
    bg[i * 3 + 2] = rand(25, 45);
  }
  const numBlobs = 35 + randInt(0, 15);
  for (let b = 0; b < numBlobs; b++) {
    const cx = rand(0, COLS);
    const cy = rand(0, ROWS);
    const rx = rand(6, 22);
    const ry = rand(6, 22);
    const angle = rand(0, Math.PI);
    const cosA = Math.cos(angle), sinA = Math.sin(angle);
    for (let x = Math.max(0, Math.floor(cx - rx - 2)); x < Math.min(COLS, Math.ceil(cx + rx + 2)); x++) {
      for (let y = Math.max(0, Math.floor(cy - ry - 2)); y < Math.min(ROWS, Math.ceil(cy + ry + 2)); y++) {
        const dx = x - cx, dy = y - cy;
        const lx = dx * cosA + dy * sinA;
        const ly = -dx * sinA + dy * cosA;
        if ((lx / rx) ** 2 + (ly / ry) ** 2 < 1) {
          const idx = y * COLS + x;
          bg[idx * 3] = rand(75, 105);
          bg[idx * 3 + 1] = rand(55, 80);
          bg[idx * 3 + 2] = rand(25, 45);
        }
      }
    }
  }
  return bg;
}

function getBgColor(bg, cx, cy) {
  const x = clamp(Math.floor(cx), 0, COLS - 1);
  const y = clamp(Math.floor(cy), 0, ROWS - 1);
  const i = (y * COLS + x) * 3;
  return { r: bg[i], g: bg[i + 1], b: bg[i + 2] };
}

// ═══════════════════════════════════════════
// ENTITIES
// ═══════════════════════════════════════════
let nextId = 0;
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

function createSnake(species, color = null) {
  const x = randInt(5, COLS - 6);
  const y = randInt(5, ROWS - 6);
  let c = color;
  if (!c) {
    if (species === "toxic") c = { ...START_TOXIC_COLOR };
    else c = { ...(START_NONTOXIC_COLORS[species] || START_NONTOXIC_COLORS.nontoxic_a) };
  }
  const dir = randInt(0, 3);
  const segs = [];
  for (let i = 0; i < CFG.snakeLen; i++) {
    segs.push({ x: x - DIRS[dir][0] * i, y: y - DIRS[dir][1] * i });
  }
  return {
    id: nextId++, species, color: c, segments: segs,
    dir, age: 0, turnTimer: randInt(5, 20),
  };
}

function createBird(genome = null) {
  const g = genome || {
    avoidColor: { ...START_BIRD_GENOME.avoidColor },
    avoidSharpness: START_BIRD_GENOME.avoidSharpness,
    caution: START_BIRD_GENOME.caution,
  };
  return {
    id: nextId++,
    x: rand(10, COLS - 10), y: rand(10, ROWS - 10),
    angle: rand(0, Math.PI * 2),
    energy: CFG.birdEnMax * 0.8,
    age: 0, genome: g,
    cooldown: 0,
    reproduced: false,
    bonusReproduced: false,
  };
}

// ═══════════════════════════════════════════
// SIMULATION TICK
// ═══════════════════════════════════════════
function simTick(state) {
  const { snakes, birds, bg } = state;
  state.tick++;
  const t = state.tick;
  const deadSnakeIds = new Set();
  const deadBirdIds = new Set();
  const newSnakes = [];
  const newBirds = [];

  if (t % CFG.snakeMoveEvery === 0) {
    for (const s of snakes) {
      s.age++;
      s.turnTimer--;
      if (s.turnTimer <= 0) {
        if (Math.random() < 0.6) {
          s.dir = (s.dir + (Math.random() < 0.5 ? 1 : 3)) % 4;
        } else {
          s.dir = randInt(0, 3);
        }
        s.turnTimer = randInt(5, 25);
      }
      const head = s.segments[0];
      let nx = head.x + DIRS[s.dir][0];
      let ny = head.y + DIRS[s.dir][1];
      nx = ((nx % COLS) + COLS) % COLS;
      ny = ((ny % ROWS) + ROWS) % ROWS;
      s.segments.unshift({ x: nx, y: ny });
      s.segments.pop();

      if (s.age > CFG.snakeMaxAge) {
        deadSnakeIds.add(s.id);
        continue;
      }

      const totalSnakes = snakes.length - deadSnakeIds.size;
      const sameSpeciesCount = snakes.filter(o => o.species === s.species && !deadSnakeIds.has(o.id)).length;
      if (totalSnakes > CFG.snakeCarryingCap && sameSpeciesCount > 8) {
        const excess = (totalSnakes - CFG.snakeCarryingCap) / CFG.snakeCarryingCap;
        if (Math.random() < excess * 0.05) {
          deadSnakeIds.add(s.id);
          continue;
        }
      }
    }
  }

  if (t % CFG.birdMoveEvery === 0) {
    for (const b of birds) {
      if (deadBirdIds.has(b.id)) continue;
      b.age++;
      b.energy -= CFG.birdEnLoss;
      if (b.cooldown > 0) b.cooldown--;

      b.angle += rand(-0.3, 0.3);
      const speed = 1.2;
      b.x += Math.cos(b.angle) * speed;
      b.y += Math.sin(b.angle) * speed;
      b.x = ((b.x % COLS) + COLS) % COLS;
      b.y = ((b.y % ROWS) + ROWS) % ROWS;

      if (b.energy <= 0) {
        deadBirdIds.add(b.id);
        continue;
      }
      if (b.age > CFG.birdMaxAge) {
        deadBirdIds.add(b.id);
        continue;
      }
      if (b.cooldown > 0) continue;

      let bestSnake = null;
      let bestDist = Infinity;
      for (const s of snakes) {
        if (deadSnakeIds.has(s.id)) continue;
        const head = s.segments[0];
        let dx = head.x - b.x;
        let dy = head.y - b.y;
        if (dx > COLS / 2) dx -= COLS;
        if (dx < -COLS / 2) dx += COLS;
        if (dy > ROWS / 2) dy -= ROWS;
        if (dy < -ROWS / 2) dy += ROWS;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > CFG.birdRange) continue;

        const angleToSnake = Math.atan2(dy, dx);
        let angleDiff = angleToSnake - b.angle;
        angleDiff = ((angleDiff + Math.PI) % (Math.PI * 2)) - Math.PI;
        if (Math.abs(angleDiff) > CFG.birdFov / 2) continue;

        const bgC = getBgColor(bg, head.x, head.y);
        const contrast = colorDist(s.color, bgC) / 441.7;
        const detectProb = Math.pow(contrast, 0.4) * 0.93;
        if (Math.random() > detectProb) continue;

        if (dist < bestDist) {
          bestDist = dist;
          bestSnake = s;
        }
      }

      if (bestSnake) {
        const cDist = colorDist(bestSnake.color, b.genome.avoidColor);
        const rawAvoid = b.genome.caution * Math.exp(-(cDist * cDist) / (2 * b.genome.avoidSharpness * b.genome.avoidSharpness));
        const bgC = getBgColor(bg, bestSnake.segments[0].x, bestSnake.segments[0].y);
        const snakeContrast = colorDist(bestSnake.color, bgC) / 441.7;
        const sc = bestSnake.color;
        const brightness = (sc.r + sc.g + sc.b) / (255 * 3);
        const maxCh = Math.max(sc.r, sc.g, sc.b);
        const minCh = Math.min(sc.r, sc.g, sc.b);
        const saturation = maxCh > 0 ? (maxCh - minCh) / maxCh : 0;
        const vividness = 0.5 * brightness + 0.5 * saturation;
        const colorClarity = Math.pow(snakeContrast, 1.5) * 0.7 + vividness * 0.25 + 0.05;
        const avoidProb = rawAvoid * colorClarity;

        if (Math.random() < avoidProb) {
          b.angle += Math.PI * rand(0.5, 1.0) * (Math.random() < 0.5 ? 1 : -1);
          b.cooldown = 10;
        } else {
          const head = bestSnake.segments[0];
          let dx = head.x - b.x;
          let dy = head.y - b.y;
          if (dx > COLS / 2) dx -= COLS;
          if (dx < -COLS / 2) dx += COLS;
          if (dy > ROWS / 2) dy -= ROWS;
          if (dy < -ROWS / 2) dy += ROWS;

          if (bestDist < 3) {
            if (isToxic(bestSnake.species)) {
              deadBirdIds.add(b.id);
              deadSnakeIds.add(bestSnake.id);
            } else {
              b.energy = Math.min(b.energy + CFG.birdEnGain, CFG.birdEnMax);
              deadSnakeIds.add(bestSnake.id);
            }
            b.cooldown = 15;
          } else {
            b.angle = Math.atan2(dy, dx);
          }
        }
      }
    }
  }

  const toxicAlive = snakes.filter(s => isToxic(s.species) && !deadSnakeIds.has(s.id));
  const nonToxicAlive = snakes.filter(s => isNontoxic(s.species) && !deadSnakeIds.has(s.id));
  const matedSnakeIds = new Set();

  for (const s of snakes) {
    if (deadSnakeIds.has(s.id) || matedSnakeIds.has(s.id)) continue;
    if (s.age < CFG.snakeReprAge) continue;
    if (Math.random() > CFG.snakeReprChance) continue;

    let bestMate = null;
    let bestMateDist = Infinity;
    for (const m of snakes) {
      if (m.id === s.id || deadSnakeIds.has(m.id) || matedSnakeIds.has(m.id)) continue;
      if (m.species !== s.species || m.age < CFG.snakeReprAge) continue;
      const dx = s.segments[0].x - m.segments[0].x;
      const dy = s.segments[0].y - m.segments[0].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestMateDist && d < CFG.snakeMateRange) {
        bestMateDist = d;
        bestMate = m;
      }
    }

    if (bestMate) {
      matedSnakeIds.add(s.id);
      matedSnakeIds.add(bestMate.id);
      deadSnakeIds.add(s.id);
      deadSnakeIds.add(bestMate.id);
      const rate = CFG.snakeMutRate;
      // Equal clutch for toxic and non-toxic: avg 2.6 offspring per mating.
      const clutch = Math.random() < 0.6 ? 3 : 2;
      for (let c = 0; c < clutch; c++) {
        const child = createSnake(s.species, blendColor(s.color, bestMate.color, rate));
        newSnakes.push(child);
      }
    }
  }

  const birdsAlive = birds.filter(b => !deadBirdIds.has(b.id));

  for (const b of birds) {
    if (deadBirdIds.has(b.id)) continue;

    if (b.energy >= CFG.birdReprEn && !b.reproduced) {
      b.reproduced = true;
      b.energy -= 300;
      const clutch = randInt(1, 2);
      for (let c = 0; c < clutch; c++) {
        const childGenome = {
          avoidColor: mutColor(b.genome.avoidColor, CFG.birdMutRate),
          avoidSharpness: clamp(b.genome.avoidSharpness + rand(-10, 10), 20, 200),
          caution: clamp(b.genome.caution + rand(-0.04, 0.04), 0.05, 0.98),
        };
        newBirds.push(createBird(childGenome));
      }
    }

    if (b.age >= CFG.birdBonusAge && b.reproduced && !b.bonusReproduced && b.energy > 200) {
      b.bonusReproduced = true;
      b.energy -= 150;
      const childGenome = {
        avoidColor: mutColor(b.genome.avoidColor, CFG.birdMutRate),
        avoidSharpness: clamp(b.genome.avoidSharpness + rand(-8, 8), 20, 200),
        caution: clamp(b.genome.caution + rand(-0.03, 0.03), 0.05, 0.98),
      };
      newBirds.push(createBird(childGenome));
    }
  }

  if (toxicAlive.length > 0) state.lastToxicColor = avgColor(toxicAlive);
  for (const sp of NONTOXIC_SPECIES) {
    const members = nonToxicAlive.filter(s => s.species === sp);
    if (members.length > 0) {
      if (!state.lastNontoxicColors) state.lastNontoxicColors = {};
      state.lastNontoxicColors[sp] = avgColor(members);
    }
  }
  if (birdsAlive.length > 0) {
    state.lastBirdGenome = {
      avoidColor: avgColor(birdsAlive, "avoid"),
      avoidSharpness: birdsAlive.reduce((a, b) => a + b.genome.avoidSharpness, 0) / birdsAlive.length,
      caution: birdsAlive.reduce((a, b) => a + b.genome.caution, 0) / birdsAlive.length,
    };
  }

  if (toxicAlive.length < CFG.minSnakePop) {
    const baseColor = state.lastToxicColor;
    for (let i = toxicAlive.length; i < CFG.minSnakePop; i++)
      newSnakes.push(createSnake("toxic", mutColor(baseColor, CFG.snakeMutRate)));
  }
  for (const sp of NONTOXIC_SPECIES) {
    const alive = snakes.filter(s => s.species === sp && !deadSnakeIds.has(s.id));
    if (alive.length < CFG.minSnakePop) {
      const baseColor = (state.lastNontoxicColors && state.lastNontoxicColors[sp])
        || START_NONTOXIC_COLORS[sp];
      for (let i = alive.length; i < CFG.minSnakePop; i++)
        newSnakes.push(createSnake(sp, mutColor(baseColor, CFG.snakeMutRate)));
    }
  }
  if (birdsAlive.length < CFG.minBirdPop) {
    const bg2 = state.lastBirdGenome;
    for (let i = birdsAlive.length; i < CFG.minBirdPop; i++)
      newBirds.push(createBird({
        avoidColor: mutColor(bg2.avoidColor, CFG.birdMutRate),
        avoidSharpness: clamp(bg2.avoidSharpness + rand(-10, 10), 20, 200),
        caution: clamp(bg2.caution + rand(-0.04, 0.04), 0.05, 0.98),
      }));
  }

  state.snakes = snakes.filter(s => !deadSnakeIds.has(s.id)).concat(newSnakes);
  state.birds = birds.filter(b => !deadBirdIds.has(b.id)).concat(newBirds);

  if (t % 60 === 0) {
    const toxic = state.snakes.filter(s => isToxic(s.species));
    const nontoxic = state.snakes.filter(s => isNontoxic(s.species));
    const entry = {
      t,
      toxicPop: toxic.length,
      birdPop: state.birds.length,
      toxicColor: avgColor(toxic),
      nonToxicColor: avgColor(nontoxic),
      birdAvoid: avgColor(state.birds, "avoid"),
    };
    for (const sp of NONTOXIC_SPECIES) {
      entry[sp + "_pop"] = state.snakes.filter(s => s.species === sp).length;
    }
    state.history.push(entry);
    if (state.history.length > 300) state.history.shift();
  }
}

// ═══════════════════════════════════════════
// RENDERING
// ═══════════════════════════════════════════
function renderBg(bgCanvas, bg) {
  const ctx = bgCanvas.getContext("2d");
  const imgData = ctx.createImageData(W, H);
  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < COLS; cx++) {
      const bi = (cy * COLS + cx) * 3;
      const r = bg[bi], g = bg[bi + 1], b = bg[bi + 2];
      for (let py = 0; py < CELL; py++) {
        for (let px = 0; px < CELL; px++) {
          const pi = ((cy * CELL + py) * W + cx * CELL + px) * 4;
          imgData.data[pi] = r;
          imgData.data[pi + 1] = g;
          imgData.data[pi + 2] = b;
          imgData.data[pi + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

function renderSim(ctx, bgCanvas, state) {
  ctx.drawImage(bgCanvas, 0, 0);

  for (const s of state.snakes) {
    const c = cssColor(s.color);
    ctx.fillStyle = c;
    for (let i = 0; i < s.segments.length; i++) {
      const seg = s.segments[i];
      const size = i === 0 ? CELL + 1 : CELL;
      ctx.fillRect(seg.x * CELL, seg.y * CELL, size, size);
    }
    if (isToxic(s.species)) {
      const h = s.segments[0];
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(h.x * CELL + 1, h.y * CELL + 1, 2, 2);
    }
  }

  for (const b of state.birds) {
    const px = b.x * CELL;
    const py = b.y * CELL;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(b.angle);
    ctx.fillStyle = "#f0f0e8";
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-5, -5);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    const enPct = b.energy / CFG.birdEnMax;
    ctx.fillStyle = enPct > 0.3 ? "#4a4" : "#c44";
    ctx.fillRect(-5, -8, 13 * enPct, 2);
    ctx.restore();
  }
}

function renderHistory(ctx, w, h, history) {
  if (history.length < 2) return;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(0, 0, w, h);

  const maxPop = Math.max(
    ...history.map(h => {
      let m = Math.max(h.toxicPop, h.birdPop);
      for (const sp of NONTOXIC_SPECIES) m = Math.max(m, h[sp + "_pop"] || 0);
      return m;
    }), 10
  );

  const drawLine = (key, color, dashed) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(dashed ? [4, 3] : []);
    ctx.beginPath();
    history.forEach((pt, i) => {
      const x = (i / (history.length - 1)) * w;
      const y = h - ((pt[key] || 0) / maxPop) * (h - 10) - 5;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  };

  drawLine("toxicPop", "#ff6b6b");
  drawLine("nontoxic_a_pop", "#51cf66");
  drawLine("nontoxic_b_pop", "#e6c845");
  drawLine("birdPop", "#74c0fc");
}

// ═══════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════
function EvolutionSim() {
  const canvasRef = useRef(null);
  const bgCanvasRef = useRef(null);
  const histCanvasRef = useRef(null);
  const simRef = useRef(null);
  const animRef = useRef(null);
  const [stats, setStats] = useState(null);
  const [speed, setSpeed] = useState(3);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const speedRef = useRef(3);

  const initSim = useCallback(() => {
    nextId = 0;
    const bg = generateBackground();
    const snakes = [];
    for (let i = 0; i < CFG.toxicSnakes; i++) snakes.push(createSnake("toxic"));
    for (const sp of NONTOXIC_SPECIES) {
      for (let i = 0; i < CFG.nonToxicPerSpecies; i++) snakes.push(createSnake(sp));
    }
    const birds = [];
    for (let i = 0; i < CFG.birds; i++) birds.push(createBird());

    simRef.current = {
      snakes, birds, bg, tick: 0, history: [],
      lastToxicColor: { ...START_TOXIC_COLOR },
      lastNontoxicColors: Object.fromEntries(
        NONTOXIC_SPECIES.map(sp => [sp, { ...START_NONTOXIC_COLORS[sp] }])
      ),
      lastBirdGenome: { ...START_BIRD_GENOME },
    };

    if (!bgCanvasRef.current) {
      bgCanvasRef.current = document.createElement("canvas");
      bgCanvasRef.current.width = W;
      bgCanvasRef.current.height = H;
    }
    renderBg(bgCanvasRef.current, bg);
  }, []);

  useEffect(() => {
    initSim();
    const loop = () => {
      if (simRef.current && !pausedRef.current) {
        const s = speedRef.current;
        for (let i = 0; i < s; i++) simTick(simRef.current);

        const st = simRef.current;
        const toxic = st.snakes.filter(s => isToxic(s.species));
        const nontoxic = st.snakes.filter(s => isNontoxic(s.species));
        const perSpecies = {};
        for (const sp of NONTOXIC_SPECIES) {
          const members = st.snakes.filter(s => s.species === sp);
          perSpecies[sp] = { pop: members.length, color: avgColor(members) };
        }
        setStats({
          tick: st.tick,
          toxicPop: toxic.length,
          nonToxicPop: nontoxic.length,
          birdPop: st.birds.length,
          toxicColor: avgColor(toxic),
          nonToxicColor: avgColor(nontoxic),
          perSpecies,
          birdAvoid: avgColor(st.birds, "avoid"),
          avgCaution: st.birds.length
            ? (st.birds.reduce((a, b) => a + b.genome.caution, 0) / st.birds.length).toFixed(2)
            : 0,
          avgSharpness: st.birds.length
            ? (st.birds.reduce((a, b) => a + b.genome.avoidSharpness, 0) / st.birds.length).toFixed(0)
            : 0,
          mimicryDist: toxic.length && nontoxic.length
            ? colorDist(avgColor(toxic), avgColor(nontoxic)).toFixed(0)
            : "—",
          birdAvoidDists: (() => {
            const ba = st.birds.length ? avgColor(st.birds, "avoid") : null;
            if (!ba) return {};
            const dists = { toxic: toxic.length ? colorDist(ba, avgColor(toxic)).toFixed(0) : "—" };
            for (const sp of NONTOXIC_SPECIES) {
              const members = st.snakes.filter(s => s.species === sp);
              dists[sp] = members.length ? colorDist(ba, avgColor(members)).toFixed(0) : "—";
            }
            return dists;
          })(),
        });
      }

      const canvas = canvasRef.current;
      if (canvas && simRef.current) {
        const ctx = canvas.getContext("2d");
        renderSim(ctx, bgCanvasRef.current, simRef.current);
      }

      const hCanvas = histCanvasRef.current;
      if (hCanvas && simRef.current && simRef.current.history.length > 1) {
        const hCtx = hCanvas.getContext("2d");
        renderHistory(hCtx, hCanvas.width, hCanvas.height, simRef.current.history);
      }

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [initSim]);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  const handleReset = () => {
    initSim();
    setPaused(false);
  };

  const Swatch = ({ color, label, sub }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <div style={{
        width: 28, height: 28, borderRadius: 4,
        background: cssColor(color),
        border: "2px solid rgba(255,255,255,0.15)",
        flexShrink: 0,
      }} />
      <div>
        <div style={{ fontSize: 12, color: "#ccc", fontWeight: 600 }}>{label}</div>
        {sub && <div style={{ fontSize: 10, color: "#888" }}>{sub}</div>}
      </div>
    </div>
  );

  return (
    <div style={{
      background: "#111",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "12px 8px",
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
      color: "#ddd",
    }}>
      <div style={{ marginBottom: 8, textAlign: "center" }}>
        <h1 style={{
          fontSize: 18, fontWeight: 700, margin: 0,
          background: "linear-gradient(90deg, #ff6b6b, #51cf66, #74c0fc)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          letterSpacing: 2,
        }}>
          BATESIAN MIMICRY SIMULATOR
        </h1>
        <p style={{ fontSize: 10, color: "#666", margin: "2px 0 0" }}>
          Toxic snakes (deadly) vs non-toxic snakes — will mimicry emerge?
        </p>
      </div>

      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={{
          border: "2px solid #333",
          borderRadius: 6,
          display: "block",
          maxWidth: "100%",
          imageRendering: "pixelated",
        }}
      />

      <div style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 12,
        marginTop: 10,
        width: "100%",
        maxWidth: W,
        justifyContent: "space-between",
      }}>
        <div style={{
          background: "#1a1a1a",
          borderRadius: 6,
          padding: "10px 14px",
          flex: "1 1 180px",
          minWidth: 160,
        }}>
          <div style={{ fontSize: 11, color: "#666", marginBottom: 8, fontWeight: 700, letterSpacing: 1 }}>
            POPULATIONS
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#ff6b6b" }}>
                {stats?.toxicPop ?? "—"}
              </div>
              <div style={{ fontSize: 9, color: "#888" }}>TOXIC</div>
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#51cf66" }}>
                {stats?.perSpecies?.nontoxic_a?.pop ?? "—"}
              </div>
              <div style={{ fontSize: 9, color: "#888" }}>GREEN-BR</div>
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#e6c845" }}>
                {stats?.perSpecies?.nontoxic_b?.pop ?? "—"}
              </div>
              <div style={{ fontSize: 9, color: "#888" }}>YELLOW-BR</div>
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#74c0fc" }}>
                {stats?.birdPop ?? "—"}
              </div>
              <div style={{ fontSize: 9, color: "#888" }}>BIRDS</div>
            </div>
          </div>
          <div style={{ fontSize: 10, color: "#555", marginTop: 6 }}>
            TICK {stats?.tick ?? 0}
          </div>
        </div>

        <div style={{
          background: "#1a1a1a",
          borderRadius: 6,
          padding: "10px 14px",
          flex: "1 1 200px",
          minWidth: 180,
        }}>
          <div style={{ fontSize: 11, color: "#666", marginBottom: 8, fontWeight: 700, letterSpacing: 1 }}>
            EVOLVED COLORS
          </div>
          {stats && (
            <>
              <Swatch
                color={stats.toxicColor}
                label="Toxic Avg"
                sub={`rgb(${stats.toxicColor.r},${stats.toxicColor.g},${stats.toxicColor.b})`}
              />
              {stats.perSpecies && NONTOXIC_SPECIES.map(sp => {
                const d = stats.perSpecies[sp];
                if (!d || !d.pop) return null;
                const label = sp.replace("nontoxic_", "NT-").toUpperCase();
                return (
                  <Swatch
                    key={sp}
                    color={d.color}
                    label={`${label} (${d.pop})`}
                    sub={`rgb(${d.color.r},${d.color.g},${d.color.b})`}
                  />
                );
              })}
              <Swatch
                color={stats.birdAvoid}
                label="Bird Avoid Color"
                sub={`caution: ${stats.avgCaution} | sharpness: ${stats.avgSharpness}`}
              />
              {stats.birdAvoidDists && (
                <div style={{ fontSize: 10, color: "#888", marginTop: 6, lineHeight: 1.8 }}>
                  <div style={{ fontSize: 9, color: "#666", fontWeight: 700, marginBottom: 2 }}>AVOID DIST FROM EACH</div>
                  <span style={{ color: "#ff6b6b" }}>toxic: <b>{stats.birdAvoidDists.toxic}</b></span>
                  {NONTOXIC_SPECIES.map(sp => {
                    const label = sp === "nontoxic_a" ? "green" : "yellow";
                    const col = sp === "nontoxic_a" ? "#51cf66" : "#e6c845";
                    return (
                      <span key={sp} style={{ marginLeft: 8, color: col }}>
                        {label}: <b>{stats.birdAvoidDists[sp]}</b>
                      </span>
                    );
                  })}
                  {parseFloat(stats.birdAvoidDists.toxic) < 60 &&
                    <div style={{ color: "#ffd43b", fontWeight: 600 }}>⚡ birds learning toxic color!</div>}
                </div>
              )}
              <div style={{ fontSize: 10, color: "#888", marginTop: 4 }}>
                Mimicry (toxic↔nontoxic): <span style={{
                  color: parseFloat(stats.mimicryDist) < 80 ? "#ffd43b" : "#666",
                  fontWeight: 600,
                }}>{stats.mimicryDist}</span>
                {parseFloat(stats.mimicryDist) < 80 && " ⚡ converging!"}
              </div>
            </>
          )}
        </div>

        <div style={{
          background: "#1a1a1a",
          borderRadius: 6,
          padding: "10px 14px",
          flex: "1 1 200px",
          minWidth: 180,
        }}>
          <div style={{ fontSize: 11, color: "#666", marginBottom: 6, fontWeight: 700, letterSpacing: 1 }}>
            POPULATION HISTORY
          </div>
          <canvas
            ref={histCanvasRef}
            width={220}
            height={80}
            style={{ width: "100%", borderRadius: 4 }}
          />
          <div style={{ display: "flex", gap: 10, marginTop: 4, fontSize: 9, color: "#888" }}>
            <span style={{ color: "#ff6b6b" }}>● toxic</span>
            <span style={{ color: "#51cf66" }}>● green-brown</span>
            <span style={{ color: "#e6c845" }}>● yellow-brown</span>
            <span style={{ color: "#74c0fc" }}>● birds</span>
          </div>
        </div>

        <div style={{
          background: "#1a1a1a",
          borderRadius: 6,
          padding: "10px 14px",
          flex: "1 1 140px",
          minWidth: 130,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}>
          <div style={{ fontSize: 11, color: "#666", fontWeight: 700, letterSpacing: 1 }}>
            CONTROLS
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => setPaused(p => !p)}
              style={{
                padding: "6px 14px",
                background: paused ? "#2d5a2d" : "#5a2d2d",
                color: "#ddd",
                border: "1px solid #444",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 11,
                fontFamily: "inherit",
              }}
            >
              {paused ? "▶ PLAY" : "⏸ PAUSE"}
            </button>
            <button
              onClick={handleReset}
              style={{
                padding: "6px 14px",
                background: "#2d2d3d",
                color: "#ddd",
                border: "1px solid #444",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 11,
                fontFamily: "inherit",
              }}
            >
              ↻ RESET
            </button>
          </div>
          <div>
            <label style={{ fontSize: 10, color: "#888" }}>
              SPEED: {speed}x
            </label>
            <input
              type="range"
              min={1}
              max={50}
              value={speed}
              onChange={e => setSpeed(parseInt(e.target.value))}
              style={{ width: "100%", marginTop: 2 }}
            />
          </div>
        </div>
      </div>

      <div style={{
        maxWidth: W,
        marginTop: 12,
        padding: "10px 14px",
        background: "#1a1a1a",
        borderRadius: 6,
        fontSize: 10,
        color: "#666",
        lineHeight: 1.6,
      }}>
        <strong style={{ color: "#888" }}>What to watch for:</strong> Toxic snakes (dark dot on head) should evolve
        bright, conspicuous colors over time — aposematism. Non-toxic snakes should then converge toward similar
        colors — Batesian mimicry. The "color distance" metric drops as mimicry emerges. Birds evolve to avoid
        whatever color toxic snakes settle on. Crank speed to 15-20x to see evolution unfold faster.
      </div>
    </div>
  );
}

// Mount
const __root = document.getElementById("simulator-root");
if (__root) {
  ReactDOM.createRoot(__root).render(<EvolutionSim />);
}
