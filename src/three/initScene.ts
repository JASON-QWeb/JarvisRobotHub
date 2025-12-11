/**
 * initScene.ts - Three.js 场景初始化模块
 * 
 * 负责创建和配置 Three.js 的基础场景，包括：
 * - Scene（场景）
 * - PerspectiveCamera（透视相机）
 * - WebGLRenderer（渲染器）
 * - 灯光系统（方向光 + 环境光）
 * - 可选的网格地面
 * - OrbitControls（轨道控制器，可通过参数启用/禁用）
 * - 窗口大小响应式处理
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// 场景配置接口
export interface SceneConfig {
  container: HTMLElement;          // 画布容器
  enableOrbitControls?: boolean;   // 是否启用轨道控制器（调试用）
  showGrid?: boolean;              // 是否显示网格地面
  backgroundColor?: number | null; // 背景颜色，null 表示透明
}

// 场景上下文，包含所有场景相关对象
export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls | null;
  lights: {
    directional: THREE.DirectionalLight;
    ambient: THREE.AmbientLight;
    hemisphere: THREE.HemisphereLight;
    fill: THREE.DirectionalLight;
    back: THREE.DirectionalLight;
  };
  starfield: THREE.Points | null;  // 星空背景
}

/**
 * 初始化 Three.js 场景
 * @param config 场景配置
 * @returns 场景上下文对象
 */
export function initScene(config: SceneConfig): SceneContext {
  const {
    container,
    enableOrbitControls = true,
    backgroundColor = 0x000000  // 纯黑色背景，传 null 则透明
  } = config;

  // 创建场景
  const scene = new THREE.Scene();
  scene.background = backgroundColor === null ? null : new THREE.Color(backgroundColor);
  
  // 不添加雾效果，保持简洁

  // 创建透视相机
  const aspect = container.clientWidth / container.clientHeight;
  const camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
  camera.position.set(0, 1.4, 5);  // 略低相机高度
  camera.lookAt(0, 0.0, 0);        // 视角稍向下，使模型整体更靠屏幕下方

  // 创建 WebGL 渲染器
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance'
  });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setClearColor(0x000000, backgroundColor === null ? 0 : 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  container.appendChild(renderer.domElement);

  // 创建灯光系统
  const lights = createLights(scene);

  // 创建星空背景
  const starfield = createStarfield(scene);

  // 可选：创建轨道控制器
  let controls: OrbitControls | null = null;
  if (enableOrbitControls) {
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 2;
    controls.maxDistance = 15;
    controls.maxPolarAngle = Math.PI * 0.85;
    controls.target.set(0, 0.05, 0);  // 让视角中心下移
    controls.update();
  }

  // 处理窗口大小变化
  const handleResize = () => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    
    renderer.setSize(width, height);
  };
  
  window.addEventListener('resize', handleResize);

  return {
    scene,
    camera,
    renderer,
    controls,
    lights,
    starfield
  };
}

/**
 * 创建灯光系统 - 简洁的白色照明
 */
function createLights(scene: THREE.Scene) {
  // 主方向光 - 白色
  const directional = new THREE.DirectionalLight(0xffffff, 1.5);
  directional.position.set(5, 10, 5);
  directional.castShadow = true;
  directional.shadow.mapSize.width = 2048;
  directional.shadow.mapSize.height = 2048;
  directional.shadow.camera.near = 0.5;
  directional.shadow.camera.far = 50;
  directional.shadow.camera.left = -10;
  directional.shadow.camera.right = 10;
  directional.shadow.camera.top = 10;
  directional.shadow.camera.bottom = -10;
  scene.add(directional);

  // 环境光 - 中性白色
  const ambient = new THREE.AmbientLight(0xffffff, 0.45);
  scene.add(ambient);

  // 天空+地面半球光，柔和填充 360° 立体感
  const hemisphere = new THREE.HemisphereLight(0xddeeff, 0x202020, 0.5);
  hemisphere.position.set(0, 6, 0);
  scene.add(hemisphere);

  // 补光 - 白色，从侧面照亮
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
  fillLight.position.set(-5, 3, 5);
  scene.add(fillLight);

  // 背光 - 让背面也被照亮，避免全黑
  const backLight = new THREE.DirectionalLight(0xffffff, 0.5);
  backLight.position.set(-6, 4, -6);
  scene.add(backLight);

  return { directional, ambient, hemisphere, fill: fillLight, back: backLight };
}

/**
 * 创建星空背景 - 闪烁的星星粒子
 */
function createStarfield(scene: THREE.Scene): THREE.Points {
  const starCount = 800;
  const geometry = new THREE.BufferGeometry();
  
  const positions = new Float32Array(starCount * 3);
  const sizes = new Float32Array(starCount);
  const phases = new Float32Array(starCount);  // 闪烁相位
  
  for (let i = 0; i < starCount; i++) {
    // 在球形范围内分布星星
    const radius = 15 + Math.random() * 35;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = radius * Math.cos(phi);
    
    sizes[i] = 0.5 + Math.random() * 1.5;
    phases[i] = Math.random() * Math.PI * 2;
  }
  
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
  
  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.08,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  
  const starfield = new THREE.Points(geometry, material);
  starfield.name = 'starfield';
  scene.add(starfield);
  
  return starfield;
}


/**
 * 更新场景动画效果
 * @param context 场景上下文
 * @param time 时间（毫秒）
 */
export function updateSceneEffects(context: SceneContext, time: number) {
  // 更新轨道控制器
  if (context.controls) {
    context.controls.update();
  }
  
  // 更新星空效果
  if (context.starfield) {
    updateStarfield(context.starfield, time);
  }
}

/**
 * 更新星空闪烁和移动效果
 */
function updateStarfield(starfield: THREE.Points, time: number) {
  const t = time * 0.001;
  
  // 整体缓慢旋转
  starfield.rotation.y = t * 0.02;
  starfield.rotation.x = Math.sin(t * 0.01) * 0.1;
  
  // 更新星星闪烁
  const geometry = starfield.geometry;
  const positions = geometry.getAttribute('position');
  const phases = geometry.getAttribute('phase');
  
  if (positions && phases) {
    const posArray = positions.array as Float32Array;
    const phaseArray = phases.array as Float32Array;
    
    // 让部分星星有微小的位置波动
    for (let i = 0; i < phaseArray.length; i++) {
      const phase = phaseArray[i];
      
      // 微小的位置波动
      const originalY = posArray[i * 3 + 1];
      posArray[i * 3 + 1] = originalY + Math.sin(t + phase) * 0.01;
    }
    
    positions.needsUpdate = true;
  }
  
  // 整体透明度呼吸效果
  const material = starfield.material as THREE.PointsMaterial;
  material.opacity = 0.6 + Math.sin(t * 0.5) * 0.2;
}



