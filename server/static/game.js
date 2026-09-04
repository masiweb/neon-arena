(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const entryScreen = $("entryScreen");
  const gameScreen = $("gameScreen");
  const playerName = $("playerName");
  const roomCode = $("roomCode");
  const entryError = $("entryError");
  const canvas = $("arena");
  const renderer3D = window.NeonRenderer3D?.create(canvas) || null;
  const ctx = renderer3D ? null : canvas.getContext("2d", { alpha: false });
  const minimap = $("minimap");
  const mapCtx = minimap.getContext("2d");
  const healthFill = $("healthFill");
  const healthText = $("healthText");
  const lives = $("lives");
  const timer = $("timer");
  const phaseLabel = $("phaseLabel");
  const myScore = $("myScore");
  const scoreList = $("scoreList");
  const scoreboard = $("scoreboard");
  const roomBadge = $("roomBadge");
  const weaponBadge = $("weaponBadge");
  const centerMessage = $("centerMessage");
  const startRound = $("startRound");
  const weaponChooser = $("weaponChooser");
  const botControls = $("botControls");
  const toast = $("toast");

  const weaponNames = {
    base: "معمولی",
    heavy: "توپ سنگین",
    rapid: "رگبار سریع",
    spread: "سه‌تیر",
  };

  const powerupStyle = {
    speed: { color: "#ffd52a", icon: "⚡", label: "سرعت" },
    health: { color: "#ff4f6f", icon: "+", label: "خون" },
    shield: { color: "#20d9ff", icon: "◇", label: "سپر" },
    weapon: { color: "#ff2da6", icon: "✦", label: "سلاح" },
    stealth: { color: "#a675ff", icon: "◉", label: "اختفا" },
  };

  const localWeaponSpecs = {
    base: { interval: 240, speed: 650, radius: 6, spread: [0] },
    heavy: { interval: 420, speed: 570, radius: 9, spread: [0] },
    rapid: { interval: 120, speed: 760, radius: 5, spread: [0] },
    spread: { interval: 360, speed: 640, radius: 5, spread: [-.17, 0, .17] },
  };

  const isAndroidApp = location.protocol === "file:";
  const httpOrigin = isAndroidApp ? "https://game.chanelchat.ir" : location.origin;
  const wsOrigin = isAndroidApp ? "wss://game.chanelchat.ir" : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
  const protocolVersion = "5";
  if (isAndroidApp) $("downloadAndroid")?.classList.add("hidden");

  const app = {
    socket: null,
    playerId: null,
    room: null,
    hostId: null,
    state: null,
    arena: { width: 1200, height: 700, obstacles: [] },
    move: [0, 0],
    padMove: [0, 0],
    aim: [1, 0],
    cameraAngle: 0,
    cameraPitch: 0,
    lookVelocity: [0, 0],
    moveVisual: 0,
    manualAim: false,
    shooting: false,
    inputSeq: 0,
    lastAck: 0,
    localBullets: [],
    lastPredictedShot: 0,
    previousHealth: 100,
    effects: [],
    renderPlayers: new Map(),
    keys: new Set(),
    lastFrame: performance.now(),
    audioContext: null,
    musicTimer: null,
    musicStep: 0,
    audioMuted: localStorage.getItem("neon-muted") === "1",
  };

  const fa = new Intl.NumberFormat("fa-IR");
  const queryRoom = new URLSearchParams(location.search).get("room");
  playerName.value = localStorage.getItem("neon-name") || "";
  if (queryRoom) roomCode.value = queryRoom.toUpperCase().slice(0, 4);

  function showError(message) {
    entryError.textContent = message;
  }

  function notify(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove("show"), 1900);
  }

  function normalizedName() {
    const name = playerName.value.trim().replace(/\s+/g, " ").slice(0, 18);
    if (!name) {
      showError("اول نام بازیکن را وارد کنید");
      playerName.focus();
      return null;
    }
    localStorage.setItem("neon-name", name);
    return name;
  }

  async function createRoom() {
    const name = normalizedName();
    if (!name) return;
    requestFullscreenSoft();
    ensureAudio();
    setBusy(true);
    try {
      const response = await fetch(`${httpOrigin}/api/rooms`, { method: "POST" });
      if (!response.ok) throw new Error("ساخت اتاق ممکن نشد");
      const data = await response.json();
      connect(data.code, name);
    } catch (error) {
      showError(error.message || "ارتباط با سرور برقرار نشد");
      setBusy(false);
    }
  }

  async function joinRoom() {
    const name = normalizedName();
    if (!name) return;
    const code = roomCode.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 4);
    roomCode.value = code;
    if (code.length !== 4) return showError("کد چهارحرفی اتاق را وارد کنید");
    requestFullscreenSoft();
    ensureAudio();
    setBusy(true);
    try {
      const check = await fetch(`${httpOrigin}/api/rooms/${code}`);
      if (!check.ok) throw new Error("اتاق پیدا نشد؛ کد را بررسی کنید");
      connect(code, name);
    } catch (error) {
      showError(error.message || "ارتباط با سرور برقرار نشد");
      setBusy(false);
    }
  }

  function setBusy(busy) {
    $("createRoom").disabled = busy;
    $("joinRoom").disabled = busy;
    entryError.textContent = busy ? "در حال اتصال…" : "";
  }

  function connect(code, name) {
    if (app.socket) app.socket.close();
    const socket = new WebSocket(`${wsOrigin}/ws/${code}?name=${encodeURIComponent(name)}&protocol=${protocolVersion}&client=${isAndroidApp ? "android" : "web"}`);
    app.socket = socket;
    socket.addEventListener("open", () => setBusy(false));
    socket.addEventListener("message", (event) => onMessage(JSON.parse(event.data)));
    socket.addEventListener("close", () => {
      if (!app.playerId) {
        showError("اتصال به اتاق ممکن نشد");
        setBusy(false);
      } else {
        notify("ارتباط قطع شد؛ در حال اتصال مجدد…");
        setTimeout(() => location.reload(), 1800);
      }
    });
    socket.addEventListener("error", () => showError("خطا در ارتباط با سرور"));
  }

  function onMessage(message) {
    if (message.type === "welcome") {
      app.playerId = message.playerId;
      app.room = message.room;
      app.hostId = message.hostId;
      app.arena = message.arena;
      roomBadge.textContent = `اتاق: ${message.room}`;
      history.replaceState(null, "", `?room=${message.room}`);
      entryScreen.classList.add("hidden");
      gameScreen.classList.remove("hidden");
      requestFullscreenSoft();
      return;
    }
    if (message.type === "state") {
      const previous = app.state;
      app.state = message;
      app.hostId = message.hostId;
      updateHud(previous);
      return;
    }
    if (message.type === "event") notify(message.message);
    if (message.type === "error") {
      app.playerId = null;
      showError(message.message);
    }
  }

  function updateHud(previous) {
    const state = app.state;
    const me = state.players.find((player) => player.id === app.playerId);
    if (!me) return;
    app.lastAck = Math.max(app.lastAck, me.ack || 0);
    healthFill.style.width = `${Math.min(100, me.health)}%`;
    healthFill.style.background = me.health > 100 ? "linear-gradient(90deg,#66cf22,#b8ff38)" : me.health < 35 ? "linear-gradient(90deg,#ff3858,#ff7b75)" : "linear-gradient(90deg,#0ba6ff,#39f1ff)";
    healthText.textContent = fa.format(me.health);
    lives.innerHTML = Array.from({ length: 3 }, (_, index) => `<i class="${index < me.lives ? "" : "lost"}">♥</i>`).join("");
    myScore.textContent = fa.format(me.score);
    weaponBadge.textContent = `سلاح: ${weaponNames[me.weapon] || weaponNames.base}${me.speedBoost ? " · سرعت+" : ""}${me.radarHidden ? " · اختفا" : ""}`;

    if (me.health < app.previousHealth) {
      navigator.vibrate?.(35);
      app.effects.push({ type: "flash", born: performance.now(), color: "#ff2d62" });
    }
    app.previousHealth = me.health;
    const mins = Math.floor(state.remaining / 60).toString().padStart(2, "0");
    const secs = (state.remaining % 60).toString().padStart(2, "0");
    timer.textContent = `${toFaDigits(mins)}:${toFaDigits(secs)}`;
    phaseLabel.textContent = state.phase === "playing" ? "راند فعال" : state.phase === "countdown" ? "آماده" : state.phase === "ended" ? "پایان راند" : "اتاق انتظار";
    updateScores(state.players);
    updateCenterMessage();
    updateCooldown($("dashButton"), $("dashCooldown"), me.dashCooldown, 4);
    updateCooldown($("shieldButton"), $("shieldCooldown"), me.shieldCooldown, 7);

    if (previous?.bullets) {
      const oldIds = new Set(previous.bullets.map((bullet) => bullet.id));
      for (const bullet of state.bullets) {
        if (!oldIds.has(bullet.id)) {
          app.effects.push({ type: "muzzle", born: performance.now(), x: bullet.x1 ?? bullet.x, y: bullet.y1 ?? bullet.y, color: bullet.color });
          if (bullet.owner === app.playerId) acknowledgePredictedBullet(bullet);
          else playShot(false);
        }
      }
    }
  }

  function updateScores(players) {
    const sorted = [...players].sort((a, b) => b.lives - a.lives || b.score - a.score || a.name.localeCompare(b.name, "fa"));
    scoreList.replaceChildren(...sorted.map((player, index) => {
      const item = document.createElement("li");
      if (player.id === app.playerId) item.className = "me";
      item.innerHTML = `<b>${toFaDigits(index + 1)}</b><i class="dot" style="background:${player.color};color:${player.color}"></i><span></span><em class="score-lives">♥ ${fa.format(player.lives)}</em><strong>${fa.format(player.score)}</strong>`;
      item.querySelector("span").textContent = `${player.bot ? "🤖 " : ""}${player.name}`;
      return item;
    }));
  }

  function updateCenterMessage() {
    const state = app.state;
    const me = state.players.find((player) => player.id === app.playerId);
    startRound.classList.add("hidden");
    botControls.classList.add("hidden");
    weaponChooser.classList.add("hidden");
    centerMessage.classList.remove("off");
    const mustChooseWeapon = state.winnerId === app.playerId && !state.winnerChoice && ["ended", "lobby"].includes(state.phase);
    if (mustChooseWeapon) {
      centerMessage.querySelector("strong").textContent = "برنده شدی!";
      centerMessage.querySelector("span").textContent = "یک سلاح قوی‌تر برای راند بعد انتخاب کن";
      weaponChooser.classList.remove("hidden");
    } else if (state.phase === "lobby") {
      centerMessage.querySelector("strong").textContent = state.players.length < 2 ? "منتظر دوستان" : `${fa.format(state.players.length)} بازیکن آماده`;
      centerMessage.querySelector("span").textContent = state.winnerChoice ? `جایزه برنده: ${weaponNames[state.winnerChoice]}` : app.playerId === state.hostId ? "هر بازیکن سه جان دارد؛ وقتی همه آماده شدند شروع کنید" : "سازنده اتاق بازی را شروع می‌کند";
      if (app.playerId === state.hostId && (!state.winnerId || state.winnerChoice)) startRound.classList.remove("hidden");
      if (app.playerId === state.hostId) {
        const bots = state.players.filter((player) => player.bot).length;
        $("botCount").textContent = `${fa.format(bots)} بات`;
        $("removeBot").disabled = bots === 0;
        $("addBot").disabled = state.players.length >= 12;
        botControls.classList.remove("hidden");
      }
    } else if (state.phase === "countdown") {
      centerMessage.querySelector("strong").textContent = toFaDigits(state.countdown || 1);
      centerMessage.querySelector("span").textContent = "سه جان داری؛ آماده باش!";
    } else if (state.phase === "ended") {
      centerMessage.querySelector("strong").textContent = `${state.winner} برنده شد!`;
      centerMessage.querySelector("span").textContent = state.winnerChoice ? `سلاح ${weaponNames[state.winnerChoice]} برای برنده انتخاب شد` : "برنده در حال انتخاب سلاح جایزه است";
    } else if (state.phase === "playing" && me?.lives === 0) {
      centerMessage.querySelector("strong").textContent = "جان‌هایت تمام شد";
      centerMessage.querySelector("span").textContent = "تا پایان راند بازی را تماشا کن";
    } else {
      centerMessage.classList.add("off");
    }
  }

  function updateCooldown(button, fill, value, total) {
    const active = value > 0;
    button.classList.toggle("cooling", active);
    button.disabled = active;
    fill.style.height = `${Math.min(100, value / total * 100)}%`;
  }

  function send(payload) {
    if (app.socket?.readyState === WebSocket.OPEN) app.socket.send(JSON.stringify(payload));
  }

  function setupPad(element, onChange, onEnd) {
    const knob = element.querySelector(".pad-knob");
    let pointer = null;
    const update = (event) => {
      const rect = element.querySelector(".pad-ring").getBoundingClientRect();
      let dx = event.clientX - (rect.left + rect.width / 2);
      let dy = event.clientY - (rect.top + rect.height / 2);
      const radius = rect.width * .34;
      const distance = Math.hypot(dx, dy);
      if (distance > radius) { dx = dx / distance * radius; dy = dy / distance * radius; }
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      onChange(dx / radius, dy / radius, distance / radius);
    };
    element.addEventListener("pointerdown", (event) => {
      pointer = event.pointerId;
      element.setPointerCapture(pointer);
      update(event);
    });
    element.addEventListener("pointermove", (event) => { if (event.pointerId === pointer) update(event); });
    const finish = (event) => {
      if (event.pointerId !== pointer) return;
      pointer = null;
      knob.style.transform = "translate(0,0)";
      onEnd();
    };
    element.addEventListener("pointerup", finish);
    element.addEventListener("pointercancel", finish);
    element.addEventListener("lostpointercapture", () => {
      if (pointer === null) return;
      pointer = null;
      knob.style.transform = "translate(0,0)";
      onEnd();
    });
  }

  setupPad($("movePad"), (x, y, distance) => {
    const rawStrength = Math.min(1, distance);
    const strength = rawStrength < .08 ? 0 : (rawStrength - .08) / .92;
    const directionLength = Math.hypot(x, y) || 1;
    app.padMove = [x / directionLength * strength, y / directionLength * strength];
  }, () => { app.padMove = [0, 0]; });
  const lookSurface = $("lookSurface");
  const fireButton = $("fireButton");
  let fireStopTimer = null;
  let lookPointer = null;
  let lookX = 0;
  let lookY = 0;
  lookSurface.addEventListener("pointerdown", (event) => {
    if (lookPointer !== null) return;
    lookPointer = event.pointerId;
    lookX = event.clientX;
    lookY = event.clientY;
    lookSurface.setPointerCapture(event.pointerId);
    if (event.pointerType === "mouse") {
      lookSurface.requestPointerLock?.();
      if (event.button === 0) beginShooting();
    }
  });
  lookSurface.addEventListener("pointermove", (event) => {
    if (event.pointerId !== lookPointer && document.pointerLockElement !== lookSurface) return;
    const dx = document.pointerLockElement === lookSurface ? event.movementX : event.clientX - lookX;
    const dy = document.pointerLockElement === lookSurface ? event.movementY : event.clientY - lookY;
    lookX = event.clientX;
    lookY = event.clientY;
    const sensitivity = event.pointerType === "mouse" ? .0025 : .0042;
    app.cameraAngle += Math.max(-55, Math.min(55, dx)) * sensitivity;
    app.cameraPitch = Math.max(-.16, Math.min(.16, app.cameraPitch - Math.max(-45, Math.min(45, dy)) * sensitivity * .55));
    app.lookVelocity = [dx * sensitivity, dy * sensitivity];
    app.manualAim = true;
  });
  const endLook = (event) => {
    if (event.pointerId !== lookPointer) return;
    lookPointer = null;
    app.lookVelocity = [0, 0];
    if (event.pointerType === "mouse" && event.button === 0) endShooting();
  };
  lookSurface.addEventListener("pointerup", endLook);
  lookSurface.addEventListener("pointercancel", endLook);

  function beginShooting() {
    clearTimeout(fireStopTimer);
    app.shooting = true;
    fireButton.classList.add("active");
    ensureAudio();
  }
  function endShooting() {
    clearTimeout(fireStopTimer);
    fireStopTimer = setTimeout(() => {
      app.shooting = false;
      fireButton.classList.remove("active");
    }, 70);
  }
  const startFire = (event) => {
    event.preventDefault();
    fireButton.setPointerCapture?.(event.pointerId);
    beginShooting();
  };
  const stopFire = () => endShooting();
  fireButton.addEventListener("pointerdown", startFire);
  fireButton.addEventListener("pointerup", stopFire);
  fireButton.addEventListener("pointercancel", stopFire);
  fireButton.addEventListener("lostpointercapture", stopFire);

  function automaticAim() {
    const me = app.state?.players.find((player) => player.id === app.playerId);
    if (!me?.alive) return null;
    let nearest = null;
    let nearestDistance = 420;
    for (const player of app.state.players) {
      if (player.id === me.id || !player.alive || player.lives <= 0) continue;
      const distance = Math.hypot(player.x - me.x, player.y - me.y);
      const direction = Math.atan2(player.y - me.y, player.x - me.x);
      const angleError = Math.abs(Math.atan2(Math.sin(direction - app.cameraAngle), Math.cos(direction - app.cameraAngle)));
      if (distance < nearestDistance && angleError < .18 && hasLineOfSight(me.x, me.y, player.x, player.y)) {
        nearest = player;
        nearestDistance = distance;
      }
    }
    return nearest ? [nearest.x - me.x, nearest.y - me.y] : null;
  }

  function hasLineOfSight(x1, y1, x2, y2) {
    const distance = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.ceil(distance / 18));
    for (let step = 2; step < steps; step++) {
      const ratio = step / steps;
      if (wallAt(x1 + (x2 - x1) * ratio, y1 + (y2 - y1) * ratio) >= 0) return false;
    }
    return true;
  }

  function resolvedAim() {
    const targetAim = app.shooting ? automaticAim() : null;
    if (targetAim) return targetAim;
    return [Math.cos(app.cameraAngle), Math.sin(app.cameraAngle)];
  }

  function ensureAudio() {
    if (app.audioMuted) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!app.audioContext) app.audioContext = new AudioContextClass();
    if (app.audioContext.state === "suspended") app.audioContext.resume().catch(() => {});
    if (!app.musicTimer) {
      playMusicNote();
      app.musicTimer = setInterval(playMusicNote, 520);
    }
  }

  function tone(frequency, duration, volume, type = "sine", delay = 0) {
    const audio = app.audioContext;
    if (!audio || app.audioMuted || audio.state !== "running") return;
    const start = audio.currentTime + delay;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + .03);
  }

  function playMusicNote() {
    if (!app.audioContext || app.audioMuted || document.hidden) return;
    const bass = [55, 65.41, 73.42, 49][Math.floor(app.musicStep / 4) % 4];
    const notes = [220, 261.63, 293.66, 329.63, 293.66, 261.63, 196, 246.94];
    tone(bass, .42, .018, "sine");
    tone(notes[app.musicStep % notes.length], .18, .011, "triangle", .04);
    app.musicStep += 1;
  }

  function playShot(isMine) {
    if (!app.audioContext || app.audioMuted) return;
    const base = isMine ? 150 : 105;
    tone(base, .075, isMine ? .075 : .025, "square");
    tone(base * 2.2, .045, isMine ? .035 : .012, "sawtooth", .008);
  }

  function predictShot(now) {
    if (!app.shooting || app.state?.phase !== "playing") return;
    const me = app.state.players.find((player) => player.id === app.playerId);
    if (!me?.alive) return;
    const spec = localWeaponSpecs[me.weapon] || localWeaponSpecs.base;
    if (now - app.lastPredictedShot < spec.interval) return;
    app.lastPredictedShot = now;
    const rendered = app.renderPlayers.get(me.id) || me;
    const length = Math.hypot(app.aim[0], app.aim[1]) || 1;
    const baseAngle = Math.atan2(app.aim[1] / length, app.aim[0] / length);
    for (const spread of spec.spread) {
      const angle = baseAngle + spread;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const end = traceEnd(rendered.x + dx * 31, rendered.y + dy * 31, dx, dy, 820);
      app.localBullets.push({
        id: `local-${now}-${spread}`,
        x1: rendered.x + dx * 31,
        y1: rendered.y + dy * 31,
        x2: end[0],
        y2: end[1],
        radius: spec.radius,
        color: me.color,
        born: now,
      });
    }
    app.effects.push({ type: "muzzle", born: now, x: rendered.x, y: rendered.y, color: me.color });
    playShot(true);
  }

  function traceEnd(x, y, dx, dy, range) {
    let distance = 0;
    while (distance < range) {
      distance += 8;
      const px = x + dx * distance, py = y + dy * distance;
      if (px <= 0 || py <= 0 || px >= app.arena.width || py >= app.arena.height || wallAt(px, py) >= 0) return [px, py];
    }
    return [x + dx * range, y + dy * range];
  }

  function acknowledgePredictedBullet(serverBullet) {
    const serverAngle = Math.atan2((serverBullet.y2 ?? serverBullet.y) - (serverBullet.y1 ?? 0), (serverBullet.x2 ?? serverBullet.x) - (serverBullet.x1 ?? 0));
    const index = app.localBullets.findIndex((bullet) => {
      const angle = Math.atan2(bullet.y2 - bullet.y1, bullet.x2 - bullet.x1);
      return Math.abs(Math.atan2(Math.sin(angle - serverAngle), Math.cos(angle - serverAngle))) < .24;
    });
    if (index >= 0) app.localBullets.splice(index, 1);
  }

  function updatePredictedBullets(dt, now) {
    app.localBullets = app.localBullets.filter((bullet) => now - bullet.born < 115);
  }

  function toggleSound() {
    app.audioMuted = !app.audioMuted;
    localStorage.setItem("neon-muted", app.audioMuted ? "1" : "0");
    $("soundToggle").textContent = app.audioMuted ? "×♪" : "♪";
    if (app.audioMuted) app.audioContext?.suspend().catch(() => {});
    else ensureAudio();
  }

  function action(name) {
    send({ type: "action", action: name });
    navigator.vibrate?.(18);
  }

  function requestFullscreenSoft() {
    const root = document.documentElement;
    const request = root.requestFullscreen || root.webkitRequestFullscreen;
    if (request && !document.fullscreenElement && !document.webkitFullscreenElement) {
      const result = request.call(root, { navigationUI: "hide" });
      if (result?.catch) result.catch(() => {});
    }
    const orientationResult = screen.orientation?.lock?.("landscape");
    if (orientationResult?.catch) orientationResult.catch(() => {});
    setTimeout(() => window.scrollTo(0, 1), 120);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      const result = exit?.call(document);
      if (result?.catch) result.catch(() => {});
    } else {
      requestFullscreenSoft();
    }
  }

  $("createRoom").addEventListener("click", createRoom);
  $("joinRoom").addEventListener("click", joinRoom);
  roomCode.addEventListener("input", () => { roomCode.value = roomCode.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 4); });
  roomCode.addEventListener("keydown", (event) => { if (event.key === "Enter") joinRoom(); });
  playerName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      if (queryRoom) joinRoom();
      else createRoom();
    }
  });
  startRound.addEventListener("click", () => send({ type: "start" }));
  $("addBot").addEventListener("click", () => send({ type: "add_bot" }));
  $("removeBot").addEventListener("click", () => send({ type: "remove_bot" }));
  weaponChooser.addEventListener("click", (event) => {
    const button = event.target.closest("[data-weapon]");
    if (button) send({ type: "choose_weapon", weapon: button.dataset.weapon });
  });
  $("dashButton").addEventListener("pointerdown", () => action("dash"));
  $("shieldButton").addEventListener("pointerdown", () => action("shield"));
  $("fullscreen").addEventListener("click", toggleFullscreen);
  $("soundToggle").addEventListener("click", toggleSound);
  $("soundToggle").textContent = app.audioMuted ? "×♪" : "♪";
  $("fullscreenEntry").addEventListener("click", requestFullscreenSoft);
  $("scoreToggle").addEventListener("click", () => scoreboard.classList.toggle("open"));
  $("closeScore").addEventListener("click", () => scoreboard.classList.remove("open"));
  $("copyInvite").addEventListener("click", async () => {
    const url = `${httpOrigin}/?room=${app.room}`;
    try { await navigator.clipboard.writeText(url); notify("لینک دعوت کپی شد"); }
    catch { prompt("این لینک را برای دوستان بفرستید:", url); }
  });

  window.addEventListener("keydown", (event) => {
    app.keys.add(event.key.toLowerCase());
    if (event.key === " ") app.shooting = true;
    if (event.key.toLowerCase() === "e") action("shield");
    if (event.key.toLowerCase() === "shift") action("dash");
  });
  window.addEventListener("keyup", (event) => { app.keys.delete(event.key.toLowerCase()); if (event.key === " ") app.shooting = false; });
  window.addEventListener("pointerup", (event) => {
    if (event.pointerType === "mouse" && event.button === 0 && document.pointerLockElement === lookSurface) endShooting();
  });

  function releaseInput() {
    clearTimeout(fireStopTimer);
    app.padMove = [0, 0];
    app.move = [0, 0];
    app.shooting = false;
    app.manualAim = false;
    app.lookVelocity = [0, 0];
    app.keys.clear();
    app.inputSeq += 1;
    send({ type: "input", seq: app.inputSeq, move: [0, 0], aim: app.aim, shooting: false });
  }
  window.addEventListener("blur", releaseInput);
  document.addEventListener("visibilitychange", () => { if (document.hidden) releaseInput(); });

  setInterval(() => {
    const x = (app.keys.has("d") || app.keys.has("arrowright") ? 1 : 0) - (app.keys.has("a") || app.keys.has("arrowleft") ? 1 : 0);
    const y = (app.keys.has("s") || app.keys.has("arrowdown") ? 1 : 0) - (app.keys.has("w") || app.keys.has("arrowup") ? 1 : 0);
    app.aim = resolvedAim();
    const local = x || y ? [x, y] : app.padMove;
    const heading = app.cameraAngle;
    const forward = -local[1];
    const strafe = local[0];
    app.move = [Math.cos(heading) * forward - Math.sin(heading) * strafe, Math.sin(heading) * forward + Math.cos(heading) * strafe];
    app.inputSeq += 1;
    send({ type: "input", seq: app.inputSeq, move: app.move, aim: app.aim, shooting: app.shooting });
  }, 33);

  function toFaDigits(value) {
    return String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[digit]);
  }

  function fit() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    canvas.style.width = `${innerWidth}px`;
    canvas.style.height = `${innerHeight}px`;
    const mapRect = minimap.getBoundingClientRect();
    minimap.width = Math.max(1, Math.round(mapRect.width * dpr));
    minimap.height = Math.max(1, Math.round(mapRect.height * dpr));
  }
  addEventListener("resize", fit);
  fit();

  function transform() {
    const scale = Math.min(canvas.width / app.arena.width, canvas.height / app.arena.height);
    return { scale, ox: (canvas.width - app.arena.width * scale) / 2, oy: (canvas.height - app.arena.height * scale) / 2 };
  }

  function screenToWorld(clientX, clientY) {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const { scale, ox, oy } = transform();
    return { x: (clientX * dpr - ox) / scale, y: (clientY * dpr - oy) / scale };
  }

  function draw() {
    requestAnimationFrame(draw);
    const now = performance.now();
    const dt = Math.min((now - app.lastFrame) / 1000, .05);
    app.lastFrame = now;
    if (!renderer3D) drawBackground(now);
    if (!app.state) return;
    if (renderer3D) {
      predictShot(now);
      updatePredictedBullets(dt, now);
      const activeIds = new Set();
      const players = app.state.players.map((player) => { activeIds.add(player.id); return smoothPlayer(player, dt); });
      for (const id of app.renderPlayers.keys()) if (!activeIds.has(id)) app.renderPlayers.delete(id);
      const me = players.find((player) => player.id === app.playerId);
      if (me) renderer3D.render({
        arena: app.arena, me, players, powerups: app.state.powerups || [],
        traces: [...app.state.bullets, ...app.localBullets], angle: app.cameraAngle,
        pitch: app.cameraPitch, now, dt, shooting: app.shooting, move: app.move
      });
      drawMinimap();
      return;
    }
    drawFirstPerson(now, dt);
    drawMinimap();
    drawScreenEffects(now);
  }

  function projectPoint(x, y, camera) {
    const dx = x - camera.me.x, dy = y - camera.me.y;
    const cosine = Math.cos(camera.angle), sine = Math.sin(camera.angle);
    const depth = dx * cosine + dy * sine;
    const side = -dx * sine + dy * cosine;
    const focal = canvas.width * .78;
    if (depth < 16 || Math.abs(side / depth) > .72) return null;
    return { x: canvas.width / 2 + side / depth * focal, depth, scale: focal / depth };
  }

  function groundY(view, horizon) {
    return horizon + Math.min(canvas.height * .48, 25500 / Math.max(45, view.depth));
  }

  function drawFirstPerson(now, dt) {
    const me = app.state.players.find((player) => player.id === app.playerId);
    if (!me) return;
    const camera = { me: smoothPlayer(me, dt), angle: app.cameraAngle };
    const movement = Math.min(1, Math.hypot(app.move[0], app.move[1]));
    app.moveVisual += (movement - app.moveVisual) * Math.min(1, dt * 10);
    const bob = Math.sin(now * .011) * canvas.height * .006 * app.moveVisual;
    const horizon = canvas.height * (.49 + app.cameraPitch) + bob;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, "#0876bd"); sky.addColorStop(1, "#5bc6e8");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, canvas.width, horizon);
    ctx.fillStyle = "rgba(190,232,255,.7)";
    const cloudShift = (app.cameraAngle * canvas.width * .12) % (canvas.width * 1.4);
    for (let i = -1; i < 4; i++) {
      const cx = i * canvas.width * .45 - cloudShift;
      ctx.fillRect(cx, horizon * .22, canvas.width * .12, horizon * .14);
      ctx.fillRect(cx + canvas.width * .06, horizon * .12, canvas.width * .09, horizon * .24);
      ctx.fillRect(cx + canvas.width * .14, horizon * .25, canvas.width * .13, horizon * .11);
    }
    const floor = ctx.createLinearGradient(0, horizon, 0, canvas.height);
    floor.addColorStop(0, "#425160"); floor.addColorStop(.45, "#263440"); floor.addColorStop(1, "#0b1119");
    ctx.fillStyle = floor; ctx.fillRect(0, horizon, canvas.width, canvas.height - horizon);
    ctx.strokeStyle = "rgba(32,217,255,.12)"; ctx.lineWidth = 1;
    for (let i = 1; i < 10; i++) { const y = horizon + (canvas.height - horizon) * (i / 10) ** .48; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
    for (let i = -8; i <= 8; i++) { ctx.beginPath(); ctx.moveTo(canvas.width / 2 + i * 20, horizon); ctx.lineTo(canvas.width / 2 + i * canvas.width * .16, canvas.height); ctx.stroke(); }

    predictShot(now); updatePredictedBullets(dt, now);
    const objects = [];
    for (const data of app.state.powerups || []) objects.push({ type: "powerup", x: data.x, y: data.y, data });
    for (const data of [...app.state.bullets, ...app.localBullets]) objects.push({ type: "bullet", x: data.x2 ?? data.x, y: data.y2 ?? data.y, data });
    for (const player of app.state.players) {
      if (player.id === app.playerId || (!player.alive && player.lives === 0)) continue;
      const data = smoothPlayer(player, dt); objects.push({ type: "player", x: data.x, y: data.y, data });
    }
    const depthBuffer = drawRaycastWalls(camera, horizon);
    for (const object of objects) object.view = projectPoint(object.x, object.y, camera);
    objects.filter((object) => object.view).sort((a, b) => b.view.depth - a.view.depth).forEach((object) => {
      const ray = Math.max(0, Math.min(depthBuffer.length - 1, Math.floor(object.view.x / canvas.width * depthBuffer.length)));
      if (object.view.depth > depthBuffer[ray] + 18) return;
      if (object.type === "player") drawNeonPerson(object, horizon);
      else if (object.type === "powerup") drawPerspectivePowerup(object, horizon, now);
      else drawPerspectiveBullet(object, horizon);
    });
    drawWeaponView(camera.me, now, app.moveVisual, bob);
  }

  function wallAt(x, y) {
    if (x <= 2 || y <= 2 || x >= app.arena.width - 2 || y >= app.arena.height - 2) return -1;
    return app.arena.obstacles.findIndex((rect) => x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h);
  }

  function drawRaycastWalls(camera, horizon) {
    const fov = Math.PI * .42;
    const rays = Math.max(140, Math.min(280, Math.floor(canvas.width / 4)));
    const slice = canvas.width / rays;
    const depths = new Array(rays).fill(1300);
    for (let column = 0; column < rays; column++) {
      const offset = (column / (rays - 1) - .5) * fov;
      const angle = camera.angle + offset;
      const dx = Math.cos(angle), dy = Math.sin(angle);
      let distance = 12, hit = null, hitX = 0, hitY = 0;
      while (distance < 1300) {
        hitX = camera.me.x + dx * distance; hitY = camera.me.y + dy * distance;
        const index = wallAt(hitX, hitY);
        if (index !== null && index !== undefined && index !== -999 && (index >= 0 || hitX <= 2 || hitY <= 2 || hitX >= app.arena.width - 2 || hitY >= app.arena.height - 2)) { hit = index; break; }
        distance += 7;
      }
      const corrected = distance * Math.cos(offset);
      depths[column] = corrected;
      const wallHeight = Math.min(canvas.height * 1.48, canvas.height * 132 / Math.max(40, corrected));
      const top = horizon - wallHeight * .64, bottom = horizon + wallHeight * .36;
      const shade = Math.max(.22, 1 - corrected / 1250);
      const edge = hit < 0 ? 190 : 150 + (hit % 3) * 17;
      const warm = hit >= 0 && hit % 4 === 0;
      ctx.fillStyle = warm
        ? `rgb(${Math.round((edge + 22) * shade)},${Math.round((edge + 15) * shade)},${Math.round(edge * shade)})`
        : `rgb(${Math.round(edge * shade)},${Math.round((edge + 12) * shade)},${Math.round((edge + 20) * shade)})`;
      ctx.fillRect(column * slice, top, slice + 1, bottom - top);
      const brickX = Math.floor((hitX + hitY) / 55);
      if (column % Math.max(2, Math.floor(18 / slice)) === 0 || brickX % 7 === 0) {
        ctx.fillStyle = `rgba(3,8,14,${.32 + (1 - shade) * .25})`;
        ctx.fillRect(column * slice, top, Math.max(1, slice * .18), bottom - top);
      }
      const rows = Math.min(8, Math.max(2, Math.floor(wallHeight / 45)));
      ctx.fillStyle = "rgba(3,8,14,.42)";
      for (let row = 1; row < rows; row++) ctx.fillRect(column * slice, top + (bottom - top) * row / rows, slice + 1, Math.max(1, canvas.height / 420));
      ctx.fillStyle = hit % 2 ? "rgba(255,45,166,.5)" : "rgba(32,217,255,.5)";
      ctx.fillRect(column * slice, bottom - 2, slice + 1, 2);
    }
    return depths;
  }

  function drawPerspectiveWall(object, horizon) {
    const { view, rect } = object;
    const width = Math.min(canvas.width * .9, Math.max(rect.w, rect.h) * view.scale);
    const height = Math.min(canvas.height * .72, 92 * view.scale), bottom = groundY(view, horizon);
    ctx.save(); const gradient = ctx.createLinearGradient(view.x, bottom - height, view.x, bottom);
    gradient.addColorStop(0, "#172b47"); gradient.addColorStop(1, "#07101f");
    ctx.fillStyle = gradient; ctx.strokeStyle = "rgba(40,211,255,.7)"; ctx.lineWidth = Math.max(2, view.scale * 2);
    ctx.fillRect(view.x - width / 2, bottom - height, width, height); ctx.strokeRect(view.x - width / 2, bottom - height, width, height);
    ctx.strokeStyle = "rgba(255,45,166,.72)"; ctx.beginPath(); ctx.moveTo(view.x - width / 2, bottom); ctx.lineTo(view.x + width / 2, bottom); ctx.stroke(); ctx.restore();
  }

  function drawNeonPerson(object, horizon) {
    const player = object.data, view = object.view, bottom = groundY(view, horizon);
    const height = Math.max(28, Math.min(canvas.height * .7, 88 * view.scale)), head = height * .12, top = bottom - height;
    ctx.save(); ctx.globalAlpha = player.alive ? 1 : .2; ctx.translate(view.x, top); ctx.strokeStyle = player.color; ctx.fillStyle = "#07101d";
    ctx.shadowColor = player.color; ctx.shadowBlur = Math.min(24, height * .2); ctx.lineCap = "round"; ctx.lineWidth = Math.max(2, height * .045);
    ctx.beginPath(); ctx.arc(0, head, head, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "rgba(4,10,18,.9)";
    ctx.beginPath(); ctx.moveTo(-head * .9, head * 2.1); ctx.lineTo(-height * .12, height * .62); ctx.lineTo(height * .12, height * .62); ctx.lineTo(head * .9, head * 2.1); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-height * .08, height * .33); ctx.lineTo(-height * .25, height * .55); ctx.moveTo(height * .08, height * .33); ctx.lineTo(height * .29, height * .46); ctx.moveTo(-height * .08, height * .62); ctx.lineTo(-height * .18, height); ctx.moveTo(height * .08, height * .62); ctx.lineTo(height * .18, height); ctx.stroke();
    ctx.lineWidth = Math.max(2, height * .035); ctx.beginPath(); ctx.moveTo(height * .2, height * .43); ctx.lineTo(height * .42, height * .38); ctx.stroke();
    if (player.shield) { ctx.strokeStyle = "#a8f7ff"; ctx.globalAlpha *= .7; ctx.beginPath(); ctx.ellipse(0, height * .52, height * .35, height * .56, 0, 0, Math.PI * 2); ctx.stroke(); }
    ctx.shadowBlur = 0; ctx.globalAlpha = 1; ctx.font = `700 ${Math.max(12, Math.min(22, height * .15))}px Vazirmatn,sans-serif`; ctx.textAlign = "center"; ctx.fillStyle = "#edfdff"; ctx.fillText(player.name, 0, -8);
    ctx.fillStyle = "rgba(1,5,12,.8)"; ctx.fillRect(-height * .28, height + 8, height * .56, 5); ctx.fillStyle = player.health < 35 ? "#ff4565" : player.color; ctx.fillRect(-height * .28, height + 8, height * .56 * Math.min(1, player.health / 100), 5); ctx.restore();
  }

  function drawPerspectivePowerup(object, horizon, now) {
    const style = powerupStyle[object.data.kind] || powerupStyle.weapon, size = Math.max(18, Math.min(74, 28 * object.view.scale));
    const y = groundY(object.view, horizon) - size * (1.05 + Math.sin(now * .006) * .08);
    ctx.save(); ctx.translate(object.view.x, y); ctx.shadowColor = style.color; ctx.shadowBlur = 22; ctx.fillStyle = "rgba(3,9,19,.9)"; ctx.strokeStyle = style.color; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, size / 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = style.color; ctx.font = `900 ${size * .58}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(style.icon, 0, 1); ctx.restore();
  }

  function drawPerspectiveBullet(object, horizon) {
    const size = Math.max(3, Math.min(18, (object.data.radius || 5) * object.view.scale));
    ctx.save(); ctx.fillStyle = "#fff"; ctx.shadowColor = object.data.color; ctx.shadowBlur = 18; ctx.beginPath(); ctx.arc(object.view.x, groundY(object.view, horizon) - 34 * object.view.scale, size, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }

  function drawWeaponView(me, now, movement, bob) {
    const recoil = app.shooting ? Math.max(0, Math.sin(now * .055)) * 12 : 0;
    const swayX = Math.sin(now * .007) * 7 * movement;
    const x = canvas.width * .73 + swayX + recoil, y = canvas.height + bob * .45 + recoil;
    const accent = me.weapon === "heavy" ? "#ffd45e" : me.weapon === "rapid" ? "#9dff24" : me.weapon === "spread" ? "#ff64c2" : me.color;
    ctx.save(); ctx.translate(x, y); ctx.rotate(-.1); ctx.shadowColor = accent; ctx.shadowBlur = 15; ctx.lineJoin = "round";
    ctx.fillStyle = "#17202a"; ctx.strokeStyle = "#03070c"; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(-canvas.width * .13, 0); ctx.lineTo(-canvas.width * .1, -canvas.height * .17); ctx.lineTo(-canvas.width * .035, -canvas.height * .22); ctx.lineTo(canvas.width * .155, -canvas.height * .26); ctx.lineTo(canvas.width * .19, -canvas.height * .21); ctx.lineTo(canvas.width * .075, -canvas.height * .15); ctx.lineTo(canvas.width * .12, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#080d13"; ctx.fillRect(canvas.width * .01, -canvas.height * .18, canvas.width * .055, canvas.height * .16);
    ctx.fillStyle = accent; ctx.fillRect(-canvas.width * .035, -canvas.height * .225, canvas.width * .19, 5);
    ctx.strokeStyle = accent; ctx.lineWidth = 3; ctx.strokeRect(canvas.width * .045, -canvas.height * .285, canvas.width * .055, canvas.height * .055);
    if (app.shooting) { ctx.fillStyle = "#fff6b0"; ctx.shadowColor = "#ff9d1f"; ctx.shadowBlur = 30; ctx.beginPath(); ctx.moveTo(canvas.width * .19,-canvas.height * .23); ctx.lineTo(canvas.width * .245,-canvas.height * .26); ctx.lineTo(canvas.width * .205,-canvas.height * .2); ctx.closePath(); ctx.fill(); }
    ctx.restore();
  }

  function drawMinimap() {
    const dpr = Math.min(devicePixelRatio || 1, 2), width = minimap.width, height = minimap.height, pad = 8 * dpr;
    const sx = (width - pad * 2) / app.arena.width, sy = (height - pad * 2) / app.arena.height;
    mapCtx.clearRect(0, 0, width, height); mapCtx.fillStyle = "rgba(2,8,18,.92)"; mapCtx.fillRect(0, 0, width, height); mapCtx.strokeStyle = "rgba(32,217,255,.24)"; mapCtx.lineWidth = dpr;
    for (const rect of app.arena.obstacles) { mapCtx.fillStyle = "#17304a"; mapCtx.fillRect(pad + rect.x * sx, pad + rect.y * sy, rect.w * sx, rect.h * sy); mapCtx.strokeRect(pad + rect.x * sx, pad + rect.y * sy, rect.w * sx, rect.h * sy); }
    for (const player of app.state.players) {
      if (!player.alive || (player.radarHidden && player.id !== app.playerId)) continue;
      const x = pad + player.x * sx, y = pad + player.y * sy;
      mapCtx.fillStyle = player.id === app.playerId ? "#fff" : player.color; mapCtx.shadowColor = player.color; mapCtx.shadowBlur = 5 * dpr; mapCtx.beginPath(); mapCtx.arc(x, y, (player.id === app.playerId ? 4 : 3) * dpr, 0, Math.PI * 2); mapCtx.fill();
      if (player.id === app.playerId) { const angle = app.cameraAngle; mapCtx.strokeStyle = player.color; mapCtx.beginPath(); mapCtx.moveTo(x, y); mapCtx.lineTo(x + Math.cos(angle) * 13 * dpr, y + Math.sin(angle) * 13 * dpr); mapCtx.stroke(); }
    }
    mapCtx.shadowBlur = 0; mapCtx.strokeStyle = "rgba(32,217,255,.65)"; mapCtx.strokeRect(.5, .5, width - 1, height - 1);
  }

  function drawBackground(now) {
    const gradient = ctx.createRadialGradient(canvas.width * .5, canvas.height * .45, 0, canvas.width * .5, canvas.height * .5, canvas.width * .7);
    gradient.addColorStop(0, "#0a1930");
    gradient.addColorStop(.55, "#050b19");
    gradient.addColorStop(1, "#02040b");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = .2;
    ctx.strokeStyle = "#167aa0";
    ctx.lineWidth = 1;
    const grid = 54 * Math.min(devicePixelRatio || 1, 2);
    const drift = (now * .003) % grid;
    for (let x = drift; x < canvas.width; x += grid) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke(); }
    for (let y = drift; y < canvas.height; y += grid) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }

  function drawArena(now, dt) {
    ctx.strokeStyle = "rgba(49,216,255,.35)";
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, app.arena.width - 4, app.arena.height - 4);

    for (const obstacle of app.arena.obstacles) drawObstacle(obstacle);
    for (const powerup of app.state.powerups || []) drawPowerup(powerup, now);
    predictShot(now);
    updatePredictedBullets(dt, now);
    for (const bullet of app.state.bullets) drawBullet(bullet);
    for (const bullet of app.localBullets) drawBullet(bullet);
    const activeIds = new Set();
    for (const player of app.state.players) {
      activeIds.add(player.id);
      drawPlayer(smoothPlayer(player, dt), now);
    }
    for (const id of app.renderPlayers.keys()) {
      if (!activeIds.has(id)) app.renderPlayers.delete(id);
    }
    drawWorldEffects(now);
  }

  function smoothPlayer(player, dt) {
    let rendered = app.renderPlayers.get(player.id);
    if (!rendered || Math.hypot(rendered.x - player.x, rendered.y - player.y) > 210) {
      rendered = { x: player.x, y: player.y };
      app.renderPlayers.set(player.id, rendered);
    }

    if (player.id === app.playerId && player.alive && app.state.phase === "playing") {
      let speed = 275 * (player.speedBoost ? 1.55 : 1) * (player.dashing ? 2.55 : 1);
      const nextX = Math.max(21, Math.min(app.arena.width - 21, rendered.x + app.move[0] * speed * dt));
      if (isClearLocal(nextX, rendered.y)) rendered.x = nextX;
      const nextY = Math.max(21, Math.min(app.arena.height - 21, rendered.y + app.move[1] * speed * dt));
      if (isClearLocal(rendered.x, nextY)) rendered.y = nextY;
      const correction = 1 - Math.exp(-7 * dt);
      rendered.x += (player.x - rendered.x) * correction;
      rendered.y += (player.y - rendered.y) * correction;
    } else {
      const interpolation = 1 - Math.exp(-15 * dt);
      rendered.x += (player.x - rendered.x) * interpolation;
      rendered.y += (player.y - rendered.y) * interpolation;
    }
    return { ...player, x: rendered.x, y: rendered.y };
  }

  function isClearLocal(x, y) {
    return !app.arena.obstacles.some((rect) => {
      const nearestX = Math.max(rect.x, Math.min(x, rect.x + rect.w));
      const nearestY = Math.max(rect.y, Math.min(y, rect.y + rect.h));
      return (x - nearestX) ** 2 + (y - nearestY) ** 2 < 21 ** 2;
    });
  }

  function drawObstacle(rect) {
    const gradient = ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
    gradient.addColorStop(0, "#142841");
    gradient.addColorStop(1, "#081426");
    ctx.fillStyle = gradient;
    ctx.strokeStyle = "rgba(50,187,229,.36)";
    ctx.lineWidth = 3;
    roundedRect(rect.x, rect.y, rect.w, rect.h, 10);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "rgba(255,45,166,.7)";
    ctx.shadowColor = "#ff2da6"; ctx.shadowBlur = 12;
    ctx.fillRect(rect.x + 14, rect.y + rect.h - 5, Math.max(18, rect.w * .22), 3);
    ctx.shadowBlur = 0;
  }

  function drawBullet(bullet) {
    ctx.save();
    ctx.strokeStyle = bullet.color;
    ctx.fillStyle = "#fff";
    ctx.shadowColor = bullet.color;
    ctx.shadowBlur = 18;
    const speed = Math.hypot(bullet.vx, bullet.vy) || 1;
    ctx.lineWidth = Math.max(4, bullet.radius || 5);
    ctx.beginPath();
    ctx.moveTo(bullet.x - bullet.vx / speed * 25, bullet.y - bullet.vy / speed * 25);
    ctx.lineTo(bullet.x, bullet.y);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(bullet.x, bullet.y, bullet.radius || 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawPowerup(powerup, now) {
    const style = powerupStyle[powerup.kind] || powerupStyle.weapon;
    const pulse = 1 + Math.sin(now * .006 + powerup.x) * .1;
    ctx.save();
    ctx.translate(powerup.x, powerup.y);
    ctx.scale(pulse, pulse);
    ctx.shadowColor = style.color;
    ctx.shadowBlur = 28;
    ctx.fillStyle = "rgba(5,14,29,.9)";
    ctx.strokeStyle = style.color;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, 23, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.rotate(now * .0014);
    ctx.setLineDash([7, 5]);
    ctx.beginPath(); ctx.arc(0, 0, 32, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.rotate(-now * .0014);
    ctx.shadowBlur = 12;
    ctx.fillStyle = style.color;
    ctx.font = "900 24px Vazirmatn, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(style.icon, 0, 1);
    ctx.shadowBlur = 0;
    ctx.font = "700 10px Vazirmatn, sans-serif";
    ctx.fillStyle = "#eafbff";
    ctx.fillText(style.label, 0, 43);
    ctx.restore();
  }

  function drawPlayer(player, now) {
    if (!player.alive && player.lives === 0) return;
    const isMe = player.id === app.playerId;
    ctx.save();
    ctx.globalAlpha = player.alive ? 1 : .18;
    ctx.translate(player.x, player.y);
    ctx.shadowColor = player.color;
    ctx.shadowBlur = isMe ? 28 : 18;
    ctx.strokeStyle = player.color;
    ctx.fillStyle = "#071426";
    ctx.lineWidth = isMe ? 5 : 4;
    ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.rotate(now * .0016 * (isMe ? 1 : -1));
    ctx.setLineDash([8, 7]);
    ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.rotate(-now * .0016 * (isMe ? 1 : -1));
    ctx.fillStyle = player.color;
    ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
    if (player.speedBoost) {
      ctx.globalAlpha = .5;
      ctx.strokeStyle = "#ffd52a";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, 36 + Math.sin(now * .012) * 3, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = player.alive ? 1 : .18;
    }
    if (player.shield) {
      ctx.globalAlpha = .45 + Math.sin(now * .01) * .15;
      ctx.fillStyle = "rgba(105,228,255,.18)";
      ctx.beginPath(); ctx.arc(0, 0, 39, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#9af4ff"; ctx.lineWidth = 2; ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (isMe) {
      ctx.fillStyle = player.color;
      ctx.beginPath(); ctx.moveTo(0, -42); ctx.lineTo(-8,-53); ctx.lineTo(8,-53); ctx.closePath(); ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.rotate(Math.atan2(player.aim[1], player.aim[0]));
    ctx.strokeStyle = player.weapon === "heavy" ? "#ffd45e" : player.weapon === "rapid" ? "#9dff24" : player.weapon === "spread" ? "#ff64c2" : player.color;
    ctx.lineWidth = player.weapon === "heavy" ? 9 : 5;
    ctx.beginPath(); ctx.moveTo(14,0); ctx.lineTo(32,0); ctx.stroke();
    ctx.rotate(-Math.atan2(player.aim[1], player.aim[0]));
    ctx.fillStyle = "rgba(3,8,18,.76)"; ctx.fillRect(-27, 34, 54, 7);
    ctx.fillStyle = player.health > 100 ? "#9dff24" : player.health < 35 ? "#ff526b" : player.color;
    ctx.fillRect(-27, 34, 54 * Math.min(1, player.health / 100), 7);
    ctx.font = "600 14px Vazirmatn, sans-serif";
    ctx.textAlign = "center"; ctx.fillStyle = "#e9fbff";
    ctx.fillText(player.name, 0, 58);
    ctx.restore();
  }

  function drawWorldEffects(now) {
    app.effects = app.effects.filter((effect) => now - effect.born < 480);
    for (const effect of app.effects) {
      if (effect.type !== "muzzle") continue;
      const progress = (now - effect.born) / 480;
      ctx.save(); ctx.globalAlpha = 1 - progress; ctx.strokeStyle = effect.color; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(effect.x, effect.y, 5 + progress * 34, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
  }

  function drawScreenEffects(now) {
    for (const effect of app.effects) {
      if (effect.type !== "flash") continue;
      const progress = (now - effect.born) / 260;
      if (progress < 1) {
        ctx.save(); ctx.globalAlpha = (1 - progress) * .22; ctx.fillStyle = effect.color; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.restore();
      }
    }
  }

  function roundedRect(x, y, width, height, radius) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
  }

  draw();
})();
