/**
 * SimpleStateMachine.ts - 简化版状态机（键盘鼠标控制）
 * 
 * 状态：
 * 1. Assembled - 整机组装状态
 * 2. Exploded - 拆解状态（可选择大部件）
 * 3. PartView - 组件视图（选中部件居中，其余环状排列）
 * 
 * 交互：
 * - A键长按：拆解
 * - S键长按：聚拢
 * - 鼠标悬停：高亮部件（由鼠标控制器处理）
 * - 双击左键：进入组件视图
 * - 上下/左右箭头：切换零件
 * - ESC：返回
 */

import * as THREE from 'three';
import {
  PartId,
  MajorPartId,
  MECH_HIERARCHY,
  getChildParts,
  PART_DISPLAY_NAMES,
  PART_DISPLAY_NAMES_EN,
  EXPLODE_OFFSETS
} from '../types/mechConfig';

// 获取当前语言
function getCurrentLang(): 'zh' | 'en' {
  if (typeof (window as any).currentLang !== 'undefined') {
    return (window as any).currentLang;
  }
  const saved = localStorage.getItem('jarvis-lang');
  return (saved === 'en') ? 'en' : 'zh';
}

// 获取部件显示名称（支持多语言）
function getPartName(partId: PartId): string {
  const lang = getCurrentLang();
  return lang === 'en' ? PART_DISPLAY_NAMES_EN[partId] : PART_DISPLAY_NAMES[partId];
}
import { MechModel } from '../three/loadMech';

// ============================================
// 类型定义
// ============================================

export type SimpleViewState = 'Assembled' | 'Exploded' | 'PartView';

export interface SimpleUIState {
  state: SimpleViewState;
  globalExplosion: number;       // 全局拆解因子 0-1
  partExplosion: number;         // 部件拆解因子 0-1
  hoveredPart: PartId | null;    // 鼠标悬停的部件
  selectedMajorPart: MajorPartId | null;  // 选中的大部件
  currentPartIndex: number;      // 当前零件索引（在PartView中）
  partList: PartId[];            // 当前显示的零件列表（所有大部件）
}

export interface SimpleCallbacks {
  onStateChange?: (newState: SimpleViewState, oldState: SimpleViewState) => void;
  onExplosionChange?: (global: number, part: number) => void;
  onHoverChange?: (partId: PartId | null, displayName: string | null) => void;
  onPartListChange?: (parts: PartId[], currentIndex: number, selectedPart: PartId | null) => void;
  onPartViewLayout?: (selectedPart: MajorPartId, otherParts: MajorPartId[]) => void;
}

// ============================================
// 状态机类
// ============================================

export class SimpleStateMachine {
  private model: MechModel | null = null;
  private scene: THREE.Scene | null = null;
  private callbacks: SimpleCallbacks;
  
  // UI 状态
  private uiState: SimpleUIState = {
    state: 'Assembled',
    globalExplosion: 0,
    partExplosion: 0,
    hoveredPart: null,
    selectedMajorPart: null,
    currentPartIndex: 0,
    partList: [...MECH_HIERARCHY.majorParts]  // 所有大部件列表
  };
  
  // 目标值（用于平滑过渡）
  private globalExplosionTarget: number = 0;
  private partExplosionTarget: number = 0;
  
  // ============================================
  // 圆环布局系统 - 1个大圆环 + 7个小圆环
  // ============================================
  
  // 大圆环（中心）参数 - 简洁科技风
  private mainRingRadius: number = 1.2;  // 大圆环半径（缩小）
  private mainRingCenter = new THREE.Vector3(0, 0.1, 2.0);  // 大圆环中心位置
  
  // 小圆环参数
  private subRingRadius: number = 0.5;   // 小圆环半径
  private subRingDistance: number = 4.0; // 小圆环距离中心的距离
  private subRingZ: number = -2;        // 小圆环的Z位置
  
  // 过渡动画系统
  private transitionTargets: Map<string, THREE.Vector3> = new Map();
  private transitionScales: Map<string, number> = new Map();
  private isTransitioning: boolean = false;
  private transitionSpeed: number = 0.08;
  
  // ============================================
  // 每个组件的位置配置（可自行调整）
  // ============================================
  
  // 组件在【大圆环】中心时的位置偏移 (x, y, z)
  // 调整这些值让组件显示在大圆环中心
  private partPositionInMainRing: Record<string, { x: number; y: number; z: number }> = {
    'Head':      { x: -0.1,    y: -1.4,   z: -1 },    // 头部
    'neck':      { x: -0.2,    y: -1.4,   z: -1 },    // 脖子
    'mainbody':  { x: -0.1,    y: -1,  z: -1 },    // 主体（重心偏上，需要下移）
    'Leftarm':   { x: -0.2,    y: -0.1,  z: -1 },    // 左臂
    'Rightarm':  { x: 0.1,    y: -0.1,  z: -1 },    // 右臂
    'Leftleg':   { x: 0,    y: 0.1,   z: -1 },    // 左腿（重心偏下，需要上移）
    'Rightleg':  { x: 0,    y: 0.1,   z: -1 },    // 右腿
  };
  
  // 组件在【小圆环】中的位置偏移 (x, y, z)
  // 调整这些值让组件显示在小圆环中心
  private partPositionInSubRing: Record<string, { x: number; y: number; z: number }> = {
    'Head':      { x: -0.05,    y: 1.2,   z: 1.3 },    // 头部
    'neck':      { x: -1.8,    y: 0.35,  z: 1.3 },    // 脖子
    'mainbody':  { x: -2.25,    y: -1.55,  z: 1.3 },    // 主体
    'Leftarm':   { x: -1,    y: -2.2,  z: 1.3 },    // 左臂
    'Rightarm':  { x: 1,    y: -2.2,  z: 1.3 },    // 右臂
    'Leftleg':   { x: 2.1,    y: -0.5,   z: 1.3 },    // 左腿
    'Rightleg':  { x: 1.8,    y: 1.5,   z: 1.3 },    // 右腿
  };
  
  // 7个小圆环的固定位置（按角度均匀分布）
  // 索引0-6对应7个位置：顶部开始顺时针
  private subRingFixedPositions: THREE.Vector3[] = [];
  
  // 3D 环形装饰
  private mainRingDecoration: THREE.Group | null = null;  // 大圆环装饰
  private subRingDecorations: THREE.Group[] = [];         // 7个小圆环装饰
  private ringDecorationVisible: boolean = false;
  private selectedSubRingIndex: number = -1;              // 当前选中组件对应的小圆环索引
  
  constructor(callbacks: SimpleCallbacks = {}) {
    this.callbacks = callbacks;
    // 初始化7个小圆环固定位置
    this.initSubRingPositions();
  }
  
  /**
   * 初始化7个小圆环的固定位置
   */
  private initSubRingPositions(): void {
    const count = 7;  // 7个小圆环
    const angleStep = (Math.PI * 2) / count;
    const startAngle = -Math.PI / 2;  // 从顶部开始
    
    this.subRingFixedPositions = [];
    for (let i = 0; i < count; i++) {
      const angle = startAngle + angleStep * i;
      const x = Math.cos(angle) * this.subRingDistance;
      const y = Math.sin(angle) * this.subRingDistance;
      this.subRingFixedPositions.push(new THREE.Vector3(x, y, this.subRingZ));
    }
  }
  
  /**
   * 初始化
   */
  init(model: MechModel, scene?: THREE.Scene): void {
    this.model = model;
    this.scene = scene || null;
    
    // 创建3D环形装饰
    if (this.scene) {
      this.createRingDecoration();
    }
    
    //console.log('[SimpleStateMachine] 初始化完成');
  }
  
  /**
   * 创建所有圆环装饰 - 1个大圆环 + 7个小圆环
   */
  private createRingDecoration(): void {
    if (!this.scene) return;
    
    // 创建大圆环（中心）
    this.createMainRing();
    
    // 创建7个小圆环
    this.createSubRings();
  }
  
  /**
   * 创建大圆环（中心）- 4层圆环，从外到内依次突出
   * 第1层：青色，无缺口
   * 第2层：青色，粗，多个缺口
   * 第3层：黄色，细，一个缺口
   * 第4层：红色，细，两个缺口
   */
  private createMainRing(): void {
    if (!this.scene) return;
    
    this.mainRingDecoration = new THREE.Group();
    this.mainRingDecoration.name = 'mainRingDecoration';
    
    const r = this.mainRingRadius;
    
    // 第1层（最外）：青色，无缺口，完整圆环，Z=0
    const ring1Arc = new THREE.TorusGeometry(r, 0.02, 16, 64, Math.PI * 2);  // 完整360度
    const ring1Mat = new THREE.MeshBasicMaterial({ color: 0x00d4ff, transparent: true, opacity: 0.7 });
    const ring1 = new THREE.Mesh(ring1Arc, ring1Mat);
    ring1.name = 'ring1';
    ring1.position.z = 0;
    this.mainRingDecoration.add(ring1);
    
    // 第2层：青色，粗，多个缺口（5段），Z=0.05
    const ring2Arc1 = new THREE.TorusGeometry(r - 0.1, 0.035, 16, 28, Math.PI * 0.35);
    const ring2Arc2 = new THREE.TorusGeometry(r - 0.1, 0.035, 16, 32, Math.PI * 0.4);
    const ring2Arc3 = new THREE.TorusGeometry(r - 0.1, 0.035, 16, 24, Math.PI * 0.3);
    const ring2Arc4 = new THREE.TorusGeometry(r - 0.1, 0.035, 16, 28, Math.PI * 0.35);
    const ring2Arc5 = new THREE.TorusGeometry(r - 0.1, 0.035, 16, 20, Math.PI * 0.25);
    const ring2Mat = new THREE.MeshBasicMaterial({ color: 0x00d4ff, transparent: true, opacity: 0.8 });
    
    const ring2a = new THREE.Mesh(ring2Arc1, ring2Mat);
    ring2a.name = 'ring2a';
    ring2a.rotation.z = 0;
    ring2a.position.z = 0.05;
    this.mainRingDecoration.add(ring2a);
    
    const ring2b = new THREE.Mesh(ring2Arc2, ring2Mat.clone());
    ring2b.name = 'ring2b';
    ring2b.rotation.z = Math.PI * 0.45;
    ring2b.position.z = 0.05;
    this.mainRingDecoration.add(ring2b);
    
    const ring2c = new THREE.Mesh(ring2Arc3, ring2Mat.clone());
    ring2c.name = 'ring2c';
    ring2c.rotation.z = Math.PI * 0.95;
    ring2c.position.z = 0.05;
    this.mainRingDecoration.add(ring2c);
    
    const ring2d = new THREE.Mesh(ring2Arc4, ring2Mat.clone());
    ring2d.name = 'ring2d';
    ring2d.rotation.z = Math.PI * 1.35;
    ring2d.position.z = 0.05;
    this.mainRingDecoration.add(ring2d);
    
    const ring2e = new THREE.Mesh(ring2Arc5, ring2Mat.clone());
    ring2e.name = 'ring2e';
    ring2e.rotation.z = Math.PI * 1.8;
    ring2e.position.z = 0.05;
    this.mainRingDecoration.add(ring2e);
    
    // 第3层：黄色，细，一个缺口（约300度弧），Z=0.1
    const ring3Arc = new THREE.TorusGeometry(r - 0.22, 0.025, 16, 56, Math.PI * 1.67);  // 约300度
    const ring3Mat = new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.75 });
    const ring3 = new THREE.Mesh(ring3Arc, ring3Mat);
    ring3.name = 'ring3';
    ring3.rotation.z = Math.PI * 0.2;  // 缺口位置
    ring3.position.z = 0.1;
    this.mainRingDecoration.add(ring3);
    
    // 第4层（最内）：红色，细，两个缺口，Z=0.15
    const ring4Arc1 = new THREE.TorusGeometry(r - 0.34, 0.025, 16, 48, Math.PI * 0.85);  // 约153度
    const ring4Arc2 = new THREE.TorusGeometry(r - 0.34, 0.025, 16, 48, Math.PI * 0.85);  // 约153度
    const ring4Mat = new THREE.MeshBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.8 });
    
    const ring4a = new THREE.Mesh(ring4Arc1, ring4Mat);
    ring4a.name = 'ring4a';
    ring4a.rotation.z = 0;
    ring4a.position.z = 0.15;
    this.mainRingDecoration.add(ring4a);
    
    const ring4b = new THREE.Mesh(ring4Arc2, ring4Mat.clone());
    ring4b.name = 'ring4b';
    ring4b.rotation.z = Math.PI;
    ring4b.position.z = 0.15;
    this.mainRingDecoration.add(ring4b);
    
    // 位置和初始隐藏
    this.mainRingDecoration.position.copy(this.mainRingCenter);
    this.mainRingDecoration.position.z -= 0.5;
    this.mainRingDecoration.visible = false;
    
    this.scene.add(this.mainRingDecoration);
  }
  
  /**
   * 创建7个小圆环 - 双层，内层Z坐标突出
   */
  private createSubRings(): void {
    if (!this.scene) return;
    
    this.subRingDecorations = [];
    
    for (let i = 0; i < 7; i++) {
      const subRing = new THREE.Group();
      subRing.name = `subRing_${i}`;
      
      const r = this.subRingRadius;
      
      // 外环：青色，带断口，Z=0
      const outerArc1 = new THREE.TorusGeometry(r + 0.1, 0.02, 16, 28, Math.PI * 0.8);
      const outerArc2 = new THREE.TorusGeometry(r + 0.1, 0.02, 16, 24, Math.PI * 0.7);
      const outerMat = new THREE.MeshBasicMaterial({ color: 0x00d4ff, transparent: true, opacity: 0.6 });
      
      const outer1 = new THREE.Mesh(outerArc1, outerMat);
      outer1.name = 'outer1';
      outer1.rotation.z = Math.PI * 0.1 + i * 0.3;  // 每个小圆环稍微不同的起始角度
      outer1.position.z = 0;
      subRing.add(outer1);
      
      const outer2 = new THREE.Mesh(outerArc2, outerMat.clone());
      outer2.name = 'outer2';
      outer2.rotation.z = Math.PI * 1.1 + i * 0.3;
      outer2.position.z = 0;
      subRing.add(outer2);
      
      // 内环：青绿色，更粗，Z=0.08（突出）
      const innerArc1 = new THREE.TorusGeometry(r - 0.02, 0.03, 16, 20, Math.PI * 0.55);
      const innerArc2 = new THREE.TorusGeometry(r - 0.02, 0.03, 16, 24, Math.PI * 0.65);
      const innerArc3 = new THREE.TorusGeometry(r - 0.02, 0.03, 16, 18, Math.PI * 0.5);
      const innerMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.7 });
      
      const inner1 = new THREE.Mesh(innerArc1, innerMat);
      inner1.name = 'inner1';
      inner1.rotation.z = Math.PI * 0.2 + i * 0.4;
      inner1.position.z = 0.08;  // 突出
      subRing.add(inner1);
      
      const inner2 = new THREE.Mesh(innerArc2, innerMat.clone());
      inner2.name = 'inner2';
      inner2.rotation.z = Math.PI * 0.9 + i * 0.4;
      inner2.position.z = 0.08;  // 突出
      subRing.add(inner2);
      
      const inner3 = new THREE.Mesh(innerArc3, innerMat.clone());
      inner3.name = 'inner3';
      inner3.rotation.z = Math.PI * 1.6 + i * 0.4;
      inner3.position.z = 0.08;  // 突出
      subRing.add(inner3);
      
      // 设置位置
      const pos = this.subRingFixedPositions[i];
      if (pos) {
        subRing.position.copy(pos);
        subRing.position.z -= 0.3;  // 在组件后面
      }
      
      subRing.visible = false;
      this.scene.add(subRing);
      this.subRingDecorations.push(subRing);
    }
  }
  
  /**
   * 更新所有圆环动画
   */
  private updateRingDecorationAnimation(time: number): void {
    if (!this.ringDecorationVisible) return;
    
    const t = time * 0.001;
    
    // 更新大圆环动画
    this.updateMainRingAnimation(t);
    
    // 更新小圆环动画
    this.updateSubRingsAnimation(t);
  }
  
  /**
   * 更新大圆环动画 - 4层圆环交错旋转
   */
  private updateMainRingAnimation(t: number): void {
    if (!this.mainRingDecoration) return;
    
    // 第1层（最外）：完整圆环，慢速顺时针
    const ring1 = this.mainRingDecoration.getObjectByName('ring1');
    if (ring1) {
      ring1.rotation.z += 0.002;
    }
    
    // 第2层：多断口，中速逆时针
    ['ring2a', 'ring2b', 'ring2c', 'ring2d', 'ring2e'].forEach((name) => {
      const ring = this.mainRingDecoration!.getObjectByName(name);
      if (ring) {
        ring.rotation.z -= 0.005;
      }
    });
    
    // 第3层：一个缺口，快速顺时针
    const ring3 = this.mainRingDecoration.getObjectByName('ring3');
    if (ring3) {
      ring3.rotation.z += 0.008;
    }
    
    // 第4层（最内）：两个缺口，最快逆时针
    ['ring4a', 'ring4b'].forEach((name) => {
      const ring = this.mainRingDecoration!.getObjectByName(name);
      if (ring) {
        ring.rotation.z -= 0.012;
      }
    });
  }
  
  /**
   * 更新小圆环动画 - 呼吸灯效果 + 旋转
   */
  private updateSubRingsAnimation(t: number): void {
    this.subRingDecorations.forEach((subRing, index) => {
      if (!subRing.visible) return;
      
      // 是否为选中组件对应的小圆环
      const isSelected = index === this.selectedSubRingIndex;
      
      // 呼吸效果
      const breatheSpeed = isSelected ? 6 : 2;
      const phase = (t * breatheSpeed + index * 0.5) % (Math.PI * 2);
      const breathe = 0.5 + Math.sin(phase) * 0.5;
      
      subRing.children.forEach((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
          const name = child.name;
          
          // 外环旋转（慢）
          if (name.startsWith('outer')) {
            child.rotation.z += isSelected ? 0.008 : 0.003;
            
            if (isSelected) {
              child.material.color.setHex(0xff4444);
              child.material.opacity = 0.4 + breathe * 0.5;
            } else {
              child.material.color.setHex(0x00d4ff);
              child.material.opacity = 0.4 + breathe * 0.2;
            }
          }
          
          // 内环旋转（快，反向）
          if (name.startsWith('inner')) {
            child.rotation.z -= isSelected ? 0.015 : 0.006;
            
            if (isSelected) {
              child.material.color.setHex(0xff5e5e);
              child.material.opacity = 0.5 + breathe * 0.5;
            } else {
              child.material.color.setHex(0x00ffcc);
              child.material.opacity = 0.5 + breathe * 0.25;
            }
          }
        }
      });
    });
  }
  
  /**
   * 显示所有圆环装饰
   */
  private showRingDecoration(): void {
    // 显示大圆环
    if (this.mainRingDecoration) {
      this.mainRingDecoration.visible = true;
    }
    // 显示所有小圆环
    this.subRingDecorations.forEach(ring => {
      ring.visible = true;
    });
    this.ringDecorationVisible = true;
  }
  
  /**
   * 隐藏所有圆环装饰
   */
  private hideRingDecoration(): void {
    // 隐藏大圆环
    if (this.mainRingDecoration) {
      this.mainRingDecoration.visible = false;
    }
    // 隐藏所有小圆环
    this.subRingDecorations.forEach(ring => {
      ring.visible = false;
    });
    this.ringDecorationVisible = false;
  }
  
  /**
   * 更新小圆环可见性和状态（所有7个小圆环始终显示，选中的变红色闪烁）
   */
  private updateSubRingVisibility(selectedIndex: number): void {
    // 记录选中的索引
    this.selectedSubRingIndex = selectedIndex;
    
    // 所有7个小圆环始终显示
    this.subRingDecorations.forEach((ring) => {
      ring.visible = this.ringDecorationVisible;
    });
  }
  
  // ============================================
  // 拆解控制
  // ============================================
  
  /**
   * 调整拆解程度
   * @param delta 正值拆解，负值聚拢
   */
  adjustExplosion(delta: number): void {
    if (this.uiState.state === 'PartView') {
      // 在组件视图中，调整部件拆解
      this.partExplosionTarget = Math.max(0, Math.min(1, this.partExplosionTarget + delta));
    } else {
      // 在整机视图中，调整全局拆解
      this.globalExplosionTarget = Math.max(0, Math.min(1, this.globalExplosionTarget + delta));
      
      // 自动切换状态
      if (this.globalExplosionTarget > 0.1 && this.uiState.state === 'Assembled') {
        this.transitionTo('Exploded');
      } else if (this.globalExplosionTarget < 0.05 && this.uiState.state === 'Exploded') {
        this.transitionTo('Assembled');
      }
    }
  }
  
  /**
   * 每帧更新
   */
  update(_deltaTime: number): void {
    if (!this.model) return;
    
    const smoothing = 0.1;
    let explosionChanged = false;
    
    // 平滑更新全局拆解
    if (Math.abs(this.uiState.globalExplosion - this.globalExplosionTarget) > 0.001) {
      this.uiState.globalExplosion += (this.globalExplosionTarget - this.uiState.globalExplosion) * smoothing;
      explosionChanged = true;
    }
    
    // 平滑更新部件拆解
    if (Math.abs(this.uiState.partExplosion - this.partExplosionTarget) > 0.001) {
      this.uiState.partExplosion += (this.partExplosionTarget - this.uiState.partExplosion) * smoothing;
      explosionChanged = true;
    }
    
    // 应用过渡动画（组件视图）
    if (this.uiState.state === 'PartView' && this.isTransitioning) {
      this.applyTransitionAnimation();
      // 同时应用子部件拆解
      if (this.uiState.partExplosion > 0) {
        this.applyPartExplosion();
      }
    } else if (explosionChanged) {
      this.applyExplosion();
    }
    
    if (explosionChanged) {
      this.callbacks.onExplosionChange?.(this.uiState.globalExplosion, this.uiState.partExplosion);
    }
    
    // 更新环形装饰动画
    this.updateRingDecorationAnimation(performance.now());
  }
  
  /**
   * 应用拆解效果
   */
  private applyExplosion(): void {
    if (!this.model) return;
    
    if (this.uiState.state === 'PartView') {
      // 组件视图：选中部件居中，其余部件环状排列
      this.applyPartViewLayout();
    } else {
      // 普通拆解视图
      this.applyNormalExplosion();
    }
  }
  
  /**
   * 应用普通拆解效果
   */
  private applyNormalExplosion(): void {
    if (!this.model) return;
    
    MECH_HIERARCHY.majorParts.forEach(partId => {
      const config = this.model!.parts.get(partId);
      if (!config || !config.node) return;
      
      const offset = EXPLODE_OFFSETS[partId];
      if (!offset) return;
      
      // 计算拆解偏移
      const dir = new THREE.Vector3(offset.direction[0], offset.direction[1], offset.direction[2]).normalize();
      const distance = offset.distance * this.uiState.globalExplosion;
      
      // 应用位置
      if (config.originalPosition) {
        config.node.position.copy(config.originalPosition);
        config.node.position.add(dir.multiplyScalar(distance));
      }
    });
  }
  
  /**
   * 应用组件视图布局：选中部件居中，其余部件环状排列（垂直于屏幕）
   */
  private applyPartViewLayout(): void {
    if (!this.model || !this.uiState.selectedMajorPart) return;
    
    const selectedPart = this.uiState.selectedMajorPart;
    const otherParts = MECH_HIERARCHY.majorParts.filter(p => p !== selectedPart);
    
    // 计算所有目标位置
    this.calculateTransitionTargets(selectedPart, otherParts);
    
    // 开始过渡动画
    if (!this.isTransitioning) {
      this.isTransitioning = true;
    }
  }
  
  /**
   * 计算组件位置 - 选中组件到大圆环，其他组件到各自固定小圆环
   * 每个组件有固定的小圆环位置（索引0-6），选中时只是移到大圆环，小圆环保留空着
   */
  private calculateTransitionTargets(selectedPart: MajorPartId, _otherParts: MajorPartId[]): void {
    this.transitionTargets.clear();
    this.transitionScales.clear();
    
    // ========== 选中组件 → 大圆环中心 ==========
    const mainOffset = this.partPositionInMainRing[selectedPart] || { x: 0, y: 0, z: 0 };
    const selectedTarget = new THREE.Vector3(
      this.mainRingCenter.x + mainOffset.x,
      this.mainRingCenter.y + mainOffset.y,
      this.mainRingCenter.z + mainOffset.z
    );
    this.transitionTargets.set(selectedPart, selectedTarget);
    this.transitionScales.set(selectedPart, 1.0);  // 选中组件原始大小
    
    // 找到选中组件在全部组件中的索引（用于确定哪个小圆环要空着）
    const selectedIndex = MECH_HIERARCHY.majorParts.indexOf(selectedPart);
    
    // 更新小圆环可见性（所有7个都显示，选中的那个空着）
    this.updateSubRingVisibility(selectedIndex);
    
    // ========== 其他组件 → 各自固定小圆环 ==========
    // 每个组件有固定的小圆环位置（按 MECH_HIERARCHY.majorParts 的索引）
    MECH_HIERARCHY.majorParts.forEach((partId, fixedIndex) => {
      if (partId === selectedPart) return;  // 跳过选中的（它在大圆环）
      
      // 使用固定索引获取小圆环位置（每个组件的小圆环位置固定不变）
      const ringPos = this.subRingFixedPositions[fixedIndex];
      if (!ringPos) return;
      
      // 获取该组件在小圆环中的位置偏移
      const subOffset = this.partPositionInSubRing[partId] || { x: 0, y: 0, z: 0 };
      
      // 计算目标位置
      const targetPos = new THREE.Vector3(
        ringPos.x + subOffset.x,
        ringPos.y + subOffset.y,
        ringPos.z + subOffset.z
      );
      
      this.transitionTargets.set(partId, targetPos);
      this.transitionScales.set(partId, 0.7);  // 小圆环中的组件缩小
    });
  }
  
  /**
   * 应用过渡动画（在update中调用）
   */
  private applyTransitionAnimation(): void {
    if (!this.model || !this.isTransitioning) return;
    
    let allReached = true;
    
    // 对每个部件应用平滑过渡（位置和缩放）
    MECH_HIERARCHY.majorParts.forEach(partId => {
      const config = this.model!.parts.get(partId);
      if (!config || !config.node) return;
      
      const targetPos = this.transitionTargets.get(partId);
      const targetScale = this.transitionScales.get(partId) || 1;
      if (!targetPos) return;
      
      const currentPos = config.node.position;
      const currentScale = config.node.scale.x;
      
      // 位置过渡
      const posDistance = currentPos.distanceTo(targetPos);
      if (posDistance < 0.01) {
        currentPos.copy(targetPos);
      } else {
        currentPos.lerp(targetPos, this.transitionSpeed);
        allReached = false;
      }
      
      // 缩放过渡
      const scaleDistance = Math.abs(currentScale - targetScale);
      if (scaleDistance < 0.01) {
        config.node.scale.setScalar(targetScale);
      } else {
        const newScale = THREE.MathUtils.lerp(currentScale, targetScale, this.transitionSpeed);
        config.node.scale.setScalar(newScale);
        allReached = false;
      }
    });
    
    // 所有部件都到达目标位置
    if (allReached) {
      this.isTransitioning = false;
    }
  }
  
  /**
   * 旧版布局方法（用于非组件视图时的子件拆解）
   */
  private applyPartExplosion(): void {
    if (!this.model || !this.uiState.selectedMajorPart) return;
    
    const selectedPart = this.uiState.selectedMajorPart;
    
    // 如果有子部件拆解
    if (this.uiState.partExplosion > 0) {
      const children = getChildParts(selectedPart);
      children.forEach(childPartId => {
        const config = this.model!.parts.get(childPartId);
        if (!config || !config.node) return;
        
        const offset = EXPLODE_OFFSETS[childPartId];
        if (!offset) return;
        
        const dir = new THREE.Vector3(offset.direction[0], offset.direction[1], offset.direction[2]).normalize();
        const distance = offset.distance * this.uiState.partExplosion;
        
        if (config.originalPosition) {
          config.node.position.copy(config.originalPosition);
          config.node.position.add(dir.multiplyScalar(distance));
        }
      });
    }
  }
  
  // ============================================
  // 鼠标交互
  // ============================================
  
  /**
   * 设置悬停的部件ID（高亮由鼠标控制器处理）
   */
  setHoveredPartId(partId: PartId | null): void {
    if (this.uiState.hoveredPart === partId) return;
    
    this.uiState.hoveredPart = partId;
    
    // 回调
    const displayName = partId ? getPartName(partId) : null;
    this.callbacks.onHoverChange?.(partId, displayName);
  }
  
  /**
   * 双击选择当前悬停的部件
   */
  selectHoveredPart(): boolean {
    if (!this.uiState.hoveredPart) {
      //console.log('[SimpleStateMachine] 没有悬停部件，无法选择');
      return false;
    }
    
    //console.log(`[SimpleStateMachine] 尝试选择部件: ${this.uiState.hoveredPart}, 当前状态: ${this.uiState.state}, 拆解程度: ${this.uiState.globalExplosion.toFixed(2)}`);
    
    // 在拆解状态或拆解过程中（globalExplosion > 0.1）都可以选择
    if (this.uiState.state === 'Exploded' || this.uiState.globalExplosion > 0.1) {
      // 检查是否是大部件
      if (MECH_HIERARCHY.majorParts.includes(this.uiState.hoveredPart as MajorPartId)) {
        const majorPart = this.uiState.hoveredPart as MajorPartId;
        
        this.uiState.selectedMajorPart = majorPart;
        this.uiState.currentPartIndex = MECH_HIERARCHY.majorParts.indexOf(majorPart);
        this.partExplosionTarget = 0;
        this.uiState.partExplosion = 0;
        // 进入组件视图时将全局拆解拉满，确保环状布局展开
        this.uiState.globalExplosion = Math.max(this.uiState.globalExplosion, 0.5);
        this.globalExplosionTarget = Math.max(this.globalExplosionTarget, 1);
        
        //console.log(`[SimpleStateMachine] ✅ 进入组件视图: ${majorPart}`);
        this.transitionTo('PartView');
        
        // 通知布局变化
        const otherParts = MECH_HIERARCHY.majorParts.filter(p => p !== majorPart);
        this.callbacks.onPartViewLayout?.(majorPart, otherParts);
        // 立即应用布局，避免等待拆解插值
        this.applyPartViewLayout();
        
        return true;
      } else {
        //console.log(`[SimpleStateMachine] ${this.uiState.hoveredPart} 不是大部件，无法选择`);
      }
    } else if (this.uiState.state === 'PartView') {
      // 在组件视图中，双击可以切换到另一个部件
      const partId = this.uiState.hoveredPart;
      if (MECH_HIERARCHY.majorParts.includes(partId as MajorPartId)) {
        this.selectPart(partId as MajorPartId);
        return true;
      }
    } else if (this.uiState.state === 'Assembled') {
      //console.log('[SimpleStateMachine] 请先按A键拆解，然后再双击选择部件');
    }
    
    return false;
  }
  
  /**
   * 选择指定部件
   */
  private selectPart(partId: MajorPartId): void {
    this.uiState.selectedMajorPart = partId;
    this.uiState.currentPartIndex = MECH_HIERARCHY.majorParts.indexOf(partId);
    // 保持组件视图展开，并在切换组件时自动收拢子件
    this.globalExplosionTarget = Math.max(this.globalExplosionTarget, 1);
    this.partExplosionTarget = 0;
    this.uiState.partExplosion = 0;
    // 重置非当前部件的子件位置
    this.resetAllChildrenExcept(partId);
    
    //console.log(`[SimpleStateMachine] 切换到组件: ${partId}`);
    
    const otherParts = MECH_HIERARCHY.majorParts.filter(p => p !== partId);
    this.callbacks.onPartViewLayout?.(partId, otherParts);
    this.callbacks.onPartListChange?.(this.uiState.partList, this.uiState.currentPartIndex, partId);
    this.callbacks.onHoverChange?.(partId, getPartName(partId));
    
    // 计算新的目标位置并启动过渡动画
    this.calculateTransitionTargets(partId, otherParts);
    this.isTransitioning = true;
  }

  /**
   * 将非当前选中部件的子件恢复到原始位置（防止之前拆解残留）
   */
  private resetAllChildrenExcept(keepPart: MajorPartId | null): void {
    MECH_HIERARCHY.majorParts.forEach(parentId => {
      if (parentId === keepPart) return;
      const children = getChildParts(parentId);
      children.forEach(childId => {
        const cfg = this.model?.parts.get(childId);
        if (cfg?.node && cfg.originalPosition) {
          cfg.node.position.copy(cfg.originalPosition);
        }
      });
    });
  }
  
  // ============================================
  // 导航
  // ============================================
  
  /**
   * 上下切换零件
   */
  navigate(direction: 'up' | 'down'): void {
    this.navigateInternal(direction === 'up' ? -1 : 1);
  }
  
  /**
   * 左右切换零件
   */
  navigateLeftRight(direction: 'left' | 'right'): void {
    this.navigateInternal(direction === 'left' ? -1 : 1);
  }
  
  /**
   * 内部导航逻辑
   */
  private navigateInternal(delta: number): void {
    if (this.uiState.state !== 'PartView' && this.uiState.state !== 'Exploded') return;
    
    const partList = MECH_HIERARCHY.majorParts;
    if (partList.length === 0) return;
    
    // 切换索引
    this.uiState.currentPartIndex = (this.uiState.currentPartIndex + delta + partList.length) % partList.length;
    const newPart = partList[this.uiState.currentPartIndex] as MajorPartId;
    
    //console.log(`[SimpleStateMachine] 导航到: ${newPart} (${this.uiState.currentPartIndex + 1}/${partList.length})`);
    
    if (this.uiState.state === 'PartView') {
      // 在组件视图中，切换选中的部件
      this.selectPart(newPart);
    } else {
      // 在拆解视图中，只更新高亮
      this.uiState.hoveredPart = newPart;
      this.callbacks.onHoverChange?.(newPart, PART_DISPLAY_NAMES[newPart]);
      this.callbacks.onPartListChange?.(partList, this.uiState.currentPartIndex, newPart);
    }
  }
  
  /**
   * 返回上级
   */
  goBack(): void {
    if (this.uiState.state === 'PartView') {
      // 聚拢当前子件
      this.resetAllChildrenExcept(null);
      this.uiState.hoveredPart = null;
      this.uiState.selectedMajorPart = null;
      this.partExplosionTarget = 0;
      this.uiState.partExplosion = 0;
      
      // 恢复所有部件缩放
      this.resetAllPartScales();
      
      // 恢复所有部件位置到原始位置
      this.resetAllPartPositions();
      
      // 直接返回 Assembled 状态，设置拆解为0
      this.globalExplosionTarget = 0;
      this.transitionTo('Assembled');
    } else if (this.uiState.state === 'Exploded') {
      this.globalExplosionTarget = 0;
      // 状态会在 update 中自动切换
    }
  }
  
  /**
   * 恢复所有部件位置到原始位置
   */
  private resetAllPartPositions(): void {
    if (!this.model) return;
    
    MECH_HIERARCHY.majorParts.forEach(partId => {
      const config = this.model!.parts.get(partId);
      if (config?.node && config.originalPosition) {
        config.node.position.copy(config.originalPosition);
      }
    });
  }
  
  /**
   * 恢复所有部件的缩放到原始值
   */
  private resetAllPartScales(): void {
    if (!this.model) return;
    
    MECH_HIERARCHY.majorParts.forEach(partId => {
      const config = this.model!.parts.get(partId);
      if (config?.node) {
        config.node.scale.setScalar(1);
      }
    });
  }
  
  // ============================================
  // 状态转换
  // ============================================
  
  private transitionTo(newState: SimpleViewState): void {
    const oldState = this.uiState.state;
    if (oldState === newState) return;
    
    //console.log(`[SimpleStateMachine] 状态转换: ${oldState} → ${newState}`);
    this.uiState.state = newState;
    
    // 进入组件视图时强制将全局拆解目标推满，确保环状布局生效
    if (newState === 'PartView') {
      this.globalExplosionTarget = Math.max(this.globalExplosionTarget, 1);
      this.showRingDecoration();  // 显示3D环形装饰
    } else {
      this.hideRingDecoration();  // 隐藏3D环形装饰
    }
    
    this.callbacks.onStateChange?.(newState, oldState);
    
    if (newState === 'PartView') {
      this.callbacks.onPartListChange?.(this.uiState.partList, this.uiState.currentPartIndex, this.uiState.selectedMajorPart);
      // 立即应用布局，避免等待帧更新
      this.applyPartViewLayout();
    }
  }
  
  // ============================================
  // Getters
  // ============================================
  
  getState(): SimpleViewState {
    return this.uiState.state;
  }
  
  getUIState(): SimpleUIState {
    return { ...this.uiState };
  }
  
  getGlobalExplosion(): number {
    return this.uiState.globalExplosion;
  }
  
  getPartExplosion(): number {
    return this.uiState.partExplosion;
  }
  
  getInteractableParts(): PartId[] {
    // 默认：所有大部件
    const major = [...MECH_HIERARCHY.majorParts];
    
    // 在组件视图中，增加当前部件的子零件以便继续深入 hover/拆解
    if (this.uiState.state === 'PartView' && this.uiState.selectedMajorPart) {
      const children = getChildParts(this.uiState.selectedMajorPart);
      return [this.uiState.selectedMajorPart, ...children, ...major.filter(p => p !== this.uiState.selectedMajorPart)];
    }
    
    return major;
  }
  
  /**
   * 重置
   */
  reset(): void {
    this.uiState = {
      state: 'Assembled',
      globalExplosion: 0,
      partExplosion: 0,
      hoveredPart: null,
      selectedMajorPart: null,
      currentPartIndex: 0,
      partList: [...MECH_HIERARCHY.majorParts]
    };
    
    this.globalExplosionTarget = 0;
    this.partExplosionTarget = 0;
    
    // 重置所有部件位置
    if (this.model) {
      this.model.parts.forEach((config) => {
        if (config.node && config.originalPosition) {
          config.node.position.copy(config.originalPosition);
        }
      });
    }
    
    this.callbacks.onStateChange?.('Assembled', 'Assembled');
    this.callbacks.onExplosionChange?.(0, 0);
  }
  
  dispose(): void {
    if (!this.scene) {
      this.model = null;
      return;
    }
    
    // 清理大圆环
    if (this.mainRingDecoration) {
      this.scene.remove(this.mainRingDecoration);
      this.mainRingDecoration.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          }
        }
      });
      this.mainRingDecoration = null;
    }
    
    // 清理小圆环
    this.subRingDecorations.forEach((ring) => {
      this.scene!.remove(ring);
      ring.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          }
        }
      });
    });
    this.subRingDecorations = [];
    
    this.model = null;
    this.scene = null;
  }
}

export function createSimpleStateMachine(callbacks?: SimpleCallbacks): SimpleStateMachine {
  return new SimpleStateMachine(callbacks);
}
