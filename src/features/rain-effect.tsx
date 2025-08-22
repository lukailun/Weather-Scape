import { useEffect, useRef } from "react"
import { Scene, WebGLRenderer, ShaderMaterial, OrthographicCamera, PlaneGeometry, Texture, CanvasTexture, Vector3, AdditiveBlending, Mesh, Clock } from "three"

const RainEffect = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<Scene | null>(null)
  const rendererRef = useRef<WebGLRenderer | null>(null)
  const materialRef = useRef<ShaderMaterial | null>(null)
  const animationRef = useRef<number | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return

    const canvas = canvasRef.current
    const gl = canvas.getContext('webgl2', { antialias: true })
    if (!gl) return

    const renderer = new WebGLRenderer({ canvas, context: gl, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio || 1)
    renderer.setClearColor(0x000000, 0)
    rendererRef.current = renderer

    const scene = new Scene()
    sceneRef.current = scene

    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)

    // Create a full-screen quad
    const geometry = new PlaneGeometry(2, 2)

    // Create a procedural background texture
    function makeBackgroundTexture(size = 1024) {
      const c = document.createElement('canvas')
      c.width = c.height = size
      const ctx = c.getContext('2d')
      if (!ctx) return new Texture()
      
      // Create a subtle gradient
      const g = ctx.createLinearGradient(0, 0, size, size)
      g.addColorStop(0, 'rgba(16, 24, 38, 0.1)')
      g.addColorStop(0.5, 'rgba(43, 65, 88, 0.1)')
      g.addColorStop(1, 'rgba(16, 16, 38, 0.1)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, size, size)
      
      return new CanvasTexture(c)
    }

    const bgTexture = makeBackgroundTexture(1024)

    // Rain shader material
    const material = new ShaderMaterial({
      uniforms: {
        iResolution: { value: new Vector3() },
        iTime: { value: 0 },
        u_rain: { value: 0.7 }, // Rain intensity
        iChannel0: { value: bgTexture }
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
        uniform float u_rain;

        #define S(a, b, t) smoothstep(a, b, t)

        vec3 N13(float p) {
          vec3 p3 = fract(vec3(p) * vec3(.1031,.11369,.13787));
          p3 += dot(p3, p3.yzx + 19.19);
          return fract(vec3((p3.x + p3.y)*p3.z, (p3.x+p3.z)*p3.y, (p3.y+p3.z)*p3.x));
        }

        float N(float t) { 
          return fract(sin(t*12345.564)*7658.76); 
        }

        float Saw(float b, float t) { 
          return S(0., b, t)*S(1., b, t); 
        }

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

        void main() {
          vec2 fragCoord = vUv * iResolution.xy;
          vec2 uv = (fragCoord.xy-.5*iResolution.xy) / iResolution.y;
          vec2 UV = fragCoord.xy/iResolution.xy;
          float T = iTime;
          float t = T*.2;
          
          float rainAmount = u_rain;
          float maxBlur = mix(3., 6., rainAmount);
          float minBlur = 2.;
          
          float staticDrops = S(-.5, 1., rainAmount)*2.;
          float layer1 = S(.25, .75, rainAmount);
          float layer2 = S(.0, .5, rainAmount);
          vec2 c = Drops(uv, t, staticDrops, layer1, layer2);
          
          vec2 e = vec2(.001, 0.);
          float cx = Drops(uv+e, t, staticDrops, layer1, layer2).x;
          float cy = Drops(uv+e.yx, t, staticDrops, layer1, layer2).x;
          vec2 n = vec2(cx-c.x, cy-c.x);
          
          float focus = mix(maxBlur-c.y, minBlur, S(.1, .2, c.x));
          vec3 col = texture2D(iChannel0, UV+n).rgb;
          
          // Apply rain effect with transparency
          float rainAlpha = rainAmount * 0.3; // Adjust transparency
          col = mix(col, vec3(0.5, 0.7, 1.0), rainAlpha * c.x);
          
          gl_FragColor = vec4(col, rainAlpha * c.x);
        }
      `,
      transparent: true,
      blending: AdditiveBlending
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

    window.addEventListener('resize', onResize, { passive: true })
    onResize()

    // Animation loop
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
      renderer.dispose()
      geometry.dispose()
      material.dispose()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="z-[99999] fixed top-0 left-0 w-full h-full pointer-events-none mix-blend-multiply"
    />
  )
}

export default RainEffect
