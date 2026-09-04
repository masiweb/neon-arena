(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const entryScreen = $("entryScreen");
  const gameScreen = $("gameScreen");
  const playerName = $("playerName");
  const roomCode = $("roomCode");
  const entryError = $("entryError");
  const canvas = $("arena");
  const ctx = canvas.getContext("2d", { alpha: false });
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
  const protocolVersion = "3";

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
    weaponBadge.textContent = `سلاح: ${weaponNames[me.weapon] || weaponNames.base}${me.speedBoost ? " · سرعت+" : ""}`;

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
          app.effects.push({ type: "muzzle", born: performance.now(), x: bullet.x, y: bullet.y, color: bullet.color });
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
  setupPad($("aimPad"), (x, y, distance) => {
    app.shooting = true;
    app.manualAim = distance > .2;
    if (app.manualAim) app.aim = [x, y];
    ensureAudio();
  }, () => { app.shooting = false; app.manualAim = false; });

  function automaticAim() {
    const me = app.state?.players.find((player) => player.id === app.playerId);
    if (!me?.alive) return null;
    let nearest = null;
    let nearestDistance = 420;
    for (const player of app.state.players) {
      if (player.id === me.id || !player.alive || player.lives <= 0) continue;
      const distance = Math.hypot(player.x - me.x, player.y - me.y);
      if (distance < nearestDistance) {
        nearest = player;
        nearestDistance = distance;
      }
    }
    return nearest ? [nearest.x - me.x, nearest.y - me.y] : null;
  }

  function resolvedAim() {
    if (app.manualAim) return app.aim;
    const targetAim = automaticAim();
    if (targetAim) return targetAim;
    if (Math.hypot(app.move[0], app.move[1]) > .08) return app.move;
    return app.aim;
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
      app.localBullets.push({
        id: `local-${now}-${spread}`,
        x: rendered.x + dx * 31,
        y: rendered.y + dy * 31,
        vx: dx * spec.speed,
        vy: dy * spec.speed,
        radius: spec.radius,
        color: me.color,
        born: now,
      });
    }
    app.effects.push({ type: "muzzle", born: now, x: rendered.x, y: rendered.y, color: me.color });
    playShot(true);
  }

  function acknowledgePredictedBullet(serverBullet) {
    const serverAngle = Math.atan2(serverBullet.vy, serverBullet.vx);
    const index = app.localBullets.findIndex((bullet) => {
      const angle = Math.atan2(bullet.vy, bullet.vx);
      return Math.abs(Math.atan2(Math.sin(angle - serverAngle), Math.cos(angle - serverAngle))) < .24;
    });
    if (index >= 0) app.localBullets.splice(index, 1);
  }

  function updatePredictedBullets(dt, now) {
    app.localBullets = app.localBullets.filter((bullet) => {
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      if (now - bullet.born > 650) return false;
      if (bullet.x < 0 || bullet.x > app.arena.width || bullet.y < 0 || bullet.y > app.arena.height) return false;
      return !app.arena.obstacles.some((rect) => {
        const nx = Math.max(rect.x, Math.min(bullet.x, rect.x + rect.w));
        const ny = Math.max(rect.y, Math.min(bullet.y, rect.y + rect.h));
        return (bullet.x - nx) ** 2 + (bullet.y - ny) ** 2 < bullet.radius ** 2;
      });
    });
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
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse" || !app.state) return;
    const me = app.state.players.find((player) => player.id === app.playerId);
    if (!me) return;
    const point = screenToWorld(event.clientX, event.clientY);
    app.aim = [point.x - me.x, point.y - me.y];
  });
  canvas.addEventListener("pointerdown", (event) => { if (event.pointerType === "mouse") app.shooting = true; });
  window.addEventListener("pointerup", (event) => { if (event.pointerType === "mouse") app.shooting = false; });

  function releaseInput() {
    app.padMove = [0, 0];
    app.move = [0, 0];
    app.shooting = false;
    app.manualAim = false;
    app.keys.clear();
    app.inputSeq += 1;
    send({ type: "input", seq: app.inputSeq, move: [0, 0], aim: app.aim, shooting: false });
  }
  window.addEventListener("blur", releaseInput);
  document.addEventListener("visibilitychange", () => { if (document.hidden) releaseInput(); });

  setInterval(() => {
    const x = (app.keys.has("d") || app.keys.has("arrowright") ? 1 : 0) - (app.keys.has("a") || app.keys.has("arrowleft") ? 1 : 0);
    const y = (app.keys.has("s") || app.keys.has("arrowdown") ? 1 : 0) - (app.keys.has("w") || app.keys.has("arrowup") ? 1 : 0);
    app.move = x || y ? [x, y] : app.padMove;
    app.aim = resolvedAim();
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
    drawBackground(now);
    if (!app.state) return;
    const { scale, ox, oy } = transform();
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    drawArena(now, dt);
    ctx.restore();
    drawScreenEffects(now);
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
