/*
 * Neon Arena renderer v5
 *
 * The server remains authoritative.  This module only turns the existing
 * snapshots into a richer first-person scene.  Every runtime dependency and
 * asset is bundled into the web build and Android APK.
 */
import "./renderer3d-legacy.js";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";

const legacyRenderer = window.NeonRenderer3D;
const PI = Math.PI;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const MODEL_FORWARD = new THREE.Vector3(1, 0, 0);
const assetRoot = window.__NEON_ASSET_ROOT__ || (location.protocol === "file:" ? "assets/" : "/static/assets/");

const QUALITY = {
  low: {
    ratio: 0.9,
    maxRatio: 1.05,
    shadows: false,
    shadowSize: 0,
    distance: 2750,
    trees: 16,
    particles: 0.55,
    anisotropy: 2,
  },
  medium: {
    ratio: 1.08,
    maxRatio: 1.32,
    shadows: true,
    shadowSize: 1024,
    distance: 3900,
    trees: 28,
    particles: 0.78,
    anisotropy: 4,
  },
  high: {
    ratio: 1.3,
    maxRatio: 1.72,
    shadows: true,
    shadowSize: 2048,
    distance: 5350,
    trees: 46,
    particles: 1,
    anisotropy: 8,
  },
};

const MODEL_FILES = {
  soldier: "soldier.gltf",
  base: "ak.gltf",
  sniper: "ak.gltf",
  rapid: "smg.gltf",
  spread: "shotgun.gltf",
  heavy: "short_cannon.gltf",
  grenade: "grenade.gltf",
  rpg: "rocket_launcher.gltf",
  crate: "crate.gltf",
  barrel: "barrel.gltf",
  barrier: "sandbags.gltf",
  container: "container.gltf",
  brokenCar: "broken_car.gltf",
  streetLight: "street_light.gltf",
  tree1: "tree_1.gltf",
  tree2: "tree_2.gltf",
  tires: "tires.gltf",
  pallet: "pallet.gltf",
};

const WEAPON_NODES = [
  "AK",
  "GrenadeLauncher",
  "Knife_1",
  "Knife_2",
  "Pistol",
  "Revolver",
  "Revolver_Small",
  "RocketLauncher",
  "ShortCannon",
  "Shotgun",
  "Shovel",
  "SMG",
  "Sniper",
  "Sniper_2",
];

const WEAPON_NODE = {
  base: "AK",
  sniper: "Sniper",
  rpg: "RocketLauncher",
  rapid: "SMG",
  spread: "Shotgun",
  heavy: "ShortCannon",
};

const POWER_COLORS = {
  ammo: 0xffcc44,
  sniper: 0x80eaff,
  rapid: 0xaaff44,
  heavy: 0xffaa44,
  spread: 0xff66aa,
  speed: 0xffc83d,
  health: 0xff405f,
  shield: 0x29d8ff,
  weapon: 0xff35aa,
  stealth: 0x9d6bff,
  grenade: 0xffa53a,
  rpg: 0xff5e42,
};

function supportsWebGL2() {
  try {
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
}

function isMobileDevice() {
  return matchMedia("(pointer: coarse)").matches || innerWidth < 900;
}

function selectedQuality() {
  const saved = localStorage.getItem("neon-quality");
  if (saved && QUALITY[saved]) return saved;
  const memory = Number(navigator.deviceMemory || 4);
  const cores = Number(navigator.hardwareConcurrency || 4);
  if (isMobileDevice() && (memory <= 3 || cores <= 4)) return "low";
  if (isMobileDevice() || memory <= 6 || cores <= 6) return "medium";
  return "high";
}

function color(value, fallback) {
  try {
    return new THREE.Color(value || fallback);
  } catch {
    return new THREE.Color(fallback);
  }
}

function seeded(index, salt) {
  const value = Math.sin((index + 1) * 127.1 + salt * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function disposeObject(root) {
  root.traverse((object) => {
    if (!object.isMesh && !object.isLine && !object.isPoints && !object.isSprite) return;
    if (!object.userData.sharedGeometry) object.geometry?.dispose?.();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material?.map?.isCanvasTexture) material.map.dispose();
      material?.dispose?.();
    }
  });
}

function xhrText(url) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", url, true);
    request.onload = () => {
      if (request.status === 0 || (request.status >= 200 && request.status < 300)) resolve(request.responseText);
      else reject(new Error("asset HTTP " + request.status));
    };
    request.onerror = () => reject(new Error("asset request failed"));
    request.send();
  });
}

async function loadGltf(loader, filename) {
  const url = assetRoot + "models/" + filename;
  let source;
  try {
    const response = await fetch(url);
    if (!response.ok && response.status !== 0) throw new Error("asset HTTP " + response.status);
    source = await response.text();
  } catch {
    source = await xhrText(url);
  }
  return new Promise((resolve, reject) => {
    loader.parse(source, assetRoot + "models/", resolve, reject);
  });
}

function configureRenderable(root, shadows, tint) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.userData.sharedGeometry = true;
    object.castShadow = shadows;
    object.receiveShadow = true;
    if (object.material) {
      object.material = object.material.clone();
      object.material.roughness = Math.max(0.42, Number(object.material.roughness ?? 0.7));
      object.material.metalness = Math.min(0.5, Number(object.material.metalness ?? 0));
      if (tint && "emissive" in object.material) {
        object.material.emissive = tint.clone().multiplyScalar(0.055);
        object.material.emissiveIntensity = 0.7;
      }
    }
  });
}

function fitModel(template, width, height, depth, shadows) {
  const model = template.scene ? template.scene.clone(true) : template.clone(true);
  configureRenderable(model, shadows);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const sx = width / Math.max(0.01, size.x);
  const sy = height / Math.max(0.01, size.y);
  const sz = depth / Math.max(0.01, size.z);
  model.scale.set(sx, sy, sz);
  model.position.set(
    -(bounds.min.x + size.x * 0.5) * sx,
    -bounds.min.y * sy,
    -(bounds.min.z + size.z * 0.5) * sz
  );
  const root = new THREE.Group();
  root.add(model);
  return root;
}

function fitModelUniform(template, targetSize, shadows) {
  const model = template.scene ? template.scene.clone(true) : template.clone(true);
  configureRenderable(model, shadows);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = targetSize / Math.max(0.01, size.x, size.y, size.z);
  model.scale.setScalar(scale);
  model.position.set(
    -(bounds.min.x + size.x * 0.5) * scale,
    -bounds.min.y * scale,
    -(bounds.min.z + size.z * 0.5) * scale
  );
  const root = new THREE.Group();
  root.add(model);
  return root;
}

function fitModelFootprint(template, width, height, depth, rotate, shadows) {
  const model = template.scene ? template.scene.clone(true) : template.clone(true);
  configureRenderable(model, shadows);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const footprintX = rotate ? size.z : size.x;
  const footprintZ = rotate ? size.x : size.z;
  const scale = Math.min(
    width / Math.max(0.01, footprintX),
    height / Math.max(0.01, size.y),
    depth / Math.max(0.01, footprintZ)
  );
  model.scale.setScalar(scale);
  model.position.set(
    -(bounds.min.x + size.x * 0.5) * scale,
    -bounds.min.y * scale,
    -(bounds.min.z + size.z * 0.5) * scale
  );
  const root = new THREE.Group();
  root.add(model);
  root.rotation.y = rotate ? PI / 2 : 0;
  return root;
}

function makeCanvasLabel(name, playerColor) {
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 384;
  labelCanvas.height = 80;
  const context = labelCanvas.getContext("2d");
  context.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
  context.fillStyle = "rgba(4,12,18,.78)";
  context.fillRect(12, 8, 360, 58);
  context.strokeStyle = playerColor || "#33dfff";
  context.lineWidth = 4;
  context.strokeRect(12, 8, 360, 58);
  context.font = "600 29px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#f4fbff";
  context.fillText(String(name || "Player").slice(0, 24), 192, 37);
  const texture = new THREE.CanvasTexture(labelCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(92, 19, 1);
  sprite.position.y = 91;
  return sprite;
}

class NeonRendererNext {
  constructor(canvas) {
    this.canvas = canvas;
    this.mobile = isMobileDevice();
    this.qualityName = selectedQuality();
    this.quality = QUALITY[this.qualityName];
    this.pixelScale = this.quality.ratio;
    this.models = new Map();
    this.modelRevision = 0;
    this.worldKey = "";
    this.frameCounter = 0;
    this.fpsStartedAt = performance.now();
    this.bobTime = 0;
    this.lastMuzzle = false;
    this.weaponKind = "";
    this.actorMap = new Map();
    this.powerupMap = new Map();
    this.projectileMap = new Map();
    this.explosionMap = new Map();
    this.textureCache = new Map();
    this.textureLoader = new THREE.TextureLoader();
    this.gltfLoader = new GLTFLoader();

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.qualityName !== "low",
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.qualityName === "high" ? 1.12 : 1.04;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x789bb4, 1);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x728695, this.quality.distance * 0.5, this.quality.distance);
    this.camera = new THREE.PerspectiveCamera(70, 1, 1.2, this.quality.distance + 1400);
    this.camera.rotation.order = "YXZ";

    this.staticRoot = new THREE.Group();
    this.actorRoot = new THREE.Group();
    this.powerupRoot = new THREE.Group();
    this.projectileRoot = new THREE.Group();
    this.explosionRoot = new THREE.Group();
    this.scene.add(this.staticRoot, this.actorRoot, this.powerupRoot, this.projectileRoot, this.explosionRoot);

    this.createLighting();
    this.createSky();
    this.createTraces();
    this.createWeaponScene();
    this.preloadAssets();
    canvas.dataset.renderer = "three-v5";
    canvas.dataset.quality = this.qualityName;
  }

  createLighting() {
    this.hemi = new THREE.HemisphereLight(0xcfeaff, 0x394031, 1.45);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffefd1, 3.2);
    this.sun.position.set(-620, 1100, -480);
    this.sun.castShadow = this.quality.shadows;
    if (this.quality.shadows) {
      this.sun.shadow.mapSize.set(this.quality.shadowSize, this.quality.shadowSize);
      const shadow = this.sun.shadow.camera;
      shadow.near = 100;
      shadow.far = 2500;
      shadow.left = -850;
      shadow.right = 850;
      shadow.top = 850;
      shadow.bottom = -850;
      this.sun.shadow.bias = -0.0003;
      this.sun.shadow.normalBias = 1.5;
    }
    this.sunTarget = new THREE.Object3D();
    this.scene.add(this.sun, this.sunTarget);
    this.sun.target = this.sunTarget;
  }

  createSky() {
    const geometry = new THREE.SphereGeometry(1, 32, 20);
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x3279b7) },
        horizonColor: { value: new THREE.Color(0xc5d7df) },
        lowerColor: { value: new THREE.Color(0x7c8a84) },
        sunColor: { value: new THREE.Color(0xfff3cf) },
        sunDirection: { value: new THREE.Vector3(-0.45, 0.72, -0.35).normalize() },
      },
      vertexShader: [
        "varying vec3 vDirection;",
        "void main(){",
        "  vDirection = normalize(position);",
        "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
        "}",
      ].join("\n"),
      fragmentShader: [
        "precision highp float;",
        "varying vec3 vDirection;",
        "uniform vec3 topColor;",
        "uniform vec3 horizonColor;",
        "uniform vec3 lowerColor;",
        "uniform vec3 sunColor;",
        "uniform vec3 sunDirection;",
        "void main(){",
        "  float h = smoothstep(-0.12, 0.68, vDirection.y);",
        "  vec3 sky = mix(lowerColor, mix(horizonColor, topColor, h), smoothstep(-0.35, 0.1, vDirection.y));",
        "  float sun = pow(max(dot(vDirection, sunDirection), 0.0), 420.0);",
        "  float haze = pow(max(1.0 - abs(vDirection.y), 0.0), 7.0) * 0.18;",
        "  gl_FragColor = vec4(sky + sunColor * sun * 2.4 + haze, 1.0);",
        "}",
      ].join("\n"),
    });
    this.sky = new THREE.Mesh(geometry, material);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.scene.add(this.sky);
  }

  createTraces() {
    const maximum = 192;
    const positions = new Float32Array(maximum * 2 * 3);
    const colors = new Float32Array(maximum * 2 * 3);
    this.traceGeometry = new THREE.BufferGeometry();
    this.traceGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.traceGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.traceGeometry.setDrawRange(0, 0);
    this.traceLines = new THREE.LineSegments(
      this.traceGeometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.traceLines.frustumCulled = false;
    this.scene.add(this.traceLines);

    const impactGeometry = new THREE.BufferGeometry();
    impactGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(maximum * 3), 3).setUsage(THREE.DynamicDrawUsage));
    impactGeometry.setDrawRange(0, 0);
    this.impactPoints = new THREE.Points(
      impactGeometry,
      new THREE.PointsMaterial({
        color: 0xffe298,
        size: 10,
        transparent: true,
        opacity: 0.92,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      })
    );
    this.impactPoints.frustumCulled = false;
    this.scene.add(this.impactPoints);
  }

  createWeaponScene() {
    this.weaponScene = new THREE.Scene();
    this.weaponCamera = new THREE.PerspectiveCamera(68, 1, 0.35, 420);
    this.weaponScene.add(new THREE.HemisphereLight(0xe9f5ff, 0x2a3027, 2.3));
    const key = new THREE.DirectionalLight(0xffdfba, 4.1);
    key.position.set(-2, 4, 3);
    this.weaponScene.add(key);
    this.weaponRig = new THREE.Group();
    this.weaponScene.add(this.weaponRig);
    this.weaponHolder = new THREE.Group();
    this.weaponRig.add(this.weaponHolder);
    this.buildFallbackWeapon();
    this.muzzleFlash = new THREE.Mesh(
      new THREE.ConeGeometry(7, 25, 7),
      new THREE.MeshBasicMaterial({
        color: 0xffba52,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      })
    );
    this.muzzleFlash.rotation.x = -PI / 2;
    this.muzzleFlash.position.set(20, -13, -100);
    this.muzzleFlash.visible = false;
    this.muzzleFlash.renderOrder = 1002;
    this.weaponScene.add(this.muzzleFlash);
    this.muzzleLight = new THREE.PointLight(0xffa93f, 0, 150, 2);
    this.muzzleLight.position.copy(this.muzzleFlash.position);
    this.weaponScene.add(this.muzzleLight);
  }

  buildFallbackWeapon() {
    this.weaponHolder.clear();
    const dark = new THREE.MeshStandardMaterial({ color: 0x252b2d, roughness: 0.32, metalness: 0.72 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x4b5455, roughness: 0.25, metalness: 0.8 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x2ae3f0, emissive: 0x0a6670, emissiveIntensity: 1.8, roughness: 0.28, metalness: 0.58 });
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(38, 15, 54), dark);
    receiver.position.set(18, -16, -56);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.5, 50, 10), metal);
    barrel.rotation.x = PI / 2;
    barrel.position.set(18, -13, -100);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(18, 5, 58), accent);
    rail.position.set(18, -5, -58);
    const magazine = new THREE.Mesh(new THREE.BoxGeometry(12, 28, 18), dark);
    magazine.position.set(17, -35, -52);
    magazine.rotation.x = -0.2;
    this.weaponHolder.add(receiver, barrel, rail, magazine);
    this.addArms();
  }

  addArms() {
    const sleeveMaterial = new THREE.MeshStandardMaterial({ color: 0x34424a, roughness: 0.9 });
    const gloveMaterial = new THREE.MeshStandardMaterial({ color: 0x171d20, roughness: 0.76 });
    const armGeometry = new THREE.CapsuleGeometry(6, 33, 5, 9);
    const leftArm = new THREE.Mesh(armGeometry, sleeveMaterial);
    leftArm.position.set(-13, -36, -37);
    leftArm.rotation.set(-0.92, 0, -0.44);
    const rightArm = new THREE.Mesh(armGeometry, sleeveMaterial.clone());
    rightArm.position.set(40, -35, -35);
    rightArm.rotation.set(-1.02, 0, 0.55);
    const leftGlove = new THREE.Mesh(new THREE.SphereGeometry(7, 12, 8), gloveMaterial);
    leftGlove.position.set(1, -22, -66);
    const rightGlove = new THREE.Mesh(new THREE.SphereGeometry(7, 12, 8), gloveMaterial.clone());
    rightGlove.position.set(29, -22, -48);
    for (const part of [leftArm, rightArm, leftGlove, rightGlove]) {
      part.renderOrder = 1000;
      part.material.depthTest = true;
      part.material.depthWrite = true;
    }
    this.weaponHolder.add(leftArm, rightArm, leftGlove, rightGlove);
  }

  async preloadAssets() {
    const entries = Object.entries(MODEL_FILES);
    const loaded = await Promise.allSettled(entries.map(async ([key, filename]) => {
      const gltf = await loadGltf(this.gltfLoader, filename);
      this.models.set(key, gltf);
    }));
    const failures = loaded.filter((item) => item.status === "rejected");
    if (failures.length) console.warn("Some local 3D assets could not be loaded", failures);
    this.modelRevision += 1;
    this.worldKey = "";
    this.actorMap.forEach((actor) => {
      this.actorRoot.remove(actor.root);
      disposeObject(actor.root);
    });
    this.actorMap.clear();
    this.weaponKind = "";
  }

  texture(name, channel, repeatX, repeatY) {
    const key = name + ":" + channel + ":" + repeatX + ":" + repeatY;
    if (this.textureCache.has(key)) return this.textureCache.get(key);
    const texture = this.textureLoader.load(
      assetRoot + "textures/" + name + "_" + channel + ".webp",
      undefined,
      undefined,
      () => console.warn("Texture unavailable: " + name + " " + channel)
    );
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.anisotropy = Math.min(this.quality.anisotropy, this.renderer.capabilities.getMaxAnisotropy());
    if (channel === "color") texture.colorSpace = THREE.SRGBColorSpace;
    this.textureCache.set(key, texture);
    return texture;
  }

  pbr(name, tint, repeatX, repeatY, options) {
    const settings = options || {};
    return new THREE.MeshStandardMaterial({
      color: color(tint, "#ffffff"),
      map: this.texture(name, "color", repeatX, repeatY),
      normalMap: this.texture(name, "normal", repeatX, repeatY),
      normalScale: new THREE.Vector2(settings.normalScale || 0.72, settings.normalScale || 0.72),
      roughnessMap: this.texture(name, "roughness", repeatX, repeatY),
      roughness: settings.roughness ?? 0.92,
      metalness: settings.metalness ?? 0,
    });
  }

  clearWorld() {
    this.scene.remove(this.staticRoot);
    disposeObject(this.staticRoot);
    this.staticRoot = new THREE.Group();
    this.scene.add(this.staticRoot);
  }

  rebuildWorld(arena) {
    this.clearWorld();
    const theme = arena.theme || {};
    const wallKind = String(theme.wallMaterial || "concrete");
    const groundTexture = arena.id === "night_market" || arena.id === "skyline" ? "asphalt"
      : arena.id === "brickworks" || arena.id === "reactor" ? "concrete"
      : arena.id === "citadel" ? "ground"
      : "grass";
    const worldWidth = Number(arena.width) || 10800;
    const worldHeight = Number(arena.height) || 6300;
    const groundMaterial = this.pbr(groundTexture, "#b5b7b2", worldWidth / 145, worldHeight / 145, { normalScale: 0.65 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(worldWidth, worldHeight), groundMaterial);
    ground.rotation.x = -PI / 2;
    ground.position.set(worldWidth / 2, -1.5, worldHeight / 2);
    ground.receiveShadow = true;
    this.staticRoot.add(ground);
    if (arena.id === "citadel") this.addGrassPatches(arena);

    const asphalt = this.pbr("asphalt", "#a1a4a4", 1, 1, { normalScale: 0.58 });
    const roadWidth = 132;
    const sectorWidth = Number(arena.sectorWidth) || 3600;
    const sectorHeight = Number(arena.sectorHeight) || 2100;
    for (let x = sectorWidth; x < worldWidth; x += sectorWidth) {
      const road = new THREE.Mesh(new THREE.BoxGeometry(roadWidth, 2.2, worldHeight), asphalt);
      road.position.set(x, 0.2, worldHeight / 2);
      road.receiveShadow = true;
      this.staticRoot.add(road);
    }
    for (let z = sectorHeight; z < worldHeight; z += sectorHeight) {
      const road = new THREE.Mesh(new THREE.BoxGeometry(worldWidth, 2.25, roadWidth), asphalt);
      road.position.set(worldWidth / 2, 0.25, z);
      road.receiveShadow = true;
      this.staticRoot.add(road);
    }
    this.addRoadMarkings(arena, sectorWidth, sectorHeight, roadWidth);

    const brick = this.pbr("brick", "#b8aaa1", 2.5, 1.2, { normalScale: 0.9 });
    const concrete = this.pbr("concrete", "#a8aaa6", 2.2, 1.3, { normalScale: 0.8 });
    const wood = new THREE.MeshStandardMaterial({ color: color(theme.wood, "#725038"), roughness: 0.88 });
    const metal = new THREE.MeshStandardMaterial({ color: color(theme.metal, "#465158"), roughness: 0.38, metalness: 0.72 });
    const plaster = this.pbr("concrete", "#b0a39a", 2.3, 1.2, { normalScale: 0.38 });
    const materialByKind = { brick, concrete, wood, metal, plaster };
    const grouped = new Map();
    const caps = [];
    const modelObjects = [];

    (arena.obstacles || []).forEach((item, index) => {
      const kind = item.kind || "wall";
      const modelKey = kind === "crate" ? "crate" : kind === "barrel" ? "barrel"
        : kind === "barrier" && index % 4 === 0 ? "brokenCar"
        : kind === "barrier" && index % 2 === 0 ? "barrier" : "";
      if (modelKey && this.models.has(modelKey)) {
        modelObjects.push({ item, modelKey, index });
        return;
      }
      const materialName = String(item.material || (kind === "wall" ? wallKind : kind === "building" ? "concrete" : "concrete"));
      if (!grouped.has(materialName)) grouped.set(materialName, []);
      grouped.get(materialName).push(item);
      if (kind === "wall" || kind === "building") caps.push(item);
    });

    grouped.forEach((items, materialName) => {
      this.addInstancedBoxes(items, materialByKind[materialName] || concrete, this.staticRoot);
    });
    const capMaterial = new THREE.MeshStandardMaterial({
      color: color(theme.wall2, "#51575a"),
      roughness: 0.68,
      metalness: 0.08,
    });
    this.addInstancedBoxes(caps.map((item) => ({
      x: item.x - 2,
      y: item.y - 2,
      w: item.w + 4,
      h: item.h + 4,
      height: 4,
      baseY: Number(item.height || 100),
    })), capMaterial, this.staticRoot);

    for (const entry of modelObjects) {
      const item = entry.item;
      const height = Math.max(32, Number(item.height) || 60);
      const sourceBounds = new THREE.Box3().setFromObject(this.models.get(entry.modelKey).scene);
      const sourceSize = sourceBounds.getSize(new THREE.Vector3());
      const rotate = (item.w >= item.h) !== (sourceSize.x >= sourceSize.z);
      const object = fitModelFootprint(
        this.models.get(entry.modelKey),
        item.w * 0.94,
        height,
        item.h * 0.94,
        rotate,
        this.qualityName === "high"
      );
      object.position.set(item.x + item.w / 2, 0, item.y + item.h / 2);
      this.staticRoot.add(object);
    }

    this.addArchitectureDetails(arena.obstacles || [], theme);
    this.addWorldProps(arena, theme);
    this.addBoundary(arena, wallKind === "brick" ? brick : concrete, capMaterial);
    this.addDistantEnvironment(arena, theme);
    this.updateTheme(theme);
    this.worldKey = String(arena.id || "arena") + ":" + (arena.obstacles || []).length + ":" + this.modelRevision;
  }

  addGrassPatches(arena) {
    const sectorWidth = Number(arena.sectorWidth || 3600);
    const sectorHeight = Number(arena.sectorHeight || 2100);
    const columns = Math.round(Number(arena.width) / sectorWidth);
    const rows = Math.round(Number(arena.height) / sectorHeight);
    const grass = this.pbr("grass", "#b7b9a1", 8, 6, { normalScale: 0.55 });
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const district = row * columns + column;
        const centers = [
          [0.24, 0.27, 430, 300],
          [0.74, 0.72, 510, 340],
          [0.53, 0.48, 330, 240],
        ];
        for (let index = 0; index < centers.length; index += 1) {
          const patch = centers[index];
          const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, this.qualityName === "low" ? 18 : 32), grass);
          mesh.rotation.x = -PI / 2;
          mesh.rotation.z = seeded(district * 3 + index, 33) * PI;
          mesh.scale.set(patch[2] * (0.82 + seeded(district, index + 35) * 0.3), patch[3], 1);
          mesh.position.set(
            column * sectorWidth + sectorWidth * patch[0],
            -0.2,
            row * sectorHeight + sectorHeight * patch[1]
          );
          mesh.receiveShadow = true;
          this.staticRoot.add(mesh);
        }
      }
    }
  }

  addInstancedBoxes(items, material, parent) {
    if (!items.length) return;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    items.forEach((item, index) => {
      const height = Math.max(2, Number(item.height) || 100);
      const baseY = Number(item.baseY || 0);
      position.set(item.x + item.w / 2, baseY + height / 2, item.y + item.h / 2);
      scale.set(Math.max(1, item.w), height, Math.max(1, item.h));
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = this.quality.shadows;
    mesh.receiveShadow = true;
    parent.add(mesh);
  }

  addRoadMarkings(arena, sectorWidth, sectorHeight, roadWidth) {
    const marks = [];
    const worldWidth = Number(arena.width);
    const worldHeight = Number(arena.height);
    for (let x = sectorWidth; x < worldWidth; x += sectorWidth) {
      for (let z = 50; z < worldHeight; z += 160) marks.push({ x: x - 2, y: z - 30, w: 4, h: 60, height: 0.8, baseY: 1.45 });
    }
    for (let z = sectorHeight; z < worldHeight; z += sectorHeight) {
      for (let x = 50; x < worldWidth; x += 160) marks.push({ x: x - 30, y: z - 2, w: 60, h: 4, height: 0.8, baseY: 1.45 });
    }
    const material = new THREE.MeshStandardMaterial({
      color: 0xe8dfbd,
      roughness: 0.72,
      emissive: 0x3a3626,
      emissiveIntensity: 0.12,
    });
    this.addInstancedBoxes(marks, material, this.staticRoot);
    const curbMaterial = new THREE.MeshStandardMaterial({ color: 0x727575, roughness: 0.93 });
    const curbs = [];
    for (let x = sectorWidth; x < worldWidth; x += sectorWidth) {
      curbs.push({ x: x - roadWidth / 2 - 7, y: 0, w: 7, h: worldHeight, height: 9 });
      curbs.push({ x: x + roadWidth / 2, y: 0, w: 7, h: worldHeight, height: 9 });
    }
    for (let z = sectorHeight; z < worldHeight; z += sectorHeight) {
      curbs.push({ x: 0, y: z - roadWidth / 2 - 7, w: worldWidth, h: 7, height: 9 });
      curbs.push({ x: 0, y: z + roadWidth / 2, w: worldWidth, h: 7, height: 9 });
    }
    this.addInstancedBoxes(curbs, curbMaterial, this.staticRoot);
  }

  addArchitectureDetails(obstacles, theme) {
    const windows = [];
    const doors = [];
    for (const item of obstacles) {
      if (item.kind !== "building") continue;
      const buildingHeight = Number(item.height || 100);
      const alongX = item.w >= item.h;
      const length = alongX ? item.w : item.h;
      const count = Math.max(1, Math.min(4, Math.floor(length / 90)));
      for (let level = 0; level < (buildingHeight > 150 ? 2 : 1); level += 1) {
        for (let index = 0; index < count; index += 1) {
          const offset = (index + 1) / (count + 1);
          if (alongX) {
            windows.push({ x: item.x + item.w * offset - 12, y: item.y - 2.5, w: 24, h: 3, height: 19, baseY: 58 + level * 62 });
            windows.push({ x: item.x + item.w * offset - 12, y: item.y + item.h - 0.5, w: 24, h: 3, height: 19, baseY: 58 + level * 62 });
          } else {
            windows.push({ x: item.x - 2.5, y: item.y + item.h * offset - 12, w: 3, h: 24, height: 19, baseY: 58 + level * 62 });
            windows.push({ x: item.x + item.w - 0.5, y: item.y + item.h * offset - 12, w: 3, h: 24, height: 19, baseY: 58 + level * 62 });
          }
        }
      }
      if (alongX) doors.push({ x: item.x + item.w / 2 - 16, y: item.y - 3, w: 32, h: 4, height: 49, baseY: 0 });
      else doors.push({ x: item.x - 3, y: item.y + item.h / 2 - 16, w: 4, h: 32, height: 49, baseY: 0 });
    }
    const windowColor = color(theme.horizon, "#bfe0e5");
    const windowMaterial = new THREE.MeshStandardMaterial({
      color: windowColor,
      emissive: windowColor.clone().multiplyScalar(0.22),
      emissiveIntensity: 0.75,
      roughness: 0.18,
      metalness: 0.44,
    });
    const doorMaterial = new THREE.MeshStandardMaterial({
      color: color(theme.metal, "#354149").multiplyScalar(0.72),
      roughness: 0.42,
      metalness: 0.62,
    });
    this.addInstancedBoxes(windows, windowMaterial, this.staticRoot);
    this.addInstancedBoxes(doors, doorMaterial, this.staticRoot);
  }

  addBoundary(arena, material, capMaterial) {
    const width = Number(arena.width);
    const height = Number(arena.height);
    const thickness = 28;
    const walls = [
      { x: -thickness, y: 0, w: thickness, h: height, height: 190 },
      { x: width, y: 0, w: thickness, h: height, height: 190 },
      { x: 0, y: -thickness, w: width, h: thickness, height: 190 },
      { x: 0, y: height, w: width, h: thickness, height: 190 },
    ];
    this.addInstancedBoxes(walls, material, this.staticRoot);
    this.addInstancedBoxes(walls.map((item) => ({
      x: item.x - 2,
      y: item.y - 2,
      w: item.w + 4,
      h: item.h + 4,
      height: 5,
      baseY: 190,
    })), capMaterial, this.staticRoot);
  }

  addWorldProps(arena, theme) {
    const metal = new THREE.MeshStandardMaterial({
      color: color(theme.metal, "#434d50"),
      roughness: 0.36,
      metalness: 0.72,
    });
    const glow = new THREE.MeshStandardMaterial({
      color: color(theme.sun, "#fff0c7"),
      emissive: color(theme.sun, "#fff0c7"),
      emissiveIntensity: 2.2,
      roughness: 0.2,
    });
    (arena.props || []).forEach((prop, index) => {
      if (prop.kind === "lamp" && this.models.has("streetLight")) {
        const lamp = fitModel(this.models.get("streetLight"), 42, Number(prop.height || 145), 42, this.qualityName === "high");
        lamp.position.set(prop.x, 0, prop.y);
        lamp.rotation.y = (prop.district % 2 ? PI : 0);
        this.staticRoot.add(lamp);
      } else if (prop.kind === "lamp") {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(3, 5, Number(prop.height || 145), 10), metal);
        pole.position.set(prop.x, Number(prop.height || 145) / 2, prop.y);
        const light = new THREE.Mesh(new THREE.SphereGeometry(8, 12, 8), glow);
        light.position.set(prop.x + 18, Number(prop.height || 145) - 8, prop.y);
        this.staticRoot.add(pole, light);
      } else if (prop.kind === "tank") {
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(34, 34, Number(prop.height || 105), 20), metal);
        tank.position.set(prop.x, Number(prop.height || 105) / 2, prop.y);
        tank.castShadow = this.qualityName === "high";
        tank.receiveShadow = true;
        this.staticRoot.add(tank);
      } else if (prop.kind === "pipe") {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, Number(prop.length || 140), 12), metal);
        pipe.position.set(prop.x, 18, prop.y);
        pipe.rotation.z = PI / 2;
        pipe.rotation.y = Number(prop.yaw || 0);
        this.staticRoot.add(pipe);
      } else if (prop.kind === "sign") {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 3.5, Number(prop.height || 96), 8), metal);
        post.position.set(prop.x, Number(prop.height || 96) / 2, prop.y);
        const panel = new THREE.Mesh(
          new THREE.BoxGeometry(72, 29, 4),
          new THREE.MeshStandardMaterial({
            color: color(theme.wall2, "#4a5053"),
            roughness: 0.42,
            metalness: 0.52,
            emissive: color(theme.accent, "#20d9ff").multiplyScalar(0.13),
          })
        );
        panel.position.set(prop.x, Number(prop.height || 96), prop.y);
        panel.rotation.y = Number(prop.yaw || 0);
        this.staticRoot.add(post, panel);
      } else if (prop.kind === "awning") {
        const canopy = new THREE.Mesh(
          new THREE.BoxGeometry(Number(prop.width || 180), 5, 90),
          new THREE.MeshStandardMaterial({ color: color(theme.accent2, "#a75378"), roughness: 0.86 })
        );
        canopy.position.set(prop.x, 80, prop.y);
        canopy.rotation.z = -0.08;
        canopy.castShadow = this.qualityName !== "low";
        this.staticRoot.add(canopy);
      }
      if (index < 8 && this.models.has("pallet") && prop.kind === "pipe") {
        const pallet = fitModel(this.models.get("pallet"), 80, 10, 55, false);
        pallet.position.set(prop.x + 45, 0, prop.y + 28);
        this.staticRoot.add(pallet);
      }
    });
  }

  addDistantEnvironment(arena, theme) {
    const width = Number(arena.width);
    const height = Number(arena.height);
    const mountainMaterial = new THREE.MeshLambertMaterial({
      color: color(theme.horizon, "#87949a").multiplyScalar(0.52),
      flatShading: true,
    });
    const mountainCount = this.qualityName === "low" ? 16 : 28;
    for (let index = 0; index < mountainCount; index += 1) {
      const side = index % 4;
      const span = side < 2 ? width : height;
      const along = seeded(index, 1) * span;
      const distance = 520 + seeded(index, 2) * 450;
      const x = side === 0 ? along : side === 1 ? along : side === 2 ? -distance : width + distance;
      const z = side === 0 ? -distance : side === 1 ? height + distance : along;
      const radius = 280 + seeded(index, 3) * 420;
      const mountain = new THREE.Mesh(
        new THREE.ConeGeometry(radius, 460 + seeded(index, 4) * 520, 7),
        mountainMaterial
      );
      mountain.position.set(x, 120, z);
      mountain.rotation.y = seeded(index, 5) * PI;
      this.staticRoot.add(mountain);
    }

    const cloudMaterial = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: this.qualityName === "low" ? 0.5 : 0.68,
      depthWrite: false,
    });
    const cloudCount = this.qualityName === "low" ? 6 : 11;
    for (let index = 0; index < cloudCount; index += 1) {
      const cloud = new THREE.Group();
      const pieces = this.qualityName === "low" ? 2 : 4;
      for (let piece = 0; piece < pieces; piece += 1) {
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), cloudMaterial);
        puff.position.set(piece * 75 - pieces * 34, seeded(index + piece, 20) * 34, seeded(index + piece, 21) * 30);
        puff.scale.set(95 + seeded(index + piece, 22) * 80, 35 + seeded(index + piece, 23) * 38, 48 + seeded(index + piece, 24) * 45);
        cloud.add(puff);
      }
      cloud.position.set(
        seeded(index, 25) * width,
        620 + seeded(index, 26) * 390,
        seeded(index, 27) * height
      );
      this.staticRoot.add(cloud);
    }

    if (!this.models.has("tree1")) return;
    for (let index = 0; index < this.quality.trees; index += 1) {
      const side = index % 4;
      const along = seeded(index, 9) * (side < 2 ? width : height);
      const outside = 46 + seeded(index, 10) * 100;
      const x = side === 0 || side === 1 ? along : side === 2 ? -outside : width + outside;
      const z = side === 0 ? -outside : side === 1 ? height + outside : along;
      const treeKey = index % 3 === 0 && this.models.has("tree2") ? "tree2" : "tree1";
      const treeHeight = 155 + seeded(index, 11) * 135;
      const tree = fitModel(this.models.get(treeKey), treeHeight * 0.58, treeHeight, treeHeight * 0.58, this.qualityName === "high");
      tree.position.set(x, 0, z);
      tree.rotation.y = seeded(index, 12) * PI * 2;
      this.staticRoot.add(tree);
    }
  }

  updateTheme(theme) {
    const sky = color(theme.sky, "#5f88a6");
    const horizon = color(theme.horizon, "#c2d2d8");
    const fog = color(theme.fog, "#718590");
    const sun = color(theme.sun, "#fff0cf");
    this.scene.fog.color.copy(fog);
    this.renderer.setClearColor(sky, 1);
    this.sky.material.uniforms.topColor.value.copy(sky).offsetHSL(0, 0.04, 0.08);
    this.sky.material.uniforms.horizonColor.value.copy(horizon);
    this.sky.material.uniforms.lowerColor.value.copy(fog).multiplyScalar(0.74);
    this.sky.material.uniforms.sunColor.value.copy(sun);
    this.hemi.color.copy(horizon);
    this.hemi.groundColor.copy(color(theme.floor, "#3b403b"));
    this.sun.color.copy(sun);
  }

  createActor(player) {
    const root = new THREE.Group();
    const tint = color(player.color, "#28dfff");
    const actor = {
      root,
      mixer: null,
      actions: new Map(),
      action: "",
      yaw: Math.atan2(player.aim?.[1] || 0, player.aim?.[0] || 1),
      model: null,
      weapon: "",
      shield: null,
      name: makeCanvasLabel(player.name, player.color),
    };
    root.add(actor.name);

    if (this.models.has("soldier")) {
      const gltf = this.models.get("soldier");
      const model = cloneSkeleton(gltf.scene);
      configureRenderable(model, this.qualityName !== "low", tint);
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      const scale = 72 / Math.max(0.1, size.y);
      model.scale.setScalar(scale);
      model.position.y = -bounds.min.y * scale;
      root.add(model);
      actor.model = model;
      actor.baseModelY = model.position.y;
      actor.poseBones = [];
      actor.mixer = new THREE.AnimationMixer(model);
      for (const clip of gltf.animations || []) actor.actions.set(clip.name, actor.mixer.clipAction(clip));
      this.setActorWeapon(actor, player.weapon || "base");
    } else {
      this.addFallbackSoldier(root, tint);
    }

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(19, 23, 28),
      new THREE.MeshBasicMaterial({
        color: tint,
        transparent: true,
        opacity: 0.72,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    ring.rotation.x = -PI / 2;
    ring.position.y = 1.2;
    root.add(ring);
    actor.ring = ring;
    actor.shield = new THREE.Mesh(
      new THREE.SphereGeometry(42, 20, 14),
      new THREE.MeshPhysicalMaterial({
        color: 0x45dfff,
        emissive: 0x0c6680,
        emissiveIntensity: 0.8,
        transparent: true,
        opacity: 0.18,
        roughness: 0.12,
        transmission: this.qualityName === "high" ? 0.22 : 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    actor.shield.position.y = 39;
    actor.shield.visible = false;
    root.add(actor.shield);
    this.actorRoot.add(root);
    this.actorMap.set(player.id, actor);
    return actor;
  }

  addFallbackSoldier(root, tint) {
    const uniform = new THREE.MeshStandardMaterial({ color: 0x344148, roughness: 0.74, metalness: 0.08 });
    const armor = new THREE.MeshStandardMaterial({
      color: tint,
      roughness: 0.42,
      metalness: 0.45,
      emissive: tint.clone().multiplyScalar(0.08),
    });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(12, 30, 6, 10), uniform);
    body.position.y = 43;
    const head = new THREE.Mesh(new THREE.SphereGeometry(11, 14, 10), armor);
    head.position.y = 69;
    const legs = [-7, 7].map((x) => {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(4.5, 24, 4, 8), uniform);
      leg.position.set(x, 18, 0);
      return leg;
    });
    const gun = new THREE.Mesh(new THREE.BoxGeometry(45, 7, 7), armor);
    gun.position.set(6, 47, 18);
    root.add(body, head, gun, ...legs);
    root.traverse((part) => {
      if (!part.isMesh) return;
      part.castShadow = this.qualityName !== "low";
      part.receiveShadow = true;
    });
  }

  setActorWeapon(actor, weapon) {
    if (!actor.model || actor.weapon === weapon) return;
    actor.weapon = weapon;
    const selected = WEAPON_NODE[weapon] || WEAPON_NODE.base;
    for (const name of WEAPON_NODES) {
      const object = actor.model.getObjectByName(name);
      if (object) object.visible = name === selected;
    }
  }

  setActorAnimation(actor, name) {
    if (!actor.mixer || actor.action === name) return;
    const next = actor.actions.get(name) || actor.actions.get("Idle") || actor.actions.values().next().value;
    if (!next) return;
    const current = actor.actions.get(actor.action);
    current?.fadeOut(0.16);
    next.reset().fadeIn(0.16).play();
    actor.action = next.getClip().name;
  }

  updateActors(frame) {
    const current = new Set();
    for (const player of frame.players || []) {
      if (player.id === frame.me.id) continue;
      current.add(player.id);
      let actor = this.actorMap.get(player.id);
      if (!actor) actor = this.createActor(player);
      const distance = Math.hypot(player.x - frame.me.x, player.y - frame.me.y);
      actor.root.visible = Boolean(player.alive) && distance < (frame.me.weapon === "sniper" && frame.me.zoom > 1 ? 4500 : this.quality.distance);
      if (!actor.root.visible) continue;
      actor.root.position.set(player.x, Number(player.z || 0), player.y);

      const targetYaw = Math.atan2(player.aim?.[1] || 0, player.aim?.[0] || 1);
      const deltaYaw = Math.atan2(Math.sin(targetYaw - actor.yaw), Math.cos(targetYaw - actor.yaw));
      actor.yaw += deltaYaw * Math.min(1, frame.dt * 15);
      actor.root.rotation.y = PI / 2 - actor.yaw;
      actor.shield.visible = Boolean(player.shield);
      actor.ring.material.opacity = player.teamId && player.teamId === frame.me.teamId ? 0.88 : 0.46;
      this.setActorWeapon(actor, player.weapon || "base");
      const animation = !player.grounded ? "Jump_Idle"
        : player.moving && player.shooting ? "Run_Shoot"
        : player.moving ? "Run_Gun"
        : player.shooting ? "Idle_Shoot"
        : "Idle";
      this.setActorAnimation(actor, animation);
      for (const [bone,rotation] of actor.poseBones || []) bone.rotation.copy(rotation);
      actor.poseBones = [];
      actor.mixer?.update(Math.min(frame.dt, 0.05));
      if (actor.model) {
        actor.model.rotation.x = player.stance === "prone" ? -PI/2 : 0;
        actor.model.position.y = player.stance === "prone" ? 14 : actor.baseModelY - (player.stance === "crouch" ? 22 : 0);
        actor.model.position.z = player.stance === "prone" ? -32 : 0;
        if (player.stance === "crouch") {
          for (const [name,angle] of [["UpperLeg.L",-.9],["UpperLeg.R",-.9],["LowerLeg.L",1.5],["LowerLeg.R",1.5]]) {
            const bone = actor.model.getObjectByName(name);
            if (bone) { actor.poseBones.push([bone,bone.rotation.clone()]); bone.rotation.x += angle; }
          }
        }
      }
    }
    for (const [id, actor] of this.actorMap) {
      if (current.has(id)) continue;
      this.actorRoot.remove(actor.root);
      disposeObject(actor.root);
      this.actorMap.delete(id);
    }
  }

  createPowerup(item) {
    const powerColor = POWER_COLORS[item.kind] || 0x2adfff;
    const group = new THREE.Group();
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(25, 31, 7, 24),
      new THREE.MeshStandardMaterial({ color: 0x303b40, roughness: 0.35, metalness: 0.68 })
    );
    pedestal.position.y = 3.5;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(25, 2.5, 8, 28),
      new THREE.MeshBasicMaterial({ color: powerColor, toneMapped: false })
    );
    ring.rotation.x = PI / 2;
    ring.position.y = 8;
    let core;
    if (["base","heavy","rapid","spread","sniper"].includes(item.kind) && this.models.has(item.kind)) {
      core = fitModelUniform(this.models.get(item.kind),55,false);
    } else if (item.kind === "ammo") {
      core = new THREE.Mesh(new THREE.BoxGeometry(35,22,25),new THREE.MeshStandardMaterial({color:0x61713b,roughness:.8}));
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(36,5,26),new THREE.MeshStandardMaterial({color:0xffcc44}));
      core.add(stripe);
    } else if (item.kind === "grenade" && this.models.has("grenade")) {
      core = fitModelUniform(this.models.get("grenade"), 30, false);
    } else if (item.kind === "rpg" && this.models.has("rpg")) {
      core = fitModelUniform(this.models.get("rpg"), 52, false);
      core.rotation.y = PI / 2;
    } else {
      core = new THREE.Mesh(
        item.kind === "health" ? new THREE.OctahedronGeometry(16, 0) : new THREE.IcosahedronGeometry(17, 1),
        new THREE.MeshStandardMaterial({
          color: powerColor,
          emissive: powerColor,
          emissiveIntensity: 1.35,
          roughness: 0.22,
          metalness: 0.38,
        })
      );
    }
    core.position.y = 30;
    group.add(pedestal, ring, core);
    group.userData.core = core;
    group.userData.ring = ring;
    this.powerupRoot.add(group);
    this.powerupMap.set(item.id, group);
    return group;
  }

  updatePowerups(items, now) {
    const current = new Set();
    for (const item of items || []) {
      current.add(item.id);
      const group = this.powerupMap.get(item.id) || this.createPowerup(item);
      group.position.set(item.x, 0, item.y);
      group.userData.core.rotation.y = now * 0.0012;
      group.userData.core.position.y = 30 + Math.sin(now * 0.004 + item.x) * 4;
      group.userData.ring.rotation.z = now * 0.001;
    }
    for (const [id, group] of this.powerupMap) {
      if (current.has(id)) continue;
      this.powerupRoot.remove(group);
      disposeObject(group);
      this.powerupMap.delete(id);
    }
  }

  createProjectile(item) {
    let object;
    if (["base","heavy","rapid","spread","sniper"].includes(item.kind) && this.models.has(item.kind)) {
      core = fitModelUniform(this.models.get(item.kind),55,false);
    } else if (item.kind === "ammo") {
      core = new THREE.Mesh(new THREE.BoxGeometry(35,22,25),new THREE.MeshStandardMaterial({color:0x61713b,roughness:.8}));
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(36,5,26),new THREE.MeshStandardMaterial({color:0xffcc44}));
      core.add(stripe);
    } else if (item.kind === "grenade" && this.models.has("grenade")) {
      object = fitModelUniform(this.models.get("grenade"), 18, false);
    } else if (item.kind === "rpg") {
      object = new THREE.Group();
      const material = new THREE.MeshStandardMaterial({
        color: 0x4a5150,
        emissive: 0x8d2410,
        emissiveIntensity: 0.34,
        roughness: 0.4,
        metalness: 0.55,
      });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 5.2, 25, 10), material);
      body.rotation.z = PI / 2;
      const nose = new THREE.Mesh(new THREE.ConeGeometry(7, 13, 10), new THREE.MeshStandardMaterial({ color: 0xd5543c, roughness: 0.4 }));
      nose.rotation.z = -PI / 2;
      nose.position.x = 18;
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(5.5, 18, 7),
        new THREE.MeshBasicMaterial({ color: 0xffb13d, toneMapped: false })
      );
      flame.rotation.z = PI / 2;
      flame.position.x = -20;
      object.add(body, nose, flame);
    } else {
      object = new THREE.Mesh(
        new THREE.SphereGeometry(9, 12, 8),
        new THREE.MeshStandardMaterial({
          color: 0x4d5a50,
          emissive: 0,
          emissiveIntensity: 1.2,
          roughness: 0.44,
          metalness: 0.35,
        })
      );
    }
    this.projectileRoot.add(object);
    this.projectileMap.set(item.id, object);
    return object;
  }

  updateProjectiles(items, now) {
    const current = new Set();
    for (const item of items || []) {
      current.add(item.id);
      const object = this.projectileMap.get(item.id) || this.createProjectile(item);
      object.position.set(item.x, Number(item.z || 0) + 8, item.y);
      if (item.kind === "rpg") {
        const direction = new THREE.Vector3(item.vx || 1, item.vz || 0, item.vy || 0).normalize();
        object.quaternion.setFromUnitVectors(MODEL_FORWARD, direction);
      } else {
        object.rotation.x += 0.12;
        object.rotation.z += 0.08;
      }
    }
    for (const [id, object] of this.projectileMap) {
      if (current.has(id)) continue;
      this.projectileRoot.remove(object);
      disposeObject(object);
      this.projectileMap.delete(id);
    }
  }

  createExplosion(item) {
    const group = new THREE.Group();
    const fire = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 2),
      new THREE.MeshBasicMaterial({
        color: item.kind === "rpg" ? 0xff5a2f : 0xffad3f,
        transparent: true,
        opacity: 0.84,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    const smoke = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshStandardMaterial({
        color: 0x292d2e,
        transparent: true,
        opacity: 0.5,
        roughness: 1,
        depthWrite: false,
      })
    );
    const light = new THREE.PointLight(item.kind === "rpg" ? 0xff5129 : 0xffa12e, 8, 440, 2);
    group.add(fire, smoke, light);
    group.userData.fire = fire;
    group.userData.smoke = smoke;
    group.userData.light = light;
    this.explosionRoot.add(group);
    this.explosionMap.set(item.id, group);
    return group;
  }

  updateExplosions(items, now) {
    const current = new Set();
    for (const item of items || []) {
      current.add(item.id);
      const group = this.explosionMap.get(item.id) || this.createExplosion(item);
      const life = Math.max(0.02, Math.min(1, Number(item.remaining || 0.1) / 0.38));
      const radius = Number(item.radius || 120);
      group.position.set(item.x, Math.max(18, Number(item.z || 0)), item.y);
      group.userData.fire.scale.setScalar(radius * (0.25 + (1 - life) * 0.25));
      group.userData.fire.material.opacity = life * 0.9;
      group.userData.fire.rotation.y = now * 0.006;
      group.userData.smoke.scale.set(radius * 0.34, radius * 0.52, radius * 0.34);
      group.userData.smoke.position.y = (1 - life) * 60;
      group.userData.smoke.material.opacity = life * 0.46;
      group.userData.light.intensity = life * 14;
    }
    for (const [id, group] of this.explosionMap) {
      if (current.has(id)) continue;
      this.explosionRoot.remove(group);
      disposeObject(group);
      this.explosionMap.delete(id);
    }
  }

  updateTraces(traces) {
    const position = this.traceGeometry.attributes.position;
    const traceColor = this.traceGeometry.attributes.color;
    const impactPosition = this.impactPoints.geometry.attributes.position;
    let count = 0;
    let hits = 0;
    for (const trace of (traces || []).slice(-192)) {
      const x1 = trace.x1 === undefined ? trace.x : trace.x1;
      const z1 = trace.y1 === undefined ? trace.y : trace.y1;
      const x2 = trace.x2 === undefined ? trace.x + (trace.vx || 0) * 0.12 : trace.x2;
      const z2 = trace.y2 === undefined ? trace.y + (trace.vy || 0) * 0.12 : trace.y2;
      const y1 = Number(trace.z || 48);
      const y2 = Number.isFinite(Number(trace.z2)) ? Number(trace.z2) : y1;
      position.setXYZ(count * 2, x1, y1, z1);
      position.setXYZ(count * 2 + 1, x2, y2, z2);
      const c = color(trace.hit ? "#fff3ad" : trace.color, "#ffe09b");
      traceColor.setXYZ(count * 2, c.r, c.g, c.b);
      traceColor.setXYZ(count * 2 + 1, c.r, c.g, c.b);
      count += 1;
      if (trace.hit && hits < 192) {
        impactPosition.setXYZ(hits, x2, y2, z2);
        hits += 1;
      }
    }
    position.needsUpdate = true;
    traceColor.needsUpdate = true;
    impactPosition.needsUpdate = true;
    this.traceGeometry.setDrawRange(0, count * 2);
    this.impactPoints.geometry.setDrawRange(0, hits);
    this.traceGeometry.computeBoundingSphere();
    this.impactPoints.geometry.computeBoundingSphere();
  }

  updateWeapon(frame) {
    const kind = frame.me.weapon || "base";
    if (kind !== this.weaponKind) {
      this.weaponKind = kind;
      disposeObject(this.weaponHolder);
      this.weaponHolder.clear();
      if (this.models.has(kind)) {
        const model = fitModelUniform(this.models.get(kind), 94, false);
        model.rotation.y = -PI / 2;
        model.position.set(18, -38, -60);
        model.traverse((object) => {
          if (!object.isMesh) return;
          object.renderOrder = 1000;
          object.material.depthTest = true;
          object.material.depthWrite = true;
        });
        if (kind === "sniper") {
          model.scale.z *= 1.45;
          const scope = new THREE.Mesh(new THREE.CylinderGeometry(3.2,3.2,29,16),new THREE.MeshStandardMaterial({color:0x16212b,metalness:.75,roughness:.25}));
          scope.rotation.x = PI/2;
          scope.position.set(18,-25,-68);
          this.weaponHolder.add(scope);
        }
        this.weaponHolder.add(model);
        this.addArms();
      } else {
        this.buildFallbackWeapon();
      }
    }
    const moving = Math.min(1, Math.hypot(frame.move?.[0] || 0, frame.move?.[1] || 0));
    this.bobTime += frame.dt * (moving > 0.05 ? 9.5 : 2.4);
    const bobX = Math.sin(this.bobTime) * 1.25 * moving;
    const bobY = Math.abs(Math.cos(this.bobTime)) * 1.25 * moving;
    const recoil = Math.max(0, Number(frame.recoil || 0));
    this.weaponRig.position.set(bobX, -bobY, recoil * 0.9);
    this.weaponRig.rotation.set(-0.018 - recoil * 0.008, -bobX * 0.0016, bobX * -0.0032);
    this.muzzleFlash.visible = Boolean(frame.muzzle);
    this.muzzleFlash.rotation.z = frame.now * 0.04;
    this.muzzleFlash.scale.setScalar(0.82 + seeded(Math.floor(frame.now / 18), 4) * 0.42);
    this.muzzleLight.intensity = frame.muzzle ? 12 : 0;
  }

  resize() {
    const width = Math.max(1, this.canvas.clientWidth || innerWidth);
    const height = Math.max(1, this.canvas.clientHeight || innerHeight);
    const maximum = Math.min(Number(devicePixelRatio || 1), this.quality.maxRatio);
    this.renderer.setPixelRatio(Math.min(maximum, this.pixelScale));
    const targetWidth = Math.round(width * this.renderer.getPixelRatio());
    const targetHeight = Math.round(height * this.renderer.getPixelRatio());
    if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) this.renderer.setSize(width, height, false);
    if (this.camera.aspect !== width / height) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.weaponCamera.aspect = width / height;
      this.weaponCamera.updateProjectionMatrix();
    }
  }

  adaptResolution(now) {
    this.frameCounter += 1;
    const elapsed = now - this.fpsStartedAt;
    if (elapsed < 2400) return;
    const fps = this.frameCounter * 1000 / elapsed;
    const maximum = Math.min(Number(devicePixelRatio || 1), this.quality.maxRatio);
    if (fps < 39 && this.pixelScale > 0.72) this.pixelScale = Math.max(0.72, this.pixelScale - 0.1);
    else if (fps > 57 && this.pixelScale < maximum) this.pixelScale = Math.min(maximum, this.pixelScale + 0.04);
    this.canvas.dataset.fps = String(Math.round(fps));
    this.frameCounter = 0;
    this.fpsStartedAt = now;
  }

  render(frame) {
    if (!frame?.arena || !frame?.me) return;
    this.resize();
    const requiredWorldKey = String(frame.arena.id || "arena") + ":" + (frame.arena.obstacles || []).length + ":" + this.modelRevision;
    if (requiredWorldKey !== this.worldKey) this.rebuildWorld(frame.arena);
    const movement = Math.min(1, Math.hypot(frame.move?.[0] || 0, frame.move?.[1] || 0));
    const eyeBob = Math.sin(this.bobTime * 2) * 0.72 * movement;
    const zoom = frame.me.weapon === "sniper" ? Number(frame.me.zoom || 1) : 1;
    this.camera.fov = THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(70)/2)/zoom));
    this.camera.updateProjectionMatrix();
    const eyeY = Number(frame.me.z || 0) + Number(frame.me.height || 72)*.875 + eyeBob;
    this.camera.position.set(frame.me.x, eyeY, frame.me.y);
    this.camera.rotation.set(frame.pitch || 0, -PI / 2 - (frame.angle || 0), 0, "YXZ");
    this.sky.position.copy(this.camera.position);
    this.sky.scale.setScalar(this.quality.distance + 1200);
    this.sun.position.set(frame.me.x - 620, eyeY + 1100, frame.me.y - 480);
    this.sunTarget.position.set(frame.me.x, 0, frame.me.y);
    this.sunTarget.updateMatrixWorld();

    const players = (frame.players || []).map((player) => player.id === frame.me.id ? {
      ...player,
      shooting: frame.shooting,
    } : player);
    this.updateActors({ ...frame, players });
    this.updatePowerups(frame.powerups, frame.now);
    this.updateProjectiles(frame.projectiles, frame.now);
    this.updateExplosions(frame.explosions, frame.now);
    this.updateTraces(frame.traces);
    this.updateWeapon(frame);

    this.renderer.autoClear = true;
    this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    if (!(frame.me.weapon === "sniper" && frame.me.zoom > 1)) this.renderer.render(this.weaponScene, this.weaponCamera);
    this.renderer.autoClear = true;
    this.adaptResolution(frame.now);
  }

  setQuality(name) {
    if (!QUALITY[name] || name === this.qualityName) return;
    localStorage.setItem("neon-quality", name);
    location.reload();
  }
}

window.NeonRenderer3D = {
  create(canvas) {
    if (!supportsWebGL2()) {
      console.info("WebGL2 unavailable; using the compatible Neon renderer");
      return legacyRenderer?.create(canvas) || null;
    }
    return new NeonRendererNext(canvas);
  },
};

