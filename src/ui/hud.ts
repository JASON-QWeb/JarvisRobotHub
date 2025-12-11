/**
 * hud.ts - 简化版 HUD 界面控制模块
 * 
 * 只保留核心功能：
 * - 状态显示（当前模式、手势）
 * - 拆解百分比
 * - 提示文本
 * - 加载屏幕
 */

import { MechViewState } from '../types/mechConfig';

// 手势类型定义（本地定义，避免依赖不存在的模块）
export type GestureType = 'OPEN_PALM' | 'FIST' | 'PINCH' | 'SWIPE_LEFT' | 'SWIPE_RIGHT' | 'POINTING' | 'NONE';
export type TrackingStatus = 'detecting' | 'tracking' | 'lost';

// HUD 配置
export interface HUDConfig {
  onReset?: () => void;
  onToggleCamera?: () => void;
  onGoBack?: () => void;
}

// 状态名称映射
const STATE_DISPLAY_NAMES: Record<MechViewState, string> = {
  'Assembled': '组装',
  'MajorExploded': '拆解',
  'PartList': '列表',
  'PartDetailExploded': '详情'
};

// 简化的手势名称
const GESTURE_SIMPLE_NAMES: Record<GestureType, string> = {
  'OPEN_PALM': '张开',
  'FIST': '握拳',
  'PINCH': '捏合',
  'SWIPE_LEFT': '左挥',
  'SWIPE_RIGHT': '右挥',
  'POINTING': '指向',
  'NONE': '无'
};

/**
 * HUD 控制器类
 */
export class HUDController {
  private isInitialized: boolean = false;
  
  // DOM 元素引用
  private elements: {
    modeStatus: HTMLElement | null;
    gestureStatus: HTMLElement | null;
    focusPartRow: HTMLElement | null;
    focusPartName: HTMLElement | null;
    explosionRing: SVGCircleElement | null;
    explosionPercent: HTMLElement | null;
    hintMain: HTMLElement | null;
    loadingScreen: HTMLElement | null;
    loadingStatus: HTMLElement | null;
    loadingProgress: HTMLElement | null;
    // 隐藏的兼容元素
    handStatus: HTMLElement | null;
    modelStatus: HTMLElement | null;
    pinchBar: HTMLElement | null;
    pinchValue: HTMLElement | null;
    fingerCount: HTMLElement | null;
  };
  
  constructor(_config: HUDConfig = {}) {
    this.elements = this.initElements();
  }
  
  /**
   * 初始化获取所有元素引用
   */
  private initElements() {
    return {
      modeStatus: document.getElementById('mode-status'),
      gestureStatus: document.getElementById('gesture-status'),
      focusPartRow: document.getElementById('focus-part-row'),
      focusPartName: document.getElementById('focus-part-name'),
      explosionRing: document.getElementById('explosion-ring') as SVGCircleElement | null,
      explosionPercent: document.getElementById('explosion-percent'),
      hintMain: document.getElementById('hint-main'),
      loadingScreen: document.getElementById('loading-screen'),
      loadingStatus: document.getElementById('loading-status'),
      loadingProgress: document.getElementById('loading-progress'),
      // 隐藏的兼容元素
      handStatus: document.getElementById('hand-status'),
      modelStatus: document.getElementById('model-status'),
      pinchBar: document.getElementById('pinch-bar'),
      pinchValue: document.getElementById('pinch-value'),
      fingerCount: document.getElementById('finger-count')
    };
  }
  
  /**
   * 初始化 HUD
   */
  init(): void {
    this.addNotificationStyles();
    this.isInitialized = true;
  }
  
  // ============================================
  // 状态更新方法
  // ============================================
  
  /**
   * 更新手部追踪状态
   */
  updateHandStatus(status: TrackingStatus): void {
    if (this.elements.handStatus) {
      this.elements.handStatus.textContent = status;
    }
  }
  
  /**
   * 更新模型加载状态
   */
  updateModelStatus(status: 'loading' | 'loaded' | 'error'): void {
    if (this.elements.modelStatus) {
      this.elements.modelStatus.textContent = status;
    }
  }
  
  /**
   * 更新手势状态
   */
  updateGestureStatus(gesture: GestureType): void {
    if (this.elements.gestureStatus) {
      this.elements.gestureStatus.textContent = GESTURE_SIMPLE_NAMES[gesture] || '无';
      
      // 根据手势类型更新颜色
      this.elements.gestureStatus.style.color = '';
      if (gesture === 'OPEN_PALM') {
        this.elements.gestureStatus.style.color = '#00ff88';
      } else if (gesture === 'FIST') {
        this.elements.gestureStatus.style.color = '#ff6600';
      } else if (gesture === 'PINCH') {
        this.elements.gestureStatus.style.color = '#ffaa00';
      }
    }
  }
  
  /**
   * 更新聚焦模式
   */
  updateFocusMode(mode: 'global' | 'part', partName: string | null): void {
    // 更新聚焦部件名称
    if (this.elements.focusPartRow && this.elements.focusPartName) {
      if (mode === 'part' && partName) {
        this.elements.focusPartRow.style.display = 'flex';
        this.elements.focusPartName.textContent = partName;
      } else {
        this.elements.focusPartRow.style.display = 'none';
      }
    }
  }
  
  /**
   * 更新状态机状态显示
   */
  updateModeStatus(state: MechViewState): void {
    if (this.elements.modeStatus) {
      this.elements.modeStatus.textContent = STATE_DISPLAY_NAMES[state] || '未知';
    }
  }
  
  /**
   * 更新选择状态（兼容旧接口）
   */
  updateSelectionState(state: any): void {
    if (state.mode) {
      this.updateFocusMode(state.mode, state.selectedPartName);
    }
  }
  
  /**
   * 更新捏合距离显示
   */
  updatePinchDistance(distance: number, _normalized: number): void {
    if (this.elements.pinchValue) {
      this.elements.pinchValue.textContent = distance.toFixed(3);
    }
  }
  
  /**
   * 更新手指伸展数量
   */
  updateFingerCount(count: number): void {
    if (this.elements.fingerCount) {
      this.elements.fingerCount.textContent = count.toString();
    }
  }
  
  /**
   * 更新拆解百分比显示
   */
  updateExplosionPercent(factor: number): void {
    const percent = Math.round(factor * 100);
    
    // 更新数字显示
    if (this.elements.explosionPercent) {
      this.elements.explosionPercent.textContent = percent.toString();
    }
    
    // 更新环形进度条
    if (this.elements.explosionRing) {
      const circumference = 251; // 2 * π * 40
      const offset = circumference * (1 - factor);
      this.elements.explosionRing.style.strokeDashoffset = offset.toString();
      
      // 根据百分比改变颜色
      let color: string;
      if (factor > 0.7) {
        color = '#ff6600';
      } else if (factor > 0.4) {
        color = '#ffaa00';
      } else {
        color = '#00d4ff';
      }
      this.elements.explosionRing.style.stroke = color;
    }
  }
  
  /**
   * 更新提示文本
   */
  updateHint(main: string, _sub?: string): void {
    if (this.elements.hintMain) {
      this.elements.hintMain.textContent = main;
    }
  }
  
  // ============================================
  // 加载屏幕
  // ============================================
  
  showLoadingScreen(): void {
    this.elements.loadingScreen?.classList.remove('hidden');
  }
  
  hideLoadingScreen(): void {
    this.elements.loadingScreen?.classList.add('hidden');
  }
  
  updateLoadingStatus(text: string): void {
    if (this.elements.loadingStatus) {
      this.elements.loadingStatus.textContent = text;
    }
  }
  
  updateLoadingProgress(progress: number): void {
    if (this.elements.loadingProgress) {
      this.elements.loadingProgress.style.width = `${Math.min(100, Math.max(0, progress))}%`;
    }
  }
  
  // ============================================
  // 通知系统
  // ============================================
  
  showNotification(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
    const notification = document.createElement('div');
    notification.className = `hud-notification notification-${type}`;
    
    const colors: Record<string, string> = {
      info: '#00d4ff',
      success: '#00ff88',
      warning: '#ffaa00',
      error: '#ff4444'
    };
    
    notification.innerHTML = `<span>${message}</span>`;
    notification.style.cssText = `
      position: fixed;
      top: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 20, 40, 0.9);
      border: 1px solid ${colors[type]};
      border-radius: 20px;
      padding: 10px 20px;
      font-family: 'Orbitron', monospace;
      font-size: 12px;
      color: ${colors[type]};
      z-index: 1000;
      animation: notificationSlide 0.3s ease-out;
      backdrop-filter: blur(10px);
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.animation = 'notificationSlideOut 0.3s ease-in forwards';
      setTimeout(() => notification.remove(), 300);
    }, 2000);
  }
  
  private addNotificationStyles(): void {
    if (document.getElementById('notification-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'notification-styles';
    style.textContent = `
      @keyframes notificationSlide {
        from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
      @keyframes notificationSlideOut {
        from { opacity: 1; transform: translateX(-50%) translateY(0); }
        to { opacity: 0; transform: translateX(-50%) translateY(-20px); }
      }
    `;
    document.head.appendChild(style);
  }
  
  dispose(): void {
    this.isInitialized = false;
  }
}

/**
 * 工厂函数
 */
export function createHUDController(config?: HUDConfig): HUDController {
  return new HUDController(config);
}
