import * as THREE from "three"; // 导入Three.js库，用于3D渲染和场景构建

// 创建一个全屏的雨效果着色器演示
// - 使用WebGL2 (GLSL3)，以便在片段着色器中使用textureLod
// - 创建一个程序化的背景纹理作为iChannel0

const canvas = document.createElement('canvas'); // 创建一个画布元素
canvas.style.width = '100%'; // 设置画布宽度为100%
canvas.style.height = '100%'; // 设置画布高度为100%
canvas.style.display = 'block'; // 设置画布为块级元素
document.getElementById('renderCanvas').appendChild(canvas); // 将画布添加到页面中

// 时间基准
const _startTime = performance.now() / 1000;

// 创建一个webgl2上下文，以允许在片段着色器中使用textureLod
const gl = canvas.getContext('webgl2', { antialias: true });
const renderer = new THREE.WebGLRenderer({ canvas, context: gl });
renderer.setPixelRatio(window.devicePixelRatio || 1); // 设置像素比

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

// 简单的全屏四边形
const geometry = new THREE.PlaneGeometry(2, 2);

// 创建一个程序化的背景纹理作为iChannel0
function makeBackgroundTexture(size = 1024) {
	const c = document.createElement('canvas');
	c.width = c.height = size;
	const ctx = c.getContext('2d');
	// 渐变
	const g = ctx.createLinearGradient(0, 0, size, size);
	g.addColorStop(0, '#101826');
	g.addColorStop(0.5, '#2b4158');
	g.addColorStop(1, '#101026');
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, size, size);
	// 简单的星星/噪声
	for (let i = 0; i < 2000; i++) {
		const x = Math.random() * size;
		const y = Math.random() * size;
		const r = Math.random() * 1.5;
		ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.15})`;
		ctx.beginPath();
		ctx.arc(x, y, r, 0, Math.PI * 2);
		ctx.fill();
	}
	return new THREE.CanvasTexture(c);
}

// const bgTexture = makeBackgroundTexture(1024);
const bgTexture = new THREE.TextureLoader().load('/bg.jpeg', tex => {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
});
bgTexture.wrapS = bgTexture.wrapT = THREE.RepeatWrapping;
bgTexture.minFilter = THREE.LinearMipmapLinearFilter;
bgTexture.magFilter = THREE.LinearFilter;
bgTexture.generateMipmaps = true;

// 用户界面：滑块控制雨量 (0..1)
const ui = document.createElement('div');
ui.style.position = 'fixed';
ui.style.left = '12px';
ui.style.bottom = '12px';
ui.style.color = '#fff';
ui.style.fontFamily = 'sans-serif';
ui.style.zIndex = '999';
ui.innerHTML = `Rain: <input id="rainRange" type="range" min="0" max="1" step="0.01" value="0.7" style="vertical-align:middle"> <span id="rainVal">0.70</span>`;
document.body.appendChild(ui);
const rainRange = document.getElementById('rainRange');
const rainVal = document.getElementById('rainVal');
let lastRain = parseFloat(rainRange.value);
let pulseStart = -1;
const pulseDuration = 0.9; // 脉冲持续时间（秒）
let pulseAmp = 0.0;
// 待处理的uniform标志（避免在材质创建之前修改材质）
let pendingIsDecrease = 0.0;
let pendingDisableLightning = 0.0;
let pendingSpeed = 1.0;
let pendingStory = 0.0;

rainRange.addEventListener('input', (e) => {
	const v = Number(e.target.value);
	rainVal.innerText = v.toFixed(2);
	const delta = v - lastRain;
	if (Math.abs(delta) > 0.0001) {
		// 当滑块变化时触发脉冲
		pulseAmp = Math.min(1.0, Math.abs(delta) * 2.0);
		// 设置脉冲开始时间
		pulseStart = (performance.now() / 1000) - _startTime;
		// 设置待处理的标志（在animate中应用）
		if (delta < 0) {
			pendingIsDecrease = 1.0;
			pendingDisableLightning = 1.0;
		} else {
			pendingIsDecrease = 0.0;
			pendingDisableLightning = v <= 0.5 ? 1.0 : 0.0;
			pendingSpeed = 1.0 + Math.min(3.0, v * 3.0);
		}

		// 如果滑块值为0，进入最终故事/心形状态，并永久禁用闪电
		if (v === 0) {
			pendingStory = 1.0;
			pendingDisableLightning = 1.0;
		} else {
			pendingStory = 0.0;
		}
	}
	lastRain = v;
});

// 着色器 (GLSL3)
const material = new THREE.ShaderMaterial({
	uniforms: {
		iResolution: { value: new THREE.Vector3() },
		iTime: { value: 0 },
		iMouse: { value: new THREE.Vector3(0, 0, 0) },
		iChannel0: { value: bgTexture },
		u_rain: { value: parseFloat(rainRange.value) },
		u_pulse: { value: 0.0 },
		u_pulse_amp: { value: 0.0 },
		u_is_decrease: { value: 0.0 },
		u_disable_lightning: { value: 0.0 },
		u_speed: { value: 1.0 },
		u_story: { value: 0.0 }
	},
		vertexShader: `
			varying vec2 vUv;
			void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
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
				gl_FragColor = vec4(col, 1.0);
			}
	`
});

const quad = new THREE.Mesh(geometry, material);
scene.add(quad);

// 指针/鼠标处理，以匹配shadertoy风格的iMouse
let pointerDown = false;
function setMouseFromEvent(e) {
	const rect = renderer.domElement.getBoundingClientRect();
	const x = (e.clientX - rect.left);
	const y = (rect.height - (e.clientY - rect.top)); // 翻转Y轴以匹配着色器坐标
 	if (material && material.uniforms && material.uniforms.iMouse) {
 		material.uniforms.iMouse.value.set(x, y, pointerDown ? 1 : 0);
 	}
}
window.addEventListener('pointerdown', (e) => { pointerDown = true; setMouseFromEvent(e); });
window.addEventListener('pointerup', (e) => { pointerDown = false; setMouseFromEvent(e); });
window.addEventListener('pointermove', (e) => { if (!pointerDown) return; setMouseFromEvent(e); });

// 处理窗口调整大小
function onResize() {
	const w = window.innerWidth;
	const h = window.innerHeight;
	renderer.setSize(w, h, false);
 	if (material && material.uniforms && material.uniforms.iResolution) {
 		material.uniforms.iResolution.value.set(w, h, window.devicePixelRatio || 1);
 	}
}
window.addEventListener('resize', onResize, { passive: true });
onResize();

// 动画循环
const clock = new THREE.Clock(); // 创建一个时钟对象，用于跟踪时间
function animate() {
    requestAnimationFrame(animate); // 请求下一帧动画
    const t = (performance.now() / 1000) - _startTime; // 计算当前时间
    if (material && material.uniforms) {
        material.uniforms.iTime.value = t; // 更新时间uniform变量
        // 应用待处理的uniform变量
        material.uniforms.u_is_decrease.value = pendingIsDecrease;
        material.uniforms.u_disable_lightning.value = pendingDisableLightning;
        material.uniforms.u_speed.value = pendingSpeed;
        material.uniforms.u_story.value = pendingStory;
    }
    // 更新雨量uniform变量（从UI获取值）
    if (material && material.uniforms && material.uniforms.u_rain) {
        material.uniforms.u_rain.value = parseFloat(rainRange.value); // 将滑块值转换为浮点数并赋值
    }
    // 更新脉冲进度
    if (pulseStart >= 0) {
        const elapsed = t - pulseStart; // 计算经过的时间
        const prog = Math.min(1, elapsed / pulseDuration); // 计算脉冲进度
        if (material && material.uniforms) {
            material.uniforms.u_pulse.value = prog; // 更新脉冲进度uniform变量
            // 保持脉冲幅度直到完成
            material.uniforms.u_pulse_amp.value = pulseAmp;
            if (prog >= 1) {
                // 清除脉冲状态
                pulseStart = -1;
                pulseAmp = 0.0;
                material.uniforms.u_pulse_amp.value = 0.0;
                material.uniforms.u_pulse.value = 0.0;
            }
        }
    }

    // 处理减少心形的超时：保持u_is_decrease一段时间，然后淡出
    if (material && material.uniforms && material.uniforms.u_is_decrease) {
        if (material.uniforms.u_is_decrease.value > 0.5) {
            // 在JS端通过pulseStartMinus启动一个衰减计时器
            if (typeof window._decreaseStart === 'undefined') window._decreaseStart = t;
            const hold = 3.0; // 保持心形可见的时间（秒）
            const since = t - window._decreaseStart; // 计算经过的时间
            if (since >= hold) {
                material.uniforms.u_is_decrease.value = 0.0; // 重置u_is_decrease
                material.uniforms.u_disable_lightning.value = 0.0; // 重置u_disable_lightning
                window._decreaseStart = undefined; // 清除计时器
            }
        } else {
            window._decreaseStart = undefined; // 清除计时器
        }
    }
    // 确保纹理已上传
    if (bgTexture) bgTexture.needsUpdate = false;
    renderer.render(scene, camera); // 渲染场景
}
animate(); // 启动动画循环