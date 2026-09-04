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
    varying float vDistance;
    void main() {
      vec3 p = aPosition * uSize;
      float c = cos(uYaw), s = sin(uYaw);
      vec3 world = vec3(
        uCenter.x + p.x * c - p.z * s,
        uCenter.y + p.y,
        uCenter.z + p.x * s + p.z * c
      );
      vec3 n = vec3(
        aNormal.x * c - aNormal.z * s,
        aNormal.y,
        aNormal.x * s + aNormal.z * c
      );
      vWorld = world;
      vNormal = normalize(n);
      gl_Position = uViewProjection * vec4(world, 1.0);
      vDistance = gl_Position.w;
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
    varying float vDistance;

    float lineGrid(vec2 uv, vec2 cell, float thickness) {
      vec2 edge = min(mod(uv, cell), cell - mod(uv, cell));
      return 1.0 - step(thickness, min(edge.x, edge.y));
    }

    void main() {
      vec3 lightDir = normalize(vec3(-0.45, 0.85, 0.3));
      float diffuse = 0.34 + max(dot(vNormal, lightDir), 0.0) * 0.66;
      vec3 color = uColor * diffuse;
      if (uMaterial > 0.5 && uMaterial < 1.5) {
        vec2 uv = abs(vNormal.y) > 0.6 ? vWorld.xz :
          (abs(vNormal.x) > 0.6 ? vWorld.zy : vWorld.xy);
        float row = floor(uv.y / 18.0);
        uv.x += mod(row, 2.0) * 18.0;
        float mortar = lineGrid(uv, vec2(36.0, 18.0), 1.25);
        float grain = 0.94 + 0.06 * sin(vWorld.x * .19 + vWorld.z * .11);
        color = mix(uColor * diffuse * grain, vec3(.035,.045,.055), mortar * .88);
        float neonBand = 1.0 - smoothstep(1.4, 3.2, abs(mod(vWorld.y, 92.0) - 1.5));
        color += vec3(.02,.55,.72) * neonBand * .22;
      } else if (uMaterial > 1.5 && uMaterial < 2.5) {
        color = uColor * (1.0 + .22 * sin(uTime * .005));
      } else if (uMaterial > 2.5 && uMaterial < 3.5) {
        float grid = lineGrid(vWorld.xz, vec2(52.0), 1.0);
        color = mix(uColor * diffuse, vec3(.02,.28,.36), grid * .5);
      } else if (uMaterial > 3.5) {
        color = mix(uColor * diffuse, vec3(.02,.06,.08), .22);
      }
      float fog = smoothstep(620.0, 1250.0, max(0.0, vDistance));
      color = mix(color, vec3(.12,.42,.60), fog * .45);
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  const CUBE = new Float32Array([
    -0.5,-0.5, 0.5, 0,0,1,  0.5,-0.5, 0.5, 0,0,1,  0.5,0.5,0.5,0,0,1,
    -0.5,-0.5, 0.5, 0,0,1,  0.5, 0.5, 0.5, 0,0,1, -0.5,0.5,0.5,0,0,1,
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

  function shader(gl, type, source) {
    const value = gl.createShader(type);
    gl.shaderSource(value, source);
    gl.compileShader(value);
    if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(value));
    return value;
  }

  function program(gl) {
    const value = gl.createProgram();
    gl.attachShader(value, shader(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(value, shader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(value);
    if (!gl.getProgramParameter(value, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(value));
    return value;
  }

  function multiply(a, b) {
    const out = new Float32Array(16);
    for (let column = 0; column < 4; column++) {
      for (let row = 0; row < 4; row++) {
        out[column * 4 + row] =
          a[row] * b[column * 4] + a[4 + row] * b[column * 4 + 1] +
          a[8 + row] * b[column * 4 + 2] + a[12 + row] * b[column * 4 + 3];
      }
    }
    return out;
  }

  function perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
    return new Float32Array([
      f / aspect,0,0,0, 0,f,0,0, 0,0,(far + near) * nf,-1,
      0,0,2 * far * near * nf,0
    ]);
  }

  function lookAt(eye, target, up) {
    let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
    let length = Math.hypot(zx, zy, zz) || 1; zx/=length; zy/=length; zz/=length;
    let xx = up[1]*zz-up[2]*zy, xy = up[2]*zx-up[0]*zz, xz = up[0]*zy-up[1]*zx;
    length = Math.hypot(xx,xy,xz) || 1; xx/=length; xy/=length; xz/=length;
    const yx = zy*xz-zz*xy, yy = zz*xx-zx*xz, yz = zx*xy-zy*xx;
    return new Float32Array([
      xx,yx,zx,0, xy,yy,zy,0, xz,yz,zz,0,
      -(xx*eye[0]+xy*eye[1]+xz*eye[2]),
      -(yx*eye[0]+yy*eye[1]+yz*eye[2]),
      -(zx*eye[0]+zy*eye[1]+zz*eye[2]),1
    ]);
  }

  function rgb(hex) {
    const value = parseInt(String(hex || "#20d9ff").replace("#", ""), 16);
    return [(value >> 16 & 255) / 255, (value >> 8 & 255) / 255, (value & 255) / 255];
  }

  function create(canvas) {
    let gl;
    try { gl = canvas.getContext("webgl", { alpha:false, antialias:true, depth:true, powerPreference:"high-performance" }); }
    catch { return null; }
    if (!gl) return null;
    const p = program(gl);
    const locations = {
      position: gl.getAttribLocation(p, "aPosition"), normal: gl.getAttribLocation(p, "aNormal"),
      vp: gl.getUniformLocation(p, "uViewProjection"), center: gl.getUniformLocation(p, "uCenter"),
      size: gl.getUniformLocation(p, "uSize"), yaw: gl.getUniformLocation(p, "uYaw"),
      color: gl.getUniformLocation(p, "uColor"), material: gl.getUniformLocation(p, "uMaterial"),
      camera: gl.getUniformLocation(p, "uCamera"), time: gl.getUniformLocation(p, "uTime")
    };
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, CUBE, gl.STATIC_DRAW);
    gl.useProgram(p);
    gl.enableVertexAttribArray(locations.position); gl.vertexAttribPointer(locations.position,3,gl.FLOAT,false,24,0);
    gl.enableVertexAttribArray(locations.normal); gl.vertexAttribPointer(locations.normal,3,gl.FLOAT,false,24,12);
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);

    const drawBox = (center, size, color, material=0, yaw=0) => {
      gl.uniform3fv(locations.center, center); gl.uniform3fv(locations.size, size);
      gl.uniform1f(locations.yaw, yaw); gl.uniform3fv(locations.color, rgb(color));
      gl.uniform1f(locations.material, material); gl.drawArrays(gl.TRIANGLES, 0, 36);
    };

    const renderPlayer = (player, now) => {
      const yaw = Math.atan2(player.aim?.[1] || 0, player.aim?.[0] || 1);
      const stride = Math.sin(now * .014 + player.x * .02) * 3;
      const color = player.color;
      drawBox([player.x-5,15,player.y], [8,30,9], color, 2, yaw + stride*.002);
      drawBox([player.x+5,15,player.y], [8,30,9], color, 2, yaw - stride*.002);
      drawBox([player.x,42,player.y], [24,30,14], "#101923", 4, yaw);
      drawBox([player.x,43,player.y-7], [20,22,3], color, 2, yaw);
      drawBox([player.x,66,player.y], [17,17,17], color, 2, yaw);
      const sideX = Math.cos(yaw + Math.PI/2), sideZ = Math.sin(yaw + Math.PI/2);
      const forwardX = Math.cos(yaw), forwardZ = Math.sin(yaw);
      drawBox([player.x+sideX*16+forwardX*5,43,player.y+sideZ*16+forwardZ*5], [9,10,32], color, 2, yaw+Math.PI/2);
      drawBox([player.x+forwardX*22,45,player.y+forwardZ*22], [34,6,7], "#162330", 4, yaw);
      if (player.shield) {
        drawBox([player.x,82,player.y], [42,2,42], "#71efff", 2, yaw);
        drawBox([player.x,4,player.y], [42,2,42], "#71efff", 2, yaw);
      }
    };

    function render(scene) {
      const dpr = Math.min(window.devicePixelRatio || 1, innerWidth < 900 ? 1.35 : 1.6);
      const width = Math.max(1, Math.round(innerWidth*dpr)), height = Math.max(1,Math.round(innerHeight*dpr));
      if (canvas.width!==width || canvas.height!==height) { canvas.width=width; canvas.height=height; canvas.style.width=`${innerWidth}px`; canvas.style.height=`${innerHeight}px`; }
      gl.viewport(0,0,width,height); gl.clearColor(.08,.39,.62,1); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      const moveAmount = Math.min(1,Math.hypot(scene.move[0],scene.move[1]));
      const bob = Math.sin(scene.now*.011)*1.5*moveAmount;
      const eye = [scene.me.x,54+bob,scene.me.y];
      const cp=Math.cos(scene.pitch), sp=Math.sin(scene.pitch), ca=Math.cos(scene.angle), sa=Math.sin(scene.angle);
      const forward=[ca*cp,sp,sa*cp];
      const target=[eye[0]+forward[0]*100,eye[1]+forward[1]*100,eye[2]+forward[2]*100];
      const vp=multiply(perspective(Math.PI*.39,width/height,2,1800),lookAt(eye,target,[0,1,0]));
      gl.useProgram(p); gl.uniformMatrix4fv(locations.vp,false,vp); gl.uniform3fv(locations.camera,eye); gl.uniform1f(locations.time,scene.now);
      drawBox([scene.arena.width/2,-4,scene.arena.height/2],[scene.arena.width,8,scene.arena.height],"#1c2934",3);
      const wallColors=["#a8adb0","#bcb49f","#8f9ba3","#b6ab91"];
      scene.arena.obstacles.forEach((wall,index)=>{
        const wallHeight=index%7===2 ? 72 : 108;
        drawBox([wall.x+wall.w/2,wallHeight/2,wall.y+wall.h/2],[wall.w,wallHeight,wall.h],wallColors[index%wallColors.length],1);
      });
      drawBox([scene.arena.width/2,58,-7],[scene.arena.width+24,116,14],"#939da3",1);
      drawBox([scene.arena.width/2,58,scene.arena.height+7],[scene.arena.width+24,116,14],"#939da3",1);
      drawBox([-7,58,scene.arena.height/2],[14,116,scene.arena.height],"#a89f8b",1);
      drawBox([scene.arena.width+7,58,scene.arena.height/2],[14,116,scene.arena.height],"#a89f8b",1);

      for (const item of scene.powerups) {
        const colors={speed:"#ffd52a",health:"#ff4f6f",shield:"#20d9ff",weapon:"#ff2da6",stealth:"#9b66ff"};
        drawBox([item.x,25+Math.sin(scene.now*.004+item.x)*5,item.y],[22,22,22],colors[item.kind]||"#fff",2,scene.now*.0015);
      }
      for (const player of scene.players) if (player.id!==scene.me.id && player.alive) renderPlayer(player,scene.now);
      for (const trace of scene.traces) {
        const x1=trace.x1??trace.x, z1=trace.y1??trace.y;
        const x2=trace.x2??(trace.x+(trace.vx||0)*.12), z2=trace.y2??(trace.y+(trace.vy||0)*.12);
        const dx=x2-x1,dz=z2-z1,length=Math.hypot(dx,dz);
        if (length>0) drawBox([(x1+x2)/2,48,(z1+z2)/2],[length,1.5,1.5],trace.color||"#fff",2,Math.atan2(dz,dx));
      }

      gl.clear(gl.DEPTH_BUFFER_BIT);
      const right=[-sa,0,ca], gunBase=[eye[0]+forward[0]*43+right[0]*22,eye[1]-20+forward[1]*15,eye[2]+forward[2]*43+right[2]*22];
      const recoil=scene.shooting ? Math.max(0,Math.sin(scene.now*.055))*4 : 0;
      const accent=scene.me.weapon==="heavy"?"#ffd45e":scene.me.weapon==="rapid"?"#9dff24":scene.me.weapon==="spread"?"#ff64c2":scene.me.color;
      drawBox([gunBase[0]-forward[0]*recoil,gunBase[1]-recoil*.3,gunBase[2]-forward[2]*recoil],[42,12,13],"#101820",4,scene.angle);
      drawBox([gunBase[0]+forward[0]*28,gunBase[1]+2,gunBase[2]+forward[2]*28],[30,7,8],accent,4,scene.angle);
      drawBox([gunBase[0]-forward[0]*5,gunBase[1]-12,gunBase[2]-forward[2]*5],[10,22,10],"#090e14",4,scene.angle);
      drawBox([gunBase[0]+forward[0]*5,gunBase[1]+11,gunBase[2]+forward[2]*5],[14,8,8],accent,2,scene.angle);
    }
    return { render, gl };
  }

  window.NeonRenderer3D = { create };
})();
