/**
 * selectionController.ts - 选择控制器
 * 
 * 管理3D场景中部件的选择、聚焦和高亮，包括：
 * - 射线投射选择部件
 * - 将选中部件移动到聚焦位置
 * - 管理全局/部件级别的聚焦模式
 * - 非选中部件的淡化处理
 * - 层级导航（进入子部件/返回上级）
 */

import * as THREE from 'three';
import { MechModel, MechPart, getPartsArray } from '../three/loadMech';

// 选择配置
export const SELECTION_CONFIG = {
  // 聚焦动画
  FOCUS_DURATION: 500,            // 聚焦动画时长（毫秒）
  FOCUS_SCALE: 1.3,               // 聚焦时的缩放比例
  FOCUS_OFFSET_Z: 1.5,            // 聚焦时向前移动的距离
  
  // 高亮效果
  HIGHLIGHT_COLOR: 0x00d4ff,      // 高亮颜色
  HIGHLIGHT_INTENSITY: 0.4,       // 高亮强度
  
  // 淡化效果
  DIM_OPACITY: 0.2,               // 非选中部件的透明度
  DIM_DURATION: 300,              // 淡化动画时长
  
  // 动画平滑
  SMOOTHING: 0.1,                 // 位置平滑系数
  
  // 调试
  DEBUG_ENABLED: false
};

// 聚焦模式
export type FocusMode = 'global' | 'part';

// 选择状态
export interface SelectionState {
  mode: FocusMode;
  selectedPart: MechPart | null;
  selectedPartName: string | null;
  focusRoot: THREE.Object3D | null;
  canDrillDown: boolean;          // 是否可以进入子层级
  canGoBack: boolean;             // 是否可以返回上级
  navigationPath: string[];       // 导航路径
}

/**
 * 选择控制器类
 */
export class SelectionController {
  private model: MechModel | null = null;
  private partsArray: MechPart[] = [];  // 部件数组（转换后）
  private camera: THREE.Camera | null = null;
  private raycaster: THREE.Raycaster;
  
  // 选择状态
  private selectedPart: MechPart | null = null;
  private focusMode: FocusMode = 'global';
  private focusRoot: THREE.Object3D | null = null;
  private navigationStack: MechPart[] = [];
  
  // 原始变换存储
  private originalTransforms: Map<string, {
    position: THREE.Vector3;
    scale: THREE.Vector3;
    opacity: number;
  }> = new Map();
  
  // 回调
  public onSelectionChange?: (state: SelectionState) => void;
  public onFocusModeChange?: (mode: FocusMode, partName: string | null) => void;
  
  constructor() {
    this.raycaster = new THREE.Raycaster();
  }
  
  /**
   * 初始化选择控制器
   */
  init(model: MechModel, camera: THREE.Camera): void {
    this.model = model;
    this.partsArray = getPartsArray(model);  // 转换为数组
    this.camera = camera;
    
    // 存储所有部件的原始变换
    this.storeOriginalTransforms();
  }
  
  /**
   * 存储原始变换信息
   */
  private storeOriginalTransforms(): void {
    if (!this.partsArray.length) return;
    
    this.originalTransforms.clear();
    
    this.partsArray.forEach(part => {
      this.originalTransforms.set(part.name, {
        position: part.mesh.position.clone(),
        scale: part.mesh.scale.clone(),
        opacity: this.getMeshOpacity(part.mesh)
      });
    });
  }
  
  /**
   * 获取网格的透明度
   */
  private getMeshOpacity(mesh: THREE.Object3D): number {
    if (mesh instanceof THREE.Mesh && mesh.material) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      return material.opacity ?? 1;
    }
    return 1;
  }
  
  /**
   * 通过射线投射选择部件
   * @param ndcX NDC X坐标 (-1 到 1)
   * @param ndcY NDC Y坐标 (-1 到 1)
   */
  selectAtPosition(ndcX: number, ndcY: number): MechPart | null {
    if (!this.model || !this.camera) return null;
    
    // 设置射线
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    
    // 获取要检测的对象列表
    const objectsToTest = this.getSelectableObjects();
    
    // 执行射线投射
    const intersects = this.raycaster.intersectObjects(objectsToTest, true);
    
    if (intersects.length > 0) {
      // 找到被击中的部件
      const hitObject = intersects[0].object;
      const part = this.findPartByMesh(hitObject);
      
      if (part) {
        this.setSelectedPart(part);
        return part;
      }
    }
    
    return null;
  }
  
  /**
   * 获取可选择的对象列表
   */
  private getSelectableObjects(): THREE.Object3D[] {
    if (!this.partsArray.length) return [];
    
    // 在全局模式下，所有部件都可选
    // 在部件模式下，只有当前聚焦部件的子部件可选
    if (this.focusMode === 'global') {
      return this.partsArray.map(p => p.mesh);
    } else if (this.focusRoot) {
      // 获取聚焦部件的子对象
      const children: THREE.Object3D[] = [];
      this.focusRoot.traverse(child => {
        if (child !== this.focusRoot) {
          children.push(child);
        }
      });
      return children.length > 0 ? children : [this.focusRoot];
    }
    
    return this.partsArray.map(p => p.mesh);
  }
  
  /**
   * 通过网格找到对应的部件
   */
  private findPartByMesh(mesh: THREE.Object3D): MechPart | null {
    if (!this.partsArray.length) return null;
    
    // 向上遍历找到匹配的部件
    let current: THREE.Object3D | null = mesh;
    while (current) {
      const part = this.partsArray.find(p => p.mesh === current);
      if (part) return part;
      current = current.parent;
    }
    
    return null;
  }
  
  /**
   * 设置选中的部件
   */
  setSelectedPart(part: MechPart | null): void {
    // 如果选择了相同的部件，尝试进入子层级
    if (part && this.selectedPart === part) {
      this.drillDown();
      return;
    }
    
    // 清除之前的高亮
    if (this.selectedPart) {
      this.unhighlightPart(this.selectedPart);
    }
    
    this.selectedPart = part;
    
    if (part) {
      // 高亮新选中的部件
      this.highlightPart(part);
      
      // 聚焦到该部件
      this.focusOnPart(part);
      
      // 更新聚焦模式
      this.setFocusMode('part', part);
      
      // 淡化其他部件
      this.dimOtherParts(part);
      
      if (SELECTION_CONFIG.DEBUG_ENABLED) {
        //console.log(`[Selection] 选中部件: ${part.name}`);
      }
    } else {
      // 返回全局模式
      this.setFocusMode('global', null);
      this.restoreAllParts();
    }
    
    // 触发回调
    this.emitSelectionChange();
  }
  
  /**
   * 进入子层级（钻取）
   */
  drillDown(): void {
    if (!this.selectedPart) return;
    
    // 检查是否有子部件
    const hasChildren = this.selectedPart.mesh.children.length > 0;
    
    if (hasChildren) {
      // 将当前部件推入导航栈
      this.navigationStack.push(this.selectedPart);
      
      // 设置为新的聚焦根
      this.focusRoot = this.selectedPart.mesh;
      
      // 重置选中状态，准备选择子部件
      this.selectedPart = null;
      
      if (SELECTION_CONFIG.DEBUG_ENABLED) {
        //console.log(`[Selection] 进入子层级: ${this.focusRoot.name}`);
      }
      
      this.emitSelectionChange();
    } else {
      // 没有子部件，显示提示
      if (SELECTION_CONFIG.DEBUG_ENABLED) {
        //console.log(`[Selection] 没有更深层级`);
      }
    }
  }
  
  /**
   * 返回上级层级
   */
  goBack(): void {
    if (this.navigationStack.length > 0) {
      // 从导航栈弹出
      const previousPart = this.navigationStack.pop();
      
      if (this.navigationStack.length > 0) {
        // 还有上级，设置为上一级
        const parent = this.navigationStack[this.navigationStack.length - 1];
        this.focusRoot = parent.mesh;
        this.selectedPart = previousPart || null;
      } else {
        // 回到全局模式
        this.focusRoot = null;
        this.selectedPart = previousPart || null;
        this.setFocusMode('global', null);
      }
      
      // 恢复所有部件显示
      this.restoreAllParts();
      
      if (SELECTION_CONFIG.DEBUG_ENABLED) {
        //console.log(`[Selection] 返回上级`);
      }
      
      this.emitSelectionChange();
    } else if (this.focusMode === 'part') {
      // 在部件模式但没有导航栈，直接返回全局
      this.clearSelection();
    }
  }
  
  /**
   * 清除选择，返回全局模式
   */
  clearSelection(): void {
    if (this.selectedPart) {
      this.unhighlightPart(this.selectedPart);
    }
    
    this.selectedPart = null;
    this.focusRoot = null;
    this.navigationStack = [];
    this.focusMode = 'global';
    
    this.restoreAllParts();
    this.emitSelectionChange();
    
    if (this.onFocusModeChange) {
      this.onFocusModeChange('global', null);
    }
  }
  
  /**
   * 设置聚焦模式
   */
  private setFocusMode(mode: FocusMode, part: MechPart | null): void {
    this.focusMode = mode;
    this.focusRoot = part?.mesh || null;
    
    if (this.onFocusModeChange) {
      this.onFocusModeChange(mode, part?.name || null);
    }
  }
  
  /**
   * 高亮部件
   */
  private highlightPart(part: MechPart): void {
    const mesh = part.mesh;
    
    if (mesh instanceof THREE.Mesh && mesh.material) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      
      // 存储原始发光颜色
      if (!mesh.userData.originalEmissive) {
        mesh.userData.originalEmissive = material.emissive?.clone() || new THREE.Color(0);
        mesh.userData.originalEmissiveIntensity = material.emissiveIntensity || 0;
      }
      
      // 设置高亮发光
      material.emissive = new THREE.Color(SELECTION_CONFIG.HIGHLIGHT_COLOR);
      material.emissiveIntensity = SELECTION_CONFIG.HIGHLIGHT_INTENSITY;
    }
    
    // 递归高亮子对象
    mesh.traverse(child => {
      if (child instanceof THREE.Mesh && child.material && child !== mesh) {
        const childMat = child.material as THREE.MeshStandardMaterial;
        if (!child.userData.originalEmissive) {
          child.userData.originalEmissive = childMat.emissive?.clone() || new THREE.Color(0);
          child.userData.originalEmissiveIntensity = childMat.emissiveIntensity || 0;
        }
        childMat.emissive = new THREE.Color(SELECTION_CONFIG.HIGHLIGHT_COLOR);
        childMat.emissiveIntensity = SELECTION_CONFIG.HIGHLIGHT_INTENSITY * 0.5;
      }
    });
  }
  
  /**
   * 取消高亮部件
   */
  private unhighlightPart(part: MechPart): void {
    const mesh = part.mesh;
    
    if (mesh instanceof THREE.Mesh && mesh.material) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      
      if (mesh.userData.originalEmissive) {
        material.emissive = mesh.userData.originalEmissive;
        material.emissiveIntensity = mesh.userData.originalEmissiveIntensity || 0;
      }
    }
    
    // 递归恢复子对象
    mesh.traverse(child => {
      if (child instanceof THREE.Mesh && child.material && child !== mesh) {
        const childMat = child.material as THREE.MeshStandardMaterial;
        if (child.userData.originalEmissive) {
          childMat.emissive = child.userData.originalEmissive;
          childMat.emissiveIntensity = child.userData.originalEmissiveIntensity || 0;
        }
      }
    });
  }
  
  /**
   * 聚焦到部件（动画移动到中心）
   */
  private focusOnPart(part: MechPart): void {
    // 这里可以添加平滑动画，将部件移动到聚焦位置
    // 简化实现：直接缩放部件
    const mesh = part.mesh;
    
    // 存储原始缩放
    if (!mesh.userData.originalScale) {
      mesh.userData.originalScale = mesh.scale.clone();
    }
    
    // 缩放选中部件
    // 注意：实际聚焦效果在 update() 中通过平滑动画实现
  }
  
  /**
   * 淡化其他部件
   */
  private dimOtherParts(selectedPart: MechPart): void {
    if (!this.partsArray.length) return;
    
    this.partsArray.forEach(part => {
      if (part !== selectedPart) {
        this.setPartOpacity(part, SELECTION_CONFIG.DIM_OPACITY);
      }
    });
  }
  
  /**
   * 恢复所有部件
   */
  private restoreAllParts(): void {
    if (!this.partsArray.length) return;
    
    this.partsArray.forEach(part => {
      this.setPartOpacity(part, 1);
      
      // 恢复缩放
      if (part.mesh.userData.originalScale) {
        part.mesh.scale.copy(part.mesh.userData.originalScale);
      }
    });
  }
  
  /**
   * 设置部件透明度
   */
  private setPartOpacity(part: MechPart, opacity: number): void {
    const mesh = part.mesh;
    
    if (mesh instanceof THREE.Mesh && mesh.material) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.transparent = true;
      material.opacity = opacity;
    }
    
    // 递归设置子对象
    mesh.traverse(child => {
      if (child instanceof THREE.Mesh && child.material && child !== mesh) {
        const childMat = child.material as THREE.MeshStandardMaterial;
        childMat.transparent = true;
        childMat.opacity = opacity;
      }
    });
  }
  
  /**
   * 每帧更新（用于动画）
   */
  update(_deltaTime: number): void {
    // 如果有选中部件，可以添加悬浮动画等效果
    if (this.selectedPart) {
      // 轻微悬浮效果（已注释）
      // const time = performance.now() * 0.001;
      // const mesh = this.selectedPart.mesh;
      // mesh.position.y = this.originalTransforms.get(this.selectedPart.name)?.position.y || 0;
      // mesh.position.y += Math.sin(time * 2) * 0.02;
    }
  }
  
  /**
   * 获取当前选择状态
   */
  getState(): SelectionState {
    return {
      mode: this.focusMode,
      selectedPart: this.selectedPart,
      selectedPartName: this.selectedPart?.name || null,
      focusRoot: this.focusRoot,
      canDrillDown: this.selectedPart ? this.selectedPart.mesh.children.length > 0 : false,
      canGoBack: this.navigationStack.length > 0 || this.focusMode === 'part',
      navigationPath: this.navigationStack.map(p => p.name)
    };
  }
  
  /**
   * 获取聚焦根节点
   */
  getFocusRoot(): THREE.Object3D | null {
    return this.focusRoot;
  }
  
  /**
   * 获取当前聚焦模式
   */
  getFocusMode(): FocusMode {
    return this.focusMode;
  }
  
  /**
   * 获取选中部件
   */
  getSelectedPart(): MechPart | null {
    return this.selectedPart;
  }
  
  /**
   * 发射选择变化事件
   */
  private emitSelectionChange(): void {
    if (this.onSelectionChange) {
      this.onSelectionChange(this.getState());
    }
  }
  
  /**
   * 销毁控制器
   */
  dispose(): void {
    this.restoreAllParts();
    this.selectedPart = null;
    this.focusRoot = null;
    this.navigationStack = [];
    this.originalTransforms.clear();
  }
}

/**
 * 工厂函数
 */
export function createSelectionController(): SelectionController {
  return new SelectionController();
}






