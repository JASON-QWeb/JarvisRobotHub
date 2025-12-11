/**
 * ringMenu.ts - 环形菜单组件
 * 
 * 显示当前大部件下的所有子零件，以环形/半环形布局展示：
 * - 当前选中的子零件在环形菜单中高亮
 * - 支持动画过渡
 * - 与 3D 场景中的高亮同步
 */

import { PartId, PART_DISPLAY_NAMES, MechViewState } from '../types/mechConfig';

// ============================================
// 配置
// ============================================

export const RING_MENU_CONFIG = {
  // 布局
  RADIUS: 150,                    // 环形半径
  START_ANGLE: -90,               // 起始角度（度）
  SPAN_ANGLE: 180,                // 跨越角度（度）
  
  // 动画
  ANIMATION_DURATION: 300,        // 动画时长（毫秒）
  
  // 样式
  ITEM_SIZE: 80,                  // 项目大小
  HIGHLIGHT_SCALE: 1.2,           // 高亮缩放
  
  // 位置
  POSITION: 'center' as 'center' | 'right' | 'left'
};

// ============================================
// 类型定义
// ============================================

export interface RingMenuItem {
  id: PartId;
  displayName: string;
  isHighlighted: boolean;
  angle: number;  // 角度位置
}

// ============================================
// 环形菜单类
// ============================================

export class RingMenu {
  private container: HTMLElement | null = null;
  private itemElements: Map<PartId, HTMLElement> = new Map();
  private currentItems: RingMenuItem[] = [];
  private isVisible: boolean = false;
  private currentHighlightIndex: number = 0;
  private currentState: MechViewState = 'Assembled';
  
  constructor() {
    this.createContainer();
    this.show(); // 确保初始可见，便于调试/展示
  }
  
  /**
   * 创建菜单容器
   */
  private createContainer(): void {
    // 检查是否已存在
    const existing = document.getElementById('ring-menu-container');
    if (existing) {
      existing.remove();
    }
    
    // 创建容器
    this.container = document.createElement('div');
    this.container.id = 'ring-menu-container';
    // 默认可见，避免状态未驱动时被隐藏
    this.container.className = 'ring-menu-container visible';
    
    // 创建标题
    const title = document.createElement('div');
    title.className = 'ring-menu-title';
    title.id = 'ring-menu-title';
    title.textContent = '选择部件';
    this.container.appendChild(title);
    
    // 创建菜单区域
    const menuArea = document.createElement('div');
    menuArea.className = 'ring-menu-area';
    menuArea.id = 'ring-menu-area';
    
    // 添加第三层和第四层圆环
    const ringLayer3 = document.createElement('div');
    ringLayer3.className = 'ring-layer-3';
    menuArea.appendChild(ringLayer3);
    
    const ringLayer4 = document.createElement('div');
    ringLayer4.className = 'ring-layer-4';
    menuArea.appendChild(ringLayer4);
    
    this.container.appendChild(menuArea);
    
    // 创建中心指示器
    const centerIndicator = document.createElement('div');
    centerIndicator.className = 'ring-menu-center';
    centerIndicator.innerHTML = `
      <div class="center-icon">◈</div>
      <div class="center-label" id="ring-menu-center-label">-</div>
    `;
    this.container.appendChild(centerIndicator);
    
    document.body.appendChild(this.container);
    
    // 添加样式
    this.addStyles();
  }
  
  /**
   * 添加样式
   */
  private addStyles(): void {
    const styleId = 'ring-menu-styles';
    if (document.getElementById(styleId)) return;
    
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .ring-menu-container {
        position: fixed;
        top: 52%;
        right: 70px;
        transform: translateY(-50%);
        z-index: 200;
        pointer-events: none;
        transition: opacity 0.3s ease, transform 0.3s ease;
        filter: drop-shadow(0 0 10px rgba(0, 200, 255, 0.25));
      }
      
      .ring-menu-container.hidden {
        opacity: 0;
        transform: translateY(-50%) scale(0.8);
        pointer-events: none;
      }
      
      .ring-menu-container.visible {
        opacity: 1;
        transform: translateY(-50%) scale(1);
      }
      
      .ring-menu-title {
        position: absolute;
        top: -72px;
        left: 50%;
        transform: translateX(-50%);
        font-family: 'Orbitron', monospace;
        font-size: 15px;
        font-weight: 600;
        color: #7cf3ff;
        text-align: center;
        letter-spacing: 2px;
        text-shadow: 0 0 10px rgba(0, 212, 255, 0.5);
        white-space: nowrap;
        padding: 6px 14px;
        border: 1px solid rgba(0, 200, 255, 0.3);
        border-radius: 999px;
        background: linear-gradient(90deg, rgba(0, 120, 160, 0.2), rgba(0, 30, 60, 0.8), rgba(0, 120, 160, 0.2));
      }
      
      .ring-menu-area {
        position: relative;
        width: ${RING_MENU_CONFIG.RADIUS * 2 + RING_MENU_CONFIG.ITEM_SIZE}px;
        height: ${RING_MENU_CONFIG.RADIUS * 2 + RING_MENU_CONFIG.ITEM_SIZE}px;
        border-radius: 50%;
        background: radial-gradient(circle at 50% 50%, rgba(0,80,130,0.15), rgba(0,20,40,0.05));
        box-shadow:
          inset 0 0 30px rgba(0, 200, 255, 0.12),
          0 0 35px rgba(0, 200, 255, 0.12);
        overflow: visible;
        transform-style: preserve-3d;
        perspective: 800px;
      }

      /* 大圆环 - 四层圆环，依次突出，粗细/颜色/断口不同 */
      /* 第一层 - 最外层，青色实线，带断口 */
      .ring-menu-area::before {
        content: '';
        position: absolute;
        inset: 5px;
        border-radius: 50%;
        border: 2px dashed rgba(0, 212, 255, 0.6);
        box-shadow: 
          0 0 15px rgba(0, 212, 255, 0.4),
          inset 0 0 10px rgba(0, 212, 255, 0.2);
        pointer-events: none;
        animation: ringRotate1 25s linear infinite;
      }

      /* 第二层 - 金色实线，带断口 */
      .ring-menu-area::after {
        content: '';
        position: absolute;
        inset: 20px;
        border-radius: 50%;
        border: 3px solid transparent;
        border-top: 3px solid rgba(255, 170, 0, 0.8);
        border-right: 3px solid rgba(255, 170, 0, 0.5);
        border-bottom: 3px solid transparent;
        border-left: 3px solid rgba(255, 170, 0, 0.6);
        box-shadow: 
          0 0 20px rgba(255, 170, 0, 0.4),
          inset 0 0 12px rgba(255, 170, 0, 0.2);
        pointer-events: none;
        animation: ringRotate2 18s linear infinite reverse;
      }

      /* 第三层 - 红色 */
      .ring-menu-area .ring-layer-3 {
        position: absolute;
        inset: 38px;
        border-radius: 50%;
        border: 4px solid transparent;
        border-top: 4px solid rgba(255, 68, 68, 0.9);
        border-right: 4px solid transparent;
        border-bottom: 4px solid rgba(255, 68, 68, 0.7);
        border-left: 4px solid rgba(255, 68, 68, 0.5);
        box-shadow: 
          0 0 25px rgba(255, 68, 68, 0.5),
          inset 0 0 15px rgba(255, 68, 68, 0.2);
        pointer-events: none;
        animation: ringRotate3 12s linear infinite;
      }

      /* 第四层 - 最内层，绿色 */
      .ring-menu-area .ring-layer-4 {
        position: absolute;
        inset: 58px;
        border-radius: 50%;
        border: 5px solid transparent;
        border-top: 5px solid rgba(0, 255, 136, 1);
        border-right: 5px solid rgba(0, 255, 136, 0.6);
        border-bottom: 5px solid rgba(0, 255, 136, 0.8);
        border-left: 5px solid transparent;
        box-shadow: 
          0 0 30px rgba(0, 255, 136, 0.6),
          inset 0 0 20px rgba(0, 255, 136, 0.3);
        pointer-events: none;
        animation: ringRotate4 8s linear infinite reverse;
      }

      @keyframes ringRotate1 {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      @keyframes ringRotate2 {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      @keyframes ringRotate3 {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      @keyframes ringRotate4 {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      
      .ring-menu-item {
        position: absolute;
        width: ${RING_MENU_CONFIG.ITEM_SIZE}px;
        height: ${RING_MENU_CONFIG.ITEM_SIZE}px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: radial-gradient(circle at 30% 30%, rgba(0, 200, 255, 0.25), rgba(0, 30, 60, 0.9));
        border: 2px solid rgba(0, 150, 200, 0.4);
        border-radius: 50%;
        cursor: pointer;
        pointer-events: auto;
        transition: all 0.3s ease;
        backdrop-filter: blur(5px);
        box-shadow:
          0 0 18px rgba(0, 200, 255, 0.25),
          inset 0 0 12px rgba(0, 200, 255, 0.12);
        transform-style: preserve-3d;
      }

      /* 小圆环 - 外层圆环 */
      .ring-menu-item .item-ring-outer {
        position: absolute;
        inset: -10px;
        border-radius: 50%;
        border: 2px solid transparent;
        border-top: 2px solid rgba(0, 212, 255, 0.8);
        border-right: 2px solid transparent;
        border-bottom: 2px solid rgba(0, 212, 255, 0.6);
        border-left: 2px solid rgba(0, 212, 255, 0.4);
        box-shadow: 0 0 12px rgba(0, 212, 255, 0.4);
        pointer-events: none;
        animation: smallRingOuter 10s linear infinite;
      }

      /* 小圆环 - 内层圆环（突出） */
      .ring-menu-item .item-ring-inner {
        position: absolute;
        inset: -5px;
        border-radius: 50%;
        border: 3px solid transparent;
        border-top: 3px solid rgba(0, 255, 200, 0.9);
        border-right: 3px solid rgba(0, 255, 200, 0.5);
        border-bottom: 3px solid transparent;
        border-left: 3px solid rgba(0, 255, 200, 0.7);
        box-shadow: 
          0 0 15px rgba(0, 255, 200, 0.5),
          inset 0 0 8px rgba(0, 255, 200, 0.2);
        pointer-events: none;
        animation: smallRingInner 6s linear infinite reverse;
      }

      @keyframes smallRingOuter {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      @keyframes smallRingInner {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      
      .ring-menu-item:hover {
        border-color: rgba(0, 212, 255, 0.8);
        box-shadow: 0 0 20px rgba(0, 212, 255, 0.4);
      }

      .ring-menu-item:hover .item-ring-outer,
      .ring-menu-item:hover .item-ring-inner {
        animation-duration: 3s;
      }
      
      .ring-menu-item.highlighted {
        background: radial-gradient(circle at 30% 30%, rgba(255, 68, 68, 0.35), rgba(40, 0, 10, 0.95));
        border-color: #ff4444;
        transform: scale(${RING_MENU_CONFIG.HIGHLIGHT_SCALE});
        box-shadow: 0 0 30px rgba(255, 68, 68, 0.6), inset 0 0 20px rgba(255, 68, 68, 0.2);
        z-index: 10;
      }

      .ring-menu-item.highlighted .item-ring-outer {
        border-top: 2px solid rgba(255, 68, 68, 0.9);
        border-right: 2px solid transparent;
        border-bottom: 2px solid rgba(255, 68, 68, 0.7);
        border-left: 2px solid rgba(255, 68, 68, 0.5);
        box-shadow: 0 0 15px rgba(255, 68, 68, 0.6);
      }

      .ring-menu-item.highlighted .item-ring-inner {
        border-top: 3px solid rgba(255, 170, 0, 1);
        border-right: 3px solid rgba(255, 170, 0, 0.6);
        border-bottom: 3px solid transparent;
        border-left: 3px solid rgba(255, 170, 0, 0.8);
        box-shadow: 
          0 0 18px rgba(255, 170, 0, 0.7),
          inset 0 0 10px rgba(255, 170, 0, 0.3);
      }
      
      .ring-menu-item .item-icon {
        font-size: 20px;
        margin-bottom: 4px;
        color: #00d4ff;
        transition: color 0.3s;
      }
      
      .ring-menu-item.highlighted .item-icon {
        color: #ff4444;
      }
      
      .ring-menu-item .item-name {
        font-family: 'Rajdhani', sans-serif;
        font-size: 12px;
        font-weight: 500;
        color: rgba(0, 212, 255, 0.9);
        text-align: center;
        line-height: 1.2;
        max-width: 70px;
        overflow: hidden;
        text-overflow: ellipsis;
        transition: color 0.3s;
      }
      
      .ring-menu-item.highlighted .item-name {
        color: #ff4444;
        font-weight: 700;
      }
      
      .ring-menu-item .item-index {
        position: absolute;
        top: -8px;
        right: -8px;
        width: 20px;
        height: 20px;
        background: rgba(0, 30, 50, 0.9);
        border: 1px solid rgba(0, 150, 200, 0.5);
        border-radius: 50%;
        font-family: 'Orbitron', monospace;
        font-size: 10px;
        color: #00d4ff;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .ring-menu-item.highlighted .item-index {
        background: rgba(255, 68, 68, 0.9);
        border-color: #ff4444;
        color: white;
      }
      
      .ring-menu-center {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 100px;
        height: 100px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: radial-gradient(circle, rgba(0, 200, 255, 0.2), rgba(0, 20, 40, 0.9));
        border: 2px solid rgba(0, 212, 255, 0.6);
        border-radius: 50%;
        backdrop-filter: blur(10px);
        box-shadow: 0 0 15px rgba(0, 200, 255, 0.3), inset 0 0 12px rgba(0, 200, 255, 0.2);
      }
      
      .ring-menu-center .center-icon {
        font-size: 24px;
        color: #ffaa00;
        animation: centerPulse 2s ease-in-out infinite;
      }
      
      .ring-menu-center .center-label {
        font-family: 'Orbitron', monospace;
        font-size: 11px;
        color: #00d4ff;
        margin-top: 5px;
        text-align: center;
        max-width: 80px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      
      @keyframes centerPulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.1); opacity: 0.8; }
      }
      
      /* 连接线已移除，使用圆环效果 */
      
      /* 状态指示 */
      .ring-menu-container::after {
        content: 'SWIPE TO NAVIGATE';
        position: absolute;
        bottom: -40px;
        left: 50%;
        transform: translateX(-50%);
        font-family: 'Orbitron', monospace;
        font-size: 10px;
        color: rgba(0, 212, 255, 0.5);
        letter-spacing: 2px;
        white-space: nowrap;
      }
    `;
    
    document.head.appendChild(style);
  }
  
  /**
   * 更新菜单项
   */
  updateItems(items: PartId[], highlightedIndex: number = 0, title?: string): void {
    if (!this.container) return;
    
    const menuArea = document.getElementById('ring-menu-area');
    const titleEl = document.getElementById('ring-menu-title');
    const centerLabel = document.getElementById('ring-menu-center-label');
    
    if (!menuArea) return;
    
    // 清空现有项
    menuArea.innerHTML = '';
    this.itemElements.clear();
    
    // 更新标题
    if (titleEl && title) {
      titleEl.textContent = title;
    }
    
    // 计算每个项的角度
    const itemCount = items.length;
    if (itemCount === 0) {
      this.currentItems = [];
      return;
    }
    
    const angleStep = RING_MENU_CONFIG.SPAN_ANGLE / Math.max(1, itemCount - 1);
    const startAngle = RING_MENU_CONFIG.START_ANGLE - RING_MENU_CONFIG.SPAN_ANGLE / 2;
    
    this.currentItems = items.map((id, index) => {
      const angle = itemCount === 1 ? 0 : startAngle + angleStep * index;
      return {
        id,
        displayName: PART_DISPLAY_NAMES[id],
        isHighlighted: index === highlightedIndex,
        angle
      };
    });
    
    // 创建菜单项元素
    this.currentItems.forEach((item, index) => {
      const element = this.createItemElement(item, index);
      menuArea.appendChild(element);
      this.itemElements.set(item.id, element);
    });
    
    // 更新中心标签
    if (centerLabel && this.currentItems[highlightedIndex]) {
      centerLabel.textContent = this.currentItems[highlightedIndex].displayName;
    }
    
    this.currentHighlightIndex = highlightedIndex;
  }
  
  /**
   * 创建单个菜单项元素
   */
  private createItemElement(item: RingMenuItem, index: number): HTMLElement {
    const element = document.createElement('div');
    element.className = `ring-menu-item ${item.isHighlighted ? 'highlighted' : ''}`;
    element.dataset.partId = item.id;
    
    // 计算位置
    const centerX = RING_MENU_CONFIG.RADIUS + RING_MENU_CONFIG.ITEM_SIZE / 2;
    const centerY = RING_MENU_CONFIG.RADIUS + RING_MENU_CONFIG.ITEM_SIZE / 2;
    const angleRad = (item.angle * Math.PI) / 180;
    const x = centerX + Math.cos(angleRad) * RING_MENU_CONFIG.RADIUS - RING_MENU_CONFIG.ITEM_SIZE / 2;
    const y = centerY + Math.sin(angleRad) * RING_MENU_CONFIG.RADIUS - RING_MENU_CONFIG.ITEM_SIZE / 2;
    
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
    
    // 获取图标
    const icon = this.getPartIcon(item.id);
    
    element.innerHTML = `
      <div class="item-ring-outer"></div>
      <div class="item-ring-inner"></div>
      <span class="item-icon">${icon}</span>
      <span class="item-name">${item.displayName}</span>
      <span class="item-index">${index + 1}</span>
    `;
    
    return element;
  }
  
  /**
   * 获取部件图标
   */
  private getPartIcon(partId: PartId): string {
    const iconMap: Partial<Record<PartId, string>> = {
      Head: '🤖',
      neck: '◯',
      mainbody: '▣',
      Leftarm: '💪',
      Rightarm: '💪',
      Leftleg: '🦿',
      Rightleg: '🦿',
      Lefthand: '✋',
      Righthand: '✋',
      Leftfeet: '👟',
      Rightfeet: '👟'
    };
    return iconMap[partId] || '◈';
  }
  
  /**
   * 设置高亮索引
   */
  setHighlightedIndex(index: number): void {
    if (index < 0 || index >= this.currentItems.length) return;
    
    // 移除旧高亮
    this.currentItems.forEach((item, i) => {
      const element = this.itemElements.get(item.id);
      if (element) {
        if (i === index) {
          element.classList.add('highlighted');
        } else {
          element.classList.remove('highlighted');
        }
      }
      this.currentItems[i].isHighlighted = i === index;
    });
    
    // 更新中心标签
    const centerLabel = document.getElementById('ring-menu-center-label');
    if (centerLabel && this.currentItems[index]) {
      centerLabel.textContent = this.currentItems[index].displayName;
    }
    
    this.currentHighlightIndex = index;
  }
  
  /**
   * 显示菜单
   */
  show(): void {
    if (!this.container) return;
    this.container.classList.remove('hidden');
    this.container.classList.add('visible');
    this.isVisible = true;
  }
  
  /**
   * 隐藏菜单
   */
  hide(): void {
    if (!this.container) return;
    this.container.classList.add('hidden');
    this.container.classList.remove('visible');
    this.isVisible = false;
  }
  
  /**
   * 根据状态更新可见性
   */
  updateVisibility(state: MechViewState | string): void {
    this.currentState = state as MechViewState;
    
    // 兼容当前状态机：组件视图（PartView）也显示
    if (state === 'PartList' || state === 'PartDetailExploded' || state === 'PartView') {
      this.show();
    } else {
      this.hide();
    }
  }
  
  /**
   * 获取当前是否可见
   */
  getIsVisible(): boolean {
    return this.isVisible;
  }
  
  /**
   * 获取当前高亮项的 ID
   */
  getHighlightedPartId(): PartId | null {
    if (this.currentHighlightIndex >= 0 && this.currentHighlightIndex < this.currentItems.length) {
      return this.currentItems[this.currentHighlightIndex].id;
    }
    return null;
  }
  
  /**
   * 销毁菜单
   */
  dispose(): void {
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    
    const style = document.getElementById('ring-menu-styles');
    if (style) {
      style.remove();
    }
    
    this.itemElements.clear();
    this.currentItems = [];
  }
}

/**
 * 工厂函数
 */
export function createRingMenu(): RingMenu {
  return new RingMenu();
}


