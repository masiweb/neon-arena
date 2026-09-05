(() => {
  "use strict";

  const VERTEX_SHADER = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    uniform mat4 uViewProjection;
    uniform vec3 uCenter;
    uniform vec3 uSize;
    uniform float uYaw;
    varying vec3 vWorld;
    varying vec3 vNormal;
    void main() {
      vec3 p = aPosition * uSize;
      float c = cos(uYaw), s = sin(uYaw);
      vec3 world = vec3(
        uCenter.x + p.x * c - p.z * s,
        uCenter.y + p.y,
        uCenter.z + p.x * s + p.z * c
      );
      vWorld = world;
      vNormal = normalize(vec3(
        aNormal.x * c - aNormal.z * s,
        aNormal.y,
        aNormal.x * s + aNormal.z * c
      ));
      gl_Position = uViewProjection * vec4(world, 1.0);
    }
  `;

  const FRAGMENT_SHADER = `
    precision mediump float;
    uniform vec3 uColor;
    uniform vec3 uFog;
    uniform vec3 uCamera;
    uniform float uMaterial;
    uniform float uTime;
    varying vec3 vWorld;
    varying vec3 vNormal;

    float gridLine(vec2 point, vec2 cell, float width) {
      vec2 local = mod(point, cell);
      vec2 edge = min(local, cell - local);
      return 1.0 - step(width, min(edge.x, edge.y));
    }

    float brickMortar(vec2 point) {
      const float brickWidth = 34.0;
      const float brickHeight = 15.0;
      float row = floor(point.y / brickHeight);
      point.x += mod(row, 2.0) * brickWidth * 0.5;
      vec2 local = mod(point, vec2(brickWidth, brickHeight));
      float vertical = 1.0 - step(1.15, min(local.x, brickWidth - local.x));
      float horizontal = 1.0 - step(1.15, min(local.y, brickHeight - local.y));
      return max(vertical, horizontal);
    }

    void main() {
      vec3 lightDirection = normalize(vec3(-0.52, 0.82, 0.28));
      float diffuse = 0.30 + max(dot(vNormal, lightDirection), 0.0) * 0.70;
      float distanceToCamera = length(vWorld - uCamera);
      vec3 color = uColor * diffuse;

      if (uMaterial > 0.5 && uMaterial < 1.5) {
        vec2 uv = abs(vNormal.y) > 0.62
          ? vWorld.xz
          : (abs(vNormal.x) > 0.62 ? vWorld.zy : vWorld.xy);
        float mortar = brickMortar(uv);
        float brickNoise = 0.88 + 0.10 * sin(floor(uv.x / 34.0) * 2.71 + floor(uv.y / 15.0) * 4.13);
        color = uColor * diffuse * brickNoise;
        color = mix(color, vec3(0.012, 0.022, 0.032), mortar * 0.94);
      } else if (uMaterial > 1.5 && uMaterial < 2.5) {
        float pulse = 0.92 + 0.18 * sin(uTime * 0.0045 + vWorld.x * 0.02 + vWorld.z * 0.02);
        color = uColor * pulse * 1.28;
      } else if (uMaterial > 2.5 && uMaterial < 3.5) {
        float major = gridLine(vWorld.xz, vec2(64.0), 1.2);
        float minor = gridLine(vWorld.xz, vec2(16.0), 0.42);
        color = mix(uColor * diffuse, vec3(0.02, 0.24, 0.30), major * 0.54);
        color = mix(color, vec3(0.015, 0.09, 0.12), minor * 0.20);
      } else if (uMaterial > 3.5) {
        float edge = pow(1.0 - max(dot(normalize(uCamera - vWorld), vNormal), 0.0), 2.0);
        color = uColor * diffuse + vec3(0.03, 0.13, 0.17) * edge;
      }

      float fog = smoothstep(820.0, 2250.0, distanceToCamera);
      color = mix(color, uFog, fog * 0.76);
      color = pow(max(color, vec3(0.0)), vec3(0.92));
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  const CUBE = new Float32Array([
    -0.5,-0.5, 0.5, 0,0,1,  0.5,-0.5, 0.5, 0,0,1,  0.5,0.5,0.5,0,0,1,
    -0.5,-0.5, 0.5, 0,0,1,  0.5, 0.5, 0.5,0,0,1, -0.5,0.5,0.5,0,0,1,
     0.5,-0.5,-0.5, 0,0,-1, -0.5,-0.5,-0.5,0,0,-1, -0.5,0.5,-0.5,0,0,-1,
     0.5,-0.5,-0.5, 0,0,-1, -0.5, 0.5,-0.5,0,0,-1,  0.5,0.5,-0.5,0,0,-1,
    -0.5,-0.5,-0.5,-1,0,0, -0.5,-0.5, 0.5,-1,0,0, -0.5,0.5,0.5,-1,0,0,
    -0.5,-0.5,-0.5,-1,0,0, -0.5, 0.5, 0.5,-1,0,0, -0.5,0.5,-0.5,-1,0,0,
     0.5,-0.5, 0.5, 1,0,0,  0.5,-0.5,-0.5,1,0,0,  0.5,0.5,-0.5,1,0,0,
     0.5,-0.5, 0.5, 1,0,0,  0.5, 0.5,-0.5,1,0,0,  0.5,0.5,0.5,1,0,0,
    -0.5, 0.5, 0.5, 0,1,0,  0.5, 0.5, 0.5,0,1,0,  0.5,0.5,-0.5,0,1,0,
    -0.5, 0.5, 0.5, 0,1,0,  0.5, 0.5,-0.5,0,1,0, -0.5,0.5,-0.5,0,1,0,
    -0.5,-0.5,-0.5, 0,-1,0, 0.5,-0.5,-0.5,0,-1,0, 0.5,-0.5,0.5,0,-1,0,
    -0.5,-0.5,-0.5, 0,-1,0, 0.5,-0.5, 0.5,0,-1,0,-0.5,-0.5,0.5,0,-1,0
  ]);

  function compileShader(gl, type, source) {
    const value = gl.createShader(type);
    gl.shaderSource(value, source);
    gl.compileShader(value);
    if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(value));
    return value;
  }

  function createProgram(gl) {
    const value = gl.createProgram();
    gl.attachShader(value, compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(value, compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(value);
    if (!gl.getProgramParameter(value, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(value));
    return value;
  }

  function multiply(a, b) {
    const out = new Float32Array(16);
    for (let column = 0; column < 4; column += 1) {
      for (let row = 0; row < 4; row += 1) {
        out[column * 4 + row] =
          a[row] * b[column * 4] + a[4 + row] * b[column * 4 + 1] +
          a[8 + row] * b[column * 4 + 2] + a[12 + row] * b[column * 4 + 3];
      }
    }
    return out;
  }

  function perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2);
    const range = 1 / (near - far);
    return new Float32Array([
      f / aspect,0,0,0, 0,f,0,0, 0,0,(far + near) * range,-1,
      0,0,2 * far * near * range,0
    ]);
  }

  function lookAt(eye, target, up) {
    let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
    let length = Math.hypot(zx, zy, zz) || 1;
    zx /= length; zy /= length; zz /= length;
    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    length = Math.hypot(xx, xy, xz) || 1;
    xx /= length; xy /= length; xz /= length;
    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;
    return new Float32Array([
      xx,yx,zx,0, xy,yy,zy,0, xz,yz,zz,0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]),1
    ]);
  }

  function rgb(hex) {
    const value = parseInt(String(hex || "#20d9ff").replace("#", ""), 16);
    return [(value >> 16 & 255) / 255, (value >> 8 & 255) / 255, (value & 255) / 255];
  }

  function create(canvas) {
    let gl;
    try {
      gl = canvas.getContext("webgl", {
        alpha: false,
        antialias: true,
        depth: true,
        powerPreference: "high-performance",
        preserveDrawingBuffer: false,
      });
    } catch {
      return null;
    }
    if (!gl) return null;

    const program = createProgram(gl);
    const locations = {
      position: gl.getAttribLocation(program, "aPosition"),
      normal: gl.getAttribLocation(program, "aNormal"),
      vp: gl.getUniformLocation(program, "uViewProjection"),
      center: gl.getUniformLocation(program, "uCenter"),
      size: gl.getUniformLocation(program, "uSize"),
      yaw: gl.getUniformLocation(program, "uYaw"),
      color: gl.getUniformLocation(program, "uColor"),
      fog: gl.getUniformLocation(program, "uFog"),
      material: gl.getUniformLocation(program, "uMaterial"),
      camera: gl.getUniformLocation(program, "uCamera"),
      time: gl.getUniformLocation(program, "uTime"),
    };
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, CUBE, gl.STATIC_DRAW);
    gl.useProgram(program);
    gl.enableVertexAttribArray(locations.position);
    gl.vertexAttribPointer(locations.position, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(locations.normal);
    gl.vertexAttribPointer(locations.normal, 3, gl.FLOAT, false, 24, 12);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    const drawBox = (center, size, color, material = 0, yaw = 0) => {
      gl.uniform3fv(locations.center, center);
      gl.uniform3fv(locations.size, size);
      gl.uniform1f(locations.yaw, yaw);
      gl.uniform3fv(locations.color, rgb(color));
      gl.uniform1f(locations.material, material);
      gl.drawArrays(gl.TRIANGLES, 0, 36);
    };

    const drawWallEdges = (wall, height, color) => {
      const cx = wall.x + wall.w / 2;
      const cz = wall.y + wall.h / 2;
      const thickness = 1.3;
      drawBox([cx, height + 0.65, wall.y], [wall.w + 1.5, thickness, 1.4], color, 2);
      drawBox([cx, height + 0.65, wall.y + wall.h], [wall.w + 1.5, thickness, 1.4], color, 2);
      drawBox([wall.x, height + 0.65, cz], [1.4, thickness, wall.h + 1.5], color, 2);
      drawBox([wall.x + wall.w, height + 0.65, cz], [1.4, thickness, wall.h + 1.5], color, 2);
    };

    const renderPlayer = (player, now, detailed = true) => {
      const yaw = Math.atan2(player.aim?.[1] || 0, player.aim?.[0] || 1);
      const forward = [Math.cos(yaw), Math.sin(yaw)];
      const right = [-forward[1], forward[0]];
      const baseHeight = Number(player.z) || 0;
      const at = (front, side, height) => [
        player.x + forward[0] * front + right[0] * side,
        baseHeight + height,
        player.y + forward[1] * front + right[1] * side,
      ];
      const stride = Math.sin(now * 0.011 + player.x * 0.025 + player.y * 0.018) * 2.6;
      const accent = player.color;

      if (!detailed) {
        // Low-detail silhouette keeps distant combatants readable without
        // spending dozens of draw calls per player on mobile GPUs.
        drawBox(at(stride, -6, 13), [10, 26, 11], "#101923", 4, yaw);
        drawBox(at(-stride, 6, 13), [10, 26, 11], "#101923", 4, yaw);
        drawBox(at(0, 0, 39), [27, 30, 16], "#111d28", 4, yaw);
        drawBox(at(7, 0, 42), [19, 18, 17], accent, 2, yaw);
        drawBox(at(0, 0, 62), [20, 20, 20], "#101f2b", 4, yaw);
        drawBox(at(11, 0, 64), [2, 14, 8], accent, 2, yaw);
        drawBox(at(29, 12, 39), [48, 7, 8], "#0b131c", 4, yaw);
        drawBox(at(51, 12, 39), [20, 4, 5], accent, 2, yaw);
        if (player.shield) drawBox(at(0, 0, 76), [43, 1.5, 43], "#8cf5ff", 2, yaw);
        return;
      }

      // Armoured neon operative: articulated boots/legs, torso plates,
      // shoulder pads, backpack, helmet/visor and a two-handed rifle.
      drawBox(at(stride, -6.2, 13), [9.5, 26, 10.5], "#101923", 4, yaw);
      drawBox(at(-stride, 6.2, 13), [9.5, 26, 10.5], "#101923", 4, yaw);
      drawBox(at(2, -6.2, 3.5), [13, 7, 16], "#071019", 4, yaw);
      drawBox(at(2, 6.2, 3.5), [13, 7, 16], "#071019", 4, yaw);
      drawBox(at(5, -6.2, 6), [11, 2.4, 13], accent, 2, yaw);
      drawBox(at(5, 6.2, 6), [11, 2.4, 13], accent, 2, yaw);
      drawBox(at(-1, 0, 29), [20, 8, 14], "#0b151f", 4, yaw);
      drawBox(at(0, 0, 40), [27, 26, 15], "#111d28", 4, yaw);
      drawBox(at(7, 0, 42), [19, 18, 16.5], accent, 2, yaw);
      drawBox(at(8.5, 0, 42), [2.2, 11, 12], "#e5fcff", 2, yaw);
      drawBox(at(-8, 0, 43), [12, 23, 19], "#08131e", 4, yaw);
      drawBox(at(-1, -16, 44), [12, 12, 12], accent, 4, yaw);
      drawBox(at(-1, 16, 44), [12, 12, 12], accent, 4, yaw);
      drawBox(at(10, -17, 37), [25, 7.5, 8], "#192834", 4, yaw);
      drawBox(at(10, 17, 37), [25, 7.5, 8], "#192834", 4, yaw);
      drawBox(at(22, -17, 37), [7, 9, 9], "#0a1119", 4, yaw);
      drawBox(at(22, 17, 37), [7, 9, 9], "#0a1119", 4, yaw);
      drawBox(at(0, 0, 61), [19, 19, 19], "#101f2b", 4, yaw);
      drawBox(at(2, 0, 69), [22, 5, 20], "#0a151f", 4, yaw);
      drawBox(at(10.2, 0, 62), [1.8, 12, 8], "#d7fbff", 2, yaw);
      drawBox(at(10.8, 0, 66), [2.1, 15, 3], accent, 2, yaw);
      drawBox(at(25, 12.5, 39), [35, 8, 9], "#0b131c", 4, yaw);
      drawBox(at(47, 12.5, 39), [28, 5, 5.5], accent, 2, yaw);
      drawBox(at(31, 12.5, 46), [12, 4.5, 8], "#0a1119", 4, yaw);
      drawBox(at(18, 12.5, 34), [10, 5, 14], "#111e28", 4, yaw);

      if (player.speedBoost) drawBox(at(-15, 0, 28), [4, 38, 31], "#ffd52a", 2, yaw);
      if (player.shield) {
        drawBox(at(0, 0, 75), [42, 1.4, 42], "#8cf5ff", 2, yaw);
        drawBox(at(0, 0, 2), [42, 1.4, 42], "#8cf5ff", 2, yaw);
        drawBox(at(0, -22, 38), [42, 1.4, 1.4], "#8cf5ff", 2, yaw);
        drawBox(at(0, 22, 38), [42, 1.4, 1.4], "#8cf5ff", 2, yaw);
      }
    };

    function render(scene) {
      const mobile = matchMedia("(pointer: coarse)").matches || innerWidth < 900;
      const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.18 : 1.55);
      const width = Math.max(1, Math.round(innerWidth * dpr));
      const height = Math.max(1, Math.round(innerHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        canvas.style.width = `${innerWidth}px`;
        canvas.style.height = `${innerHeight}px`;
      }

      gl.viewport(0, 0, width, height);
      const theme = scene.arena.theme || {};
      const sky = rgb(theme.sky || "#071d36");
      gl.clearColor(sky[0], sky[1], sky[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const movement = Math.min(1, Math.hypot(scene.move[0], scene.move[1]));
      const bob = Math.sin(scene.now * 0.0105) * 0.9 * movement;
      const eye = [scene.me.x, 63 + (Number(scene.me.z) || 0) + bob, scene.me.y];
      const cp = Math.cos(scene.pitch), sp = Math.sin(scene.pitch);
      const ca = Math.cos(scene.angle), sa = Math.sin(scene.angle);
      const forward = [ca * cp, sp, sa * cp];
      const target = [eye[0] + forward[0] * 120, eye[1] + forward[1] * 120, eye[2] + forward[2] * 120];
      const viewProjection = multiply(
        perspective(Math.PI * 0.405, width / height, 1.8, 2600),
        lookAt(eye, target, [0, 1, 0])
      );
      gl.useProgram(program);
      gl.uniformMatrix4fv(locations.vp, false, viewProjection);
      gl.uniform3fv(locations.camera, eye);
      gl.uniform3fv(locations.fog, rgb(theme.fog || "#06334b"));
      gl.uniform1f(locations.time, scene.now);

      drawBox([scene.arena.width / 2, -3, scene.arena.height / 2], [scene.arena.width, 6, scene.arena.height], theme.floor || "#131e29", 3);

      const wallColors = ["#273541", "#303945", "#293843", "#343b42"];
      const wallVisibility = mobile ? 1900 : 2600;
      scene.arena.obstacles.forEach((wall, index) => {
        const nearestX = Math.max(wall.x, Math.min(scene.me.x, wall.x + wall.w));
        const nearestZ = Math.max(wall.y, Math.min(scene.me.y, wall.y + wall.h));
        if (Math.hypot(nearestX - scene.me.x, nearestZ - scene.me.y) > wallVisibility) return;
        const wallHeight = Math.max(38, Math.min(170, Number(wall.height) || (index % 5 === 2 ? 56 : 110)));
        const color = wallColors[index % wallColors.length];
        const accent = index % 3 === 1 ? (theme.accent2 || "#ff2da6") : (theme.accent || "#20d9ff");
        drawBox([wall.x + wall.w / 2, wallHeight / 2, wall.y + wall.h / 2], [wall.w, wallHeight, wall.h], color, 1);
        drawWallEdges(wall, wallHeight, accent);
      });

      const boundaryColor = "#26333e";
      const boundaryHeight = 150;
      const boundaries = [
        { x: -12, y: -8, w: scene.arena.width + 24, h: 16 },
        { x: -12, y: scene.arena.height - 8, w: scene.arena.width + 24, h: 16 },
        { x: -8, y: 0, w: 16, h: scene.arena.height },
        { x: scene.arena.width - 8, y: 0, w: 16, h: scene.arena.height },
      ];
      for (const wall of boundaries) {
        drawBox([wall.x + wall.w / 2, boundaryHeight / 2, wall.y + wall.h / 2], [wall.w, boundaryHeight, wall.h], boundaryColor, 1);
      }

      for (const item of scene.powerups) {
        if (Math.hypot(item.x - scene.me.x, item.y - scene.me.y) > 1800) continue;
        const colors = { speed:"#ffd52a", health:"#ff4f6f", shield:"#20d9ff", weapon:"#ff2da6", stealth:"#9b66ff", grenade:"#ffc14f", rpg:"#ff593f" };
        const itemHeight = 22 + Math.sin(scene.now * 0.0045 + item.x) * 4;
        drawBox([item.x, itemHeight, item.y], [19, 19, 19], colors[item.kind] || "#fff", 2, scene.now * 0.0017);
        drawBox([item.x, 3, item.y], [34, 1.2, 34], colors[item.kind] || "#fff", 2, scene.now * -0.001);
      }

      for (const player of scene.players) {
        if (player.id === scene.me.id || !player.alive) continue;
        const distance = Math.hypot(player.x - scene.me.x, player.y - scene.me.y);
        if (distance <= 2000) renderPlayer(player, scene.now, !mobile || distance < 820);
      }

      for (const projectile of scene.projectiles || []) {
        if (Math.hypot(projectile.x - scene.me.x, projectile.y - scene.me.y) > 1900) continue;
        const color = projectile.kind === "rpg" ? "#ff593f" : "#ffc14f";
        const yaw = Math.atan2(projectile.vy || 0, projectile.vx || 1);
        if (projectile.kind === "rpg") {
          drawBox([projectile.x, (projectile.z || 0) + 2, projectile.y], [31, 7, 7], color, 2, yaw);
          drawBox([projectile.x - Math.cos(yaw) * 17, (projectile.z || 0) + 2, projectile.y - Math.sin(yaw) * 17], [14, 3, 3], "#fff0a2", 2, yaw);
        } else {
          drawBox([projectile.x, (projectile.z || 0) + 7, projectile.y], [14, 14, 14], color, 2, scene.now * .008);
        }
      }

      for (const explosion of scene.explosions || []) {
        const life = Math.max(.05, Math.min(1, (explosion.remaining || .1) / .38));
        const size = (explosion.radius || 120) * (1.05 - life * .42);
        const color = explosion.kind === "rpg" ? "#ff4e35" : "#ffb72f";
        const core = 18 + (1 - life) * 34;
        const centerY = Math.max(15, explosion.z || 0);
        drawBox([explosion.x, centerY, explosion.y], [core, core, core], "#fff4b0", 2, scene.now * .01);
        drawBox([explosion.x, centerY, explosion.y], [size, 4, 5], color, 2, scene.now * .013);
        drawBox([explosion.x, centerY, explosion.y], [5, 4, size], color, 2, -scene.now * .011);
        drawBox([explosion.x, centerY + size * .16, explosion.y], [5, size * .45, 5], color, 2);
        drawBox([explosion.x, 3, explosion.y], [size * 1.25, 1.4, size * 1.25], color, 2, -scene.now * .007);
      }

      for (const trace of scene.traces) {
        const x1 = trace.x1 ?? trace.x;
        const z1 = trace.y1 ?? trace.y;
        const x2 = trace.x2 ?? (trace.x + (trace.vx || 0) * 0.12);
        const z2 = trace.y2 ?? (trace.y + (trace.vy || 0) * 0.12);
        const dx = x2 - x1, dz = z2 - z1;
        const length = Math.hypot(dx, dz);
        if (length > 0.5) {
          const color = trace.hit ? "#fff29a" : (trace.color || "#fff");
          const startHeight = Number(trace.z) || 48;
          const endHeight = Number.isFinite(Number(trace.z2)) ? Number(trace.z2) : startHeight;
          const traceHeight = (startHeight + endHeight) / 2;
          drawBox([(x1 + x2) / 2, traceHeight, (z1 + z2) / 2], [length, 1.35, 1.35], color, 2, Math.atan2(dz, dx));
          drawBox([x2, endHeight, z2], [trace.hit ? 5 : 2.5, trace.hit ? 5 : 2.5, trace.hit ? 5 : 2.5], color, 2, scene.now * 0.01);
        }
      }

      gl.clear(gl.DEPTH_BUFFER_BIT);
      const right = [-sa, 0, ca];
      const recoil = Math.max(0, Number(scene.recoil) || 0);
      const weaponAt = (frontDistance, sideDistance, vertical) => [
        eye[0] + ca * (frontDistance - recoil) + right[0] * sideDistance,
        eye[1] + vertical + sp * frontDistance,
        eye[2] + sa * (frontDistance - recoil) + right[2] * sideDistance,
      ];
      const accent = scene.me.weapon === "heavy" ? "#ffd45e" : scene.me.weapon === "rapid" ? "#9dff24" : scene.me.weapon === "spread" ? "#ff64c2" : scene.me.color;

      drawBox(weaponAt(39, 18, -18), [40, 13, 14], "#111b25", 4, scene.angle);
      drawBox(weaponAt(43, 18, -13), [25, 4, 15], accent, 2, scene.angle);
      drawBox(weaponAt(66, 18, -18), [31, 6, 7], "#182632", 4, scene.angle);
      drawBox(weaponAt(82, 18, -18), [8, 8, 9], accent, 2, scene.angle);
      drawBox(weaponAt(22, 18, -18), [17, 10, 18], "#0b1119", 4, scene.angle);
      drawBox(weaponAt(37, 18, -28), [10, 23, 10], "#0a1018", 4, scene.angle);
      drawBox(weaponAt(45, 18, -6), [12, 7, 10], accent, 2, scene.angle);
      drawBox(weaponAt(49, 18, -1), [16, 3.5, 4], "#0b1119", 4, scene.angle);
      drawBox(weaponAt(31, 9, -26), [12, 13, 10], scene.me.color, 4, scene.angle);

      if (scene.muzzle) {
        drawBox(weaponAt(91, 18, -18), [13, 13, 13], "#fff3a0", 2, scene.now * 0.025);
        drawBox(weaponAt(98, 18, -18), [16, 4, 4], accent, 2, scene.angle);
      }
    }

    return { render, gl };
  }

  window.NeonRenderer3D = { create };
})();
