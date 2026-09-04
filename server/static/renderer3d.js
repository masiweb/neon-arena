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

      float fog = smoothstep(690.0, 1450.0, distanceToCamera);
      color = mix(color, vec3(0.035, 0.13, 0.21), fog * 0.72);
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

    const renderPlayer = (player, now) => {
      const yaw = Math.atan2(player.aim?.[1] || 0, player.aim?.[0] || 1);
      const forward = [Math.cos(yaw), Math.sin(yaw)];
      const right = [-forward[1], forward[0]];
      const at = (front, side, height) => [
        player.x + forward[0] * front + right[0] * side,
        height,
        player.y + forward[1] * front + right[1] * side,
      ];
      const stride = Math.sin(now * 0.012 + player.x * 0.025 + player.y * 0.018) * 2.2;
      const accent = player.color;

      drawBox(at(stride, -5.7, 13), [8.5, 26, 9.5], "#121c27", 4, yaw);
      drawBox(at(-stride, 5.7, 13), [8.5, 26, 9.5], "#121c27", 4, yaw);
      drawBox(at(0, -5.7, 4), [10.5, 7, 14], accent, 2, yaw);
      drawBox(at(0, 5.7, 4), [10.5, 7, 14], accent, 2, yaw);
      drawBox(at(0, 0, 36), [25, 25, 14], "#111d28", 4, yaw);
      drawBox(at(5.5, 0, 39), [17, 17, 15.5], accent, 2, yaw);
      drawBox(at(-1, -15, 39), [10, 11, 10], accent, 4, yaw);
      drawBox(at(-1, 15, 39), [10, 11, 10], accent, 4, yaw);
      drawBox(at(8, -16, 34), [23, 6.5, 7], "#192834", 4, yaw);
      drawBox(at(8, 16, 34), [23, 6.5, 7], "#192834", 4, yaw);
      drawBox(at(0, 0, 58), [18, 18, 18], "#14222e", 4, yaw);
      drawBox(at(9.3, 0, 60), [1.5, 9, 13], accent, 2, yaw);
      drawBox(at(2, 0, 69), [20, 3, 20], accent, 2, yaw);
      drawBox(at(20, 13, 38), [32, 7, 8], "#101923", 4, yaw);
      drawBox(at(39, 13, 38), [22, 4.5, 5], accent, 2, yaw);
      drawBox(at(26, 13, 44), [8, 4, 7], accent, 2, yaw);

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
      gl.clearColor(0.018, 0.095, 0.16, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const movement = Math.min(1, Math.hypot(scene.move[0], scene.move[1]));
      const bob = Math.sin(scene.now * 0.0105) * 0.9 * movement;
      const eye = [scene.me.x, 63 + bob, scene.me.y];
      const cp = Math.cos(scene.pitch), sp = Math.sin(scene.pitch);
      const ca = Math.cos(scene.angle), sa = Math.sin(scene.angle);
      const forward = [ca * cp, sp, sa * cp];
      const target = [eye[0] + forward[0] * 120, eye[1] + forward[1] * 120, eye[2] + forward[2] * 120];
      const viewProjection = multiply(
        perspective(Math.PI * 0.405, width / height, 1.8, 1750),
        lookAt(eye, target, [0, 1, 0])
      );
      gl.useProgram(program);
      gl.uniformMatrix4fv(locations.vp, false, viewProjection);
      gl.uniform3fv(locations.camera, eye);
      gl.uniform1f(locations.time, scene.now);

      drawBox([scene.arena.width / 2, -3, scene.arena.height / 2], [scene.arena.width, 6, scene.arena.height], "#131e29", 3);

      const wallColors = ["#273541", "#303945", "#293843", "#343b42"];
      scene.arena.obstacles.forEach((wall, index) => {
        const wallHeight = Math.max(42, Math.min(96, Number(wall.height) || (index % 5 === 2 ? 56 : 76)));
        const color = wallColors[index % wallColors.length];
        const accent = index % 3 === 1 ? "#ff2da6" : "#20d9ff";
        drawBox([wall.x + wall.w / 2, wallHeight / 2, wall.y + wall.h / 2], [wall.w, wallHeight, wall.h], color, 1);
        drawWallEdges(wall, wallHeight, accent);
      });

      const boundaryColor = "#26333e";
      const boundaryHeight = 86;
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
        const colors = { speed:"#ffd52a", health:"#ff4f6f", shield:"#20d9ff", weapon:"#ff2da6", stealth:"#9b66ff" };
        const itemHeight = 22 + Math.sin(scene.now * 0.0045 + item.x) * 4;
        drawBox([item.x, itemHeight, item.y], [19, 19, 19], colors[item.kind] || "#fff", 2, scene.now * 0.0017);
        drawBox([item.x, 3, item.y], [34, 1.2, 34], colors[item.kind] || "#fff", 2, scene.now * -0.001);
      }

      for (const player of scene.players) {
        if (player.id !== scene.me.id && player.alive) renderPlayer(player, scene.now);
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
          drawBox([(x1 + x2) / 2, 48, (z1 + z2) / 2], [length, 1.35, 1.35], color, 2, Math.atan2(dz, dx));
          drawBox([x2, 48, z2], [trace.hit ? 5 : 2.5, trace.hit ? 5 : 2.5, trace.hit ? 5 : 2.5], color, 2, scene.now * 0.01);
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
