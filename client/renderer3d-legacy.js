(() => {
  "use strict";

  /*
   * Lightweight procedural FPS renderer.
   *
   * All geometry and materials are generated in the client so the same
   * renderer works offline inside the APK and in desktop browsers without
   * downloading models or textures.  Curved meshes, physically-inspired
   * lighting, material detail and distance LOD replace the old cube-only
   * neon renderer while keeping draw cost suitable for mobile WebView.
   */

  const PI = Math.PI;
  const TAU = PI * 2;

  const VERTEX_SHADER = [
    "attribute vec3 aPosition;",
    "attribute vec3 aNormal;",
    "uniform mat4 uViewProjection;",
    "uniform vec3 uCenter;",
    "uniform vec3 uSize;",
    "uniform vec3 uRotation;",
    "varying vec3 vWorld;",
    "varying vec3 vNormal;",
    "varying vec3 vLocal;",
    "vec3 rotateX(vec3 p, float a) { float c=cos(a), s=sin(a); return vec3(p.x, p.y*c-p.z*s, p.y*s+p.z*c); }",
    "vec3 rotateZ(vec3 p, float a) { float c=cos(a), s=sin(a); return vec3(p.x*c-p.y*s, p.x*s+p.y*c, p.z); }",
    "vec3 rotateY(vec3 p, float a) { float c=cos(a), s=sin(a); return vec3(p.x*c-p.z*s, p.y, p.x*s+p.z*c); }",
    "void main() {",
    "  vec3 p = aPosition * uSize;",
    "  vLocal = p;",
    "  p = rotateX(p, uRotation.y);",
    "  p = rotateZ(p, uRotation.z);",
    "  p = rotateY(p, uRotation.x);",
    "  vec3 n = rotateX(aNormal, uRotation.y);",
    "  n = rotateZ(n, uRotation.z);",
    "  n = rotateY(n, uRotation.x);",
    "  vNormal = normalize(n);",
    "  vWorld = uCenter + p;",
    "  gl_Position = uViewProjection * vec4(vWorld, 1.0);",
    "}"
  ].join("\n");

  const FRAGMENT_SHADER = [
    "precision highp float;",
    "uniform vec3 uColor;",
    "uniform vec3 uAccent;",
    "uniform vec3 uFog;",
    "uniform vec3 uCamera;",
    "uniform vec3 uSun;",
    "uniform float uMaterial;",
    "uniform float uRoughness;",
    "uniform float uTime;",
    "uniform float uAlpha;",
    "varying vec3 vWorld;",
    "varying vec3 vNormal;",
    "varying vec3 vLocal;",
    "float hash21(vec2 p) { p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }",
    "float lineMask(float value, float spacing, float width) { float m=abs(fract(value/spacing)-0.5)*spacing; return 1.0-smoothstep(width,width+0.7,m); }",
    "float brickMortar(vec2 p) {",
    "  float row=floor(p.y/16.0);",
    "  p.x += mod(row,2.0)*17.0;",
    "  vec2 cell=mod(p,vec2(34.0,16.0));",
    "  float edge=min(min(cell.x,34.0-cell.x),min(cell.y,16.0-cell.y));",
    "  return 1.0-smoothstep(1.0,1.9,edge);",
    "}",
    "void main() {",
    "  vec3 n=normalize(vNormal);",
    "  vec3 lightDir=normalize(vec3(-0.46,0.82,0.34));",
    "  vec3 viewDir=normalize(uCamera-vWorld);",
    "  vec3 halfDir=normalize(lightDir+viewDir);",
    "  float ndl=max(dot(n,lightDir),0.0);",
    "  float ambient=0.25+0.10*max(n.y,0.0);",
    "  float rough=clamp(uRoughness,0.08,1.0);",
    "  float spec=pow(max(dot(n,halfDir),0.0),mix(72.0,7.0,rough))*mix(0.58,0.08,rough);",
    "  vec3 base=uColor;",
    "  float emissive=0.0;",
    "  vec2 planar=abs(n.y)>0.66?vWorld.xz:(abs(n.x)>0.66?vWorld.zy:vWorld.xy);",
    "  if (uMaterial>0.5 && uMaterial<1.5) {",
    "    float mortar=brickMortar(planar);",
    "    float variation=0.82+hash21(floor(planar/vec2(34.0,16.0)))*0.25;",
    "    base=mix(uColor*variation,vec3(0.19,0.19,0.18),mortar*0.88);",
    "  } else if (uMaterial>1.5 && uMaterial<2.5) {",
    "    float grit=hash21(floor(planar*0.24))*0.14;",
    "    float seam=max(lineMask(planar.x,90.0,0.65),lineMask(planar.y,90.0,0.65));",
    "    base=uColor*(0.91+grit)-seam*0.055;",
    "  } else if (uMaterial>2.5 && uMaterial<3.5) {",
    "    float brushed=0.88+0.12*sin(planar.y*1.7+hash21(floor(planar))*2.0);",
    "    float rust=smoothstep(0.83,0.98,hash21(floor(planar/8.0)));",
    "    base=mix(uColor*brushed,vec3(0.27,0.12,0.055),rust*0.52);",
    "  } else if (uMaterial>3.5 && uMaterial<4.5) {",
    "    float grain=0.86+0.14*sin(planar.x*0.17+sin(planar.y*0.06)*2.0);",
    "    float plank=lineMask(planar.y,22.0,0.9);",
    "    base=uColor*grain-plank*0.10;",
    "  } else if (uMaterial>4.5 && uMaterial<5.5) {",
    "    float aggregate=hash21(floor(vWorld.xz*0.32))*0.13;",
    "    float crack=max(lineMask(vWorld.x+sin(vWorld.z*0.017)*6.0,280.0,0.45),lineMask(vWorld.z,310.0,0.38));",
    "    base=uColor*(0.89+aggregate)-crack*0.085;",
    "  } else if (uMaterial>5.5 && uMaterial<6.5) {",
    "    base=uColor*(1.18+0.20*sin(uTime*0.005+vWorld.x*0.035+vWorld.z*0.029));",
    "    emissive=1.0;",
    "  } else if (uMaterial>6.5 && uMaterial<7.5) {",
    "    float fresnel=pow(1.0-max(dot(n,viewDir),0.0),2.1);",
    "    base=mix(uColor,uAccent,0.28+fresnel*0.55);",
    "    spec+=0.34;",
    "  } else if (uMaterial>7.5 && uMaterial<8.5) {",
    "    float weave=0.94+0.05*sin(planar.x*1.5)*sin(planar.y*1.5);",
    "    base=uColor*weave;",
    "  } else if (uMaterial>8.5 && uMaterial<9.5) {",
    "    float grit=hash21(floor(planar*0.21))*0.11;",
    "    base=uColor*(0.91+grit);",
    "    if (abs(n.y)<0.55) {",
    "      vec2 cell=mod(vLocal.xy+vec2(5000.0),vec2(46.0,36.0));",
    "      float window=step(8.0,cell.x)*step(cell.x,37.0)*step(9.0,cell.y)*step(cell.y,27.0);",
    "      float lit=step(0.72,hash21(floor((vLocal.xy+vec2(5000.0))/vec2(46.0,36.0))));",
    "      base=mix(base,vec3(0.035,0.075,0.095)+uAccent*lit*0.34,window*0.78);",
    "    }",
    "  } else if (uMaterial>9.5) {",
    "    vec3 direction=normalize(vWorld-uCamera);",
    "    float horizon=1.0-smoothstep(-0.08,0.42,direction.y);",
    "    float cloudWave=sin(direction.x*19.0+sin(direction.z*11.0)*2.4)+sin(direction.z*27.0-direction.x*8.0);",
    "    float clouds=smoothstep(1.1,1.72,cloudWave)*smoothstep(0.02,0.35,direction.y);",
    "    float sunDisk=smoothstep(0.994,0.999,dot(direction,normalize(vec3(-0.46,0.34,0.82))));",
    "    vec3 sky=mix(uColor,uAccent,horizon*0.72);",
    "    sky=mix(sky,vec3(0.88,0.90,0.88),clouds*0.24);",
    "    sky+=uSun*sunDisk*0.78;",
    "    gl_FragColor=vec4(sky,1.0);",
    "    return;",
    "  }",
    "  vec3 litColor=base*(ambient+ndl*0.76)*uSun+vec3(spec);",
    "  litColor+=uAccent*emissive*0.66;",
    "  float distanceToCamera=length(vWorld-uCamera);",
    "  float fogAmount=smoothstep(1100.0,3950.0,distanceToCamera);",
    "  litColor=mix(litColor,uFog,fogAmount*0.82);",
    "  litColor=litColor/(litColor+vec3(0.55));",
    "  litColor=pow(max(litColor,vec3(0.0)),vec3(0.88));",
    "  gl_FragColor=vec4(litColor,uAlpha);",
    "}"
  ].join("\n");

  function pushVertex(data, point, normal) {
    data.push(point[0], point[1], point[2], normal[0], normal[1], normal[2]);
  }

  function pushTriangle(data, a, b, c, na, nb, nc) {
    pushVertex(data, a, na);
    pushVertex(data, b, nb);
    pushVertex(data, c, nc);
  }

  function cubeMesh() {
    const data = [];
    const faces = [
      [[-0.5,-0.5,0.5],[0.5,-0.5,0.5],[0.5,0.5,0.5],[-0.5,0.5,0.5],[0,0,1]],
      [[0.5,-0.5,-0.5],[-0.5,-0.5,-0.5],[-0.5,0.5,-0.5],[0.5,0.5,-0.5],[0,0,-1]],
      [[-0.5,-0.5,-0.5],[-0.5,-0.5,0.5],[-0.5,0.5,0.5],[-0.5,0.5,-0.5],[-1,0,0]],
      [[0.5,-0.5,0.5],[0.5,-0.5,-0.5],[0.5,0.5,-0.5],[0.5,0.5,0.5],[1,0,0]],
      [[-0.5,0.5,0.5],[0.5,0.5,0.5],[0.5,0.5,-0.5],[-0.5,0.5,-0.5],[0,1,0]],
      [[-0.5,-0.5,-0.5],[0.5,-0.5,-0.5],[0.5,-0.5,0.5],[-0.5,-0.5,0.5],[0,-1,0]]
    ];
    for (const face of faces) {
      pushTriangle(data, face[0], face[1], face[2], face[4], face[4], face[4]);
      pushTriangle(data, face[0], face[2], face[3], face[4], face[4], face[4]);
    }
    return new Float32Array(data);
  }

  function cylinderMesh(sides) {
    const data = [];
    for (let index=0; index<sides; index+=1) {
      const a=index/sides*TAU, b=(index+1)/sides*TAU;
      const ca=Math.cos(a)*0.5, sa=Math.sin(a)*0.5;
      const cb=Math.cos(b)*0.5, sb=Math.sin(b)*0.5;
      const na=[Math.cos(a),0,Math.sin(a)], nb=[Math.cos(b),0,Math.sin(b)];
      pushTriangle(data,[ca,-0.5,sa],[cb,-0.5,sb],[cb,0.5,sb],na,nb,nb);
      pushTriangle(data,[ca,-0.5,sa],[cb,0.5,sb],[ca,0.5,sa],na,nb,na);
      pushTriangle(data,[0,0.5,0],[ca,0.5,sa],[cb,0.5,sb],[0,1,0],[0,1,0],[0,1,0]);
      pushTriangle(data,[0,-0.5,0],[cb,-0.5,sb],[ca,-0.5,sa],[0,-1,0],[0,-1,0],[0,-1,0]);
    }
    return new Float32Array(data);
  }

  function coneMesh(sides) {
    const data = [];
    for (let index=0; index<sides; index+=1) {
      const a=index/sides*TAU, b=(index+1)/sides*TAU;
      const ca=Math.cos(a)*0.5, sa=Math.sin(a)*0.5;
      const cb=Math.cos(b)*0.5, sb=Math.sin(b)*0.5;
      const mid=(a+b)*0.5;
      const normal=[Math.cos(mid)*0.88,0.47,Math.sin(mid)*0.88];
      pushTriangle(data,[ca,-0.5,sa],[cb,-0.5,sb],[0,0.5,0],normal,normal,normal);
      pushTriangle(data,[0,-0.5,0],[cb,-0.5,sb],[ca,-0.5,sa],[0,-1,0],[0,-1,0],[0,-1,0]);
    }
    return new Float32Array(data);
  }

  function sphereMesh(rows, columns) {
    const data = [];
    function point(row, column) {
      const latitude=-PI/2+row/rows*PI;
      const longitude=column/columns*TAU;
      const normal=[Math.cos(latitude)*Math.cos(longitude),Math.sin(latitude),Math.cos(latitude)*Math.sin(longitude)];
      return { point:[normal[0]*0.5,normal[1]*0.5,normal[2]*0.5], normal };
    }
    for (let row=0; row<rows; row+=1) {
      for (let column=0; column<columns; column+=1) {
        const a=point(row,column), b=point(row,column+1);
        const c=point(row+1,column+1), d=point(row+1,column);
        pushTriangle(data,a.point,b.point,c.point,a.normal,b.normal,c.normal);
        pushTriangle(data,a.point,c.point,d.point,a.normal,c.normal,d.normal);
      }
    }
    return new Float32Array(data);
  }

  function compileShader(gl, type, source) {
    const shader=gl.createShader(type);
    gl.shaderSource(shader,source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) {
      const message=gl.getShaderInfoLog(shader) || "WebGL shader compilation failed";
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function createProgram(gl) {
    const program=gl.createProgram();
    const vertex=compileShader(gl,gl.VERTEX_SHADER,VERTEX_SHADER);
    let fragment;
    try {
      fragment=compileShader(gl,gl.FRAGMENT_SHADER,FRAGMENT_SHADER);
    } catch (highPrecisionError) {
      // Fragment highp is optional in WebGL 1.  Older Android GPUs receive the
      // same renderer at medium precision instead of crashing the WebView.
      fragment=compileShader(gl,gl.FRAGMENT_SHADER,FRAGMENT_SHADER.replace("precision highp float;","precision mediump float;"));
    }
    gl.attachShader(program,vertex);
    gl.attachShader(program,fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program,gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || "WebGL program link failed");
    }
    return program;
  }

  function multiply(a,b) {
    const out=new Float32Array(16);
    for (let column=0; column<4; column+=1) {
      for (let row=0; row<4; row+=1) {
        out[column*4+row]=a[row]*b[column*4]+a[4+row]*b[column*4+1]+a[8+row]*b[column*4+2]+a[12+row]*b[column*4+3];
      }
    }
    return out;
  }

  function perspective(fov,aspect,near,far) {
    const f=1/Math.tan(fov/2), range=1/(near-far);
    return new Float32Array([
      f/aspect,0,0,0,
      0,f,0,0,
      0,0,(far+near)*range,-1,
      0,0,2*far*near*range,0
    ]);
  }

  function lookAt(eye,target,up) {
    let zx=eye[0]-target[0], zy=eye[1]-target[1], zz=eye[2]-target[2];
    let length=Math.hypot(zx,zy,zz)||1;
    zx/=length; zy/=length; zz/=length;
    let xx=up[1]*zz-up[2]*zy, xy=up[2]*zx-up[0]*zz, xz=up[0]*zy-up[1]*zx;
    length=Math.hypot(xx,xy,xz)||1;
    xx/=length; xy/=length; xz/=length;
    const yx=zy*xz-zz*xy, yy=zz*xx-zx*xz, yz=zx*xy-zy*xx;
    return new Float32Array([
      xx,yx,zx,0,
      xy,yy,zy,0,
      xz,yz,zz,0,
      -(xx*eye[0]+xy*eye[1]+xz*eye[2]),
      -(yx*eye[0]+yy*eye[1]+yz*eye[2]),
      -(zx*eye[0]+zy*eye[1]+zz*eye[2]),1
    ]);
  }

  function rgb(hex) {
    const clean=String(hex || "#ffffff").replace("#","");
    const expanded=clean.length===3?clean.split("").map((part)=>part+part).join(""):clean;
    const value=parseInt(expanded,16);
    if (!Number.isFinite(value)) return [1,1,1];
    return [(value>>16&255)/255,(value>>8&255)/255,(value&255)/255];
  }

  function shade(hex,amount) {
    const source=rgb(hex);
    return source.map((value)=>Math.max(0,Math.min(1,value*amount)));
  }

  function nearestDistance(rect,x,z) {
    const nearestX=Math.max(rect.x,Math.min(x,rect.x+rect.w));
    const nearestZ=Math.max(rect.y,Math.min(z,rect.y+rect.h));
    return Math.hypot(nearestX-x,nearestZ-z);
  }

  function create(canvas) {
    let gl;
    try {
      gl=canvas.getContext("webgl",{
        alpha:false,
        antialias:true,
        depth:true,
        powerPreference:"high-performance",
        preserveDrawingBuffer:false
      });
    } catch (error) {
      return null;
    }
    if (!gl) return null;

    const program=createProgram(gl);
    const locations={
      position:gl.getAttribLocation(program,"aPosition"),
      normal:gl.getAttribLocation(program,"aNormal"),
      vp:gl.getUniformLocation(program,"uViewProjection"),
      center:gl.getUniformLocation(program,"uCenter"),
      size:gl.getUniformLocation(program,"uSize"),
      rotation:gl.getUniformLocation(program,"uRotation"),
      color:gl.getUniformLocation(program,"uColor"),
      accent:gl.getUniformLocation(program,"uAccent"),
      fog:gl.getUniformLocation(program,"uFog"),
      camera:gl.getUniformLocation(program,"uCamera"),
      sun:gl.getUniformLocation(program,"uSun"),
      material:gl.getUniformLocation(program,"uMaterial"),
      roughness:gl.getUniformLocation(program,"uRoughness"),
      time:gl.getUniformLocation(program,"uTime"),
      alpha:gl.getUniformLocation(program,"uAlpha")
    };

    const meshSources={
      cube:cubeMesh(),
      cylinder:cylinderMesh(12),
      cylinderSmooth:cylinderMesh(18),
      cone:coneMesh(14),
      sphere:sphereMesh(8,12)
    };
    const meshes={};
    Object.keys(meshSources).forEach((name)=>{
      const buffer=gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.bufferData(gl.ARRAY_BUFFER,meshSources[name],gl.STATIC_DRAW);
      meshes[name]={buffer:buffer,count:meshSources[name].length/6};
    });

    gl.useProgram(program);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);

    let boundMesh=null;
    function bindMesh(name) {
      if (boundMesh===name) return;
      const mesh=meshes[name] || meshes.cube;
      gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);
      gl.enableVertexAttribArray(locations.position);
      gl.vertexAttribPointer(locations.position,3,gl.FLOAT,false,24,0);
      gl.enableVertexAttribArray(locations.normal);
      gl.vertexAttribPointer(locations.normal,3,gl.FLOAT,false,24,12);
      boundMesh=name;
    }

    function drawMesh(name,center,size,color,material,yaw,pitch,roll,accent,roughness,alpha) {
      bindMesh(name);
      gl.uniform3fv(locations.center,center);
      gl.uniform3fv(locations.size,size);
      gl.uniform3f(locations.rotation,yaw||0,pitch||0,roll||0);
      const base=Array.isArray(color)?color:rgb(color);
      const glow=Array.isArray(accent)?accent:rgb(accent || color);
      gl.uniform3fv(locations.color,base);
      gl.uniform3fv(locations.accent,glow);
      gl.uniform1f(locations.material,material||0);
      gl.uniform1f(locations.roughness,roughness===undefined?0.72:roughness);
      const opacity=alpha===undefined?1:alpha;
      gl.uniform1f(locations.alpha,opacity);
      if (opacity<0.995) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
      }
      gl.drawArrays(gl.TRIANGLES,0,(meshes[name] || meshes.cube).count);
      if (opacity<0.995) {
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }
    }

    function box(center,size,color,material,yaw,pitch,roll,accent,roughness,alpha) {
      drawMesh("cube",center,size,color,material,yaw,pitch,roll,accent,roughness,alpha);
    }

    function cylinder(center,size,color,material,yaw,pitch,roll,accent,roughness,alpha,smooth) {
      drawMesh(smooth?"cylinderSmooth":"cylinder",center,size,color,material,yaw,pitch,roll,accent,roughness,alpha);
    }

    function sphere(center,size,color,material,yaw,pitch,roll,accent,roughness,alpha) {
      drawMesh("sphere",center,size,color,material,yaw,pitch,roll,accent,roughness,alpha);
    }

    function cone(center,size,color,material,yaw,pitch,roll,accent,roughness,alpha) {
      drawMesh("cone",center,size,color,material,yaw,pitch,roll,accent,roughness,alpha);
    }

    function segment(a,b,radius,color,material,accent,roughness,smooth) {
      const dx=b[0]-a[0], dy=b[1]-a[1], dz=b[2]-a[2];
      const length=Math.hypot(dx,dy,dz);
      if (length<0.01) return;
      const yaw=Math.atan2(dz,dx);
      const roll=-Math.acos(Math.max(-1,Math.min(1,dy/length)));
      cylinder([(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2],[radius*2,length,radius*2],color,material,yaw,0,roll,accent,roughness,1,smooth);
    }

    function wallMaterial(name) {
      if (name==="brick") return 1;
      if (name==="concrete") return 2;
      if (name==="metal") return 3;
      if (name==="wood") return 4;
      if (name==="glass") return 7;
      if (name==="fabric") return 8;
      return 2;
    }

    function drawCrate(item,theme,index) {
      const cx=item.x+item.w/2, cz=item.y+item.h/2;
      const height=Math.max(45,Number(item.height)||64);
      const wood=theme.wood || "#795438";
      box([cx,height/2,cz],[item.w,height,item.h],wood,4,0,0,0,theme.accent,0.92);
      const brace=shade(wood,0.58);
      box([cx,height*0.5,item.y-0.8],[item.w+3,4,2.4],brace,4,0,0,0,theme.accent,0.9);
      box([cx,height*0.5,item.y-1.5],[Math.max(12,item.w*0.78),4,2.8],brace,4,0,index%2?0.62:-0.62,theme.accent,0.9);
      box([item.x+4,height/2,cz],[4,height+2,item.h+2],brace,4);
      box([item.x+item.w-4,height/2,cz],[4,height+2,item.h+2],brace,4);
    }

    function drawBarrel(item,theme) {
      const cx=item.x+item.w/2, cz=item.y+item.h/2;
      const height=Math.max(48,Number(item.height)||68);
      const diameter=Math.min(item.w,item.h)*0.94;
      cylinder([cx,height/2,cz],[diameter,height,diameter],theme.metal || "#3d484c",3,0,0,0,theme.accent,0.27,1,true);
      cylinder([cx,height*0.18,cz],[diameter*1.05,4,diameter*1.05],"#242b2e",3,0,0,0,theme.accent,0.23,1,true);
      cylinder([cx,height*0.82,cz],[diameter*1.05,4,diameter*1.05],"#242b2e",3,0,0,0,theme.accent,0.23,1,true);
      cylinder([cx,height+1,cz],[diameter*0.96,2,diameter*0.96],theme.accent || "#20d9ff",6,0,0,0,theme.accent,0.15,1,true);
    }

    function drawBarrier(item,theme) {
      const cx=item.x+item.w/2, cz=item.y+item.h/2;
      const height=Math.max(36,Number(item.height)||52);
      const base=theme.wall2 || "#51575a";
      box([cx,height*0.38,cz],[item.w,height*0.76,item.h],base,2,0,0,0,theme.accent,0.95);
      box([cx,height*0.81,cz],[item.w*0.82,height*0.28,item.h*0.78],theme.wall || "#777772",2,0,0,0,theme.accent,0.92);
      box([cx,height+1.2,cz],[item.w*0.86,2.4,item.h*0.82],theme.accent || "#20d9ff",6);
    }

    function drawBuilding(item,theme) {
      const cx=item.x+item.w/2, cz=item.y+item.h/2;
      const height=Math.max(74,Number(item.height)||112);
      box([cx,height/2,cz],[item.w,height,item.h],theme.wall2 || "#50565a",9,0,0,0,theme.accent2 || theme.accent,0.88);
      box([cx,height+3,cz],[item.w+7,6,item.h+7],theme.wall || "#767773",2,0,0,0,theme.accent,0.9);
      const longX=item.w>=item.h;
      if (Math.max(item.w,item.h)>230) {
        const ventX=cx+(longX?item.w*0.22:0);
        const ventZ=cz+(longX?0:item.h*0.22);
        box([ventX,height+10,ventZ],[34,14,24],theme.metal || "#3d464a",3,0,0,0,theme.accent,0.3);
      }
    }

    function drawWall(item,theme) {
      const cx=item.x+item.w/2, cz=item.y+item.h/2;
      const height=Math.max(52,Number(item.height)||108);
      const base=theme.wall || "#77756e";
      const material=wallMaterial(item.material || theme.wallMaterial);
      box([cx,height/2,cz],[item.w,height,item.h],base,material,0,0,0,theme.accent,material===3?0.3:0.92);
      box([cx,2.5,cz],[item.w+5,5,item.h+5],theme.wall2 || "#4b5052",2,0,0,0,theme.accent,0.95);
      box([cx,height+2.2,cz],[item.w+5,4.4,item.h+5],theme.wall2 || "#4b5052",2,0,0,0,theme.accent,0.9);
      if (Math.max(item.w,item.h)>430) {
        const alongX=item.w>=item.h;
        const count=Math.min(4,Math.floor(Math.max(item.w,item.h)/260));
        for (let index=1; index<count; index+=1) {
          const ratio=index/count-0.5;
          const x=cx+(alongX?ratio*item.w:0);
          const z=cz+(alongX?0:ratio*item.h);
          box([x,height*0.39,z],[alongX?8:item.w+6,height*0.78,alongX?item.h+6:8],theme.wall2 || "#4b5052",2);
        }
      }
    }

    function drawObstacle(item,theme,index) {
      if (item.kind==="crate") drawCrate(item,theme,index);
      else if (item.kind==="barrel") drawBarrel(item,theme);
      else if (item.kind==="barrier") drawBarrier(item,theme);
      else if (item.kind==="building") drawBuilding(item,theme);
      else drawWall(item,theme);
    }

    function drawLamp(prop,theme) {
      const height=Number(prop.height)||145;
      cylinder([prop.x,height/2,prop.y],[5,height,5],theme.metal || "#39454a",3,0,0,0,theme.accent,0.24,1,true);
      segment([prop.x,height-8,prop.y],[prop.x+24,height-8,prop.y],3,theme.metal || "#39454a",3,theme.accent,0.25,true);
      cone([prop.x+27,height-12,prop.y],[18,15,18],theme.metal || "#39454a",3,0,0,PI,theme.accent,0.25);
      sphere([prop.x+27,height-18,prop.y],[10,8,10],theme.sun || "#fff1cf",6,0,0,0,theme.accent,0.1);
      cylinder([prop.x,2,prop.y],[20,4,20],theme.wall2 || "#4d5253",2,0,0,0,theme.accent,0.9,1,true);
    }

    function drawProp(prop,theme) {
      if (prop.kind==="lamp") {
        drawLamp(prop,theme);
      } else if (prop.kind==="sign") {
        const height=Number(prop.height)||96;
        cylinder([prop.x,height*0.42,prop.y],[4,height*0.84,4],theme.metal || "#3a4448",3,prop.yaw||0,0,0,theme.accent,0.25,1,true);
        box([prop.x,height,prop.y],[74,31,5],theme.wall2 || "#4b4e50",3,prop.yaw||0,0,0,theme.accent,0.28);
        box([prop.x,height,prop.y-3.1],[62,18,1.4],theme.accent2 || theme.accent || "#20d9ff",6,prop.yaw||0);
      } else if (prop.kind==="pipe") {
        const yaw=Number(prop.yaw)||0;
        const length=Number(prop.length)||140;
        const direction=[Math.cos(yaw)*length/2,0,Math.sin(yaw)*length/2];
        segment([prop.x-direction[0],20,prop.y-direction[2]],[prop.x+direction[0],20,prop.y+direction[2]],8,theme.metal || "#3a4448",3,theme.accent,0.23,true);
        cylinder([prop.x,20,prop.y],[22,5,22],theme.accent || "#20d9ff",6,yaw,0,-PI/2,theme.accent,0.15,1,true);
      } else if (prop.kind==="tank") {
        const height=Number(prop.height)||105;
        cylinder([prop.x,height/2,prop.y],[66,height,66],theme.metal || "#3a4448",3,0,0,0,theme.accent,0.28,1,true);
        sphere([prop.x,height,prop.y],[66,24,66],theme.metal || "#3a4448",3,0,0,0,theme.accent,0.28);
        cylinder([prop.x,height*0.35,prop.y],[72,5,72],theme.accent || "#20d9ff",6,0,0,0,theme.accent,0.15,1,true);
      } else if (prop.kind==="awning") {
        const width=Number(prop.width)||180;
        box([prop.x,78,prop.y],[width,6,92],theme.accent2 || "#a95174",8,0,0,-0.08,theme.accent,0.85);
        cylinder([prop.x-width*0.45,38,prop.y-38],[4,76,4],theme.metal || "#3a4448",3,0,0,0,theme.accent,0.25,1,true);
        cylinder([prop.x+width*0.45,38,prop.y-38],[4,76,4],theme.metal || "#3a4448",3,0,0,0,theme.accent,0.25,1,true);
      }
    }

    function drawRoads(scene,theme,visibility) {
      const sectorWidth=Number(scene.arena.sectorWidth)||3600;
      const sectorHeight=Number(scene.arena.sectorHeight)||2100;
      const roadColor=shade(theme.floor || "#373b3d",0.68);
      const stripe=theme.horizon || "#b8b9ad";
      for (let x=sectorWidth; x<scene.arena.width; x+=sectorWidth) {
        if (Math.abs(scene.me.x-x)>visibility) continue;
        box([x,0.35,scene.me.y],[96,0.7,Math.min(visibility*2.2,scene.arena.height)],roadColor,5);
        const first=Math.max(35,Math.floor((scene.me.y-visibility)/105)*105);
        const last=Math.min(scene.arena.height-35,scene.me.y+visibility);
        for (let z=first; z<last; z+=105) box([x,0.85,z],[4,1,52],stripe,6);
      }
      for (let z=sectorHeight; z<scene.arena.height; z+=sectorHeight) {
        if (Math.abs(scene.me.y-z)>visibility) continue;
        box([scene.me.x,0.38,z],[Math.min(visibility*2.2,scene.arena.width),0.75,96],roadColor,5);
        const first=Math.max(35,Math.floor((scene.me.x-visibility)/105)*105);
        const last=Math.min(scene.arena.width-35,scene.me.x+visibility);
        for (let x=first; x<last; x+=105) box([x,0.9,z],[52,1,4],stripe,6);
      }
    }

    function playerPoint(player,yaw,front,side,height) {
      const forwardX=Math.cos(yaw), forwardZ=Math.sin(yaw);
      const rightX=-forwardZ, rightZ=forwardX;
      return [
        player.x+forwardX*front+rightX*side,
        (Number(player.z)||0)+height,
        player.y+forwardZ*front+rightZ*side
      ];
    }

    function drawDistantPlayer(player,now) {
      const yaw=Math.atan2((player.aim && player.aim[1])||0,(player.aim && player.aim[0])||1);
      const base=playerPoint(player,yaw,0,0,0);
      cylinder([base[0],base[1]+33,base[2]],[26,52,18],"#30373b",8,yaw,0,0,player.color,0.9,1,true);
      sphere([base[0],base[1]+65,base[2]],[19,21,19],"#957963",0,yaw,0,0,player.color,0.78);
      box(playerPoint(player,yaw,20,8,43),[47,6,8],"#20272a",3,yaw,0,0,player.color,0.22);
      box(playerPoint(player,yaw,44,8,43),[22,3,4],player.color,6,yaw);
      if (player.shield) sphere([base[0],base[1]+37,base[2]],[52,78,52],"#7addec",7,0,0,0,player.color,0.1,0.22);
    }

    function drawPlayer(player,now,detailed) {
      if (!detailed) {
        drawDistantPlayer(player,now);
        return;
      }
      const aim=player.aim || [1,0];
      const yaw=Math.atan2(aim[1]||0,aim[0]||1);
      const moving=player.moving!==false;
      const stride=moving?Math.sin(now*0.011+player.x*0.018+player.y*0.014)*6.5:0;
      const armor="#344149", fabric="#20292e", boot="#151b1e", skin="#967864";
      const leftHip=playerPoint(player,yaw,0,-6.5,36);
      const rightHip=playerPoint(player,yaw,0,6.5,36);
      const leftKnee=playerPoint(player,yaw,stride*0.52,-6.5,21);
      const rightKnee=playerPoint(player,yaw,-stride*0.52,6.5,21);
      const leftAnkle=playerPoint(player,yaw,-stride,-6.5,5);
      const rightAnkle=playerPoint(player,yaw,stride,6.5,5);

      segment(leftHip,leftKnee,5.4,fabric,8,player.color,0.92,true);
      segment(leftKnee,leftAnkle,5,armor,8,player.color,0.82,true);
      segment(rightHip,rightKnee,5.4,fabric,8,player.color,0.92,true);
      segment(rightKnee,rightAnkle,5,armor,8,player.color,0.82,true);
      sphere(leftKnee,[11,11,11],armor,3,0,0,0,player.color,0.32);
      sphere(rightKnee,[11,11,11],armor,3,0,0,0,player.color,0.32);
      box(playerPoint(player,yaw,3,-6.5,3.8),[17,8,10],boot,3,yaw,0,0,player.color,0.28);
      box(playerPoint(player,yaw,3,6.5,3.8),[17,8,10],boot,3,yaw,0,0,player.color,0.28);

      box(playerPoint(player,yaw,0,0,43),[25,25,17],fabric,8,yaw,0,0,player.color,0.86);
      box(playerPoint(player,yaw,5,0,45),[18,18,18],armor,3,yaw,0,0,player.color,0.28);
      box(playerPoint(player,yaw,14,0,46),[3,12,14],player.color,6,yaw);
      box(playerPoint(player,yaw,-8,0,44),[11,23,20],"#263138",3,yaw,0,0,player.color,0.31);
      sphere(playerPoint(player,yaw,0,-14,50),[13,13,13],armor,3,yaw,0,0,player.color,0.28);
      sphere(playerPoint(player,yaw,0,14,50),[13,13,13],armor,3,yaw,0,0,player.color,0.28);

      const leftShoulder=playerPoint(player,yaw,2,-15,49);
      const rightShoulder=playerPoint(player,yaw,2,15,49);
      const leftElbow=playerPoint(player,yaw,15,-17,40);
      const rightElbow=playerPoint(player,yaw,16,16,40);
      const leftHand=playerPoint(player,yaw,27,-8,42);
      const rightHand=playerPoint(player,yaw,29,9,42);
      segment(leftShoulder,leftElbow,4.7,fabric,8,player.color,0.9,true);
      segment(leftElbow,leftHand,4.2,armor,8,player.color,0.78,true);
      segment(rightShoulder,rightElbow,4.7,fabric,8,player.color,0.9,true);
      segment(rightElbow,rightHand,4.2,armor,8,player.color,0.78,true);
      sphere(leftHand,[8,8,8],skin,0);
      sphere(rightHand,[8,8,8],skin,0);

      cylinder(playerPoint(player,yaw,0,0,63),[19,20,19],skin,0,yaw,0,0,player.color,0.82,1,true);
      sphere(playerPoint(player,yaw,0,0,69),[21,13,21],armor,3,yaw,0,0,player.color,0.25);
      box(playerPoint(player,yaw,9.5,0,64),[2.2,10,14],"#17282d",7,yaw,0,0,player.color,0.08,0.95);
      box(playerPoint(player,yaw,10.8,0,64),[1.1,4,11],player.color,6,yaw);

      const weaponColor=player.weapon==="heavy"?"#6b5634":player.weapon==="rapid"?"#394c35":player.weapon==="spread"?"#553b4b":"#30393d";
      box(playerPoint(player,yaw,31,8,43),[45,8,9],weaponColor,3,yaw,0,0,player.color,0.22);
      segment(playerPoint(player,yaw,47,8,43),playerPoint(player,yaw,66,8,43),2.5,"#20282b",3,player.color,0.14,true);
      box(playerPoint(player,yaw,25,8,36),[8,15,7],"#20272a",3,yaw,0,-0.18,player.color,0.23);
      box(playerPoint(player,yaw,31,8,49),[13,5,7],"#1b2225",3,yaw,0,0,player.color,0.18);
      box(playerPoint(player,yaw,40,8,43),[18,2,3],player.color,6,yaw);

      if (player.speedBoost) {
        cone(playerPoint(player,yaw,-17,-7,12),[7,31,7],"#ffc94a",6,yaw,0,PI/2,player.color,0.1);
        cone(playerPoint(player,yaw,-17,7,12),[7,31,7],"#ffc94a",6,yaw,0,PI/2,player.color,0.1);
      }
      if (player.shield) {
        const center=playerPoint(player,yaw,0,0,38);
        sphere(center,[54,82,54],"#64cadc",7,0,0,0,player.color,0.08,0.2);
      }
    }

    function drawPowerup(item,now,theme) {
      const colors={speed:"#f5b835",health:"#e84d5b",shield:"#43bed6",weapon:"#d8498c",stealth:"#7656c7",grenade:"#c98d35",rpg:"#d5523d"};
      const color=colors[item.kind] || theme.accent || "#20d9ff";
      const bob=25+Math.sin(now*0.0045+item.x*0.01)*4;
      cylinder([item.x,2,item.y],[38,4,38],"#2b3337",3,0,0,0,color,0.22,1,true);
      cylinder([item.x,5,item.y],[29,2,29],color,6,0,0,0,color,0.1,1,true);
      if (item.kind==="health") {
        box([item.x,bob,item.y],[8,24,8],color,6);
        box([item.x,bob,item.y],[24,8,8],color,6);
      } else if (item.kind==="grenade") {
        sphere([item.x,bob,item.y],[18,18,18],color,3,0,now*0.001,0,color,0.23);
        cylinder([item.x,bob+12,item.y],[7,8,7],"#2a3336",3,0,0,0,color,0.2,1,true);
      } else if (item.kind==="rpg") {
        cylinder([item.x,bob,item.y],[8,28,8],color,3,now*0.001,0,-PI/2,color,0.2,1,true);
        cone([item.x+18,bob,item.y],[11,13,11],color,6,0,0,-PI/2,color,0.1);
      } else if (item.kind==="shield") {
        sphere([item.x,bob,item.y],[24,27,24],color,7,now*0.001,0,0,color,0.08,0.42);
      } else {
        drawMesh("cone",[item.x,bob,item.y],[21,28,21],color,6,now*0.0014,0,0,color,0.1,1);
      }
    }

    function drawProjectile(projectile,now) {
      const y=(Number(projectile.z)||0)+7;
      const yaw=Math.atan2(projectile.vy||0,projectile.vx||1);
      if (projectile.kind==="rpg") {
        segment(
          [projectile.x-Math.cos(yaw)*16,y,projectile.y-Math.sin(yaw)*16],
          [projectile.x+Math.cos(yaw)*17,y,projectile.y+Math.sin(yaw)*17],
          4.5,"#42484a",3,"#ef543c",0.2,true
        );
        cone([projectile.x+Math.cos(yaw)*20,y,projectile.y+Math.sin(yaw)*20],[12,13,12],"#d34b39",3,yaw,0,-PI/2,"#ff8b42",0.25);
        sphere([projectile.x-Math.cos(yaw)*20,y,projectile.y-Math.sin(yaw)*20],[9,9,9],"#ffc45a",6,0,0,0,"#ff6b39",0.1);
      } else {
        sphere([projectile.x,y,projectile.y],[14,14,14],"#48504d",3,now*0.003,0,0,"#ffc14f",0.22);
      }
    }

    function drawExplosion(explosion,now) {
      const life=Math.max(0.04,Math.min(1,(explosion.remaining||0.1)/0.38));
      const radius=(explosion.radius||120)*(1.05-life*0.42);
      const centerY=Math.max(15,Number(explosion.z)||0);
      const color=explosion.kind==="rpg"?"#ef5138":"#f0a932";
      sphere([explosion.x,centerY,explosion.y],[radius*0.33,radius*0.33,radius*0.33],"#fff0a0",6,now*0.01,0,0,color,0.1,0.84);
      sphere([explosion.x,centerY,explosion.y],[radius,radius*0.58,radius],color,7,-now*0.006,0,0,color,0.1,0.2);
      cylinder([explosion.x,2.5,explosion.y],[radius*1.5,5,radius*1.5],color,6,now*0.004,0,0,color,0.1,0.46,true);
    }

    function drawTrace(trace) {
      const x1=trace.x1===undefined?trace.x:trace.x1;
      const z1=trace.y1===undefined?trace.y:trace.y1;
      const x2=trace.x2===undefined?trace.x+(trace.vx||0)*0.12:trace.x2;
      const z2=trace.y2===undefined?trace.y+(trace.vy||0)*0.12:trace.y2;
      const y1=Number(trace.z)||48;
      const y2=Number.isFinite(Number(trace.z2))?Number(trace.z2):y1;
      const color=trace.hit?"#fff2a0":(trace.color||"#ffe3a0");
      segment([x1,y1,z1],[x2,y2,z2],trace.hit?1.7:1.05,color,6,color,0.08,true);
      if (trace.hit) sphere([x2,y2,z2],[7,7,7],"#fff5bc",6,0,0,0,color,0.08);
    }

    function drawBoundaries(scene,theme,visibility) {
      const height=180, thickness=18, color=theme.wall2 || "#4c5254";
      if (scene.me.x<visibility) drawWall({x:-thickness,y:0,w:thickness,h:scene.arena.height,height:height,material:theme.wallMaterial},theme);
      if (scene.arena.width-scene.me.x<visibility) drawWall({x:scene.arena.width,y:0,w:thickness,h:scene.arena.height,height:height,material:theme.wallMaterial},theme);
      if (scene.me.y<visibility) drawWall({x:0,y:-thickness,w:scene.arena.width,h:thickness,height:height,material:theme.wallMaterial},theme);
      if (scene.arena.height-scene.me.y<visibility) drawWall({x:0,y:scene.arena.height,w:scene.arena.width,h:thickness,height:height,material:theme.wallMaterial},theme);
    }

    function drawWeapon(scene,eye,theme) {
      const yaw=scene.angle, pitch=scene.pitch;
      const ca=Math.cos(yaw), sa=Math.sin(yaw);
      const right=[-sa,0,ca];
      const recoil=Math.max(0,Number(scene.recoil)||0);
      function at(front,side,vertical) {
        return [
          eye[0]+ca*(front-recoil)+right[0]*side,
          eye[1]+vertical+Math.sin(pitch)*front,
          eye[2]+sa*(front-recoil)+right[2]*side
        ];
      }
      const accent=scene.me.weapon==="heavy"?"#d7a943":scene.me.weapon==="rapid"?"#70a957":scene.me.weapon==="spread"?"#ba5d8d":(scene.me.color||theme.accent);
      const receiver=scene.me.weapon==="heavy"?"#4a4437":scene.me.weapon==="rapid"?"#35433a":scene.me.weapon==="spread"?"#463840":"#353e42";
      const roll=pitch;
      const rough=0.22;

      // Sleeves and gloved hands anchor the weapon in a human first-person view.
      segment(at(18,2,-28),at(37,10,-18),6.4,"#273137",8,accent,0.86,true);
      segment(at(15,29,-27),at(45,22,-17),6.4,"#273137",8,accent,0.86,true);
      sphere(at(39,10,-17),[13,12,12],"#675f55",8,yaw,0,roll,accent,0.8);
      sphere(at(47,21,-16),[13,12,12],"#675f55",8,yaw,0,roll,accent,0.8);

      box(at(48,17,-16),[48,14,15],receiver,3,yaw,0,roll,accent,rough);
      box(at(47,17,-8),[43,4,14],"#242c30",3,yaw,0,roll,accent,0.18);
      box(at(50,17,-6),[37,2,5],accent,6,yaw,0,roll,accent,0.08);
      box(at(27,17,-16),[18,12,18],"#252d30",3,yaw,0,roll,accent,rough);
      box(at(40,17,-27),[10,23,10],"#22292c",3,yaw,0,roll-0.18,accent,rough);
      box(at(54,17,-27),[10,24,9],"#262d30",3,yaw,0,roll+0.12,accent,rough);
      segment(at(68,17,-16),at(91,17,-16),3.8,"#252d30",3,accent,0.14,true);
      cylinder(at(94,17,-16),[9,13,9],"#171d20",3,yaw,0,roll-PI/2,accent,0.12,1,true);

      if (scene.me.weapon==="heavy") {
        cylinder(at(58,17,-7),[13,30,13],"#20272a",3,yaw,0,roll-PI/2,accent,0.16,1,true);
        box(at(58,17,-31),[18,28,12],"#3f3a31",3,yaw,0,roll,accent,0.28);
      } else if (scene.me.weapon==="rapid") {
        box(at(39,17,-4),[22,5,8],"#222a2d",3,yaw,0,roll,accent,0.18);
        cylinder(at(44,17,0),[8,17,8],"#182024",7,yaw,0,roll-PI/2,accent,0.08,1,true);
      } else if (scene.me.weapon==="spread") {
        segment(at(68,13,-13),at(92,13,-13),3.2,"#242b2e",3,accent,0.14,true);
        segment(at(68,21,-19),at(92,21,-19),3.2,"#242b2e",3,accent,0.14,true);
      }

      if (scene.muzzle) {
        sphere(at(103,17,-16),[17,17,17],"#fff0a0",6,scene.now*0.02,0,0,accent,0.05,0.9);
        cone(at(111,17,-16),[12,23,12],"#ef9f39",6,yaw,0,roll-PI/2,accent,0.05,0.75);
      }
    }

    function render(scene) {
      if (!scene || !scene.me || !scene.arena) return;
      const mobile=matchMedia("(pointer: coarse)").matches || innerWidth<900;
      const dpr=Math.min(window.devicePixelRatio||1,mobile?1.14:1.52);
      const cssWidth=Math.max(1,canvas.clientWidth||innerWidth);
      const cssHeight=Math.max(1,canvas.clientHeight||innerHeight);
      const width=Math.max(1,Math.round(cssWidth*dpr));
      const height=Math.max(1,Math.round(cssHeight*dpr));
      if (canvas.width!==width || canvas.height!==height) {
        canvas.width=width;
        canvas.height=height;
        canvas.style.width=cssWidth+"px";
        canvas.style.height=cssHeight+"px";
      }

      const theme=scene.arena.theme || {};
      const sky=rgb(theme.sky || "#6f8798");
      gl.viewport(0,0,width,height);
      gl.clearColor(sky[0],sky[1],sky[2],1);
      gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);

      const movement=Math.min(1,Math.hypot(scene.move[0],scene.move[1]));
      const bob=Math.sin(scene.now*0.0105)*0.7*movement;
      const eye=[scene.me.x,63+(Number(scene.me.z)||0)+bob,scene.me.y];
      const cp=Math.cos(scene.pitch), sp=Math.sin(scene.pitch);
      const ca=Math.cos(scene.angle), sa=Math.sin(scene.angle);
      const forward=[ca*cp,sp,sa*cp];
      const target=[eye[0]+forward[0]*140,eye[1]+forward[1]*140,eye[2]+forward[2]*140];
      const viewProjection=multiply(
        perspective(PI*0.39,width/height,1.6,mobile?3900:4700),
        lookAt(eye,target,[0,1,0])
      );
      gl.useProgram(program);
      gl.uniformMatrix4fv(locations.vp,false,viewProjection);
      gl.uniform3fv(locations.camera,eye);
      gl.uniform3fv(locations.fog,rgb(theme.fog || "#788b93"));
      gl.uniform3fv(locations.sun,rgb(theme.sun || "#fff0cf"));
      gl.uniform1f(locations.time,scene.now);

      const visibility=mobile?2250:3200;
      drawMesh("sphere",eye,[7200,7200,7200],theme.sky || "#6f8798",10,0,0,0,theme.horizon || "#b2c2ca",1,1);
      box([scene.arena.width/2,-3,scene.arena.height/2],[scene.arena.width,6,scene.arena.height],theme.floor || "#343b3d",5,0,0,0,theme.accent,1);
      drawRoads(scene,theme,visibility);

      const obstacles=Array.isArray(scene.arena.obstacles)?scene.arena.obstacles:[];
      for (let index=0; index<obstacles.length; index+=1) {
        const item=obstacles[index];
        if (nearestDistance(item,scene.me.x,scene.me.y)>visibility) continue;
        drawObstacle(item,theme,index);
      }

      const props=Array.isArray(scene.arena.props)?scene.arena.props:[];
      for (const prop of props) {
        if (Math.hypot(prop.x-scene.me.x,prop.y-scene.me.y)>visibility*0.94) continue;
        drawProp(prop,theme);
      }
      drawBoundaries(scene,theme,visibility);

      for (const item of scene.powerups || []) {
        if (Math.hypot(item.x-scene.me.x,item.y-scene.me.y)<visibility) drawPowerup(item,scene.now,theme);
      }
      for (const player of scene.players || []) {
        if (player.id===scene.me.id || !player.alive) continue;
        const distance=Math.hypot(player.x-scene.me.x,player.y-scene.me.y);
        if (distance<visibility) drawPlayer(player,scene.now,!mobile || distance<920);
      }
      for (const projectile of scene.projectiles || []) {
        if (Math.hypot(projectile.x-scene.me.x,projectile.y-scene.me.y)<visibility) drawProjectile(projectile,scene.now);
      }
      for (const explosion of scene.explosions || []) {
        if (Math.hypot(explosion.x-scene.me.x,explosion.y-scene.me.y)<visibility) drawExplosion(explosion,scene.now);
      }
      for (const trace of scene.traces || []) drawTrace(trace);

      // The weapon is rendered after clearing depth so nearby walls never clip
      // through it, matching a conventional first-person game camera.
      gl.clear(gl.DEPTH_BUFFER_BIT);
      drawWeapon(scene,eye,theme);
    }

    return {render:render,gl:gl};
  }

  window.NeonRenderer3D={create:create};
})();
