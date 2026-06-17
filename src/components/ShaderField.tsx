import { useEffect, useRef } from 'react';

/**
 * ShaderField — a dependency-free WebGL "wallpaper" for the landing page.
 *
 * One full-screen quad, one fragment shader, drawn on a single canvas. It is an
 * order of magnitude lighter than a Three.js scene: no geometry, no lighting,
 * no shadow maps — just a pixel program on the GPU. Five hand-written shaders
 * (selected by `variant`) react to the pointer and spawn ripples on click, so
 * the background feels alive and fun to fidget with. Rendering pauses when the
 * tab is hidden or the canvas scrolls off-screen, and honours reduced motion.
 */

export const WALLPAPERS = [
  { id: 'aurora', label: 'Aurora', hint: 'Flowing light that bends to your cursor' },
  { id: 'liquid', label: 'Liquid', hint: 'Metaball goo — one orb chases the pointer' },
  { id: 'grid', label: 'Grid', hint: 'A neon horizon that tilts as you move' },
  { id: 'warp', label: 'Warp', hint: 'Starfield that steers toward the mouse' },
  { id: 'crystal', label: 'Crystal', hint: 'Living cells that glow near the cursor' },
  { id: 'lattice', label: 'Lattice', hint: 'A tech grid that lights up around your cursor' },
] as const;

const VERT = `attribute vec2 a_pos; void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const COMMON = `precision highp float;
uniform vec2 u_res; uniform float u_time; uniform vec2 u_mouse; uniform vec3 u_clicks[8];
float hash21(vec2 p){ p = fract(p*vec2(123.34,345.45)); p += dot(p,p+34.345); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
  float a=hash21(i),b=hash21(i+vec2(1.0,0.0)),c=hash21(i+vec2(0.0,1.0)),d=hash21(i+vec2(1.0,1.0));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }
float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.02; a*=0.5; } return s; }
vec3 pal(float t, vec3 a, vec3 b, vec3 c, vec3 d){ return a + b*cos(6.28318*(c*t+d)); }
float ripples(vec2 uv){ float r=0.0;
  for(int i=0;i<8;i++){ vec3 c=u_clicks[i]; if(c.z<0.0) continue;
    float d=distance(uv,c.xy); r += sin(d*22.0 - c.z*7.0)*exp(-c.z*2.2)*exp(-d*4.0); }
  return r; }
`;

const AURORA = `${COMMON}
void main(){
  vec2 uv = gl_FragCoord.xy/u_res; float asp=u_res.x/u_res.y;
  vec2 p = uv; p.x*=asp; vec2 m=u_mouse; m.x*=asp;
  float t=u_time*0.09;
  vec2 q=p*3.0; vec2 dir=m-p; q += 0.7*dir*exp(-length(dir)*1.6);
  float n=fbm(q+vec2(0.0,t*4.0)); n+=0.5*fbm(q*2.0-vec2(t*3.0,0.0));
  n += ripples(uv)*0.6;
  vec3 col=pal(n*0.55+0.15, vec3(0.10,0.13,0.22), vec3(0.30,0.42,0.55), vec3(1.0,1.0,1.0), vec3(0.0,0.18,0.42));
  col=mix(col, vec3(0.05,0.85,0.55), smoothstep(0.65,1.15,n)*0.55);
  col+=vec3(0.12,0.32,0.7)*smoothstep(0.25,-0.25,n);
  col+=0.20*exp(-length(p-m)*3.0)*vec3(0.4,1.0,0.85);
  col*=0.55+0.55*uv.y;
  gl_FragColor=vec4(col,1.0);
}`;

const LIQUID = `${COMMON}
void main(){
  vec2 uv=gl_FragCoord.xy/u_res; float asp=u_res.x/u_res.y;
  vec2 p=(uv-0.5); p.x*=asp; vec2 m=(u_mouse-0.5); m.x*=asp;
  float t=u_time*0.4; float field=0.0;
  for(int i=0;i<6;i++){ float fi=float(i);
    vec2 c=0.42*vec2(sin(t*0.7+fi*1.7), cos(t*0.6+fi*2.3));
    if(i==0){ c=m; }
    float r=0.15+0.05*sin(t+fi);
    field += r*r/max(dot(p-c,p-c),0.0008); }
  field += ripples(uv)*0.5;
  float e=smoothstep(0.85,1.7,field);
  vec3 col=pal(field*0.12+t*0.05, vec3(0.10,0.12,0.20), vec3(0.50,0.40,0.62), vec3(1.0,0.9,0.85), vec3(0.0,0.25,0.52));
  col=mix(vec3(0.025,0.035,0.07), col, e);
  col+=0.32*pow(e,3.0)*vec3(0.55,0.9,1.0);
  gl_FragColor=vec4(col,1.0);
}`;

const GRID = `${COMMON}
void main(){
  vec2 uv=gl_FragCoord.xy/u_res; vec2 m=u_mouse;
  float hor=0.52 + (m.y-0.5)*0.16;
  vec3 col=vec3(0.0);
  if(uv.y<hor){
    float persp=1.0/(hor-uv.y+0.025);
    float gx=(uv.x-0.5 + (m.x-0.5)*0.30)*persp;
    float gz=persp + u_time*0.7;
    float lx=abs(fract(gx)-0.5), lz=abs(fract(gz)-0.5);
    float glow=exp(-min(lx,lz)*26.0/persp);
    col += vec3(0.95,0.2,0.85)*glow;
    col += vec3(0.1,0.6,0.95)*exp(-lx*16.0)*0.45;
    col *= clamp(persp*0.16,0.0,1.0);
    col += vec3(0.02,0.0,0.05);
  } else {
    float sky=smoothstep(0.0,0.45,uv.y-hor);
    col += mix(vec3(0.35,0.06,0.34), vec3(0.04,0.02,0.10), sky);
    vec2 s=uv-vec2(0.5,hor+0.13);
    float sun=exp(-length(s*vec2(1.0,1.7))*4.2);
    float bands=step(0.5,fract((uv.y-hor)*42.0));
    col += vec3(1.0,0.55,0.2)*sun*(1.0-0.6*bands);
  }
  col += max(ripples(uv),0.0)*0.35*vec3(0.5,0.85,1.0);
  gl_FragColor=vec4(col,1.0);
}`;

const WARP = `${COMMON}
void main(){
  vec2 uv=gl_FragCoord.xy/u_res; float asp=u_res.x/u_res.y;
  vec2 p=(uv-0.5); p.x*=asp; vec2 m=(u_mouse-0.5); m.x*=asp;
  vec2 c=p - m*0.7; float a=atan(c.y,c.x); float r=length(c);
  float t=u_time*0.35; vec3 col=vec3(0.0);
  for(int i=0;i<3;i++){ float L=float(i); float sp=1.0+L*0.6;
    float rr=fract(r*(1.6+L) - t*sp);
    float seed=hash21(vec2(floor(a*34.0+L*11.0), floor(r*2.2+L)));
    float star=smoothstep(0.93,1.0,seed)*exp(-rr*4.0);
    col += star*vec3(0.7+0.3*L,0.85,1.0)/(0.32+r); }
  col += 0.16*exp(-r*3.0)*vec3(0.5,0.7,1.0);
  col += max(ripples(uv),0.0)*vec3(0.6,0.85,1.0);
  col += vec3(0.01,0.02,0.05);
  gl_FragColor=vec4(col,1.0);
}`;

const CRYSTAL = `${COMMON}
void main(){
  vec2 uv=gl_FragCoord.xy/u_res; float asp=u_res.x/u_res.y;
  vec2 p=uv*vec2(asp,1.0)*5.5; vec2 m=u_mouse*vec2(asp,1.0)*5.5;
  float t=u_time*0.3; vec2 ip=floor(p), fp=fract(p);
  float d1=8.0,d2=8.0; float cellId=0.0;
  for(int y=-1;y<=1;y++){ for(int x=-1;x<=1;x++){
    vec2 g=vec2(float(x),float(y));
    vec2 o=g + (0.5+0.5*sin(t+6.2831*vec2(hash21(ip+g),hash21(ip+g+5.0)))) - fp;
    float d=dot(o,o);
    if(d<d1){ d2=d1; d1=d; cellId=hash21(ip+g); } else if(d<d2){ d2=d; } } }
  float edge=smoothstep(0.0,0.09,sqrt(d2)-sqrt(d1));
  vec3 col=pal(cellId+t*0.05, vec3(0.10,0.12,0.18), vec3(0.42,0.46,0.56), vec3(1.0,1.0,1.0), vec3(0.0,0.22,0.46));
  col *= 0.28+0.72*edge;
  float md=distance(p,m);
  col += 0.45*exp(-md*0.8)*vec3(0.3,0.95,0.7);
  col += max(ripples(uv),0.0)*0.35;
  col *= 0.82; // a touch calmer so overlaid UI stays crisp
  gl_FragColor=vec4(col,1.0);
}`;

const LATTICE = `${COMMON}
void main(){
  vec2 uv=gl_FragCoord.xy/u_res; float asp=u_res.x/u_res.y;
  vec2 p=(uv-0.5); p.x*=asp; vec2 m=(u_mouse-0.5); m.x*=asp;
  float t=u_time*0.25; float scale=13.0;
  vec2 gp=p*scale + 0.35*vec2(sin(p.y*4.0+t), cos(p.x*4.0+t));
  vec2 id=floor(gp); vec2 f=fract(gp)-0.5;
  vec2 gm=m*scale; float md=distance(id+0.5, gm); float glow=exp(-md*0.22);
  float d=length(f); float dotm=smoothstep(0.34,0.16,d);
  float pulse=0.5+0.5*sin(t*2.5 - md*0.6);
  vec3 col=vec3(0.03,0.05,0.10);
  col += dotm*(0.12+0.9*glow)*mix(vec3(0.18,0.34,0.7), vec3(0.35,1.0,0.92), glow);
  col += dotm*0.18*pulse*vec3(0.25,0.5,0.95);
  float grid=max(smoothstep(0.03,0.0,abs(f.x)), smoothstep(0.03,0.0,abs(f.y)));
  col += grid*(0.05+0.25*glow)*vec3(0.3,0.6,1.0);
  col += max(ripples(uv),0.0)*0.8*vec3(0.4,0.9,1.0);
  gl_FragColor=vec4(col,1.0);
}`;

const FRAGS: Record<string, string> = { aurora: AURORA, liquid: LIQUID, grid: GRID, warp: WARP, crystal: CRYSTAL, lattice: LATTICE };

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('shader compile error:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh); return null;
  }
  return sh;
}

export default function ShaderField({ variant = 'aurora', className }: { variant?: string; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const variantRef = useRef(variant);
  variantRef.current = variant;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const vert = compileShader(gl, gl.VERTEX_SHADER, VERT)!;
    const programs: Record<string, { prog: WebGLProgram; loc: Record<string, WebGLUniformLocation | null> }> = {};
    for (const id of Object.keys(FRAGS)) {
      const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAGS[id]);
      if (!frag) continue;
      const prog = gl.createProgram()!;
      gl.attachShader(prog, vert); gl.attachShader(prog, frag); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn('link error', id, gl.getProgramInfoLog(prog)); continue; }
      programs[id] = {
        prog,
        loc: {
          res: gl.getUniformLocation(prog, 'u_res'),
          time: gl.getUniformLocation(prog, 'u_time'),
          mouse: gl.getUniformLocation(prog, 'u_mouse'),
          clicks: gl.getUniformLocation(prog, 'u_clicks[0]'),
          pos: gl.getAttribLocation(prog, 'a_pos') as unknown as WebGLUniformLocation,
        },
      };
    }

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // one big triangle

    let raf = 0, running = true, visible = true;
    const start = performance.now();
    const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
    const clicks = new Float32Array(24).fill(-1); // 8 × (x, y, age); age<0 = inactive
    const clickTimes: number[] = new Array(8).fill(-1);
    let clickHead = 0;

    const dpr = () => Math.min(window.devicePixelRatio || 1, 1.75);
    function resize() {
      const r = dpr();
      const w = Math.max(1, Math.floor(canvas!.clientWidth * r));
      const h = Math.max(1, Math.floor(canvas!.clientHeight * r));
      if (canvas!.width !== w || canvas!.height !== h) { canvas!.width = w; canvas!.height = h; }
    }

    function onMove(e: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      mouse.tx = (e.clientX - rect.left) / Math.max(1, rect.width);
      mouse.ty = 1 - (e.clientY - rect.top) / Math.max(1, rect.height);
    }
    function onDown(e: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      const x = (e.clientX - rect.left) / Math.max(1, rect.width);
      const y = 1 - (e.clientY - rect.top) / Math.max(1, rect.height);
      clicks[clickHead * 3] = x; clicks[clickHead * 3 + 1] = y; clicks[clickHead * 3 + 2] = 0;
      clickTimes[clickHead] = performance.now();
      clickHead = (clickHead + 1) % 8;
    }
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });

    function frame(now: number) {
      if (!running || !visible) { raf = requestAnimationFrame(frame); return; }
      resize();
      const cur = programs[variantRef.current] || programs.aurora;
      if (!cur) { raf = requestAnimationFrame(frame); return; }
      const t = reduce ? 6.0 : (now - start) / 1000;
      // ease the mouse for a pleasant trailing feel
      mouse.x += (mouse.tx - mouse.x) * 0.08;
      mouse.y += (mouse.ty - mouse.y) * 0.08;
      // age clicks
      for (let i = 0; i < 8; i++) {
        if (clickTimes[i] < 0) { clicks[i * 3 + 2] = -1; continue; }
        const age = (now - clickTimes[i]) / 1000;
        if (age > 2.6) { clickTimes[i] = -1; clicks[i * 3 + 2] = -1; } else clicks[i * 3 + 2] = age;
      }
      gl!.viewport(0, 0, canvas!.width, canvas!.height);
      gl!.useProgram(cur.prog);
      const posLoc = cur.loc.pos as unknown as number;
      gl!.bindBuffer(gl!.ARRAY_BUFFER, buf);
      gl!.enableVertexAttribArray(posLoc);
      gl!.vertexAttribPointer(posLoc, 2, gl!.FLOAT, false, 0, 0);
      gl!.uniform2f(cur.loc.res, canvas!.width, canvas!.height);
      gl!.uniform1f(cur.loc.time, t);
      gl!.uniform2f(cur.loc.mouse, mouse.x, mouse.y);
      if (cur.loc.clicks) gl!.uniform3fv(cur.loc.clicks, clicks);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    const onVis = () => { running = !document.hidden; };
    document.addEventListener('visibilitychange', onVis);
    const io = new IntersectionObserver((entries) => { visible = entries[0]?.isIntersecting ?? true; }, { threshold: 0 });
    io.observe(canvas);
    const onResize = () => resize();
    window.addEventListener('resize', onResize);

    const onLost = (e: Event) => { e.preventDefault(); cancelAnimationFrame(raf); };
    canvas.addEventListener('webglcontextlost', onLost);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('webglcontextlost', onLost);
      io.disconnect();
      const ext = gl.getExtension('WEBGL_lose_context'); ext?.loseContext();
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
