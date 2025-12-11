/**
 * gestureController.ts - 3D 机甲手势交互控制器
 * 
 * 基于 docs/gesture-control.md 规范实现
 * 
 * ===== 核心设计 =====
 * - 左手：只做模式切换（比划 1/2/3/4）
 * - 右手：根据当前模式执行具体操作
 * 
 * ===== 四种模式 =====
 * 1. 监视模式（左手比划1）：右手张开控制视角旋转
 * 2. 缩放模式（左手比划2）：右手张开放大，握拳缩小
 * 3. 拆解模式（左手比划3）：右手张开拆解，食指点击选择，握拳聚合
 * 4. 组件模式（左手比划4）：右手张开挥动切换材质/组件
 * 
 * ===== 模式切换规则 =====
 * - 左手比划稳定 0.5-0.8 秒后切换
 * - 手势切换每个模式至少持续 5 秒
 * - 鼠标点击切换不受 5 秒限制
 * - 60 秒无交互自动回到监视模式
 */

// ============================================
// MediaPipe 类型声明
// ============================================

interface NormalizedLandmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

interface HandsResults {
  image: HTMLVideoElement | HTMLCanvasElement;
  multiHandLandmarks?: NormalizedLandmark[][];
  multiHandedness?: { label: string; score: number }[];
}

interface HandsOptions {
  maxNumHands?: number;
  modelComplexity?: number;
  minDetectionConfidence?: number;
  minTrackingConfidence?: number;
}

interface HandsInterface {
  setOptions(options: HandsOptions): void;
  onResults(callback: (results: HandsResults) => void): void;
  send(data: { image: HTMLVideoElement }): Promise<void>;
  close(): void;
}

interface CameraOptions {
  onFrame: () => Promise<void>;
  width: number;
  height: number;
}

interface CameraInterface {
  start(): Promise<void>;
  stop(): void;
}

async function loadMediaPipeScripts(): Promise<void> {
  const scripts = [
    'https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js',
    'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js',
  ];
  
  for (const src of scripts) {
    if (!document.querySelector(`script[src="${src}"]`)) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.crossOrigin = 'anonymous';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
      });
    }
  }
}

declare global {
  interface Window {
    Hands: new (config: { locateFile: (file: string) => string }) => HandsInterface;
    Camera: new (video: HTMLVideoElement, options: CameraOptions) => CameraInterface;
    gestureController?: GestureController;  // 暴露给全局用于UI切换
  }
}

// ============================================
// 类型定义
// ============================================

/** 手势类型（导出兼容） */
export type GestureType = 
  | 'open_palm'      // 五指张开
  | 'closed_fist'    // 握拳
  | 'pinch'          // 捏合
  | 'pointing'       // 食指指向
  | 'none';          // 无手势

/** 手型类型 */
type HandShape = 'open' | 'fist' | 'one' | 'two' | 'three' | 'four' | 'pointer' | 'other';

/** 系统模式 */
export type GestureMode = 'watch' | 'zoom' | 'explode' | 'component';

/** 模式名称映射 */
const MODE_NAMES: Record<GestureMode, { zh: string; en: string }> = {
  'watch': { zh: '监视模式', en: 'Watch Mode' },
  'zoom': { zh: '缩放模式', en: 'Zoom Mode' },
  'explode': { zh: '拆解模式', en: 'Explode Mode' },
  'component': { zh: '组件模式', en: 'Component Mode' }
};

/** 回调接口 */
export interface GestureCallbacks {
  // 模式切换回调
  onModeChange?: (mode: GestureMode, modeName: string) => void;
  
  // 监视模式回调
  onRotateView?: (deltaX: number, deltaY: number) => void;  // 视角旋转
  
  // 缩放模式回调
  onZoom?: (delta: number) => void;                         // 缩放
  
  // 拆解模式回调
  onExplosion?: () => void;                       // 模型爆炸
  onAggregation?: () => void;                     // 模型聚合
  onExplosionChange?: (delta: number) => void;   // 持续爆炸变化（兼容旧API）
  onEscape?: () => void;                          // 返回/聚合（兼容旧API）
  onMouseMove?: (x: number, y: number) => void;   // 光标移动
  onClick?: () => void;                           // 点击选择组件
  
  // 组件模式回调
  onNavigateUpDown?: (direction: 'up' | 'down') => void;        // 上下切换材质
  onNavigateLeftRight?: (direction: 'left' | 'right') => void;  // 左右切换组件
  
  // 通用回调
  onGestureChange?: (gesture: string, hand: 'left' | 'right' | 'both') => void;
}

// ============================================
// 配置常量
// ============================================
const CONFIG = {
  // 模式切换
  MODE_SWITCH_STABLE_TIME: 500,       // 模式切换需要稳定时间 (ms)
  MODE_SWITCH_STABLE_TIME_3: 600,     // 比划3的稳定时间
  MODE_SWITCH_STABLE_TIME_4: 800,     // 比划4的稳定时间
  MODE_LOCK_DURATION: 5000,           // 手势模式锁定最短时间 (ms)
  AUTO_RESET_TIMEOUT: 60000,          // 无交互自动回到监视模式 (ms)
  
  // 监视模式 - 视角旋转
  NEUTRAL_ZONE_RATIO: 0.12,           // 中立区域半径
  ROTATION_SENSITIVITY: 3.5,          // 旋转灵敏度
  ROTATION_MAX_SPEED: 0.06,           // 最大旋转速度
  
  // 缩放模式
  ZOOM_SPEED: 0.025,                  // 持续缩放速度（提高）
  ZOOM_ACCELERATION_TIME: 250,        // 缩放加速时间 (ms)
  
  // 拆解模式
  EXPLOSION_SPEED: 0.008,             // 缓慢分解速度
  EXPLOSION_COOLDOWN: 1500,           // 爆炸冷却时间 (ms)
  AGGREGATION_BLOCK_TIME: 3000,       // 拆解后禁止聚合时间 (ms)
  PINCH_THRESHOLD: 0.08,              // 捏合判定阈值
  PINCH_RELEASE_THRESHOLD: 0.12,      // 捏合释放阈值
  HOVER_CLICK_TIME: 2000,             // hover自动点击时间 (ms)
  
  // 组件模式
  SWIPE_DISTANCE_THRESHOLD: 0.12,     // 挥动距离阈值
  SWIPE_SPEED_THRESHOLD: 0.008,       // 挥动速度阈值
  MATERIAL_SWIPE_COOLDOWN: 3000,      // 材质切换冷却 (ms)
  COMPONENT_SWIPE_COOLDOWN: 1000,     // 组件切换冷却 (ms)
  
  // 手型判定
  FINGER_EXTENDED_RATIO: 0.75,        // 手指伸展判定比值
  FINGER_CURLED_RATIO: 0.55,          // 手指弯曲判定比值
  STABLE_FRAMES: 4,                   // 连续帧稳定阈值
  
  // 光标
  MOUSE_SMOOTHING: 0.25,              // 光标平滑系数
};

/** 关键点索引 */
const LANDMARKS = {
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
};

// ============================================
// 手势控制器类
// ============================================
export class GestureController {
  private hands: HandsInterface | null = null;
  private camera: CameraInterface | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private canvasElement: HTMLCanvasElement | null = null;
  private canvasCtx: CanvasRenderingContext2D | null = null;
  
  private callbacks: GestureCallbacks;
  private enabled: boolean = false;
  private initialized: boolean = false;
  
  // ===== 核心状态 =====
  private currentMode: GestureMode = 'watch';
  private lastModeChangeTime: number = 0;
  private lastInteractionTime: number = 0;
  private lastFrameTime: number = 0;
  private deltaTime: number = 0;
  private modeSwitchByGesture: boolean = true;  // 是否通过手势切换（用于判断是否受CD控制）
  
  // ===== 左手状态（模式切换）=====
  private leftShape: HandShape = 'other';
  private leftShapeStableCount: number = 0;
  private lastLeftShape: HandShape = 'other';
  private leftModeGestureStartTime: number = 0;
  private leftPendingMode: GestureMode | null = null;
  
  // ===== 右手状态 =====
  private rightShape: HandShape = 'other';
  private rightShapeStableCount: number = 0;
  private lastRightShape: HandShape = 'other';
  private rightHandPosition = { x: 0.5, y: 0.5, z: 0 };
  private lastRightHandPosition = { x: 0.5, y: 0.5, z: 0 };
  
  // 监视模式状态
  private isRotating: boolean = false;
  
  // 缩放模式状态
  private isZooming: boolean = false;
  private zoomStartTime: number = 0;
  private zoomDirection: number = 0;  // 1=放大, -1=缩小, 0=停止
  
  // 拆解模式状态
  private isExploding: boolean = false;       // 是否正在缓慢分解
  private lastExplosionTime: number = 0;
  private lastAggregationTime: number = 0;
  private isInClickMode: boolean = false;
  private aggregationBlockedUntil: number = 0;  // 聚合被阻止直到此时间
  private isPinching: boolean = false;
  private pinchStartTime: number = 0;
  private smoothedCursorX: number = 0.5;
  private smoothedCursorY: number = 0.5;
  private cursorElement: HTMLElement | null = null;
  private hoverStartTime: number = 0;         // hover开始时间
  private lastHoverX: number = 0;             // 上次hover位置
  private lastHoverY: number = 0;
  
  // 组件模式状态
  private swipeStartPosition = { x: 0, y: 0 };
  private swipeStartTime: number = 0;
  private lastMaterialSwipeTime: number = 0;
  private lastComponentSwipeTime: number = 0;
  private rightPositionHistory: { x: number; y: number; time: number }[] = [];
  
  // UI 元素
  private modeDisplayElement: HTMLElement | null = null;
  
  constructor(callbacks: GestureCallbacks = {}) {
    this.callbacks = callbacks;
  }
  
  // ============================================
  // 初始化
  // ============================================
  async init(): Promise<boolean> {
    try {
      this.videoElement = document.getElementById('webcam') as HTMLVideoElement;
      this.canvasElement = document.getElementById('hand-canvas') as HTMLCanvasElement;
      
      if (!this.videoElement || !this.canvasElement) {
        console.error('[GestureController] 找不到视频或画布元素');
        return false;
      }
      
      this.canvasCtx = this.canvasElement.getContext('2d');
      
      console.log('[GestureController] 加载 MediaPipe 脚本...');
      await loadMediaPipeScripts();
      await new Promise(resolve => setTimeout(resolve, 100));
      
      if (!window.Hands || !window.Camera) {
        console.error('[GestureController] MediaPipe 未正确加载');
        return false;
      }
      
      this.hands = new window.Hands({
        locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
      });
      
      this.hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.6,
      });
      
      this.hands.onResults(this.onResults.bind(this));
      
      this.camera = new window.Camera(this.videoElement, {
        onFrame: async () => {
          if (this.enabled && this.hands && this.videoElement) {
            await this.hands.send({ image: this.videoElement });
          }
        },
        width: 640,
        height: 480,
      });
      
      await this.camera.start();
      
      this.canvasElement.width = 640;
      this.canvasElement.height = 480;
      
      // 获取 UI 元素
      this.cursorElement = document.getElementById('gesture-cursor');
      this.modeDisplayElement = document.getElementById('gesture-mode-display');
      
      this.initialized = true;
      this.enabled = true;
      this.lastFrameTime = Date.now();
      this.lastInteractionTime = Date.now();
      this.lastModeChangeTime = Date.now();
      
      // 初始化为监视模式
      this.setMode('watch', false);
      
      // 暴露到全局供UI调用
      window.gestureController = this;
      
      console.log('[GestureController] ✅ 四模式手势控制器初始化成功');
      this.updateHandStatus(true);
      
      return true;
    } catch (error) {
      console.error('[GestureController] 初始化失败:', error);
      return false;
    }
  }
  
  // ============================================
  // 基础计算工具函数
  // ============================================
  
  /** 计算两点间的 2D 距离 */
  private dist2D(a: NormalizedLandmark, b: NormalizedLandmark): number {
    return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
  }
  
  /** 获取掌宽（手腕到中指 MCP 的距离） */
  private getPalmWidth(landmarks: NormalizedLandmark[]): number {
    return this.dist2D(landmarks[LANDMARKS.WRIST], landmarks[LANDMARKS.MIDDLE_MCP]);
  }
  
  /** 获取手掌中心位置 */
  private getPalmCenter(landmarks: NormalizedLandmark[]): { x: number; y: number; z: number } {
    const wrist = landmarks[LANDMARKS.WRIST];
    const indexMcp = landmarks[LANDMARKS.INDEX_MCP];
    const middleMcp = landmarks[LANDMARKS.MIDDLE_MCP];
    const pinkyMcp = landmarks[LANDMARKS.PINKY_MCP];
    return {
      x: (wrist.x + indexMcp.x + middleMcp.x + pinkyMcp.x) / 4,
      y: (wrist.y + indexMcp.y + middleMcp.y + pinkyMcp.y) / 4,
      z: (wrist.z || 0) + (indexMcp.z || 0) + (middleMcp.z || 0) + (pinkyMcp.z || 0) / 4
    };
  }
  
  /** 获取指尖到手腕的相对距离（相对于掌宽） */
  private getFingerTipRatio(landmarks: NormalizedLandmark[], tipIndex: number): number {
    const palmWidth = this.getPalmWidth(landmarks);
    if (palmWidth < 0.01) return 0;
    return this.dist2D(landmarks[tipIndex], landmarks[LANDMARKS.WRIST]) / palmWidth;
  }
  
  /** 获取捏合距离（拇指尖到食指尖的距离，相对于掌宽） */
  private getPinchRatio(landmarks: NormalizedLandmark[]): number {
    const palmWidth = this.getPalmWidth(landmarks);
    if (palmWidth < 0.01) return 1;
    return this.dist2D(landmarks[LANDMARKS.THUMB_TIP], landmarks[LANDMARKS.INDEX_TIP]) / palmWidth;
  }
  
  /** 判断手指是否伸展 */
  private isFingerExtended(landmarks: NormalizedLandmark[], tipIndex: number): boolean {
    return this.getFingerTipRatio(landmarks, tipIndex) > CONFIG.FINGER_EXTENDED_RATIO;
  }
  
  /** 判断手指是否弯曲 */
  private isFingerCurled(landmarks: NormalizedLandmark[], tipIndex: number): boolean {
    return this.getFingerTipRatio(landmarks, tipIndex) < CONFIG.FINGER_CURLED_RATIO;
  }
  
  // ============================================
  // 手型判定
  // ============================================
  
  /** 判定手型 */
  private getHandShape(landmarks: NormalizedLandmark[]): HandShape {
    const palmWidth = this.getPalmWidth(landmarks);
    if (palmWidth < 0.01) return 'other';
    
    const indexExtended = this.isFingerExtended(landmarks, LANDMARKS.INDEX_TIP);
    const middleExtended = this.isFingerExtended(landmarks, LANDMARKS.MIDDLE_TIP);
    const ringExtended = this.isFingerExtended(landmarks, LANDMARKS.RING_TIP);
    const pinkyExtended = this.isFingerExtended(landmarks, LANDMARKS.PINKY_TIP);
    
    const indexCurled = this.isFingerCurled(landmarks, LANDMARKS.INDEX_TIP);
    const middleCurled = this.isFingerCurled(landmarks, LANDMARKS.MIDDLE_TIP);
    const ringCurled = this.isFingerCurled(landmarks, LANDMARKS.RING_TIP);
    const pinkyCurled = this.isFingerCurled(landmarks, LANDMARKS.PINKY_TIP);
    
    const extendedCount = [indexExtended, middleExtended, ringExtended, pinkyExtended].filter(Boolean).length;
    
    // 五指张开（3-4根手指伸出）
    if (extendedCount >= 3) {
      return 'open';
    }
    
    // 握拳：所有手指都弯曲（严格判定）
    if (indexCurled && middleCurled && ringCurled && pinkyCurled) {
      return 'fist';
    }
    
    // 比划 1：只有食指伸出
    if (indexExtended && middleCurled && ringCurled && pinkyCurled) {
      return 'one';
    }
    
    // 比划 2：食指和中指伸出
    if (indexExtended && middleExtended && ringCurled && pinkyCurled) {
      return 'two';
    }
    
    // 比划 3：食指、中指、无名指伸出
    if (indexExtended && middleExtended && ringExtended && pinkyCurled) {
      return 'three';
    }
    
    // 比划 4：四指伸出
    if (indexExtended && middleExtended && ringExtended && pinkyExtended) {
      return 'four';
    }
    
    // 指针姿态
    if (indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
      return 'pointer';
    }
    
    return 'other';
  }
  
  /** 判断是否为宽松握拳（仅在缩放模式使用：不是张开就算握拳） */
  private isLooseFist(landmarks: NormalizedLandmark[]): boolean {
    const indexExtended = this.isFingerExtended(landmarks, LANDMARKS.INDEX_TIP);
    const middleExtended = this.isFingerExtended(landmarks, LANDMARKS.MIDDLE_TIP);
    const ringExtended = this.isFingerExtended(landmarks, LANDMARKS.RING_TIP);
    const pinkyExtended = this.isFingerExtended(landmarks, LANDMARKS.PINKY_TIP);
    const extendedCount = [indexExtended, middleExtended, ringExtended, pinkyExtended].filter(Boolean).length;
    // 伸出手指少于等于2个就算握拳
    return extendedCount <= 2;
  }
  
  /** 更新手型稳定性 */
  private updateShapeStability(currentShape: HandShape, lastShape: HandShape, stableCount: number): { shape: HandShape; count: number } {
    if (currentShape === lastShape) {
      return { shape: currentShape, count: Math.min(stableCount + 1, CONFIG.STABLE_FRAMES * 3) };
    }
    return { shape: currentShape, count: 1 };
  }
  
  /** 判断手型是否稳定 */
  private isShapeStable(stableCount: number): boolean {
    return stableCount >= CONFIG.STABLE_FRAMES;
  }
  
  // ============================================
  // 模式切换
  // ============================================
  
  /** 设置当前模式（公开方法，供UI调用） */
  setMode(mode: GestureMode, byGesture: boolean = true): void {
    const now = Date.now();
    
    // 如果是手势切换，检查模式锁定
    if (byGesture && now - this.lastModeChangeTime < CONFIG.MODE_LOCK_DURATION && this.modeSwitchByGesture) {
      return;
    }
    
    if (this.currentMode !== mode) {
      this.currentMode = mode;
      this.lastModeChangeTime = now;
      this.lastInteractionTime = now;
      this.modeSwitchByGesture = byGesture;
      
      // 重置子状态
      this.resetModeSubStates();
      
      // 获取模式名称
      const isEn = this.isEnglish();
      const modeName = MODE_NAMES[mode][isEn ? 'en' : 'zh'];
      
      console.log(`[GestureController] 切换到：${modeName}${byGesture ? '（手势）' : '（点击）'}`);
      
      // 回调
      this.callbacks.onModeChange?.(mode, modeName);
      this.callbacks.onGestureChange?.(`mode_${mode}`, 'left');
      
      // 更新 UI
      this.updateModeDisplay();
    }
  }
  
  /** 重置模式子状态 */
  private resetModeSubStates(): void {
    this.isRotating = false;
    this.isZooming = false;
    this.zoomDirection = 0;
    this.isInClickMode = false;
    this.isPinching = false;
    this.swipeStartPosition = { x: 0.5, y: 0.5 };
    this.swipeStartTime = 0;
    this.rightPositionHistory = [];
    this.hideCursor();
  }
  
  /** 检查左手模式切换手势 */
  private checkLeftHandModeSwitch(now: number): void {
    // 手势模式锁定期间不处理
    if (this.modeSwitchByGesture && now - this.lastModeChangeTime < CONFIG.MODE_LOCK_DURATION) {
      this.leftModeGestureStartTime = 0;
      this.leftPendingMode = null;
      return;
    }
    
    // 检测左手比划
    let targetMode: GestureMode | null = null;
    let requiredStableTime = CONFIG.MODE_SWITCH_STABLE_TIME;
    
    if (this.leftShape === 'one' && this.isShapeStable(this.leftShapeStableCount)) {
      targetMode = 'watch';
      requiredStableTime = CONFIG.MODE_SWITCH_STABLE_TIME;
    } else if (this.leftShape === 'two' && this.isShapeStable(this.leftShapeStableCount)) {
      targetMode = 'zoom';
      requiredStableTime = CONFIG.MODE_SWITCH_STABLE_TIME;
    } else if (this.leftShape === 'three' && this.isShapeStable(this.leftShapeStableCount)) {
      targetMode = 'explode';
      requiredStableTime = CONFIG.MODE_SWITCH_STABLE_TIME_3;
    } else if (this.leftShape === 'four' && this.isShapeStable(this.leftShapeStableCount)) {
      targetMode = 'component';
      requiredStableTime = CONFIG.MODE_SWITCH_STABLE_TIME_4;
    }
    
    if (targetMode && targetMode !== this.currentMode) {
      if (this.leftPendingMode === targetMode) {
        // 继续计时
        if (now - this.leftModeGestureStartTime >= requiredStableTime) {
          this.setMode(targetMode, true);
          this.leftModeGestureStartTime = 0;
          this.leftPendingMode = null;
        }
      } else {
        // 开始新的计时
        this.leftPendingMode = targetMode;
        this.leftModeGestureStartTime = now;
      }
    } else {
      // 重置
      this.leftModeGestureStartTime = 0;
      this.leftPendingMode = null;
    }
  }
  
  /** 检查自动回退到监视模式 */
  private checkAutoReset(now: number): void {
    if (this.currentMode !== 'watch' && now - this.lastInteractionTime > CONFIG.AUTO_RESET_TIMEOUT) {
      console.log('[GestureController] 60秒无交互，自动回到监视模式');
      this.setMode('watch', false);
    }
  }
  
  // ============================================
  // MediaPipe 结果处理
  // ============================================
  private onResults(results: HandsResults): void {
    if (!this.canvasCtx || !this.canvasElement) return;
    
    // 计算帧时间
    const now = Date.now();
    this.deltaTime = now - this.lastFrameTime;
    this.lastFrameTime = now;
    
    // 绘制画面
    this.canvasCtx.save();
    this.canvasCtx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
    this.canvasCtx.translate(this.canvasElement.width, 0);
    this.canvasCtx.scale(-1, 1);
    this.canvasCtx.drawImage(results.image, 0, 0, this.canvasElement.width, this.canvasElement.height);
    this.canvasCtx.restore();
    
    // 解析左右手
    let rightHand: NormalizedLandmark[] | null = null;
    let leftHand: NormalizedLandmark[] | null = null;
    
    if (results.multiHandLandmarks && results.multiHandedness) {
      for (let i = 0; i < results.multiHandLandmarks.length; i++) {
        const landmarks = results.multiHandLandmarks[i];
        const handedness = results.multiHandedness[i]?.label;
        
        this.drawHand(landmarks, handedness === 'Left' ? 'Right' : 'Left');
        
        // MediaPipe 的 handedness 是镜像的
        if (handedness === 'Left') {
          rightHand = landmarks;
        } else {
          leftHand = landmarks;
        }
      }
    }
    
    // 更新手型状态
    this.updateHandShapes(leftHand, rightHand);
    
    // 检查自动回退
    this.checkAutoReset(now);
    
    // 检查左手模式切换
    if (leftHand) {
      this.checkLeftHandModeSwitch(now);
    }
    
    // 根据当前模式处理右手操作
    if (rightHand) {
      this.processRightHandByMode(rightHand, now);
    } else {
      this.resetRightHandState();
    }
    
    // 更新 UI
    this.updateGestureDisplay();
  }
  
  /** 更新手型状态 */
  private updateHandShapes(leftHand: NormalizedLandmark[] | null, rightHand: NormalizedLandmark[] | null): void {
    // 左手
    if (leftHand) {
      const shape = this.getHandShape(leftHand);
      const result = this.updateShapeStability(shape, this.lastLeftShape, this.leftShapeStableCount);
      this.leftShape = result.shape;
      this.leftShapeStableCount = result.count;
      this.lastLeftShape = shape;
    } else {
      this.leftShape = 'other';
      this.leftShapeStableCount = 0;
    }
    
    // 右手
    if (rightHand) {
      const shape = this.getHandShape(rightHand);
      const result = this.updateShapeStability(shape, this.lastRightShape, this.rightShapeStableCount);
      this.rightShape = result.shape;
      this.rightShapeStableCount = result.count;
      this.lastRightShape = shape;
      
      // 更新位置
      this.lastRightHandPosition = { ...this.rightHandPosition };
      this.rightHandPosition = this.getPalmCenter(rightHand);
    } else {
      this.rightShape = 'other';
      this.rightShapeStableCount = 0;
    }
  }
  
  // ============================================
  // 右手操作处理（按模式分发）
  // ============================================
  private processRightHandByMode(rightHand: NormalizedLandmark[], now: number): void {
    switch (this.currentMode) {
      case 'watch':
        this.processWatchMode(rightHand, now);
        break;
      case 'zoom':
        this.processZoomMode(rightHand, now);
        break;
      case 'explode':
        this.processExplodeMode(rightHand, now);
        break;
      case 'component':
        this.processComponentMode(rightHand, now);
        break;
    }
  }
  
  // ============================================
  // 模式一：监视模式（只旋转）
  // ============================================
  private processWatchMode(rightHand: NormalizedLandmark[], now: number): void {
    // 右手五指张开 → 旋转模式
    if (this.rightShape === 'open' && this.isShapeStable(this.rightShapeStableCount)) {
      this.isRotating = true;
      this.processRotation(rightHand);
      this.lastInteractionTime = now;
    } else {
      this.isRotating = false;
    }
  }
  
  /** 处理视角旋转 */
  private processRotation(rightHand: NormalizedLandmark[]): void {
    const palm = this.getPalmCenter(rightHand);
    const x = 1 - palm.x; // 镜像翻转
    const y = palm.y;
    
    // 计算相对于中心的偏移
    const centerX = 0.5;
    const centerY = 0.5;
    const offsetX = x - centerX;
    const offsetY = y - centerY;
    
    // 中立区域检查
    const distance = Math.sqrt(offsetX * offsetX + offsetY * offsetY);
    
    if (distance > CONFIG.NEUTRAL_ZONE_RATIO) {
      // 超出中立区域，计算旋转
      const normalizedOffset = (distance - CONFIG.NEUTRAL_ZONE_RATIO) / (0.5 - CONFIG.NEUTRAL_ZONE_RATIO);
      const rotationSpeed = Math.min(normalizedOffset, 1) * CONFIG.ROTATION_SENSITIVITY;
      
      // 归一化方向
      const dirX = offsetX / distance;
      const dirY = offsetY / distance;
      
      const deltaX = dirX * rotationSpeed * CONFIG.ROTATION_MAX_SPEED;
      const deltaY = dirY * rotationSpeed * CONFIG.ROTATION_MAX_SPEED;
      
      this.callbacks.onRotateView?.(deltaX, deltaY);
    }
  }
  
  // ============================================
  // 模式二：缩放模式
  // ============================================
  private processZoomMode(rightHand: NormalizedLandmark[], now: number): void {
    let newZoomDirection = 0;
    
    // 右手张开 → 放大
    if (this.rightShape === 'open' && this.isShapeStable(this.rightShapeStableCount)) {
      newZoomDirection = 1;
    }
    // 右手握拳 → 缩小（使用宽松检测：不是张开就是握拳）
    else if (this.isLooseFist(rightHand) && this.isShapeStable(this.rightShapeStableCount)) {
      newZoomDirection = -1;
    }
    
    // 检测方向变化
    if (newZoomDirection !== this.zoomDirection) {
      this.zoomDirection = newZoomDirection;
      if (newZoomDirection !== 0) {
        this.zoomStartTime = now;
        this.isZooming = true;
      } else {
        this.isZooming = false;
      }
    }
    
    // 持续缩放
    if (this.isZooming && this.zoomDirection !== 0) {
      // 加速曲线
      const elapsed = now - this.zoomStartTime;
      const acceleration = Math.min(1, elapsed / CONFIG.ZOOM_ACCELERATION_TIME);
      const speed = CONFIG.ZOOM_SPEED * acceleration;
      
      // 反转方向：张开(zoomDirection=1)应该让相机靠近(delta<0)，握拳应该让相机远离(delta>0)
      const zoomDelta = -this.zoomDirection * speed;
      this.callbacks.onZoom?.(zoomDelta);
      this.lastInteractionTime = now;
    }
  }
  
  // ============================================
  // 模式三：拆解模式
  // ============================================
  private processExplodeMode(rightHand: NormalizedLandmark[], now: number): void {
    // 右手张开 → 缓慢分解（持续）
    if (this.rightShape === 'open' && this.isShapeStable(this.rightShapeStableCount)) {
      // 退出点击模式
      if (this.isInClickMode) {
        this.isInClickMode = false;
        console.log('[拆解模式] 退出点击模式');
      }
      
      // 开始缓慢分解
      if (!this.isExploding) {
        this.isExploding = true;
        console.log('[拆解模式] 右手张开 → 开始缓慢分解');
        this.callbacks.onGestureChange?.('explosion_start', 'right');
      }
      
      // 持续分解（每帧调用）
      this.callbacks.onExplosionChange?.(CONFIG.EXPLOSION_SPEED);
      this.lastExplosionTime = now;
      this.lastInteractionTime = now;
      
      // 分解期间禁止聚合
      this.aggregationBlockedUntil = now + CONFIG.AGGREGATION_BLOCK_TIME;
      
      this.hideCursor();
    }
    // 右手食指伸出 → 点击模式
    else if ((this.rightShape === 'one' || this.rightShape === 'pointer') && this.isShapeStable(this.rightShapeStableCount)) {
      // 停止分解
      if (this.isExploding) {
        this.isExploding = false;
        console.log('[拆解模式] 停止分解');
      }
      
      if (!this.isInClickMode) {
        this.isInClickMode = true;
        this.hoverStartTime = 0;  // 重置hover计时
        console.log('[拆解模式] 进入点击模式（聚合被禁止）');
        this.callbacks.onGestureChange?.('click_mode_enter', 'right');
        // 进入点击模式也禁止聚合（持续禁止直到退出点击模式）
        this.aggregationBlockedUntil = Infinity;
      }
      
      // 处理光标和hover点击
      this.processClickMode(rightHand, now);
      this.lastInteractionTime = now;
    }
    // 右手握拳 → 聚合（有条件限制）
    else if (this.rightShape === 'fist' && this.isShapeStable(this.rightShapeStableCount)) {
      this.hideCursor();
      
      // 停止分解
      if (this.isExploding) {
        this.isExploding = false;
        console.log('[拆解模式] 停止分解');
      }
      
      // 退出点击模式
      if (this.isInClickMode) {
        this.isInClickMode = false;
        // 退出点击模式后，恢复正常的聚合CD检测
        this.aggregationBlockedUntil = 0;
        console.log('[拆解模式] 退出点击模式');
      }
      
      // 检查是否允许聚合
      const canAggregate = now > this.aggregationBlockedUntil && 
                          now - this.lastAggregationTime > CONFIG.EXPLOSION_COOLDOWN;
      
      if (canAggregate) {
        console.log('[拆解模式] 右手握拳 → 模型聚合');
        this.callbacks.onAggregation?.();
        this.callbacks.onEscape?.();
        this.callbacks.onGestureChange?.('aggregation', 'right');
        this.lastAggregationTime = now;
        this.lastInteractionTime = now;
      }
    } else {
      this.hideCursor();
      // 停止分解
      if (this.isExploding) {
        this.isExploding = false;
      }
      // 其他手型时退出点击模式
      if (this.isInClickMode) {
        this.isInClickMode = false;
        this.aggregationBlockedUntil = 0;
      }
    }
  }
  
  /** 处理点击模式 */
  private processClickMode(rightHand: NormalizedLandmark[], now: number): void {
    // 光标跟随食指
    const indexTip = rightHand[LANDMARKS.INDEX_TIP];
    const targetX = 1 - indexTip.x; // 镜像翻转
    const targetY = indexTip.y;
    
    // 平滑处理
    this.smoothedCursorX += (targetX - this.smoothedCursorX) * CONFIG.MOUSE_SMOOTHING;
    this.smoothedCursorY += (targetY - this.smoothedCursorY) * CONFIG.MOUSE_SMOOTHING;
    
    // 更新光标（显示hover进度）
    const hoverProgress = this.hoverStartTime > 0 ? 
      Math.min(1, (now - this.hoverStartTime) / CONFIG.HOVER_CLICK_TIME) : 0;
    this.updateCursorPosition(this.smoothedCursorX, this.smoothedCursorY, this.isPinching, hoverProgress);
    this.callbacks.onMouseMove?.(this.smoothedCursorX, this.smoothedCursorY);
    
    // 检测 hover 自动点击（在同一位置停留2秒）
    const moveDist = Math.sqrt(
      Math.pow(this.smoothedCursorX - this.lastHoverX, 2) + 
      Math.pow(this.smoothedCursorY - this.lastHoverY, 2)
    );
    
    const HOVER_MOVE_THRESHOLD = 0.03;  // 移动超过此距离重置hover
    
    if (moveDist > HOVER_MOVE_THRESHOLD) {
      // 移动了，重置hover计时
      this.hoverStartTime = now;
      this.lastHoverX = this.smoothedCursorX;
      this.lastHoverY = this.smoothedCursorY;
    } else if (this.hoverStartTime === 0) {
      // 首次进入，开始计时
      this.hoverStartTime = now;
      this.lastHoverX = this.smoothedCursorX;
      this.lastHoverY = this.smoothedCursorY;
    } else if (now - this.hoverStartTime >= CONFIG.HOVER_CLICK_TIME) {
      // hover时间到达2秒，自动点击
      console.log('[拆解模式] hover 2秒 → 自动选择组件');
      this.callbacks.onClick?.();
      this.lastInteractionTime = now;
      this.hoverStartTime = 0;  // 重置
      
      // 进入组件视图后切换回监视模式
      setTimeout(() => {
        this.setMode('watch', false);
        console.log('[拆解模式] 进入组件视图 → 自动切换到监视模式');
      }, 100);
      return;
    }
    
    // 检测捏合（仍然保留捏合点击）
    const pinchRatio = this.getPinchRatio(rightHand);
    
    if (pinchRatio < CONFIG.PINCH_THRESHOLD) {
      if (!this.isPinching) {
        this.isPinching = true;
        this.pinchStartTime = now;
      }
    } else if (pinchRatio > CONFIG.PINCH_RELEASE_THRESHOLD) {
      if (this.isPinching) {
        const holdTime = now - this.pinchStartTime;
        if (holdTime >= 100) {
          console.log('[拆解模式] 捏合 → 选择组件');
          this.callbacks.onClick?.();
          this.lastInteractionTime = now;
          this.hoverStartTime = 0;  // 重置hover
          
          // 进入组件视图后切换回监视模式
          setTimeout(() => {
            this.setMode('watch', false);
            console.log('[拆解模式] 进入组件视图 → 自动切换到监视模式');
          }, 100);
        }
        this.isPinching = false;
      }
    }
  }
  
  // ============================================
  // 模式四：组件模式
  // ============================================
  private processComponentMode(rightHand: NormalizedLandmark[], now: number): void {
    // 必须右手张开
    if (this.rightShape !== 'open' || !this.isShapeStable(this.rightShapeStableCount)) {
      this.swipeStartPosition = { x: 0.5, y: 0.5 };
      this.swipeStartTime = 0;
      this.rightPositionHistory = [];
      return;
    }
    
    const palm = this.getPalmCenter(rightHand);
    const x = 1 - palm.x;
    const y = palm.y;
    
    // 更新位置历史
    this.rightPositionHistory.push({ x, y, time: now });
    if (this.rightPositionHistory.length > 15) {
      this.rightPositionHistory.shift();
    }
    
    // 初始化挥动起点
    if (this.swipeStartTime === 0) {
      this.swipeStartPosition = { x, y };
      this.swipeStartTime = now;
      return;
    }
    
    // 计算位移
    const dx = x - this.swipeStartPosition.x;
    const dy = y - this.swipeStartPosition.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // 计算速度
    let speed = 0;
    if (this.rightPositionHistory.length >= 2) {
      const recent = this.rightPositionHistory[this.rightPositionHistory.length - 1];
      const older = this.rightPositionHistory[Math.max(0, this.rightPositionHistory.length - 5)];
      const dt = recent.time - older.time;
      if (dt > 0) {
        const d = Math.sqrt(Math.pow(recent.x - older.x, 2) + Math.pow(recent.y - older.y, 2));
        speed = d / dt * 1000;
      }
    }
    
    // 检测挥动
    if (distance > CONFIG.SWIPE_DISTANCE_THRESHOLD && speed > CONFIG.SWIPE_SPEED_THRESHOLD) {
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      
      // 上下挥动 → 切换材质
      if (absY > absX * 1.5) {
        if (now - this.lastMaterialSwipeTime > CONFIG.MATERIAL_SWIPE_COOLDOWN) {
          if (dy < 0) {
            console.log('[组件模式] 向上挥动 → 上一个材质');
            this.callbacks.onNavigateUpDown?.('up');
            this.callbacks.onGestureChange?.('swipe_up', 'right');
          } else {
            console.log('[组件模式] 向下挥动 → 下一个材质');
            this.callbacks.onNavigateUpDown?.('down');
            this.callbacks.onGestureChange?.('swipe_down', 'right');
          }
          this.lastMaterialSwipeTime = now;
          this.lastInteractionTime = now;
          this.swipeStartPosition = { x, y };
          this.swipeStartTime = now;
        }
      }
      // 左右挥动 → 切换组件
      else if (absX > absY * 1.5) {
        if (now - this.lastComponentSwipeTime > CONFIG.COMPONENT_SWIPE_COOLDOWN) {
          if (dx < 0) {
            console.log('[组件模式] 向左挥动 → 上一个组件');
            this.callbacks.onNavigateLeftRight?.('left');
            this.callbacks.onGestureChange?.('swipe_left', 'right');
          } else {
            console.log('[组件模式] 向右挥动 → 下一个组件');
            this.callbacks.onNavigateLeftRight?.('right');
            this.callbacks.onGestureChange?.('swipe_right', 'right');
          }
          this.lastComponentSwipeTime = now;
          this.lastInteractionTime = now;
          this.swipeStartPosition = { x, y };
          this.swipeStartTime = now;
        }
      }
    }
    
    // 定期重置起点
    if (now - this.swipeStartTime > 800 && distance < CONFIG.SWIPE_DISTANCE_THRESHOLD * 0.5) {
      this.swipeStartPosition = { x, y };
      this.swipeStartTime = now;
    }
  }
  
  // ============================================
  // 状态重置
  // ============================================
  private resetRightHandState(): void {
    this.isRotating = false;
    this.isZooming = false;
    this.zoomDirection = 0;
    this.isPinching = false;
    this.hideCursor();
  }
  
  // ============================================
  // 光标控制
  // ============================================
  private updateCursorPosition(x: number, y: number, isPinching: boolean, hoverProgress: number = 0): void {
    if (!this.cursorElement) return;
    
    const screenX = x * window.innerWidth;
    const screenY = y * window.innerHeight;
    
    this.cursorElement.style.left = `${screenX}px`;
    this.cursorElement.style.top = `${screenY}px`;
    this.cursorElement.classList.add('active');
    
    if (isPinching) {
      this.cursorElement.classList.add('pinching');
    } else {
      this.cursorElement.classList.remove('pinching');
    }
    
    // 显示 hover 进度（通过 CSS 变量）
    this.cursorElement.style.setProperty('--hover-progress', `${hoverProgress}`);
    if (hoverProgress > 0) {
      this.cursorElement.classList.add('hovering');
    } else {
      this.cursorElement.classList.remove('hovering');
    }
  }
  
  private hideCursor(): void {
    if (this.cursorElement) {
      this.cursorElement.classList.remove('active');
      this.cursorElement.classList.remove('pinching');
      this.cursorElement.classList.remove('hovering');
    }
    // 重置 hover 状态
    this.hoverStartTime = 0;
  }
  
  // ============================================
  // 绘制手部
  // ============================================
  private drawHand(landmarks: NormalizedLandmark[], label: 'Left' | 'Right'): void {
    if (!this.canvasCtx || !this.canvasElement) return;
    
    this.canvasCtx.save();
    this.canvasCtx.translate(this.canvasElement.width, 0);
    this.canvasCtx.scale(-1, 1);
    
    const color = label === 'Right' ? '#00ff88' : '#00ddff';
    
    const connections = [
      [0, 1], [1, 2], [2, 3], [3, 4],
      [0, 5], [5, 6], [6, 7], [7, 8],
      [0, 9], [9, 10], [10, 11], [11, 12],
      [0, 13], [13, 14], [14, 15], [15, 16],
      [0, 17], [17, 18], [18, 19], [19, 20],
      [5, 9], [9, 13], [13, 17],
    ];
    
    this.canvasCtx.strokeStyle = color;
    this.canvasCtx.lineWidth = 2;
    
    connections.forEach(([s, e]) => {
      const start = landmarks[s], end = landmarks[e];
      this.canvasCtx!.beginPath();
      this.canvasCtx!.moveTo(start.x * this.canvasElement!.width, start.y * this.canvasElement!.height);
      this.canvasCtx!.lineTo(end.x * this.canvasElement!.width, end.y * this.canvasElement!.height);
      this.canvasCtx!.stroke();
    });
    
    landmarks.forEach((lm, idx) => {
      const x = lm.x * this.canvasElement!.width;
      const y = lm.y * this.canvasElement!.height;
      const isTip = [4, 8, 12, 16, 20].includes(idx);
      
      this.canvasCtx!.fillStyle = isTip ? '#ffffff' : color;
      this.canvasCtx!.beginPath();
      this.canvasCtx!.arc(x, y, isTip ? 5 : 3, 0, Math.PI * 2);
      this.canvasCtx!.fill();
    });
    
    this.canvasCtx.restore();
  }
  
  // ============================================
  // UI 更新
  // ============================================
  
  private isEnglish(): boolean {
    return (typeof (window as unknown as { currentLang?: string }).currentLang !== 'undefined' 
      && (window as unknown as { currentLang?: string }).currentLang === 'en') 
      || localStorage.getItem('jarvis-lang') === 'en';
  }
  
  private updateHandStatus(online: boolean): void {
    const el = document.getElementById('hand-status');
    if (el) el.textContent = online ? 'ONLINE' : 'OFFLINE';
  }
  
  private updateModeDisplay(): void {
    // 更新模式显示元素
    const modeEl = document.getElementById('gesture-mode-display');
    if (modeEl) {
      const isEn = this.isEnglish();
      const modeName = MODE_NAMES[this.currentMode][isEn ? 'en' : 'zh'];
      modeEl.textContent = modeName;
      modeEl.className = `mode-display mode-${this.currentMode}`;
    }
    
    // 更新下拉列表选中状态
    const select = document.getElementById('mode-select') as HTMLSelectElement | null;
    if (select && select.value !== this.currentMode) {
      select.value = this.currentMode;
    }
  }
  
  private updateGestureDisplay(): void {
    const el = document.getElementById('gesture-status');
    if (!el) return;
    
    const isEn = this.isEnglish();
    
    // 显示正在进行的操作
    let text = '';
    
    if (this.leftPendingMode) {
      const pendingName = MODE_NAMES[this.leftPendingMode][isEn ? 'en' : 'zh'];
      text = isEn ? `→ ${pendingName}...` : `→ ${pendingName}...`;
    } else if (this.isRotating) {
      text = isEn ? '🔄 Rotating' : '🔄 旋转中';
    } else if (this.isZooming) {
      text = this.zoomDirection > 0 
        ? (isEn ? '🔍+ Zoom In' : '🔍+ 放大中')
        : (isEn ? '🔍- Zoom Out' : '🔍- 缩小中');
    } else if (this.isInClickMode) {
      text = isEn ? '👆 Click Mode' : '👆 点击模式';
      if (this.isPinching) {
        text = isEn ? '🤏 Selecting' : '🤏 选择中';
      }
    } else {
      // 显示手型
      const shapeEmoji: Record<HandShape, string> = {
        'open': '✋',
        'fist': '✊',
        'one': '☝️',
        'two': '✌️',
        'three': '🤟',
        'four': '🖖',
        'pointer': '👆',
        'other': '—'
      };
      const l = shapeEmoji[this.leftShape] || '—';
      const r = shapeEmoji[this.rightShape] || '—';
      text = isEn ? `L${l} R${r}` : `左${l} 右${r}`;
    }
    
    el.textContent = text;
    
    // 同时更新模式显示
    this.updateModeDisplay();
  }
  
  // ============================================
  // 公共方法
  // ============================================
  
  /** 获取当前模式 */
  getCurrentMode(): GestureMode {
    return this.currentMode;
  }
  
  /** 获取当前模式名称 */
  getCurrentModeName(): string {
    const isEn = this.isEnglish();
    return MODE_NAMES[this.currentMode][isEn ? 'en' : 'zh'];
  }
  
  /** 获取所有模式列表 */
  getAllModes(): { id: GestureMode; name: string }[] {
    const isEn = this.isEnglish();
    return [
      { id: 'watch', name: MODE_NAMES.watch[isEn ? 'en' : 'zh'] },
      { id: 'zoom', name: MODE_NAMES.zoom[isEn ? 'en' : 'zh'] },
      { id: 'explode', name: MODE_NAMES.explode[isEn ? 'en' : 'zh'] },
      { id: 'component', name: MODE_NAMES.component[isEn ? 'en' : 'zh'] },
    ];
  }
  
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.resetRightHandState();
    }
  }
  
  isInitialized(): boolean {
    return this.initialized;
  }
  
  getCurrentGesture(): GestureType {
    if (this.rightShape === 'open') return 'open_palm';
    if (this.rightShape === 'fist') return 'closed_fist';
    if (this.isPinching) return 'pinch';
    if (this.rightShape === 'pointer' || this.rightShape === 'one') return 'pointing';
    return 'none';
  }
  
  dispose(): void {
    if (this.camera) this.camera.stop();
    if (this.hands) this.hands.close();
    this.enabled = false;
    this.initialized = false;
    window.gestureController = undefined;
    console.log('[GestureController] 资源已释放');
  }
}

export function createGestureController(callbacks?: GestureCallbacks): GestureController {
  return new GestureController(callbacks);
}
