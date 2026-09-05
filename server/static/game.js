(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const entryScreen = $("entryScreen");
  const lobbyScreen = $("lobbyScreen");
  const gameScreen = $("gameScreen");
  const roomCode = $("roomCode");
  const entryError = $("entryError");
  const lobbyError = $("lobbyError");
  const panelModal = $("panelModal");
  const panelBody = $("panelBody");
  let canvas = $("arena");
  let renderer3D = null;
  try {
    renderer3D = window.NeonRenderer3D?.create(canvas) || null;
  } catch (error) {
    // A few Android WebView/GPU combinations reject otherwise valid WebGL
    // shaders. A canvas cannot switch from WebGL to 2D after a context was
    // created, so replace it before entering compatibility mode.
    console.warn("WebGL renderer unavailable; using compatibility mode", error);
    const fallbackCanvas = canvas.cloneNode(false);
    canvas.replaceWith(fallbackCanvas);
    canvas = fallbackCanvas;
  }
  const ctx = renderer3D ? null : canvas.getContext("2d", { alpha: false });
  const coarsePointer = matchMedia("(pointer: coarse)").matches;
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
  const lobbySettings = $("lobbySettings");
  const mapSelect = $("mapSelect");
  const botDifficulty = $("botDifficulty");
  const mapBadge = $("mapBadge");
  const jumpButton = $("jumpButton");
  const toast = $("toast");
  const crosshair = document.querySelector(".crosshair");
  const damageFlash = $("damageFlash");
  const grenadeButton = $("grenadeButton");
  const rpgButton = $("rpgButton");

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
    grenade: { color: "#ffc14f", icon: "●", label: "۳ نارنجک" },
    rpg: { color: "#ff654f", icon: "➤", label: "۳ موشک RPG" },
  };

  const localWeaponSpecs = {
    base: { interval: 220, radius: 6, spread: [0] },
    heavy: { interval: 460, radius: 9, spread: [0] },
    rapid: { interval: 105, radius: 5, spread: [-.015, .015] },
    spread: { interval: 390, radius: 5, spread: [-.09, 0, .09] },
  };

  const isAndroidApp = location.protocol === "file:";
  const bundledServerOrigin = "__NEON_SERVER_ORIGIN__";
  const androidServerOrigin = bundledServerOrigin.startsWith("https://")
    ? bundledServerOrigin.replace(/\/$/, "")
    : "https://game.chanelchat.ir";
  const httpOrigin = isAndroidApp ? androidServerOrigin : location.origin;
  const wsOrigin = isAndroidApp
    ? androidServerOrigin.replace(/^https:/, "wss:")
    : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
  const protocolVersion = "9";
  if (isAndroidApp) {
    $("downloadAndroid")?.classList.add("hidden");
    $("downloadAndroidLobby")?.classList.add("hidden");
  }

  const app = {
    token: localStorage.getItem("neon-token") || "",
    user: null,
    inviteUrl: "",
    socket: null,
    playerId: null,
    accountId: null,
    teamId: null,
    ownerUserId: null,
    room: null,
    hostId: null,
    maps: [],
    botDifficulties: [],
    state: null,
    stateReceivedAt: performance.now(),
    arena: { id: "citadel", name: "دژ نئون", width: 3600, height: 2100, obstacles: [], theme: {} },
    move: [0, 0],
    padMove: [0, 0],
    aim: [1, 0],
    cameraAngle: 0,
    cameraPitch: 0,
    lastPitchInputAt: 0,
    moveVisual: 0,
    assistTargetId: null,
    shooting: false,
    inputSeq: 0,
    lastAck: 0,
    localBullets: [],
    lastPredictedShot: 0,
    muzzleUntil: 0,
    weaponRecoil: 0,
    previousHealth: 100,
    effects: [],
    renderPlayers: new Map(),
    keys: new Set(),
    lastFrame: performance.now(),
    audioContext: null,
    audioMaster: null,
    musicBus: null,
    effectsBus: null,
    noiseBuffer: null,
    musicTimer: null,
    musicStep: 0,
    audioMuted: localStorage.getItem("neon-muted") === "1",
    voiceStream: null,
    voicePeers: new Map(),
    voiceEnabled: false,
    voiceMode: "off",
    iceServers: [],
  };

  const fa = new Intl.NumberFormat("fa-IR");
  const query = new URLSearchParams(location.search);
  const queryRoom = query.get("room");
  const queryReferral = query.get("ref");
  const queryTeam = query.get("team");
  const resetToken = new URLSearchParams(location.hash.replace(/^#/, "")).get("reset");
  if (queryRoom) roomCode.value = queryRoom.toUpperCase().slice(0, 4);
  if (queryReferral) $("referralCode").value = queryReferral.toUpperCase().slice(0, 20);

  function showError(message) {
    const target = lobbyScreen.classList.contains("hidden") ? entryError : lobbyError;
    target.textContent = message || "";
  }

  function notify(message) {
    if (gameScreen.classList.contains("hidden")) {
      const target = lobbyScreen.classList.contains("hidden") ? entryError : lobbyError;
      target.textContent = message;
      clearTimeout(notify.portalTimer);
      notify.portalTimer = setTimeout(() => { if (target.textContent === message) target.textContent = ""; }, 3000);
      return;
    }
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove("show"), 1900);
  }

  async function api(path, options = {}, authenticated = true) {
    const headers = { ...(options.headers || {}) };
    if (authenticated && app.token) headers.Authorization = `Bearer ${app.token}`;
    let body = options.body;
    if (body && typeof body !== "string") {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(body);
    }
    const response = await fetch(`${httpOrigin}${path}`, { ...options, headers, body });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && authenticated) clearSession(true);
      throw new Error(data.detail || data.message || "درخواست انجام نشد");
    }
    return data;
  }

  function showAuthView(name) {
    for (const form of document.querySelectorAll(".auth-form")) form.classList.add("hidden");
    const selected = $(`${name}Form`);
    selected?.classList.remove("hidden");
    $("authTabs").classList.toggle("hidden", !["login", "register"].includes(name));
    for (const button of document.querySelectorAll("[data-auth-view]")) button.classList.toggle("active", button.dataset.authView === name);
    entryError.textContent = "";
    setAppOrientation("portrait");
  }

  function setAppOrientation(mode) {
    const landscape = mode === "landscape";
    try { window.NeonAndroid?.setOrientation?.(mode); } catch { /* Web fallback below. */ }
    const requested = screen.orientation?.lock?.(landscape ? "landscape" : "portrait");
    if (requested?.catch) requested.catch(() => {});
  }

  function setSession(data) {
    app.token = data.token;
    localStorage.setItem("neon-token", app.token);
    enterLobby(data.user, data.inviteUrl || "");
    if (queryTeam && !data.user.team) {
      api("/api/teams/join", { method:"POST", body:{ inviteCode:queryTeam } })
        .then(() => refreshProfile()).then(() => notify("به تیم دعوت‌شده پیوستی"))
        .catch((error) => showError(error.message));
    }
  }

  function clearSession(showLogin = true) {
    app.token = "";
    app.user = null;
    localStorage.removeItem("neon-token");
    closeVoice();
    lobbyScreen.classList.add("hidden");
    gameScreen.classList.add("hidden");
    document.body.classList.remove("in-game", "in-lobby");
    setAppOrientation("portrait");
    if (showLogin) {
      entryScreen.classList.remove("hidden");
      showAuthView("login");
    }
  }

  function enterLobby(user, inviteUrl = "") {
    app.user = user;
    app.teamId = user.team?.id || null;
    app.inviteUrl = inviteUrl || `${httpOrigin}/?ref=${user.referralCode}`;
    $("profileUsername").textContent = user.username;
    $("profileRank").textContent = user.rank?.name || "تازه‌کار";
    $("goldBalance").textContent = fa.format(user.gold || 0);
    $("diamondBalance").textContent = fa.format(user.diamonds || 0);
    $("personalInvite").value = app.inviteUrl;
    $("adminLink").classList.toggle("hidden", !user.isAdmin);
    $("adminLink").href = `${httpOrigin}/admin`;
    $("voiceTeamOption").disabled = !user.team;
    entryScreen.classList.add("hidden");
    gameScreen.classList.add("hidden");
    lobbyScreen.classList.remove("hidden");
    document.body.classList.remove("in-game");
    document.body.classList.add("in-lobby");
    setAppOrientation("landscape");
    loadAds("lobby");
  }

  async function refreshProfile() {
    if (!app.token) return;
    const data = await api("/api/me");
    enterLobby(data.user, data.inviteUrl);
  }

  async function bootstrap() {
    if (resetToken) {
      entryScreen.classList.remove("hidden");
      showAuthView("reset");
      return;
    }
    loadAds("login");
    if (!app.token) return showAuthView("login");
    try {
      const data = await api("/api/me");
      enterLobby(data.user, data.inviteUrl);
      if (queryTeam && !data.user.team) {
        try { await api("/api/teams/join", { method: "POST", body: { inviteCode: queryTeam } }); await refreshProfile(); notify("به تیم دعوت‌شده پیوستی"); }
        catch (error) { showError(error.message); }
      }
    } catch {
      clearSession(true);
    }
  }

  async function loadAds(placement) {
    try {
      const data = await api(`/api/ads?placement=${encodeURIComponent(placement)}`, {}, false);
      const slot = placement === "login" ? $("loginAd") : placement === "result" ? $("resultAd") : $("lobbyAd");
      const ad = data.ads?.[0];
      if (!slot || !ad) return;
      const content = document.createElement(ad.targetUrl ? "a" : "div");
      if (ad.targetUrl) { content.href = ad.targetUrl; content.target = "_blank"; content.rel = "noopener"; }
      content.innerHTML = `<b></b><span></span>`;
      content.querySelector("b").textContent = ad.title;
      content.querySelector("span").textContent = ad.body;
      if (ad.imageUrl) {
        const picture = document.createElement("img");
        picture.src = ad.imageUrl;
        picture.alt = ad.title;
        picture.loading = "lazy";
        content.prepend(picture);
      }
      slot.replaceChildren(content);
      slot.classList.remove("hidden");
    } catch { /* Ads never block login or play. */ }
  }

  async function createRoom() {
    requestFullscreenSoft();
    ensureAudio();
    setBusy(true);
    try {
      const data = await api("/api/rooms", { method: "POST" });
      if (data.reused) notify("اتاق فعال قبلی‌ات باز شد");
      connect(data.code);
    } catch (error) {
      showError(error.message || "ارتباط با سرور برقرار نشد");
      setBusy(false);
    }
  }

  async function joinRoom() {
    const code = roomCode.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 4);
    roomCode.value = code;
    if (code.length !== 4) return showError("کد چهارحرفی اتاق را وارد کنید");
    requestFullscreenSoft();
    ensureAudio();
    setBusy(true);
    try {
      await api(`/api/rooms/${code}`, {}, false);
      connect(code);
    } catch (error) {
      showError(error.message || "ارتباط با سرور برقرار نشد");
      setBusy(false);
    }
  }

  function setBusy(busy) {
    $("createRoom").disabled = busy;
    $("joinRoom").disabled = busy;
    lobbyError.textContent = busy ? "در حال اتصال…" : "";
  }

  function connect(code) {
    if (app.socket) app.socket.close();
    const socket = new WebSocket(`${wsOrigin}/ws/${code}?protocol=${protocolVersion}&client=${isAndroidApp ? "android" : "web"}`);
    app.socket = socket;
    app.playerId = null;
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "auth", token: app.token }));
      setBusy(false);
    });
    socket.addEventListener("message", (event) => onMessage(JSON.parse(event.data)));
    socket.addEventListener("close", () => {
      if (!app.playerId) {
        showError("اتصال به اتاق ممکن نشد");
        setBusy(false);
      } else {
        notify("ارتباط با اتاق قطع شد");
        closeVoice();
        app.playerId = null;
        app.room = null;
        document.body.classList.remove("in-game");
        setTimeout(() => refreshProfile().catch(() => clearSession(true)), 700);
      }
    });
    socket.addEventListener("error", () => showError("خطا در ارتباط با سرور"));
  }

  function onMessage(message) {
    if (message.type === "welcome") {
      app.playerId = message.playerId;
      app.room = message.room;
      app.hostId = message.hostId;
      app.accountId = message.accountId;
      app.teamId = message.teamId;
      app.ownerUserId = message.ownerUserId;
      app.iceServers = message.iceServers || [];
      app.maps = message.maps || [];
      app.botDifficulties = message.botDifficulties || [];
      applyArena(message.arena);
      populateLobbyOptions();
      roomBadge.textContent = `اتاق ${message.room}`;
      history.replaceState(null, "", `?room=${message.room}`);
      entryScreen.classList.add("hidden");
      lobbyScreen.classList.add("hidden");
      gameScreen.classList.remove("hidden");
      document.body.classList.remove("in-lobby");
      document.body.classList.add("in-game");
      setAppOrientation("landscape");
      requestAnimationFrame(fit);
      requestFullscreenSoft();
      return;
    }
    if (message.type === "arena") {
      applyArena(message.arena);
      return;
    }
    if (message.type === "state") {
      const previous = app.state;
      app.state = message;
      app.stateReceivedAt = performance.now();
      app.hostId = message.hostId;
      updateHud(previous);
      return;
    }
    if (message.type === "event") notify(message.message);
    if (message.type === "voice_peers") handleVoicePeers(message.peers || []);
    if (message.type === "voice_signal") handleVoiceSignal(message.from, message.signal).catch(() => notify("اتصال صوتی یکی از کاربران برقرار نشد"));
    if (message.type === "forced_leave") {
      notify(message.message || "از اتاق خارج شدید");
      app.socket?.close(1000);
    }
    if (message.type === "error") {
      if (app.playerId) notify(message.message);
      else showError(message.message);
    }
  }

  function applyArena(arena) {
    if (!arena?.width || !arena?.height || !Array.isArray(arena.obstacles)) return;
    app.arena = arena;
    app.renderPlayers.clear();
    mapBadge.textContent = `نقشه: ${arena.name || "نئون"}`;
    if (mapSelect) mapSelect.value = arena.id || "citadel";
    requestAnimationFrame(fitMinimap);
  }

  function populateLobbyOptions() {
    mapSelect.replaceChildren(...app.maps.map((map) => {
      const option = document.createElement("option");
      option.value = map.id;
      option.textContent = map.name;
      option.title = map.description || "";
      return option;
    }));
    botDifficulty.replaceChildren(...app.botDifficulties.map((level) => {
      const option = document.createElement("option");
      option.value = level.id;
      option.textContent = level.name;
      return option;
    }));
    mapSelect.value = app.arena.id || "citadel";
  }

  function updateHud(previous) {
    const state = app.state;
    const me = state.players.find((player) => player.id === app.playerId);
    if (!me) return;
    app.lastAck = Math.max(app.lastAck, me.ack || 0);
    healthFill.style.width = `${Math.min(100, me.health)}%`;
    healthFill.style.background = me.health > 100 ? "linear-gradient(90deg,#66cf22,#b8ff38)" : me.health < 35 ? "linear-gradient(90deg,#ff3858,#ff7b75)" : "linear-gradient(90deg,#0ba6ff,#39f1ff)";
    healthText.textContent = `${fa.format(me.health)}٪`;
    lives.innerHTML = Array.from({ length: 3 }, (_, index) => `<i class="${index < me.lives ? "" : "lost"}">♥</i>`).join("");
    myScore.textContent = fa.format(me.score);
    weaponBadge.textContent = `سلاح: ${weaponNames[me.weapon] || weaponNames.base}${me.speedBoost ? " · سرعت+" : ""}${me.radarHidden ? " · اختفا" : ""}`;
    $("grenadeCount").textContent = fa.format(me.grenades || 0);
    $("rpgCount").textContent = fa.format(me.rockets || 0);
    grenadeButton.classList.toggle("hidden", !(me.grenades > 0));
    rpgButton.classList.toggle("hidden", !(me.rockets > 0));
    grenadeButton.disabled = !me.alive || state.phase !== "playing" || !(me.grenades > 0);
    rpgButton.disabled = !me.alive || state.phase !== "playing" || !(me.rockets > 0);
    mapBadge.textContent = `نقشه: ${state.mapName || app.arena.name || "نئون"}`;

    if (me.health < app.previousHealth) {
      navigator.vibrate?.(35);
      app.effects.push({ type: "flash", born: performance.now(), color: "#ff2d62" });
      if (damageFlash) {
        damageFlash.classList.remove("show");
        void damageFlash.offsetWidth;
        damageFlash.classList.add("show");
      }
    }
    app.previousHealth = me.health;
    const mins = Math.floor(state.remaining / 60).toString().padStart(2, "0");
    const secs = (state.remaining % 60).toString().padStart(2, "0");
    timer.textContent = `${toFaDigits(mins)}:${toFaDigits(secs)}`;
    phaseLabel.textContent = state.phase === "playing" ? "راند فعال" : state.phase === "countdown" ? "آماده" : state.phase === "ended" ? "پایان راند" : "اتاق انتظار";
    if (state.phase === "ended" && previous?.phase !== "ended") loadAds("result");
    if (state.phase !== "ended") $("resultAd").classList.add("hidden");
    updateScores(state.players);
    updateCenterMessage();
    jumpButton.disabled = !me.grounded || state.phase !== "playing" || !me.alive;
    jumpButton.classList.toggle("cooling", jumpButton.disabled);

    if (previous?.bullets) {
      const oldIds = new Set(previous.bullets.map((bullet) => bullet.id));
      for (const bullet of state.bullets) {
        if (!oldIds.has(bullet.id)) {
          app.effects.push({ type: "muzzle", born: performance.now(), x: bullet.x1 ?? bullet.x, y: bullet.y1 ?? bullet.y, color: bullet.color });
          if (bullet.owner === app.playerId) {
            acknowledgePredictedBullet(bullet);
            if (bullet.hit) showHitConfirmation(bullet.hitZone);
          }
          else {
            const shooter = state.players.find((player) => player.id === bullet.owner);
            playShot(false, shooter?.weapon || "base");
          }
        }
      }
    }
    if (previous?.explosions) {
      const oldExplosions = new Set(previous.explosions.map((item) => item.id));
      for (const explosion of state.explosions || []) {
        if (!oldExplosions.has(explosion.id)) playExplosion(explosion.kind);
      }
    }
  }

  function showHitConfirmation(hitZone = "body") {
    crosshair?.classList.remove("hit");
    void crosshair?.offsetWidth;
    crosshair?.classList.add("hit");
    clearTimeout(showHitConfirmation.timer);
    showHitConfirmation.timer = setTimeout(() => crosshair?.classList.remove("hit"), 130);
    navigator.vibrate?.(14);
    if (hitZone === "head") {
      const banner = $("headshotBanner");
      banner.classList.remove("show");
      void banner.offsetWidth;
      banner.classList.add("show");
      playHeadshot();
      navigator.vibrate?.([24, 30, 42]);
    } else {
      playHit(hitZone);
    }
  }

  function updateScores(players) {
    const sorted = [...players].sort((a, b) => b.lives - a.lives || b.score - a.score || a.name.localeCompare(b.name, "fa"));
    scoreList.replaceChildren(...sorted.map((player, index) => {
      const item = document.createElement("li");
      if (player.id === app.playerId) item.className = "me";
      item.innerHTML = `<b>${toFaDigits(index + 1)}</b><i class="dot" style="background:${player.color};color:${player.color}"></i><span></span><em class="score-lives">♥ ${fa.format(player.lives)}</em><strong>${fa.format(player.score)}</strong>`;
      const teammate = app.teamId && player.teamId === app.teamId ? " ◈" : "";
      item.querySelector("span").textContent = `${player.bot ? "🤖 " : ""}${player.name}${teammate}`;
      return item;
    }));
  }

  function updateCenterMessage() {
    const state = app.state;
    const me = state.players.find((player) => player.id === app.playerId);
    startRound.classList.add("hidden");
    $("resetRoundMenu").classList.toggle("hidden", app.playerId !== state.hostId);
    botControls.classList.add("hidden");
    lobbySettings.classList.add("hidden");
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
        mapSelect.value = state.mapId || app.arena.id || "citadel";
        botDifficulty.value = state.botDifficulty || "normal";
        lobbySettings.classList.remove("hidden");
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

  function send(payload) {
    if (app.socket?.readyState === WebSocket.OPEN) app.socket.send(JSON.stringify(payload));
  }

  async function copyText(value, message = "کپی شد") {
    try { await navigator.clipboard.writeText(value); notify(message); }
    catch { prompt("این متن را کپی کنید:", value); }
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
      event.preventDefault();
      if (pointer !== null) return;
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
    const strength = rawStrength < .055 ? 0 : Math.pow((rawStrength - .055) / .945, .82);
    const directionLength = Math.hypot(x, y) || 1;
    app.padMove = [x / directionLength * strength, y / directionLength * strength];
  }, () => { app.padMove = [0, 0]; });

  const lookSurface = $("lookSurface");
  const fireButton = $("fireButton");
  let fireStopTimer = null;
  let lookPointer = null;
  let lookX = 0;
  let lookY = 0;

  function rotateCamera(dx, dy, pointerType) {
    const mouse = pointerType === "mouse";
    const yawSensitivity = mouse ? .00215 : .00405;
    const pitchSensitivity = mouse ? .0017 : .00275;
    const maxDelta = mouse ? 90 : 52;
    app.cameraAngle += Math.max(-maxDelta, Math.min(maxDelta, dx)) * (mouse ? yawSensitivity : .00325);
    app.cameraPitch = Math.max(-.48, Math.min(.42, app.cameraPitch - Math.max(-48, Math.min(48, dy)) * pitchSensitivity));
    if (Math.abs(dy) > 1.5) app.lastPitchInputAt = performance.now();
  }

  lookSurface.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse") {
      event.preventDefault();
      lookSurface.requestPointerLock?.();
      if (event.button === 0) beginShooting();
      return;
    }
    if (lookPointer !== null) return;
    event.preventDefault();
    lookPointer = event.pointerId;
    lookX = event.clientX;
    lookY = event.clientY;
    lookSurface.setPointerCapture(event.pointerId);
  });
  lookSurface.addEventListener("pointermove", (event) => {
    if (event.pointerType === "mouse" || event.pointerId !== lookPointer) return;
    event.preventDefault();
    const dx = event.clientX - lookX;
    const dy = event.clientY - lookY;
    lookX = event.clientX;
    lookY = event.clientY;
    rotateCamera(dx, dy, event.pointerType);
  });
  const endLook = (event) => {
    if (event.pointerId !== lookPointer) return;
    lookPointer = null;
  };
  lookSurface.addEventListener("pointerup", endLook);
  lookSurface.addEventListener("pointercancel", endLook);
  lookSurface.addEventListener("contextmenu", (event) => event.preventDefault());

  document.addEventListener("mousemove", (event) => {
    if (document.pointerLockElement === lookSurface) rotateCamera(event.movementX, event.movementY, "mouse");
  });
  document.addEventListener("pointerlockchange", () => {
    gameScreen.classList.toggle("mouse-locked", document.pointerLockElement === lookSurface);
  });
  document.addEventListener("mousedown", (event) => {
    if (coarsePointer || gameScreen.classList.contains("hidden") || event.target.closest?.("button,input,a")) return;
    if (event.button === 0) {
      event.preventDefault();
      lookSurface.requestPointerLock?.();
      beginShooting();
    }
  });
  document.addEventListener("mouseup", (event) => {
    if (event.button === 0) endShooting();
  });

  function beginShooting() {
    clearTimeout(fireStopTimer);
    app.shooting = true;
    app.aim = resolvedAim();
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
    let best = null;
    let bestScore = Infinity;
    const cone = coarsePointer ? .31 : .14;
    const maximumDistance = coarsePointer ? 560 : 480;
    for (const player of app.state.players) {
      if (player.id === me.id || !player.alive || player.lives <= 0) continue;
      if (me.teamId && player.teamId === me.teamId) continue;
      const distance = Math.hypot(player.x - me.x, player.y - me.y);
      const direction = Math.atan2(player.y - me.y, player.x - me.x);
      const delta = Math.atan2(Math.sin(direction - app.cameraAngle), Math.cos(direction - app.cameraAngle));
      const angleError = Math.abs(delta);
      const score = angleError * 900 + distance;
      const bodyPitch = Math.atan2(((player.z || 0) + 40) - ((me.z || 0) + 63), distance || 1);
      if (distance < maximumDistance && angleError < cone && score < bestScore && hasLineOfSight(me.x, me.y, player.x, player.y, (me.z || 0) + 63, bodyPitch)) {
        best = { player, direction, delta, distance, bodyPitch };
        bestScore = score;
      }
    }
    return best;
  }

  function hasLineOfSight(x1, y1, x2, y2, rayHeight = 63, pitch = 0) {
    const distance = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.ceil(distance / 18));
    for (let step = 2; step < steps; step++) {
      const ratio = step / steps;
      const height = rayHeight + Math.tan(pitch) * distance * ratio;
      if (wallAt(x1 + (x2 - x1) * ratio, y1 + (y2 - y1) * ratio, height) >= 0) return false;
    }
    return true;
  }

  function resolvedAim() {
    const target = automaticAim();
    app.assistTargetId = target?.player.id || null;
    crosshair?.classList.toggle("locked", Boolean(target));
    if (target && app.shooting) {
      const pull = coarsePointer ? .16 : .055;
      app.cameraAngle += target.delta * pull;
      if (performance.now() - app.lastPitchInputAt > 750) app.cameraPitch = target.bodyPitch;
      return [Math.cos(target.direction), Math.sin(target.direction)];
    }
    return [Math.cos(app.cameraAngle), Math.sin(app.cameraAngle)];
  }

  function ensureAudio() {
    if (app.audioMuted) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!app.audioContext) {
      const audio = new AudioContextClass();
      const compressor = audio.createDynamicsCompressor();
      const master = audio.createGain();
      const musicBus = audio.createGain();
      const effectsBus = audio.createGain();
      compressor.threshold.value = -18;
      compressor.knee.value = 12;
      compressor.ratio.value = 7;
      compressor.attack.value = .004;
      compressor.release.value = .2;
      master.gain.value = .72;
      musicBus.gain.value = .42;
      effectsBus.gain.value = .9;
      musicBus.connect(compressor);
      effectsBus.connect(compressor);
      compressor.connect(master).connect(audio.destination);
      const noise = audio.createBuffer(1, Math.floor(audio.sampleRate * .6), audio.sampleRate);
      const channel = noise.getChannelData(0);
      for (let index = 0; index < channel.length; index++) channel[index] = Math.random() * 2 - 1;
      app.audioContext = audio;
      app.audioMaster = master;
      app.musicBus = musicBus;
      app.effectsBus = effectsBus;
      app.noiseBuffer = noise;
    }
    if (app.audioContext.state === "suspended") app.audioContext.resume().catch(() => {});
    if (!app.musicTimer) {
      playMusicNote();
      app.musicTimer = setInterval(playMusicNote, 260);
    }
  }

  function tone(frequency, duration, volume, type = "sine", delay = 0, bus = "effects", endFrequency = frequency) {
    const audio = app.audioContext;
    if (!audio || app.audioMuted || audio.state !== "running") return;
    const start = audio.currentTime + delay;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(gain).connect(bus === "music" ? app.musicBus : app.effectsBus);
    oscillator.start(start);
    oscillator.stop(start + duration + .03);
  }

  function noiseBurst(duration, volume, cutoff, delay = 0, bus = "effects") {
    const audio = app.audioContext;
    if (!audio || !app.noiseBuffer || app.audioMuted || audio.state !== "running") return;
    const start = audio.currentTime + delay;
    const source = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    source.buffer = app.noiseBuffer;
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(cutoff, start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(120, cutoff * .34), start + duration);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    source.connect(filter).connect(gain).connect(bus === "music" ? app.musicBus : app.effectsBus);
    source.start(start);
    source.stop(start + duration + .02);
  }

  function playMusicNote() {
    if (!app.audioContext || app.audioMuted || document.hidden) return;
    const step = app.musicStep % 16;
    const bass = [55, 55, 65.41, 65.41, 73.42, 73.42, 49, 49][Math.floor(step / 2)];
    const notes = [220, 0, 293.66, 0, 329.63, 293.66, 0, 246.94, 196, 0, 261.63, 0, 293.66, 246.94, 220, 0];
    if (step % 2 === 0) tone(bass, .24, .028, "sawtooth", 0, "music", bass * .82);
    if (notes[step]) tone(notes[step], .15, .014, "triangle", .025, "music", notes[step] * 1.01);
    if (step === 0 || step === 8) tone(82, .16, .038, "sine", 0, "music", 38);
    if (step === 4 || step === 12) noiseBurst(.075, .012, 3400, 0, "music");
    app.musicStep += 1;
  }

  function playShot(isMine, weapon = "base") {
    if (!app.audioContext || app.audioMuted) return;
    const scale = isMine ? 1 : .28;
    if (weapon === "heavy") {
      tone(155, .16, .11 * scale, "sawtooth", 0, "effects", 48);
      tone(72, .2, .085 * scale, "sine", .006, "effects", 34);
      noiseBurst(.14, .095 * scale, 1500);
    } else if (weapon === "rapid") {
      tone(260, .052, .07 * scale, "square", 0, "effects", 125);
      noiseBurst(.045, .045 * scale, 4200);
    } else if (weapon === "spread") {
      tone(130, .12, .095 * scale, "sawtooth", 0, "effects", 58);
      noiseBurst(.11, .08 * scale, 2200);
      tone(310, .04, .035 * scale, "square", .012, "effects", 180);
    } else {
      tone(205, .085, .082 * scale, "square", 0, "effects", 92);
      tone(680, .035, .03 * scale, "sawtooth", .004, "effects", 260);
      noiseBurst(.065, .045 * scale, 3200);
    }
  }

  function playHit(hitZone = "body") {
    if (!app.audioContext || app.audioMuted) return;
    const strong = hitZone === "neck";
    tone(strong ? 560 : 720, .06, strong ? .05 : .035, "triangle", 0, "effects", strong ? 1240 : 1080);
    tone(1180, .045, strong ? .032 : .022, "sine", .028, "effects", 820);
  }

  function playHeadshot() {
    ensureAudio();
    if (!app.audioContext || app.audioMuted) return;
    tone(1280, .08, .07, "square", 0, "effects", 520);
    tone(1880, .12, .055, "triangle", .045, "effects", 880);
    noiseBurst(.09, .045, 5200, 0, "effects");
    if ("speechSynthesis" in window && typeof SpeechSynthesisUtterance === "function") {
      const callout = new SpeechSynthesisUtterance("Headshot");
      callout.lang = "en-US";
      callout.rate = 1.18;
      callout.pitch = 0.82;
      callout.volume = 0.62;
      speechSynthesis.cancel();
      speechSynthesis.speak(callout);
    }
  }

  function playJump() {
    ensureAudio();
    tone(150, .12, .035, "triangle", 0, "effects", 310);
  }

  function playExplosion(kind) {
    ensureAudio();
    const heavy = kind === "rpg";
    tone(heavy ? 72 : 92, heavy ? .55 : .42, heavy ? .18 : .14, "sawtooth", 0, "effects", 28);
    noiseBurst(heavy ? .48 : .36, heavy ? .2 : .15, heavy ? 980 : 1350);
    navigator.vibrate?.(heavy ? [45, 35, 80] : [35, 25, 55]);
  }

  function predictShot(now) {
    if (!app.shooting || app.state?.phase !== "playing") return;
    const me = app.state.players.find((player) => player.id === app.playerId);
    if (!me?.alive) return;
    const spec = localWeaponSpecs[me.weapon] || localWeaponSpecs.base;
    if (now - app.lastPredictedShot < spec.interval) return;
    app.lastPredictedShot = now;
    app.muzzleUntil = now + 58;
    app.weaponRecoil = Math.min(7, app.weaponRecoil + (me.weapon === "heavy" ? 5.5 : 3.2));
    const rendered = app.renderPlayers.get(me.id) || me;
    const length = Math.hypot(app.aim[0], app.aim[1]) || 1;
    const baseAngle = Math.atan2(app.aim[1] / length, app.aim[0] / length);
    for (const spread of spec.spread) {
      const angle = baseAngle + spread;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const shotHeight = (rendered.z || 0) + 63;
      const end = traceEnd(rendered.x + dx * 31, rendered.y + dy * 31, dx, dy, 920, shotHeight, app.cameraPitch);
      app.localBullets.push({
        id: `local-${now}-${spread}`,
        x1: rendered.x + dx * 31,
        y1: rendered.y + dy * 31,
        x2: end[0],
        y2: end[1],
        z: shotHeight,
        z2: end[2],
        radius: spec.radius,
        color: me.color,
        born: now,
      });
    }
    app.effects.push({ type: "muzzle", born: now, x: rendered.x, y: rendered.y, color: me.color });
    playShot(true, me.weapon);
  }

  function traceEnd(x, y, dx, dy, range, shotHeight = 48, pitch = 0) {
    let distance = 0;
    while (distance < range) {
      distance += 8;
      const px = x + dx * distance, py = y + dy * distance;
      const height = shotHeight + Math.tan(pitch) * distance;
      if (height < 0 || px <= 0 || py <= 0 || px >= app.arena.width || py >= app.arena.height || wallAt(px, py, height) >= 0) return [px, py, height];
    }
    return [x + dx * range, y + dy * range, shotHeight + Math.tan(pitch) * range];
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
    $("soundToggle").textContent = app.audioMuted ? "🔇" : "🔊";
    $("soundToggle").classList.toggle("active", !app.audioMuted);
    if (app.audioMuted) app.audioContext?.suspend().catch(() => {});
    else ensureAudio();
  }

  function action(name) {
    if (name === "jump") {
      const me = app.state?.players.find((player) => player.id === app.playerId);
      if (!me?.alive || !me.grounded || app.state?.phase !== "playing") return;
    }
    send({ type: "action", action: name });
    if (name === "jump") playJump();
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

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[char]);
  }

  function openPanel(title, eyebrow = "حساب کاربری") {
    $("panelTitle").textContent = title;
    $("panelEyebrow").textContent = eyebrow;
    panelBody.innerHTML = '<div class="empty-state">در حال دریافت اطلاعات…</div>';
    panelModal.classList.remove("hidden");
  }

  function closePanel() {
    panelModal.classList.add("hidden");
    panelBody.replaceChildren();
  }

  function userRow(user, actions = "") {
    return `<div class="list-row"><div><b>${escapeHtml(user.username)}</b><small>${escapeHtml(user.rank?.name || "")} · ریتینگ ${fa.format(user.rating || 0)}</small></div><div class="row-actions">${actions}</div></div>`;
  }

  async function showFriends() {
    openPanel("دوستان و درخواست‌ها", "شبکه مبارزان");
    try {
      const social = await api("/api/friends");
      panelBody.innerHTML = `
        <form id="friendSearchForm" class="panel-tools"><input id="friendSearch" class="text-input" maxlength="20" placeholder="نام کاربری را جست‌وجو کن" /><button class="button secondary" type="submit">جست‌وجو</button></form>
        <div id="friendSearchResults" class="panel-list"></div>
        <h3>درخواست‌های دریافتی</h3><div class="panel-list">${social.received.length ? social.received.map((user) => userRow(user, `<button data-friend-accept="${user.requestId}">قبول</button><button class="reject" data-friend-reject="${user.requestId}">رد</button>`)).join("") : '<div class="empty-state">درخواستی نداری</div>'}</div>
        <h3>دوستان</h3><div class="panel-list">${social.friends.length ? social.friends.map((user) => userRow(user, `<button class="reject" data-block-user="${user.id}">مسدود</button>`)).join("") : '<div class="empty-state">هنوز دوستی اضافه نکرده‌ای</div>'}</div>
        <h3>در انتظار پاسخ</h3><div class="panel-list">${social.sent.length ? social.sent.map((user) => userRow(user, '<small>ارسال شده</small>')).join("") : '<div class="empty-state">موردی نیست</div>'}</div>
        <h3>مسدودشده‌ها</h3><div class="panel-list">${social.blocked.length ? social.blocked.map((user) => userRow(user, `<button data-unblock-user="${user.id}">رفع مسدودی</button>`)).join("") : '<div class="empty-state">موردی نیست</div>'}</div>`;
      $("friendSearchForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const q = $("friendSearch").value.trim();
        if (q.length < 2) return;
        const result = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
        $("friendSearchResults").innerHTML = result.users.length
          ? result.users.map((user) => userRow(user, `<button data-add-friend="${escapeHtml(user.username)}">افزودن</button><button class="reject" data-block-user="${user.id}">مسدود</button>`)).join("")
          : '<div class="empty-state">کاربری پیدا نشد</div>';
      });
    } catch (error) { panelBody.innerHTML = `<div class="entry-error">${escapeHtml(error.message)}</div>`; }
  }

  async function showTeam() {
    openPanel("تیم من", "گروه تا ۶ نفر");
    try {
      const data = await api("/api/teams/me");
      if (data.team) {
        const team = data.team;
        panelBody.innerHTML = `<div class="economy-note"><b>${escapeHtml(team.name)}</b><br>اعضا ${fa.format(team.members.length)} از ${fa.format(team.maxMembers)} · تیر، نارنجک و RPG هم‌تیمی‌ها روی یکدیگر اثر ندارد.</div>
          <div class="copy-row"><input id="teamInviteLink" class="text-input" readonly dir="ltr" value="${escapeHtml(data.inviteUrl)}" /><button data-copy-team class="button secondary">کپی دعوت</button></div>
          <h3>اعضای تیم</h3><div class="panel-list">${team.members.map((user) => userRow(user, user.id === team.ownerId ? '<small>فرمانده</small>' : "")).join("")}</div>
          <button data-leave-team class="button danger wide" type="button">خروج از تیم</button>`;
      } else {
        panelBody.innerHTML = `<div class="economy-note">یک تیم بساز یا با کد دعوت به تیم دوستانت ملحق شو. ظرفیت هر تیم دقیقاً ۶ بازیکن است.</div>
          <form id="createTeamForm" class="panel-tools"><input id="teamName" class="text-input" maxlength="24" placeholder="نام تیم" /><button class="button primary" type="submit">ساخت تیم</button></form>
          <div class="divider"><span>یا</span></div>
          <form id="joinTeamForm" class="panel-tools"><input id="teamInviteCode" class="text-input room-input" maxlength="8" placeholder="کد دعوت" /><button class="button secondary" type="submit">عضویت</button></form>`;
        $("createTeamForm").addEventListener("submit", async (event) => { event.preventDefault(); await api("/api/teams", { method:"POST", body:{ name:$("teamName").value } }); await refreshProfile(); showTeam(); });
        $("joinTeamForm").addEventListener("submit", async (event) => { event.preventDefault(); await api("/api/teams/join", { method:"POST", body:{ inviteCode:$("teamInviteCode").value } }); await refreshProfile(); showTeam(); });
      }
    } catch (error) { panelBody.innerHTML = `<div class="entry-error">${escapeHtml(error.message)}</div>`; }
  }

  async function showShop() {
    openPanel("فروشگاه طلا و الماس", "اقتصاد بازی");
    try {
      const [products, orders, economy] = await Promise.all([api("/api/shop/products", {}, false), api("/api/shop/orders"), api("/api/economy/rules", {}, false)]);
      const rule = economy.rules;
      panelBody.innerHTML = `<div class="economy-note">روش دریافت رایگان: حضور در هر راند ${fa.format(rule.participation_gold)} طلا، هر حذف ${fa.format(rule.kill_gold)} طلا و ${fa.format(rule.kill_xp)} XP، برد ${fa.format(rule.winner_gold)} طلا و ${fa.format(rule.winner_diamonds)} الماس. جایزه فقط از نتیجه معتبر سرور پرداخت می‌شود.</div>
        <div class="shop-grid">${products.products.map((item) => `<article class="product-card"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><strong>${fa.format(item.priceIrr)} ریال</strong><small>${item.grantGold ? `${fa.format(item.grantGold)} طلا` : ""} ${item.grantDiamonds ? `${fa.format(item.grantDiamonds)} الماس` : ""}</small><button class="button secondary" data-order-product="${item.id}">ثبت سفارش</button></article>`).join("")}</div>
        <h3>سفارش‌های من</h3><div class="panel-list">${orders.orders.length ? orders.orders.map((item) => `<div class="list-row"><div><b>${escapeHtml(item.title)}</b><small>${fa.format(item.amountIrr)} ریال</small></div><span>${item.status === "paid" ? "تأییدشده" : item.status === "rejected" ? "ردشده" : "در انتظار تأیید"}</span></div>`).join("") : '<div class="empty-state">سفارشی ثبت نشده است</div>'}</div>`;
    } catch (error) { panelBody.innerHTML = `<div class="entry-error">${escapeHtml(error.message)}</div>`; }
  }

  async function showRanking() {
    openPanel("رده‌بندی مبارزان", "امتیاز و افتخارات");
    try {
      const data = await api("/api/leaderboard?limit=50", {}, false);
      panelBody.innerHTML = `<table class="rank-table"><thead><tr><th>#</th><th>بازیکن</th><th>رده</th><th>ریتینگ</th><th>برد</th><th>حذف</th></tr></thead><tbody>${data.players.map((player) => `<tr class="${player.id === app.user?.id ? "me" : ""}"><td>${fa.format(player.position)}</td><td>${escapeHtml(player.username)}</td><td>${escapeHtml(player.rank.name)}</td><td>${fa.format(player.rating)}</td><td>${fa.format(player.wins)}</td><td>${fa.format(player.kills)}</td></tr>`).join("")}</tbody></table>`;
    } catch (error) { panelBody.innerHTML = `<div class="entry-error">${escapeHtml(error.message)}</div>`; }
  }

  function createVoicePeer(peerId) {
    let connection = app.voicePeers.get(peerId);
    if (connection) return connection;
    connection = new RTCPeerConnection({ iceServers: app.iceServers.length ? app.iceServers : [{ urls:"stun:stun.l.google.com:19302" }] });
    connection.pendingCandidates = [];
    for (const track of app.voiceStream?.getTracks() || []) connection.addTrack(track, app.voiceStream);
    connection.onicecandidate = (event) => { if (event.candidate) send({ type:"voice_signal", target:peerId, signal:{ candidate:event.candidate } }); };
    connection.ontrack = (event) => {
      let audio = connection.remoteAudio;
      if (!audio) { audio = document.createElement("audio"); audio.autoplay = true; audio.dataset.voicePeer = peerId; document.body.appendChild(audio); connection.remoteAudio = audio; }
      audio.srcObject = event.streams[0];
    };
    connection.onconnectionstatechange = () => { if (["failed","closed"].includes(connection.connectionState)) removeVoicePeer(peerId); };
    app.voicePeers.set(peerId, connection);
    return connection;
  }

  function removeVoicePeer(peerId) {
    const connection = app.voicePeers.get(peerId);
    connection?.remoteAudio?.remove();
    connection?.close();
    app.voicePeers.delete(peerId);
  }

  async function handleVoicePeers(peers) {
    if (!app.voiceEnabled) return;
    const ids = new Set(peers.map((peer) => peer.id));
    for (const id of app.voicePeers.keys()) if (!ids.has(id)) removeVoicePeer(id);
    for (const peer of peers) {
      const connection = createVoicePeer(peer.id);
      if (app.playerId < peer.id && connection.signalingState === "stable") {
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        send({ type:"voice_signal", target:peer.id, signal:{ description:connection.localDescription } });
      }
    }
  }

  async function handleVoiceSignal(from, signal) {
    if (!app.voiceEnabled || !from || !signal) return;
    const connection = createVoicePeer(from);
    if (signal.description) {
      await connection.setRemoteDescription(signal.description);
      for (const candidate of connection.pendingCandidates.splice(0)) await connection.addIceCandidate(candidate);
      if (signal.description.type === "offer") {
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        send({ type:"voice_signal", target:from, signal:{ description:connection.localDescription } });
      }
    } else if (signal.candidate) {
      if (connection.remoteDescription) await connection.addIceCandidate(signal.candidate);
      else connection.pendingCandidates.push(signal.candidate);
    }
  }

  function updateVoiceUi() {
    const button = $("voiceMenuToggle");
    button.textContent = app.voiceEnabled ? "🎙" : "🔇";
    button.classList.toggle("active", app.voiceEnabled);
    for (const option of document.querySelectorAll("[data-voice-mode]")) {
      option.classList.toggle("active", option.dataset.voiceMode === app.voiceMode);
    }
  }

  async function setVoiceMode(mode) {
    if (mode === "off") {
      closeVoice();
      $("voiceMenu").classList.add("hidden");
      notify("میکروفون قطع شد");
      return;
    }
    if (mode === "team" && !app.teamId) {
      notify("برای گفت‌وگوی تیمی ابتدا عضو تیم شوید");
      return;
    }
    try {
      if (!app.voiceStream) app.voiceStream = await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:true, noiseSuppression:true, autoGainControl:true }, video:false });
      if (app.voiceEnabled && app.voiceMode !== mode) {
        for (const id of [...app.voicePeers.keys()]) removeVoicePeer(id);
      }
      app.voiceEnabled = true;
      app.voiceMode = mode;
      updateVoiceUi();
      send({ type:"voice_join", mode });
      $("voiceMenu").classList.add("hidden");
      notify(mode === "team" ? "فقط اعضای تیم صدایت را می‌شنوند" : "همه افراد اتاق صدایت را می‌شنوند");
    } catch { notify("اجازه میکروفون داده نشد"); }
  }

  function closeVoice() {
    if (app.voiceEnabled) send({ type:"voice_leave" });
    app.voiceEnabled = false;
    app.voiceStream?.getTracks().forEach((track) => track.stop());
    app.voiceStream = null;
    for (const id of [...app.voicePeers.keys()]) removeVoicePeer(id);
    app.voiceMode = "off";
    updateVoiceUi();
  }

  for (const button of document.querySelectorAll("[data-auth-view]")) button.addEventListener("click", () => showAuthView(button.dataset.authView));
  $("showForgot").addEventListener("click", () => showAuthView("forgot"));
  $("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault(); entryError.textContent = "در حال ورود…";
    try { setSession(await api("/api/auth/login", { method:"POST", body:{ email:$("loginEmail").value, password:$("loginPassword").value } }, false)); }
    catch (error) { entryError.textContent = error.message; }
  });
  $("registerForm").addEventListener("submit", async (event) => {
    event.preventDefault(); entryError.textContent = "در حال ساخت حساب…";
    try {
      setSession(await api("/api/auth/register", { method:"POST", body:{ email:$("registerEmail").value, username:$("registerUsername").value, password:$("registerPassword").value, referralCode:$("referralCode").value } }, false));
      notify("حساب ساخته شد؛ ۲۵۰ طلا هدیه گرفتی");
    } catch (error) { entryError.textContent = error.message; }
  });
  $("forgotForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = await api("/api/auth/forgot", { method:"POST", body:{ email:$("forgotEmail").value } }, false);
      entryError.textContent = data.delivery === "not_configured" ? "ایمیل سرور هنوز تنظیم نشده؛ با مدیر تماس بگیرید." : data.message;
      if (data.debugResetUrl) entryError.textContent += ` ${data.debugResetUrl}`;
    } catch (error) { entryError.textContent = error.message; }
  });
  $("resetForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try { await api("/api/auth/reset", { method:"POST", body:{ token:resetToken, password:$("resetPassword").value } }, false); history.replaceState(null,"",location.pathname); showAuthView("login"); entryError.textContent = "رمز تغییر کرد؛ حالا وارد شوید."; }
    catch (error) { entryError.textContent = error.message; }
  });
  $("logoutButton").addEventListener("click", async () => { try { await api("/api/auth/logout", { method:"POST" }); } catch {} clearSession(true); });
  $("copyPersonalInvite").addEventListener("click", () => copyText(app.inviteUrl, "لینک شخصی دعوت کپی شد"));
  for (const button of document.querySelectorAll("[data-panel]")) button.addEventListener("click", () => ({ friends:showFriends, team:showTeam, shop:showShop, ranking:showRanking })[button.dataset.panel]?.());
  $("closePanel").addEventListener("click", closePanel); $("panelBackdrop").addEventListener("click", closePanel);
  panelBody.addEventListener("click", async (event) => {
    const button = event.target.closest("button"); if (!button) return;
    try {
      if (button.dataset.addFriend) { await api("/api/friends/requests", { method:"POST", body:{ username:button.dataset.addFriend } }); notify("درخواست دوستی ارسال شد"); showFriends(); }
      else if (button.dataset.friendAccept) { await api(`/api/friends/requests/${button.dataset.friendAccept}/accept`, { method:"POST" }); showFriends(); }
      else if (button.dataset.friendReject) { await api(`/api/friends/requests/${button.dataset.friendReject}/reject`, { method:"POST" }); showFriends(); }
      else if (button.dataset.blockUser) { await api(`/api/users/${button.dataset.blockUser}/block`, { method:"POST" }); showFriends(); }
      else if (button.dataset.unblockUser) { await api(`/api/users/${button.dataset.unblockUser}/block`, { method:"DELETE" }); showFriends(); }
      else if (button.hasAttribute("data-copy-team")) copyText($("teamInviteLink").value, "لینک تیم کپی شد");
      else if (button.hasAttribute("data-leave-team")) { await api("/api/teams/leave", { method:"POST" }); await refreshProfile(); showTeam(); }
      else if (button.dataset.orderProduct) { const data = await api("/api/shop/orders", { method:"POST", body:{ productId:Number(button.dataset.orderProduct) } }); notify(data.message); showShop(); }
    } catch (error) { notify(error.message); }
  });

  $("createRoom").addEventListener("click", createRoom);
  $("joinRoom").addEventListener("click", joinRoom);
  roomCode.addEventListener("input", () => { roomCode.value = roomCode.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 4); });
  roomCode.addEventListener("keydown", (event) => { if (event.key === "Enter") joinRoom(); });
  startRound.addEventListener("click", () => send({ type: "start" }));
  $("resetRoundMenu").addEventListener("click", () => {
    $("gameMenu").classList.add("hidden");
    if (confirm("مسابقه فعلی از اول شروع شود؟")) send({ type:"reset" });
  });
  $("addBot").addEventListener("click", () => send({ type: "add_bot" }));
  $("removeBot").addEventListener("click", () => send({ type: "remove_bot" }));
  mapSelect.addEventListener("change", () => send({ type: "select_map", map: mapSelect.value }));
  botDifficulty.addEventListener("change", () => send({ type: "set_bot_difficulty", difficulty: botDifficulty.value }));
  weaponChooser.addEventListener("click", (event) => {
    const button = event.target.closest("[data-weapon]");
    if (button) send({ type: "choose_weapon", weapon: button.dataset.weapon });
  });
  jumpButton.addEventListener("pointerdown", () => action("jump"));
  grenadeButton.addEventListener("pointerdown", () => action("grenade"));
  rpgButton.addEventListener("pointerdown", () => action("rpg"));
  $("voiceMenuToggle").addEventListener("click", (event) => {
    event.stopPropagation();
    $("gameMenu").classList.add("hidden");
    $("voiceMenu").classList.toggle("hidden");
  });
  $("gameMenuToggle").addEventListener("click", (event) => {
    event.stopPropagation();
    $("voiceMenu").classList.add("hidden");
    $("gameMenu").classList.toggle("hidden");
  });
  $("voiceMenu").addEventListener("click", (event) => {
    const option = event.target.closest("[data-voice-mode]");
    if (option && !option.disabled) setVoiceMode(option.dataset.voiceMode);
  });
  $("leaveRoom").addEventListener("click", async () => { try { await api(`/api/rooms/${app.room}/leave`, { method:"POST" }); } catch {} app.socket?.close(1000); });
  $("soundToggle").addEventListener("click", toggleSound);
  $("soundToggle").textContent = app.audioMuted ? "🔇" : "🔊";
  $("soundToggle").classList.toggle("active", !app.audioMuted);
  updateVoiceUi();
  $("scoreToggle").addEventListener("click", () => {
    $("gameMenu").classList.add("hidden");
    $("voiceMenu").classList.add("hidden");
    scoreboard.classList.toggle("open");
  });
  $("closeScore").addEventListener("click", () => scoreboard.classList.remove("open"));
  document.addEventListener("click", (event) => {
    if (!event.target.closest?.("#gameMenu,#gameMenuToggle")) $("gameMenu").classList.add("hidden");
    if (!event.target.closest?.("#voiceMenu,#voiceMenuToggle")) $("voiceMenu").classList.add("hidden");
  });

  bootstrap();

  window.addEventListener("keydown", (event) => {
    if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) event.preventDefault();
    app.keys.add(event.key.toLowerCase());
    if (event.repeat) return;
    if (event.key === " ") action("jump");
    if (event.key.toLowerCase() === "e") action("shield");
    if (event.key.toLowerCase() === "shift") action("dash");
    if (event.key.toLowerCase() === "g") action("grenade");
    if (event.key.toLowerCase() === "r") action("rpg");
  });
  window.addEventListener("keyup", (event) => {
    app.keys.delete(event.key.toLowerCase());
  });

  function releaseInput() {
    clearTimeout(fireStopTimer);
    app.padMove = [0, 0];
    app.move = [0, 0];
    app.shooting = false;
    fireButton.classList.remove("active");
    app.keys.clear();
    app.inputSeq += 1;
    send({ type: "input", seq: app.inputSeq, move: [0, 0], aim: app.aim, pitch: app.cameraPitch, shooting: false });
  }
  window.addEventListener("blur", releaseInput);
  document.addEventListener("visibilitychange", () => { if (document.hidden) releaseInput(); });

  function sampleAndSendInput() {
    const x = (app.keys.has("d") || app.keys.has("arrowright") ? 1 : 0) - (app.keys.has("a") || app.keys.has("arrowleft") ? 1 : 0);
    const y = (app.keys.has("s") || app.keys.has("arrowdown") ? 1 : 0) - (app.keys.has("w") || app.keys.has("arrowup") ? 1 : 0);
    app.aim = resolvedAim();
    const local = x || y ? [x, y] : [...app.padMove];
    const localLength = Math.hypot(local[0], local[1]);
    if (localLength > 1) {
      local[0] /= localLength;
      local[1] /= localLength;
    }
    const heading = app.cameraAngle;
    const forward = -local[1];
    const strafe = local[0];
    app.move = [Math.cos(heading) * forward - Math.sin(heading) * strafe, Math.sin(heading) * forward + Math.cos(heading) * strafe];
    app.inputSeq += 1;
    send({ type: "input", seq: app.inputSeq, move: app.move, aim: app.aim, pitch: app.cameraPitch, shooting: app.shooting });
  }
  setInterval(sampleAndSendInput, 20);

  function toFaDigits(value) {
    return String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[digit]);
  }

  function fit() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    canvas.style.width = `${innerWidth}px`;
    canvas.style.height = `${innerHeight}px`;
    fitMinimap();
  }

  function fitMinimap() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const mapRect = minimap.getBoundingClientRect();
    const width = Math.max(1, Math.round(mapRect.width * dpr));
    const height = Math.max(1, Math.round(mapRect.height * dpr));
    if (minimap.width !== width) minimap.width = width;
    if (minimap.height !== height) minimap.height = height;
  }
  addEventListener("resize", fit);
  if ("ResizeObserver" in window) new ResizeObserver(fitMinimap).observe(minimap);
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
    app.weaponRecoil *= Math.exp(-19 * dt);
    if (renderer3D) {
      predictShot(now);
      updatePredictedBullets(dt, now);
      const activeIds = new Set();
      const players = app.state.players.map((player) => { activeIds.add(player.id); return smoothPlayer(player, dt); });
      for (const id of app.renderPlayers.keys()) if (!activeIds.has(id)) app.renderPlayers.delete(id);
      const me = players.find((player) => player.id === app.playerId);
      if (me) renderer3D.render({
        arena: app.arena, me, players, powerups: app.state.powerups || [],
        projectiles: app.state.projectiles || [], explosions: app.state.explosions || [],
        traces: [...app.state.bullets, ...app.localBullets], angle: app.cameraAngle,
        pitch: app.cameraPitch, now, dt, shooting: app.shooting, move: app.move,
        muzzle: now < app.muzzleUntil, recoil: app.weaponRecoil
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
    for (const data of app.state.projectiles || []) objects.push({ type: "projectile", x: data.x, y: data.y, data });
    for (const data of app.state.explosions || []) objects.push({ type: "explosion", x: data.x, y: data.y, data });
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
      else if (object.type === "projectile") drawPerspectiveProjectile(object, horizon);
      else if (object.type === "explosion") drawPerspectiveExplosion(object, horizon);
      else drawPerspectiveBullet(object, horizon);
    });
    drawWeaponView(camera.me, now, app.moveVisual, bob);
  }

  function wallAt(x, y, rayHeight = 0) {
    if (x <= 2 || y <= 2 || x >= app.arena.width - 2 || y >= app.arena.height - 2) return -1;
    return app.arena.obstacles.findIndex((rect) =>
      (Number(rect.height) || 100) >= rayHeight &&
      x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
    );
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
        const index = wallAt(hitX, hitY, (camera.me.z || 0) + 62);
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

  function drawPerspectiveProjectile(object, horizon) {
    const size = Math.max(7, Math.min(32, 12 * object.view.scale));
    const color = object.data.kind === "rpg" ? "#ff613f" : "#ffc14f";
    const y = groundY(object.view, horizon) - ((object.data.z || 12) + 20) * object.view.scale;
    ctx.save(); ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 24; ctx.beginPath(); ctx.arc(object.view.x, y, size, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }

  function drawPerspectiveExplosion(object, horizon) {
    const progress = Math.max(.08, Math.min(1, (object.data.remaining || .1) / .38));
    const radius = Math.max(18, Math.min(canvas.width * .42, object.data.radius * object.view.scale * (1.15 - progress * .3)));
    const y = groundY(object.view, horizon) - (object.data.z || 0) * object.view.scale;
    const color = object.data.kind === "rpg" ? "#ff5438" : "#ffb62e";
    ctx.save(); ctx.globalAlpha = progress * .75; ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 45; ctx.beginPath(); ctx.arc(object.view.x, y, radius, 0, Math.PI * 2); ctx.fill(); ctx.restore();
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
    if (width <= 2 || height <= 2) return;
    const sx = (width - pad * 2) / app.arena.width, sy = (height - pad * 2) / app.arena.height;
    const accent = app.arena.theme?.accent || "#20d9ff";
    mapCtx.clearRect(0, 0, width, height);
    mapCtx.fillStyle = "rgba(2,8,18,.96)";
    mapCtx.fillRect(0, 0, width, height);
    mapCtx.strokeStyle = "rgba(88,205,238,.11)";
    mapCtx.lineWidth = Math.max(1, dpr * .6);
    for (let column = 1; column < 6; column++) {
      const x = pad + (width - pad * 2) * column / 6;
      mapCtx.beginPath(); mapCtx.moveTo(x, pad); mapCtx.lineTo(x, height - pad); mapCtx.stroke();
    }
    for (let row = 1; row < 4; row++) {
      const y = pad + (height - pad * 2) * row / 4;
      mapCtx.beginPath(); mapCtx.moveTo(pad, y); mapCtx.lineTo(width - pad, y); mapCtx.stroke();
    }
    mapCtx.strokeStyle = `${accent}88`;
    mapCtx.lineWidth = dpr;
    for (const rect of app.arena.obstacles) {
      mapCtx.fillStyle = Number(rect.height) <= 65 ? "#28536a" : "#142d45";
      mapCtx.fillRect(pad + rect.x * sx, pad + rect.y * sy, Math.max(1, rect.w * sx), Math.max(1, rect.h * sy));
      mapCtx.strokeRect(pad + rect.x * sx, pad + rect.y * sy, Math.max(1, rect.w * sx), Math.max(1, rect.h * sy));
    }
    for (const player of app.state.players) {
      if (!player.alive || (player.radarHidden && player.id !== app.playerId)) continue;
      const x = pad + player.x * sx, y = pad + player.y * sy;
      mapCtx.fillStyle = player.id === app.playerId ? "#fff" : player.color; mapCtx.shadowColor = player.color; mapCtx.shadowBlur = 5 * dpr; mapCtx.beginPath(); mapCtx.arc(x, y, (player.id === app.playerId ? 4.5 : 3.4) * dpr, 0, Math.PI * 2); mapCtx.fill();
      if (player.id === app.playerId) { const angle = app.cameraAngle; mapCtx.strokeStyle = player.color; mapCtx.beginPath(); mapCtx.moveTo(x, y); mapCtx.lineTo(x + Math.cos(angle) * 13 * dpr, y + Math.sin(angle) * 13 * dpr); mapCtx.stroke(); }
    }
    mapCtx.shadowBlur = 0; mapCtx.strokeStyle = accent; mapCtx.lineWidth = dpr; mapCtx.strokeRect(.5 * dpr, .5 * dpr, width - dpr, height - dpr);
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
    if (!rendered || Math.hypot(rendered.x - player.x, rendered.y - player.y) > 120) {
      rendered = { x: player.x, y: player.y, z: player.z || 0 };
      app.renderPlayers.set(player.id, rendered);
    }

    if (player.id === app.playerId && player.alive && app.state.phase === "playing") {
      let speed = 285 * (player.speedBoost ? 1.55 : 1) * (player.dashing ? 2.55 : 1);
      const nextX = Math.max(21, Math.min(app.arena.width - 21, rendered.x + app.move[0] * speed * dt));
      if (isClearLocal(nextX, rendered.y, rendered.z)) rendered.x = nextX;
      const nextY = Math.max(21, Math.min(app.arena.height - 21, rendered.y + app.move[1] * speed * dt));
      if (isClearLocal(rendered.x, nextY, rendered.z)) rendered.y = nextY;
      const error = Math.hypot(player.x - rendered.x, player.y - rendered.y);
      if (error > 160) {
        rendered.x = player.x;
        rendered.y = player.y;
      } else if (error > 4) {
        const moving = Math.hypot(app.move[0], app.move[1]) > .05;
        const correction = 1 - Math.exp(-(moving ? 4.2 : 14) * dt);
        rendered.x += (player.x - rendered.x) * correction;
        rendered.y += (player.y - rendered.y) * correction;
      }
    } else {
      const interpolation = 1 - Math.exp(-23 * dt);
      rendered.x += (player.x - rendered.x) * interpolation;
      rendered.y += (player.y - rendered.y) * interpolation;
    }
    const verticalInterpolation = 1 - Math.exp(-24 * dt);
    rendered.z += ((player.z || 0) - rendered.z) * verticalInterpolation;
    return { ...player, x: rendered.x, y: rendered.y, z: rendered.z };
  }

  function isClearLocal(x, y, z = 0) {
    return !app.arena.obstacles.some((rect) => {
      if ((Number(rect.height) || 100) <= z + 7) return false;
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
    ctx.strokeStyle = bullet.hit ? "#fff29a" : bullet.color;
    ctx.fillStyle = "#fff";
    ctx.shadowColor = bullet.hit ? "#fff29a" : bullet.color;
    ctx.shadowBlur = 18;
    ctx.lineWidth = Math.max(4, bullet.radius || 5);
    ctx.beginPath();
    if (Number.isFinite(bullet.x1) && Number.isFinite(bullet.x2)) {
      ctx.moveTo(bullet.x1, bullet.y1);
      ctx.lineTo(bullet.x2, bullet.y2);
    } else {
      const speed = Math.hypot(bullet.vx, bullet.vy) || 1;
      ctx.moveTo(bullet.x - bullet.vx / speed * 25, bullet.y - bullet.vy / speed * 25);
      ctx.lineTo(bullet.x, bullet.y);
    }
    ctx.stroke();
    const endX = bullet.x2 ?? bullet.x;
    const endY = bullet.y2 ?? bullet.y;
    ctx.beginPath(); ctx.arc(endX, endY, bullet.hit ? 8 : (bullet.radius || 5), 0, Math.PI * 2); ctx.fill();
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
