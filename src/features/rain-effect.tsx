import { useEffect, useRef } from "react"
import { Scene, WebGLRenderer, ShaderMaterial, OrthographicCamera, PlaneGeometry, Texture, CanvasTexture, Vector3, AdditiveBlending, Mesh, Clock, NormalBlending } from "three"

const RainEffect = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<Scene | null>(null)
  const rendererRef = useRef<WebGLRenderer | null>(null)
  const materialRef = useRef<ShaderMaterial | null>(null)
  const animationRef = useRef<number | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    const canvas = canvasRef.current
    const context = canvas.getContext('webgl2', { antialias: true })
    if (!context) return
    const renderer = new WebGLRenderer({ canvas, context, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio || 1)
    renderer.setClearColor(0x000000, 0)
    rendererRef.current = renderer

    const scene = new Scene()
    sceneRef.current = scene

    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)

    const geometry = new PlaneGeometry(2, 2)

    function makeBackgroundTexture(size = 1024) {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      const context = canvas.getContext('2d')
      if (!context) return new Texture()
      
      const gradient = context.createLinearGradient(0, 0, size, size)
      gradient.addColorStop(0, 'rgba(16, 24, 38, 0.05)') 
      gradient.addColorStop(0.5, 'rgba(43, 65, 88, 0.05)') // 非常透明
      gradient.addColorStop(1, 'rgba(16, 16, 38, 0.05)')   // 非常透明
      context.fillStyle = gradient
      context.fillRect(0, 0, size, size)
      
      for (let i = 0; i < 2000; i++) {
        const x = Math.random() * size
        const y = Math.random() * size
        const r = Math.random() * 1.5
        context.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})` // 更透明
        context.beginPath()
        context.arc(x, y, r, 0, Math.PI * 2)
        context.fill()
      }
      
      return new CanvasTexture(canvas)
    }

    const bgTexture = makeBackgroundTexture(1024)

    const material = new ShaderMaterial({
      uniforms: {
        iResolution: { value: new Vector3() },
        iTime: { value: 0 },
        iMouse: { value: new Vector3(0, 0, 0) },
        iChannel0: { value: bgTexture },
        u_rain: { value: 0.7 },
        u_pulse: { value: 0.0 },
        u_pulse_amp: { value: 0.0 },
        u_is_decrease: { value: 0.0 },
        u_disable_lightning: { value: 0.0 },
        u_speed: { value: 1.0 },
        u_story: { value: 0.0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() { 
          vUv = uv; 
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); 
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;

        uniform sampler2D iChannel0;
        uniform vec3 iResolution;
        uniform float iTime;
        uniform vec3 iMouse;
        uniform float u_rain;
        uniform float u_pulse;
        uniform float u_pulse_amp;
        uniform float u_is_decrease;
        uniform float u_disable_lightning;
        uniform float u_speed;
        uniform float u_story;

        #define S(a, b, t) smoothstep(a, b, t)
        //#define CHEAP_NORMALS
        #define USE_POST_PROCESSING

        vec3 N13(float p) {
          vec3 p3 = fract(vec3(p) * vec3(.1031,.11369,.13787));
          p3 += dot(p3, p3.yzx + 19.19);
          return fract(vec3((p3.x + p3.y)*p3.z, (p3.x+p3.z)*p3.y, (p3.y+p3.z)*p3.x));
        }

        vec4 N14(float t) {
          return fract(sin(t*vec4(123., 1024., 1456., 264.))*vec4(6547., 345., 8799., 1564.));
        }
        float N(float t) { return fract(sin(t*12345.564)*7658.76); }

        float Saw(float b, float t) { return S(0., b, t)*S(1., b, t); }

        vec2 DropLayer2(vec2 uv, float t) {
          vec2 UV = uv;
          uv.y += t*0.75;
          vec2 a = vec2(6., 1.);
          vec2 grid = a*2.;
          vec2 id = floor(uv*grid);
          float colShift = N(id.x);
          uv.y += colShift;
          id = floor(uv*grid);
          vec3 n = N13(id.x*35.2+id.y*2376.1);
          vec2 st = fract(uv*grid)-vec2(.5, 0);
          float x = n.x-.5;
          float y = UV.y*20.;
          float wiggle = sin(y+sin(y));
          x += wiggle*(.5-abs(x))*(n.z-.5);
          x *= .7;
          float ti = fract(t+n.z);
          y = (Saw(.85, ti)-.5)*.9+.5;
          vec2 p = vec2(x, y);
          float d = length((st-p)*a.yx);
          float mainDrop = S(.4, .0, d);
          float r = sqrt(S(1., y, st.y));
          float cd = abs(st.x-x);
          float trail = S(.23*r, .15*r*r, cd);
          float trailFront = S(-.02, .02, st.y-y);
          trail *= trailFront*r*r;
          y = UV.y;
          float trail2 = S(.2*r, .0, cd);
          float droplets = max(0., (sin(y*(1.-y)*120.)-st.y))*trail2*trailFront*n.z;
          y = fract(y*10.)+(st.y-.5);
          float dd = length(st-vec2(x, y));
          droplets = S(.3, 0., dd);
          float m = mainDrop+droplets*r*trailFront;
          return vec2(m, trail);
        }

        float StaticDrops(vec2 uv, float t) {
          uv *= 40.;
          vec2 id = floor(uv);
          uv = fract(uv)-.5;
          vec3 n = N13(id.x*107.45+id.y*3543.654);
          vec2 p = (n.xy-.5)*.7;
          float d = length(uv-p);
          float fade = Saw(.025, fract(t+n.z));
          float c = S(.3, 0., d)*fract(n.z*10.)*fade;
          return c;
        }

        vec2 Drops(vec2 uv, float t, float l0, float l1, float l2) {
          float s = StaticDrops(uv, t)*l0;
          vec2 m1 = DropLayer2(uv, t)*l1;
          vec2 m2 = DropLayer2(uv*1.85, t)*l2;
          float c = s+m1.x+m2.x;
          c = S(.3, 1., c);
          return vec2(c, max(m1.y*l0, m2.y*l1));
        }

        void main(){
          vec2 fragCoord = vUv * iResolution.xy;
          vec2 uv = (fragCoord.xy-.5*iResolution.xy) / iResolution.y;
          vec2 UV = fragCoord.xy/iResolution.xy;
          vec3 M = iMouse.xyz/iResolution.xyz;
          float T = iTime;
          float t = T*.2 * max(0.0001, u_speed);
          // 完全由滑块控制（u_rain）。u_pulse/u_pulse_amp提供滑块变化时的临时脉冲。
          float rainAmount = u_rain;
          // 将脉冲作为乘法增益应用：脉冲 = sin(pi * 进度) * 幅度
          float pulse = 0.0;
          if (u_pulse_amp > 0.0001) {
            pulse = sin(3.14159265 * clamp(u_pulse, 0.0, 1.0)) * u_pulse_amp;
            rainAmount = clamp(rainAmount + pulse, 0.0, 1.0);
          }

          // 提前声明模糊变量，以便故事块可以修改它们
          float maxBlur = mix(3., 6., rainAmount);
          float minBlur = 2.;

          // 故事（最终心形状态）当u_story启用时：近似原始HAS_HEART行为
          float heart = 0.0;
          if (u_story > 0.5) {
            float story = 1.0; // u_story已经表示进入最终状态
            // 重新映射t，使雨滴减速像原始的那样
            float tt = min(1.0, u_story);
            float t2 = 1.0 - tt;
            t2 = (1.0 - t2 * t2) * 70.0;
            float zoom = mix(.3, 1.2, story);
            uv *= zoom;
            minBlur = 4.0 + smoothstep(.5, 1.0, story) * 3.0;
            maxBlur = 6.0 + smoothstep(.5, 1.0, story) * 1.5;
            vec2 hv = uv - vec2(0.0, -0.1);
            hv.x *= .5;
            float s = smoothstep(70.0, 110.0, 70.0); // 近似最终的小心形
            hv.y -= sqrt(abs(hv.x)) * .5 * s;
            heart = length(hv);
            heart = smoothstep(.2 * s, .4 * s, heart) * s;
            // 仅在心形区域下雨
            rainAmount = heart;
            maxBlur -= heart;
            uv *= 1.5;
            t = t2 * .25;
          } else if (u_is_decrease > 0.5) {
            // 减少时的短暂心形（短脉冲）
            vec2 hv = uv-vec2(.0, -.1);
            hv.x *= .5;
            float s2 = 1.0;
            hv.y -= sqrt(abs(hv.x))*.5*s2;
            heart = length(hv);
            heart = smoothstep(.2*s2, .4*s2, heart) * s2;
            rainAmount = mix(rainAmount, 0.0, heart);
          }
          float story = 0.;
          float zoom = -cos(T*.2);
          uv *= .7+zoom*.3;
          UV = (UV-.5)*(.9+zoom*.1)+.5;
          float staticDrops = S(-.5, 1., rainAmount)*2.;
          float layer1 = S(.25, .75, rainAmount);
          float layer2 = S(.0, .5, rainAmount);
          vec2 c = Drops(uv, t, staticDrops, layer1, layer2);
          #ifdef CHEAP_NORMALS
            vec2 n = vec2(dFdx(c.x), dFdy(c.x));
          #else
            vec2 e = vec2(.001, 0.);
            float cx = Drops(uv+e, t, staticDrops, layer1, layer2).x;
            float cy = Drops(uv+e.yx, t, staticDrops, layer1, layer2).x;
            vec2 n = vec2(cx-c.x, cy-c.x);
          #endif
          #ifdef HAS_HEART
          n *= 1.-S(60., 85., T);
          c.y *= 1.-S(80., 100., T)*.8;
          #endif
          // textureLod需要GLSL3 / 显式版本；使用texture2D以兼容
          float focus = mix(maxBlur-c.y, minBlur, S(.1, .2, c.x));
          vec3 col = texture2D(iChannel0, UV+n).rgb;
          #ifdef USE_POST_PROCESSING
          t = (T+3.)*.5;
          float colFade = sin(t*.2)*.5+.5+story;
          col *= mix(vec3(1.), vec3(.8, .9, 1.3), colFade);
          // 禁用自动淡入；仅通过着色器输入控制全强度
          float fade = 1.0;
          // 仅在未禁用且雨量高时才闪电
          float lightning = 0.0;
          if (u_disable_lightning < 0.5 && rainAmount > 0.5) {
            lightning = sin(t*sin(t*10.));
            lightning *= pow(max(0., sin(t+sin(t))), 10.);
          }
          col *= 1.+lightning*fade*mix(1., .1, story*story);
          col *= 1.-dot(UV-=.5, UV);
          #ifdef HAS_HEART
            col = mix(pow(col, vec3(1.2)), col, heart);
            fade *= S(102., 97., T);
          #endif
          col *= fade;
          #endif
          // Make rain effect very subtle and transparent
          float rainIntensity = rainAmount * c.x;
          float alpha = mix(0.0, 0.15, rainIntensity); // Very low opacity
          
          // Soften the rain effect to not interfere with page content
          vec3 softCol = mix(col, vec3(1.0), 0.8); // Make colors softer
          gl_FragColor = vec4(softCol, alpha);
        }
      `,
      transparent: true,
      blending: NormalBlending
    })

    materialRef.current = material

    const quad = new Mesh(geometry, material)
    scene.add(quad)

    // Handle window resize
    function onResize() {
      const w = window.innerWidth
      const h = window.innerHeight
      renderer.setSize(w, h, false)
      if (material.uniforms.iResolution) {
        material.uniforms.iResolution.value.set(w, h, window.devicePixelRatio || 1)
      }
    }

    // Pointer/mouse handling to match shadertoy-style iMouse
    let pointerDown = false
    function setMouseFromEvent(e) {
      const rect = renderer.domElement.getBoundingClientRect()
      const x = (e.clientX - rect.left)
      const y = (rect.height - (e.clientY - rect.top)) // Flip Y axis to match shader coordinates
      if (material.uniforms.iMouse) {
        material.uniforms.iMouse.value.set(x, y, pointerDown ? 1 : 0)
      }
    }
    window.addEventListener('pointerdown', (e) => { pointerDown = true; setMouseFromEvent(e) })
    window.addEventListener('pointerup', (e) => { pointerDown = false; setMouseFromEvent(e) })
    window.addEventListener('pointermove', (e) => { if (!pointerDown) return; setMouseFromEvent(e) })

    window.addEventListener('resize', onResize, { passive: true })
    onResize()

    const clock = new Clock()
    function animate() {
      animationRef.current = requestAnimationFrame(animate)
      const t = clock.getElapsedTime()
      if (material.uniforms.iTime) {
        material.uniforms.iTime.value = t
      }
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointerdown', setMouseFromEvent)
      window.removeEventListener('pointerup', setMouseFromEvent)
      window.removeEventListener('pointermove', setMouseFromEvent)
      renderer.dispose()
      geometry.dispose()
      material.dispose()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="z-[-1] fixed top-0 left-0 w-full h-full pointer-events-none"
    />
  )
}

export default RainEffect
