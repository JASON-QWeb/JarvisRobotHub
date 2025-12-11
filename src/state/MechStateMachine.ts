/**
 * MechStateMachine.ts - 机甲视图状态机
 * 
 * 实现四种状态的转换：
 * 1. Assembled - 整机组装状态
 * 2. MajorExploded - 大部件拆解状态
 * 3. PartList - 零件大列表视图（环形菜单）
 * 4. PartDetailExploded - 选中零件的详情拆解视图
 * 
 * 手势控制：
 * - 张开手 (OPEN_PALM) → 触发当前层级的「拆解展开」
 * - 握拳 (FIST) → 多级返回
 * - 捏合 (PINCH) → 确认选择当前高亮的零件
 * - 左右挥 (SWIPE) → 在列表中切换高亮目标
 */

import {
  MechViewState,
  MechUIState,
  PartId,
  MajorPartId,
  MECH_HIERARCHY,
  getChildParts,
  hasChildren,
  createInitialUIState,
  PART_DISPLAY_NAMES
} from '../types/mechConfig';
import { MechModel, highlightPart, unhighlightPart, dimOtherParts, restoreAllParts } from '../three/loadMech';

// 本地定义手势类型
type GestureType = 'OPEN_PALM' | 'FIST' | 'PINCH' | 'SWIPE_LEFT' | 'SWIPE_RIGHT' | 'POINTING' | 'NONE';

// ============================================
// 配置
// ============================================

export const STATE_MACHINE_CONFIG = {
  // 动画时长
  TRANSITION_DURATION: 500,     // 状态转换动画时长（毫秒）
  EXPLOSION_SPEED: 0.03,        // 拆解速度
  
  // 手势冷却
  GESTURE_COOLDOWN: 300,        // 手势冷却时间
  
  // 调试
  DEBUG_ENABLED: true
};

// ============================================
// 回调类型
// ============================================

export interface StateMachineCallbacks {
  onStateChange?: (newState: MechViewState, oldState: MechViewState) => void;
  onHighlightChange?: (partId: PartId | null, index: number) => void;
  onExplosionChange?: (factor: number, level: 'global' | 'part') => void;
  onPartSelected?: (partId: PartId) => void;
  onMajorPartSelected?: (partId: MajorPartId) => void;
}

// ============================================
// 状态机类
// ============================================

export class MechStateMachine {
  private model: MechModel | null = null;
  private uiState: MechUIState;
  private callbacks: StateMachineCallbacks;
  
  // 拆解因子
  private globalExplosionFactor: number = 0;
  private globalExplosionTarget: number = 0;
  private partExplosionFactor: number = 0;
  private partExplosionTarget: number = 0;
  
  // 手势冷却
  private lastGestureTime: number = 0;
  private lastGestureType: GestureType = 'NONE';
  
  // 当前列表（用于环形菜单）
  private currentList: PartId[] = [];
  
  constructor(callbacks: StateMachineCallbacks = {}) {
    this.uiState = createInitialUIState();
    this.callbacks = callbacks;
  }
  
  /**
   * 初始化状态机
   */
  init(model: MechModel): void {
    this.model = model;
    this.uiState = createInitialUIState();
    this.globalExplosionFactor = 0;
    this.globalExplosionTarget = 0;
    this.partExplosionFactor = 0;
    this.partExplosionTarget = 0;
    
    this.log('状态机初始化完成');
  }
  
  /**
   * 处理手势输入
   */
  handleGesture(gesture: GestureType, gestureJustStarted: boolean = false): void {
    if (!this.model) return;
    
    const now = performance.now();
    
    // 对于持续性手势（OPEN_PALM, FIST），每帧都处理
    // 对于瞬时手势（PINCH, SWIPE），只在刚开始时处理一次
    
    switch (gesture) {
      case 'OPEN_PALM':
        this.handleOpenPalm();
        break;
        
      case 'FIST':
        this.handleFist();
        break;
        
      case 'PINCH':
        if (gestureJustStarted && this.canTriggerGesture(now)) {
          this.handlePinch();
          this.lastGestureTime = now;
        }
        break;
        
      case 'SWIPE_LEFT':
        if (this.canTriggerGesture(now)) {
          this.handleSwipe('left');
          this.lastGestureTime = now;
        }
        break;
        
      case 'SWIPE_RIGHT':
        if (this.canTriggerGesture(now)) {
          this.handleSwipe('right');
          this.lastGestureTime = now;
        }
        break;
    }
    
    this.lastGestureType = gesture;
  }
  
  /**
   * 检查是否可以触发手势（冷却检查）
   */
  private canTriggerGesture(now: number): boolean {
    return now - this.lastGestureTime > STATE_MACHINE_CONFIG.GESTURE_COOLDOWN;
  }
  
  // ============================================
  // 手势处理
  // ============================================
  
  /**
   * 处理张开手掌 - 增加拆解因子
   */
  private handleOpenPalm(): void {
    switch (this.uiState.state) {
      case 'Assembled':
        // 开始全局拆解
        this.globalExplosionTarget = Math.min(1, this.globalExplosionTarget + STATE_MACHINE_CONFIG.EXPLOSION_SPEED);
        if (this.globalExplosionTarget > 0.1 && this.uiState.state === 'Assembled') {
          this.transitionTo('MajorExploded');
        }
        break;
        
      case 'MajorExploded':
        // 继续全局拆解
        this.globalExplosionTarget = Math.min(1, this.globalExplosionTarget + STATE_MACHINE_CONFIG.EXPLOSION_SPEED);
        break;
        
      case 'PartList':
      case 'PartDetailExploded':
        // 部件级拆解
        this.partExplosionTarget = Math.min(1, this.partExplosionTarget + STATE_MACHINE_CONFIG.EXPLOSION_SPEED);
        break;
    }
  }
  
  /**
   * 处理握拳 - 多级返回
   */
  private handleFist(): void {
    switch (this.uiState.state) {
      case 'Assembled':
        // 已经是初始状态，无操作
        break;
        
      case 'MajorExploded':
        // 减少全局拆解，回到 Assembled
        this.globalExplosionTarget = Math.max(0, this.globalExplosionTarget - STATE_MACHINE_CONFIG.EXPLOSION_SPEED);
        if (this.globalExplosionTarget < 0.05) {
          this.transitionTo('Assembled');
        }
        break;
        
      case 'PartList':
        // 先收回部件拆解
        if (this.partExplosionTarget > 0.01) {
          this.partExplosionTarget = Math.max(0, this.partExplosionTarget - STATE_MACHINE_CONFIG.EXPLOSION_SPEED);
        } else {
          // 返回 MajorExploded
          this.transitionTo('MajorExploded');
        }
        break;
        
      case 'PartDetailExploded':
        // 先收回部件拆解
        if (this.partExplosionTarget > 0.01) {
          this.partExplosionTarget = Math.max(0, this.partExplosionTarget - STATE_MACHINE_CONFIG.EXPLOSION_SPEED);
        } else {
          // 返回 PartList
          this.transitionTo('PartList');
        }
        break;
    }
  }
  
  /**
   * 处理捏合 - 确认选择
   */
  private handlePinch(): void {
    this.log(`handlePinch 当前状态: ${this.uiState.state}, 当前列表长度: ${this.currentList.length}`);
    
    switch (this.uiState.state) {
      case 'Assembled':
        // 组装状态下不响应捏合
        break;
        
      case 'MajorExploded':
        // 选中当前高亮的大部件，进入 PartList
        if (this.currentList.length > 0) {
          const selectedId = this.currentList[this.uiState.highlightedIndex] as MajorPartId;
          this.log(`选择大部件: ${selectedId}`);
          this.uiState.currentMajorPart = selectedId;
          this.callbacks.onMajorPartSelected?.(selectedId);
          
          // 如果有子部件，进入 PartList
          if (hasChildren(selectedId)) {
            this.transitionTo('PartList');
          }
        }
        break;
        
      case 'PartList':
        // 选中当前高亮的子零件，进入详情视图
        if (this.currentList.length > 0) {
          const selectedId = this.currentList[this.uiState.highlightedIndex];
          this.log(`选择子零件: ${selectedId}`);
          this.uiState.currentSubPart = selectedId;
          this.callbacks.onPartSelected?.(selectedId);
          this.transitionTo('PartDetailExploded');
        }
        break;
        
      case 'PartDetailExploded':
        // 可以再次拆解或锁定
        this.partExplosionTarget = this.partExplosionTarget > 0.5 ? 0 : 1;
        break;
    }
  }
  
  /**
   * 处理左右挥 - 切换高亮
   */
  private handleSwipe(direction: 'left' | 'right'): void {
    if (this.currentList.length === 0) return;
    
    const delta = direction === 'right' ? 1 : -1;
    let newIndex = this.uiState.highlightedIndex + delta;
    
    // 循环
    if (newIndex < 0) newIndex = this.currentList.length - 1;
    if (newIndex >= this.currentList.length) newIndex = 0;
    
    this.setHighlightedIndex(newIndex);
    
    this.log(`Swipe ${direction}: 切换到索引 ${newIndex}`);
  }
  
  // ============================================
  // 状态转换
  // ============================================
  
  /**
   * 转换到新状态
   */
  private transitionTo(newState: MechViewState): void {
    const oldState = this.uiState.state;
    if (oldState === newState) return;
    
    this.log(`状态转换: ${oldState} → ${newState}`);
    
    // 退出旧状态
    this.exitState(oldState);
    
    // 更新状态
    this.uiState.state = newState;
    
    // 进入新状态
    this.enterState(newState);
    
    // 触发回调
    this.callbacks.onStateChange?.(newState, oldState);
  }
  
  /**
   * 退出状态
   */
  private exitState(state: MechViewState): void {
    if (!this.model) return;
    
    switch (state) {
      case 'MajorExploded':
        // 清除高亮
        if (this.uiState.currentMajorPart) {
          unhighlightPart(this.model, this.uiState.currentMajorPart);
        }
        break;
        
      case 'PartList':
      case 'PartDetailExploded':
        // 清除子部件高亮
        if (this.uiState.currentSubPart) {
          unhighlightPart(this.model, this.uiState.currentSubPart);
        }
        break;
    }
  }
  
  /**
   * 进入状态
   */
  private enterState(state: MechViewState): void {
    if (!this.model) return;
    
    switch (state) {
      case 'Assembled':
        // 重置所有
        this.uiState.currentMajorPart = null;
        this.uiState.currentSubPart = null;
        this.uiState.highlightedIndex = 0;
        this.currentList = [];
        this.globalExplosionTarget = 0;
        this.partExplosionTarget = 0;
        restoreAllParts(this.model);
        break;
        
      case 'MajorExploded':
        // 设置大部件列表
        this.currentList = [...MECH_HIERARCHY.majorParts];
        this.uiState.highlightedIndex = 0;
        this.uiState.currentSubPart = null;
        this.uiState.currentMajorPart = null;
        this.partExplosionTarget = 0;
        
        // 恢复所有部件显示（不高亮）
        restoreAllParts(this.model);
        // 不自动高亮，等用户捏合选择时再高亮
        break;
        
      case 'PartList':
        // 设置子零件列表
        if (this.uiState.currentMajorPart) {
          const children = getChildParts(this.uiState.currentMajorPart);
          this.log(`进入 PartList, 大部件: ${this.uiState.currentMajorPart}, 子部件: ${children.join(', ')}`);
          this.currentList = children;
          this.uiState.highlightedIndex = 0;
          
          // 淡化其他部件，高亮当前大部件和子部件
          dimOtherParts(this.model, [this.uiState.currentMajorPart, ...children]);
          
          // 高亮第一个子零件
          if (children.length > 0) {
            this.uiState.currentSubPart = children[0];
            highlightPart(this.model, children[0]);
          }
        }
        break;
        
      case 'PartDetailExploded':
        // 详情视图
        if (this.uiState.currentSubPart) {
          // 可以保留子零件列表用于切换
          // 聚焦当前零件
          this.updateHighlight();
        }
        break;
    }
  }
  
  /**
   * 选择当前高亮项（内部使用）
   */
  selectCurrentHighlight(): void {
    if (this.currentList.length === 0) return;
    
    const selectedId = this.currentList[this.uiState.highlightedIndex];
    
    switch (this.uiState.state) {
      case 'MajorExploded':
        // 选择大部件
        this.uiState.currentMajorPart = selectedId as MajorPartId;
        this.callbacks.onMajorPartSelected?.(selectedId as MajorPartId);
        
        // 检查是否有子部件
        if (hasChildren(selectedId)) {
          this.transitionTo('PartList');
        }
        break;
        
      case 'PartList':
        // 选择子零件
        this.uiState.currentSubPart = selectedId;
        this.callbacks.onPartSelected?.(selectedId);
        this.transitionTo('PartDetailExploded');
        break;
    }
  }
  
  /**
   * 设置高亮索引
   */
  private setHighlightedIndex(index: number): void {
    if (index < 0 || index >= this.currentList.length) return;
    
    // 取消之前的高亮
    this.clearCurrentHighlight();
    
    // 更新索引
    this.uiState.highlightedIndex = index;
    
    // 应用新高亮
    this.updateHighlight();
    
    // 触发回调
    const partId = this.currentList[index] || null;
    this.callbacks.onHighlightChange?.(partId, index);
  }
  
  /**
   * 清除当前高亮
   */
  private clearCurrentHighlight(): void {
    if (!this.model) return;
    
    if (this.uiState.state === 'MajorExploded' && this.uiState.currentMajorPart) {
      unhighlightPart(this.model, this.uiState.currentMajorPart);
    } else if (this.uiState.currentSubPart) {
      unhighlightPart(this.model, this.uiState.currentSubPart);
    }
    
    // 也清除列表中当前索引的高亮
    const currentId = this.currentList[this.uiState.highlightedIndex];
    if (currentId) {
      unhighlightPart(this.model, currentId);
    }
  }
  
  /**
   * 更新高亮显示
   */
  private updateHighlight(): void {
    if (!this.model || this.currentList.length === 0) return;
    
    const partId = this.currentList[this.uiState.highlightedIndex];
    if (!partId) return;
    
    highlightPart(this.model, partId);
    
    // 更新 UI 状态
    if (this.uiState.state === 'MajorExploded') {
      this.uiState.currentMajorPart = partId as MajorPartId;
    } else {
      this.uiState.currentSubPart = partId;
    }
  }
  
  // ============================================
  // 更新循环
  // ============================================
  
  /**
   * 每帧更新
   */
  update(_deltaTime: number): void {
    if (!this.model) return;
    
    // 平滑更新拆解因子
    const smoothing = 0.1;
    
    // 全局拆解
    if (Math.abs(this.globalExplosionFactor - this.globalExplosionTarget) > 0.001) {
      this.globalExplosionFactor += (this.globalExplosionTarget - this.globalExplosionFactor) * smoothing;
      this.callbacks.onExplosionChange?.(this.globalExplosionFactor, 'global');
      this.applyGlobalExplosion();
    }
    
    // 部件拆解
    if (Math.abs(this.partExplosionFactor - this.partExplosionTarget) > 0.001) {
      this.partExplosionFactor += (this.partExplosionTarget - this.partExplosionFactor) * smoothing;
      this.callbacks.onExplosionChange?.(this.partExplosionFactor, 'part');
      this.applyPartExplosion();
    }
    
    // 更新 UI 状态的拆解因子
    this.uiState.explosionFactor = this.uiState.state === 'PartList' || this.uiState.state === 'PartDetailExploded'
      ? this.partExplosionFactor
      : this.globalExplosionFactor;
  }
  
  /**
   * 应用全局拆解
   */
  private applyGlobalExplosion(): void {
    if (!this.model) return;
    
    // 遍历大部件，应用拆解偏移
    MECH_HIERARCHY.majorParts.forEach(partId => {
      const config = this.model!.parts.get(partId);
      if (!config || !config.node || !config.originalPosition) return;
      
      // 减小拆解距离乘数，使部件分离更温和
      const offset = config.explodeDir.clone().multiplyScalar(
        config.explodeDistance * this.globalExplosionFactor * 1.2
      );
      
      config.node.position.copy(config.originalPosition).add(offset);
      
      // 轻微旋转（减小旋转幅度）
      if (config.originalRotation) {
        config.node.rotation.set(
          config.originalRotation.x + config.explodeDir.x * this.globalExplosionFactor * 0.02,
          config.originalRotation.y + config.explodeDir.y * this.globalExplosionFactor * 0.02,
          config.originalRotation.z + config.explodeDir.z * this.globalExplosionFactor * 0.02
        );
      }
    });
  }
  
  /**
   * 应用部件级拆解
   */
  private applyPartExplosion(): void {
    if (!this.model || !this.uiState.currentMajorPart) return;
    
    const children = getChildParts(this.uiState.currentMajorPart);
    
    children.forEach(partId => {
      const config = this.model!.parts.get(partId);
      if (!config || !config.node || !config.originalPosition) return;
      
      const offset = config.explodeDir.clone().multiplyScalar(
        config.explodeDistance * this.partExplosionFactor * 1.5
      );
      
      config.node.position.copy(config.originalPosition).add(offset);
    });
  }
  
  // ============================================
  // Getters
  // ============================================
  
  /**
   * 获取当前 UI 状态
   */
  getUIState(): MechUIState {
    return { ...this.uiState };
  }
  
  /**
   * 获取当前状态
   */
  getCurrentState(): MechViewState {
    return this.uiState.state;
  }
  
  /**
   * 获取当前列表
   */
  getCurrentList(): PartId[] {
    return [...this.currentList];
  }
  
  /**
   * 获取当前列表的显示名称
   */
  getCurrentListDisplayNames(): string[] {
    return this.currentList.map(id => PART_DISPLAY_NAMES[id]);
  }
  
  /**
   * 获取当前高亮索引
   */
  getHighlightedIndex(): number {
    return this.uiState.highlightedIndex;
  }
  
  /**
   * 获取全局拆解因子
   */
  getGlobalExplosionFactor(): number {
    return this.globalExplosionFactor;
  }
  
  /**
   * 获取部件拆解因子
   */
  getPartExplosionFactor(): number {
    return this.partExplosionFactor;
  }
  
  /**
   * 获取状态显示名称
   */
  getStateDisplayName(): string {
    const stateNames: Record<MechViewState, string> = {
      'Assembled': '整机组装',
      'MajorExploded': '大部件拆解',
      'PartList': '零件列表',
      'PartDetailExploded': '零件详情'
    };
    return stateNames[this.uiState.state];
  }
  
  /**
   * 获取当前聚焦部件名称
   */
  getFocusPartName(): string | null {
    if (this.uiState.currentSubPart) {
      return PART_DISPLAY_NAMES[this.uiState.currentSubPart];
    }
    if (this.uiState.currentMajorPart) {
      return PART_DISPLAY_NAMES[this.uiState.currentMajorPart];
    }
    return null;
  }
  
  // ============================================
  // 重置和销毁
  // ============================================
  
  /**
   * 重置状态机
   */
  reset(): void {
    this.transitionTo('Assembled');
    this.globalExplosionFactor = 0;
    this.globalExplosionTarget = 0;
    this.partExplosionFactor = 0;
    this.partExplosionTarget = 0;
  }
  
  /**
   * 销毁
   */
  dispose(): void {
    this.model = null;
    this.currentList = [];
  }
  
  /**
   * 日志输出
   */
  private log(message: string): void {
    if (STATE_MACHINE_CONFIG.DEBUG_ENABLED) {
      //console.log(`[StateMachine] ${message}`);
    }
  }
}

/**
 * 工厂函数
 */
export function createMechStateMachine(callbacks?: StateMachineCallbacks): MechStateMachine {
  return new MechStateMachine(callbacks);
}

