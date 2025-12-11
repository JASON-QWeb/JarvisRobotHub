/**
 * main.ts - 主入口文件（手势+键盘鼠标控制版本）
 * 
 * 交互方式：
 * ===== 键盘控制 =====
 * - A键长按：拆解（分离）
 * - S键长按：聚拢
 * - 上/下箭头：切换材质模式（默认/金属/线框）
 * - 左/右箭头：切换零件
 * - ESC：返回上级
 * 
 * ===== 手势控制 =====
 * - 五指张开：拆解（分离）
 * - 五指合拢：聚拢 + 返回上级
 * - 上/下/左/右挥动：切换材质/零件（带防抖）
 * - 食指指向：控制鼠标位置
 * - 食指+大拇指捏合两下：双击选择
 * - 三指（食指+大拇指+中指）：旋转视角 + 缩放
 * 
 * ===== 鼠标控制 =====
 * - 鼠标悬停：高亮部件（标红）
 * - 双击左键：进入组件页面
 */

import { initScene, updateSceneEffects, SceneContext } from './three/initScene';
import { loadMechModel, MechModel, updateGlowEffects, applyMaterialMode } from './three/loadMech';
import { KeyboardController, createKeyboardController } from './interaction/keyboardController';
import { SimpleMouseController, createSimpleMouseController } from './interaction/simpleMouseController';
import { GestureController, createGestureController } from './interaction/gestureController';
import { SimpleStateMachine, createSimpleStateMachine, SimpleViewState } from './state/SimpleStateMachine';
import { PartId, PART_DISPLAY_NAMES, PART_DISPLAY_NAMES_EN, MECH_HIERARCHY, MaterialMode } from './types/mechConfig';

// 获取当前语言（从全局变量或 localStorage）
function getCurrentLang(): 'zh' | 'en' {
  // 优先从全局变量获取
  if (typeof (window as any).currentLang !== 'undefined') {
    return (window as any).currentLang;
  }
  // 否则从 localStorage 获取
  const saved = localStorage.getItem('jarvis-lang');
  return (saved === 'en') ? 'en' : 'zh';
}

// 获取部件显示名称（支持多语言）
function getPartName(partId: PartId): string {
  const lang = getCurrentLang();
  return lang === 'en' ? PART_DISPLAY_NAMES_EN[partId] : PART_DISPLAY_NAMES[partId];
}

// ============================================
// 应用配置
// ============================================
const APP_CONFIG = {
  MODEL_PATH: '/assets/models/robot.glb',
  DEBUG_MODE: true
};

// ============================================
// 应用状态
// ============================================
interface AppState {
  sceneContext: SceneContext | null;
  mechModel: MechModel | null;
  stateMachine: SimpleStateMachine | null;
  keyboardController: KeyboardController | null;
  mouseController: SimpleMouseController | null;
  gestureController: GestureController | null;
  isRunning: boolean;
  lastTime: number;
  materialMode: MaterialMode;
  // 手势模拟鼠标位置
  gestureMouseX: number;
  gestureMouseY: number;
}

const appState: AppState = {
  sceneContext: null,
  mechModel: null,
  stateMachine: null,
  keyboardController: null,
  mouseController: null,
  gestureController: null,
  isRunning: false,
  lastTime: 0,
  materialMode: 'default',
  gestureMouseX: 0.5,
  gestureMouseY: 0.5
};

// 材质模式序列
const MATERIAL_MODES: MaterialMode[] = ['default', 'metal', 'wire'];

// ============================================
// 主初始化函数
// ============================================
async function init(): Promise<void> {
  //console.log('🚀 机甲控制系统初始化...');
  //console.log('📋 控制方式: A=拆解, S=聚拢, 鼠标悬停高亮, 双击进入, 上下切换, ESC返回');
  
  const canvasContainer = document.getElementById('canvas-container');
  if (!canvasContainer) {
    //console.error('找不到 canvas-container');
    return;
  }
  
  try {
    // 更新加载状态
    updateLoadingStatus('初始化 Three.js 场景...');
    updateLoadingProgress(10);
    
    // 1. 初始化 Three.js 场景（纯黑色背景，无特效）
    appState.sceneContext = initScene({
      container: canvasContainer,
      enableOrbitControls: true,
      showGrid: false,
    backgroundColor: null
    });
    
    updateLoadingStatus('加载机甲模型...');
    updateLoadingProgress(25);
    
    // 2. 加载机甲模型
    appState.mechModel = await loadMechModel(appState.sceneContext.scene, {
      modelPath: APP_CONFIG.MODEL_PATH,
      onProgress: (progress) => {
        updateLoadingProgress(25 + progress * 0.25);
      },
      scale: 1
    });
    // 默认材质模式
    applyMaterialMode(appState.mechModel, appState.materialMode);
    // 默认材质模式
    applyMaterialMode(appState.mechModel, appState.materialMode);
    
    updateLoadingStatus('初始化状态机...');
    updateLoadingProgress(55);
    
    // 3. 初始化状态机
    appState.stateMachine = createSimpleStateMachine({
      onStateChange: handleStateChange,
      onExplosionChange: handleExplosionChange,
      onHoverChange: handleHoverChange,
      onPartListChange: handlePartListChange
    });
    appState.stateMachine.init(appState.mechModel, appState.sceneContext.scene);
    
    updateLoadingStatus('初始化控制器...');
    updateLoadingProgress(70);
    
    // 4. 环形菜单已移除，改用3D环形装饰
    
    // 5. 初始化键盘控制器
    appState.keyboardController = createKeyboardController({
      onExplosionChange: (delta) => {
        appState.stateMachine?.adjustExplosion(delta);
      },
      onNavigateLeftRight: (direction) => {
        appState.stateMachine?.navigateLeftRight(direction);
      },
      onMaterialModeChange: (direction) => {
        cycleMaterialMode(direction);
      },
      onEscape: () => {
        appState.stateMachine?.goBack();
      },
      onEnter: () => {
        // Enter 键确认选择当前高亮的部件
        appState.stateMachine?.selectHoveredPart();
      }
    });
    
    // 5. 初始化鼠标控制器（高亮由鼠标控制器自己处理）
    appState.mouseController = createSimpleMouseController(
      appState.sceneContext.camera,
      canvasContainer,
      {
        onHover: (partId, _hoveredMeshes) => {
          // 只更新状态，高亮已由鼠标控制器处理
          appState.stateMachine?.setHoveredPartId(partId);
        },
        onDoubleClick: (_partId) => {
          appState.stateMachine?.selectHoveredPart();
        }
      }
    );
    appState.mouseController.setModel(appState.mechModel);
    appState.mouseController.setInteractableParts([...MECH_HIERARCHY.majorParts]);
    
    updateLoadingStatus('初始化手势控制...');
    updateLoadingProgress(85);
    
    // 6. 初始化双手手势控制器
    // 右手：零件交互（拆解、聚拢、切换、选择、光标）
    // 左手：视角控制（握拳旋转、捏合缩放）
    appState.gestureController = createGestureController({
      // ===== 右手回调 =====
      onExplosionChange: (delta) => {
        appState.stateMachine?.adjustExplosion(delta);
      },
      onNavigateUpDown: (direction) => {
        cycleMaterialMode(direction === 'up' ? 'up' : 'down');
      },
      onNavigateLeftRight: (direction) => {
        appState.stateMachine?.navigateLeftRight(direction);
      },
      onMouseMove: (x, y) => {
        appState.gestureMouseX = x;
        appState.gestureMouseY = y;
        simulateMouseMoveFromGesture(x, y, canvasContainer);
      },
      onClick: () => {
        // 单次捏合点击 = 选择/确认
        appState.stateMachine?.selectHoveredPart();
      },
      onEscape: () => {
        appState.stateMachine?.goBack();
      },
      
      // ===== 左手回调 =====
      onRotateView: (deltaX, deltaY) => {
        // 左手握拳拖动 → 旋转视角
        if (appState.sceneContext?.controls) {
          const controls = appState.sceneContext.controls;
          // 水平旋转（方位角）
          const azimuthDelta = -deltaX * Math.PI * 0.5;
          const polarDelta = -deltaY * Math.PI * 0.3;
          
          // 获取当前球坐标
          const spherical = controls.object.position.clone()
            .sub(controls.target)
            .normalize();
          
          // 更新相机位置
          const distance = controls.getDistance();
          const theta = Math.atan2(spherical.x, spherical.z) + azimuthDelta;
          const phi = Math.acos(Math.max(-1, Math.min(1, spherical.y))) + polarDelta;
          const clampedPhi = Math.max(0.1, Math.min(Math.PI * 0.85, phi));
          
          controls.object.position.set(
            distance * Math.sin(clampedPhi) * Math.sin(theta),
            distance * Math.cos(clampedPhi),
            distance * Math.sin(clampedPhi) * Math.cos(theta)
          ).add(controls.target);
          
          controls.update();
        }
      },
      onZoom: (delta) => {
        // 左手捏合 → 缩放
        if (appState.sceneContext?.camera && appState.sceneContext?.controls) {
          const camera = appState.sceneContext.camera;
          const controls = appState.sceneContext.controls;
          const target = controls.target.clone();
          
          const direction = camera.position.clone().sub(target).normalize();
          const currentDistance = camera.position.distanceTo(target);
          const newDistance = Math.max(
            controls.minDistance,
            Math.min(controls.maxDistance, currentDistance + delta)
          );
          
          camera.position.copy(target).add(direction.multiplyScalar(newDistance));
          controls.update();
        }
      },
      // ===== 通用 =====
      onGestureChange: (gesture, hand) => {
        //console.log(`[${hand === 'right' ? '右手' : '左手'}] 手势: ${gesture}`);
      }
    });
    
    // 异步初始化手势控制器（不阻塞主流程）
    appState.gestureController.init().then((success) => {
      if (success) {
        //console.log('✅ 双手手势控制器 V2 初始化成功');
      } else {
        //console.warn('⚠️ 手势控制器初始化失败，仅使用键鼠控制');
      }
    });
    
    updateLoadingProgress(100);
    // 根据语言显示加载完成文字
    const isEn = (typeof (window as any).currentLang !== 'undefined' && (window as any).currentLang === 'en') 
      || localStorage.getItem('jarvis-lang') === 'en';
    updateLoadingStatus(isEn ? 'Ready!' : '准备就绪！');
    
    // 隐藏加载屏幕
    setTimeout(() => {
      hideLoadingScreen();
    }, 500);
    
    // 6. 启动渲染循环
    appState.isRunning = true;
    appState.lastTime = performance.now();
    animate();
    
    //console.log('✅ 初始化完成！');
    //console.log('📦 已绑定部件数:', appState.mechModel.parts.size);
    
  } catch (error) {
    //console.error('初始化失败:', error);
    updateLoadingStatus('初始化失败，请刷新页面');
  }
}

// ============================================
// 回调处理
// ============================================

function handleStateChange(newState: SimpleViewState, oldState: SimpleViewState): void {
  //console.log(`📍 状态变化: ${oldState} → ${newState}`);
  
  // 更新 UI
  updateModeStatus(newState);
  
  // 更新可交互部件
  if (appState.mouseController && appState.stateMachine) {
    const parts = appState.stateMachine.getInteractableParts();
    appState.mouseController.setInteractableParts(parts);
  }
  
  // 组件视图时隐藏光标指示器
  const cursor = document.getElementById('gesture-cursor');
  if (cursor) {
    if (newState === 'PartView') {
      cursor.classList.add('part-view-hidden');
    } else {
      cursor.classList.remove('part-view-hidden');
    }
  }
}

function handleExplosionChange(global: number, part: number): void {
  updateExplosionPercent(global, part);
}

function handleHoverChange(_partId: PartId | null, displayName: string | null): void {
  updateHoveredPart(displayName);
}

function handlePartListChange(parts: PartId[], currentIndex: number, selectedPart: PartId | null): void {
  updatePartList(parts, currentIndex, selectedPart);
  
  // 同步可交互部件（包含当前组件的子件，支持二次拆解 hover）
  if (appState.mouseController && appState.stateMachine) {
    const interactable = appState.stateMachine.getInteractableParts();
    appState.mouseController.setInteractableParts(interactable);
  }
  
}

// ============================================
// 材质模式切换
// ============================================

function cycleMaterialMode(direction: 'up' | 'down'): void {
  if (!appState.mechModel) return;
  
  const currentIndex = MATERIAL_MODES.indexOf(appState.materialMode);
  const delta = direction === 'up' ? 1 : -1;
  const nextIndex = (currentIndex + delta + MATERIAL_MODES.length) % MATERIAL_MODES.length;
  const nextMode = MATERIAL_MODES[nextIndex];
  
  appState.materialMode = nextMode;
  applyMaterialMode(appState.mechModel, nextMode);
  
  const label = nextMode === 'default' ? '默认' : nextMode === 'metal' ? '金属' : '线框';
  //console.log(`[MaterialMode] 切换到 ${label}`);
}

// ============================================
// 手势模拟鼠标移动
// ============================================
function simulateMouseMoveFromGesture(x: number, y: number, container: HTMLElement): void {
  // 将标准化坐标转换为容器内的像素坐标
  const rect = container.getBoundingClientRect();
  const clientX = rect.left + x * rect.width;
  const clientY = rect.top + y * rect.height;
  
  // 创建并分发模拟的鼠标事件
  const event = new MouseEvent('mousemove', {
    bubbles: true,
    cancelable: true,
    clientX: clientX,
    clientY: clientY,
    view: window
  });
  
  container.dispatchEvent(event);
}

// ============================================
// UI 更新函数
// ============================================

function updateLoadingStatus(status: string): void {
  const el = document.getElementById('loading-status');
  if (el) el.textContent = status;
}

function updateLoadingProgress(percent: number): void {
  const el = document.getElementById('loading-progress');
  if (el) el.style.width = `${percent}%`;
}

function hideLoadingScreen(): void {
  const el = document.getElementById('loading-screen');
  if (el) el.style.display = 'none';
}

function updateModeStatus(state: SimpleViewState): void {
  const el = document.getElementById('mode-status');
  if (el) {
    const names: Record<SimpleViewState, string> = {
      'Assembled': '组装',
      'Exploded': '拆解',
      'PartView': '组件视图'
    };
    el.textContent = names[state];
  }
}

function updateExplosionPercent(global: number, part: number): void {
  const el = document.getElementById('explosion-percent');
  const ring = document.getElementById('explosion-ring');
  
  const percent = Math.round(Math.max(global, part) * 100);
  if (el) el.textContent = String(percent);
  if (ring) {
    const circumference = 2 * Math.PI * 40;
    const offset = circumference * (1 - percent / 100);
    ring.style.strokeDashoffset = String(offset);
  }
}

function updateHoveredPart(displayName: string | null): void {
  const name = document.getElementById('focus-part-name');
  
  if (name) {
    if (displayName) {
      name.textContent = displayName;
    } else {
      // 默认显示"机器人/Robot"
      const lang = getCurrentLang();
      name.textContent = lang === 'en' ? 'Robot' : '机器人';
    }
  }
}

// updateHint 函数保留，可能在其他地方使用
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function updateHint(hint: string): void {
  const el = document.getElementById('hint-main');
  if (el) el.textContent = hint;
}

function updatePartList(parts: PartId[], currentIndex: number, selectedPart: PartId | null): void {
  // 更新列表 UI
  const currentPart = selectedPart || parts[currentIndex];
  if (currentPart) {
    updateHoveredPart(getPartName(currentPart));
  }
}

// ============================================
// 动画循环
// ============================================

function animate(): void {
  if (!appState.isRunning) return;
  
  requestAnimationFrame(animate);
  
  const currentTime = performance.now();
  const deltaTime = currentTime - appState.lastTime;
  appState.lastTime = currentTime;
  
  // 更新键盘控制器（检测A/S键）
  appState.keyboardController?.update();
  
  // 更新状态机
  appState.stateMachine?.update(deltaTime);
  
  // 更新场景效果
  if (appState.sceneContext) {
    updateSceneEffects(appState.sceneContext, currentTime);
  }
  
  // 更新模型发光效果
  if (appState.mechModel) {
    updateGlowEffects(appState.mechModel, currentTime);
  }
  
  // 渲染场景
  if (appState.sceneContext) {
    appState.sceneContext.renderer.render(
      appState.sceneContext.scene,
      appState.sceneContext.camera
    );
  }
}

// ============================================
// 清理
// ============================================

// 暴露简单的场景开关供前端 UI 调用（沉浸模式隐藏星空）
(window as any).setStarfieldVisible = (visible: boolean) => {
  const starfield = appState.sceneContext?.starfield;
  if (starfield) {
    starfield.visible = visible;
  }
};

function cleanup(): void {
  appState.isRunning = false;
  appState.keyboardController?.dispose();
  appState.mouseController?.dispose();
  appState.gestureController?.dispose();
  appState.stateMachine?.dispose();
  
  if (appState.sceneContext) {
    appState.sceneContext.renderer.dispose();
  }
  
  //console.log('🧹 资源已清理');
}

window.addEventListener('beforeunload', cleanup);

// DOM 加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export { appState, APP_CONFIG };

