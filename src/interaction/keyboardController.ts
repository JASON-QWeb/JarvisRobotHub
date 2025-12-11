/**
 * keyboardController.ts - 键盘控制器
 * 
 * 交互方式：
 * - A键长按：拆解（分离）
 * - S键长按：聚拢
 * - 上/下箭头：切换材质模式
 * - 左/右箭头：切换零件
 * - ESC：返回上级
 */

export interface KeyboardCallbacks {
  onExplosionChange?: (delta: number) => void;  // delta > 0 拆解，< 0 聚拢
  onNavigate?: (direction: 'up' | 'down') => void;
  onNavigateLeftRight?: (direction: 'left' | 'right') => void;
  onEscape?: () => void;
  onEnter?: () => void;  // 确认选择
  onMaterialModeChange?: (direction: 'up' | 'down') => void; // 材质模式循环
}

export class KeyboardController {
  private callbacks: KeyboardCallbacks;
  private keysPressed: Set<string> = new Set();
  private enabled: boolean = true;
  
  // 拆解速度
  private explosionSpeed: number = 0.02;
  
  constructor(callbacks: KeyboardCallbacks = {}) {
    this.callbacks = callbacks;
    this.bindEvents();
  }
  
  private bindEvents(): void {
    window.addEventListener('keydown', this.onKeyDown.bind(this));
    window.addEventListener('keyup', this.onKeyUp.bind(this));
  }
  
  private onKeyDown(event: KeyboardEvent): void {
    if (!this.enabled) return;
    
    const key = event.key.toLowerCase();
    
    // 防止重复触发（用于导航和ESC）
    const isNewKey = !this.keysPressed.has(key);
    this.keysPressed.add(key);
    
    switch (key) {
      case 'a':
        // A键：立即触发拆解效果（每次按下都触发）
        this.callbacks.onExplosionChange?.(this.explosionSpeed * 3);
        break;
      case 's':
        // S键：立即触发聚拢效果（每次按下都触发）
        this.callbacks.onExplosionChange?.(-this.explosionSpeed * 3);
        break;
      case 'arrowup':
        event.preventDefault();
        if (isNewKey) this.callbacks.onMaterialModeChange?.('up');
        break;
      case 'arrowdown':
        event.preventDefault();
        if (isNewKey) this.callbacks.onMaterialModeChange?.('down');
        break;
      case 'arrowleft':
        event.preventDefault();
        if (isNewKey) this.callbacks.onNavigateLeftRight?.('left');
        break;
      case 'arrowright':
        event.preventDefault();
        if (isNewKey) this.callbacks.onNavigateLeftRight?.('right');
        break;
      case 'escape':
        if (isNewKey) this.callbacks.onEscape?.();
        break;
      case 'enter':
        if (isNewKey) this.callbacks.onEnter?.();
        break;
    }
  }
  
  private onKeyUp(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    this.keysPressed.delete(key);
  }
  
  /**
   * 每帧更新（在动画循环中调用）
   */
  update(): void {
    if (!this.enabled) return;
    
    // A键：拆解
    if (this.keysPressed.has('a')) {
      this.callbacks.onExplosionChange?.(this.explosionSpeed);
    }
    
    // S键：聚拢
    if (this.keysPressed.has('s')) {
      this.callbacks.onExplosionChange?.(-this.explosionSpeed);
    }
  }
  
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.keysPressed.clear();
    }
  }
  
  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown.bind(this));
    window.removeEventListener('keyup', this.onKeyUp.bind(this));
    this.keysPressed.clear();
  }
}

export function createKeyboardController(callbacks?: KeyboardCallbacks): KeyboardController {
  return new KeyboardController(callbacks);
}

