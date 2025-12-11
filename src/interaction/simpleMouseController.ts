/**
 * simpleMouseController.ts - 简化版鼠标控制器
 * 
 * 功能：
 * - 鼠标悬停检测部件
 * - 双击左键选择部件
 * - 精确高亮被hover的mesh
 */

import * as THREE from 'three';
import { MechModel } from '../three/loadMech';
import { PartId, HIGHLIGHT_CONFIG } from '../types/mechConfig';

export interface SimpleMouseCallbacks {
  onHover?: (partId: PartId | null, hoveredMeshes: THREE.Mesh[]) => void;
  onDoubleClick?: (partId: PartId) => void;
}

export class SimpleMouseController {
  private camera: THREE.Camera;
  private container: HTMLElement;
  private model: MechModel | null = null;
  private callbacks: SimpleMouseCallbacks;
  
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  
  private hoveredPartId: PartId | null = null;
  private hoveredMeshes: THREE.Mesh[] = [];  // 追踪被hover的具体mesh
  private interactableParts: Set<PartId> = new Set();
  private enabled: boolean = true;
  
  // 双击检测
  private lastClickTime: number = 0;
  private doubleClickThreshold: number = 300; // 毫秒
  
  // 材质存储 - 存储每个mesh材质的原始emissive值
  private originalEmissives: Map<string, { color: THREE.Color, intensity: number }> = new Map();
  // 当前高亮的mesh keys，用于精确清除
  private currentHighlightedKeys: Set<string> = new Set();
  
  // 防止初始化时自动hover
  private hasMouseMoved: boolean = false;
  
  // 绑定的事件处理函数引用
  private boundOnMouseMove: (event: MouseEvent) => void;
  private boundOnClick: (event: MouseEvent) => void;
  
  constructor(camera: THREE.Camera, container: HTMLElement, callbacks: SimpleMouseCallbacks = {}) {
    this.camera = camera;
    this.container = container;
    this.callbacks = callbacks;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(-999, -999);  // 初始化在屏幕外
    
    // 保存绑定的函数引用，用于正确移除事件监听器
    this.boundOnMouseMove = this.onMouseMove.bind(this);
    this.boundOnClick = this.onClick.bind(this);
    
    this.bindEvents();
  }
  
  setModel(model: MechModel): void {
    this.model = model;
    // 初始化时存储所有mesh的原始emissive值
    this.storeAllOriginalEmissives();
  }
  
  /**
   * 存储所有mesh的原始emissive值
   */
  private storeAllOriginalEmissives(): void {
    if (!this.model) return;
    
    this.originalEmissives.clear();
    
    this.model.parts.forEach((config, _partId) => {
      if (config.node) {
        config.node.traverse(child => {
          if (child instanceof THREE.Mesh) {
            // 确保每个mesh拥有独立的材质实例，避免共享材质导致整体发光
            this.ensureUniqueMaterials(child);
            
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((mat, index) => {
              if (mat instanceof THREE.MeshStandardMaterial) {
                const key = `${child.uuid}_${index}`;
                this.originalEmissives.set(key, {
                  color: mat.emissive.clone(),
                  intensity: mat.emissiveIntensity
                });
              }
            });
          }
        });
      }
    });
    
    //console.log(`[SimpleMouseController] 存储了 ${this.originalEmissives.size} 个材质的原始值`);
  }

  /**
   * 获取某个部件下的所有 mesh，用于整体高亮
   */
  private getMeshesForPart(partId: PartId, fallbackMesh?: THREE.Mesh): THREE.Mesh[] {
    const config = this.model?.parts.get(partId);
    if (!config?.node) {
      return fallbackMesh ? [fallbackMesh] : [];
    }
    
    const meshes: THREE.Mesh[] = [];
    config.node.traverse(child => {
      if (child instanceof THREE.Mesh && child.name !== 'material') {
        meshes.push(child);
      }
    });
    
    if (meshes.length === 0 && fallbackMesh) {
      meshes.push(fallbackMesh);
    }
    
    return meshes;
  }

  /**
   * clone 共享材质，确保每个mesh的材质独立，避免修改emissive时影响其他mesh
   */
  private ensureUniqueMaterials(mesh: THREE.Mesh): void {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const newMaterials = materials.map(mat => {
      if (mat instanceof THREE.MeshStandardMaterial) {
        // 如果已经为该mesh克隆过则复用
        if (mat.userData.__hoverClonedFor === mesh.uuid) {
          return mat;
        }
        const cloned = mat.clone();
        cloned.emissive = mat.emissive.clone(); // 防止引用同一Color
        cloned.userData.__hoverClonedFor = mesh.uuid;
        return cloned;
      }
      return mat;
    });
    
    if (Array.isArray(mesh.material)) {
      mesh.material = newMaterials as THREE.Material[];
    } else {
      mesh.material = newMaterials[0] as THREE.Material;
    }
  }
  
  setInteractableParts(partIds: PartId[]): void {
    this.interactableParts = new Set(partIds);
  }
  
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.clearHoverHighlight();
      this.hoveredPartId = null;
      this.hoveredMeshes = [];
    }
  }
  
  private bindEvents(): void {
    this.container.addEventListener('mousemove', this.boundOnMouseMove);
    this.container.addEventListener('click', this.boundOnClick);
  }
  
  private onMouseMove(event: MouseEvent): void {
    if (!this.enabled || !this.model) return;
    
    // 标记用户已移动鼠标
    this.hasMouseMoved = true;
    
    // 计算标准化设备坐标
    const rect = this.container.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    // 射线检测
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    // 收集可交互的网格
    const meshes: THREE.Mesh[] = [];
    this.interactableParts.forEach(partId => {
      const config = this.model!.parts.get(partId);
      if (config && config.node) {
        config.node.traverse(child => {
          if (child instanceof THREE.Mesh) {
            if (child.name !== 'material') {
              child.userData.partId = partId;
              meshes.push(child);
            }
          }
        });
      }
    });
    
    const intersects = this.raycaster.intersectObjects(meshes, false);
    
    if (intersects.length > 0) {
      // 获取第一个命中的mesh和部件ID
      const hitMesh = intersects[0].object as THREE.Mesh;
      let hitPartId = hitMesh.userData.partId as PartId;
      
      // 如果命中的是躯干部件，尝试找更具体的部件
      if ((hitPartId === 'mainbody' || hitPartId === 'neck') && intersects.length > 1) {
        for (let i = 1; i < Math.min(intersects.length, 5); i++) {
          const otherPartId = intersects[i].object.userData.partId as PartId;
          if (otherPartId && 
              (otherPartId.includes('arm') || otherPartId.includes('leg') || 
               otherPartId.includes('Arm') || otherPartId.includes('Leg') ||
               otherPartId === 'Head')) {
            hitPartId = otherPartId;
            break;
          }
        }
      }
      
      // 检查是否是新的mesh被hover（不是新的部件，而是新的具体mesh）
      const targetMeshes = this.getMeshesForPart(hitPartId, hitMesh);
      const isSamePart =
        this.hoveredPartId === hitPartId &&
        this.hoveredMeshes.length === targetMeshes.length &&
        targetMeshes.every(m => this.hoveredMeshes.includes(m));
      
      if (!isSamePart) {
        // 先清除之前的高亮
        this.clearHoverHighlight();
        
        // 更新hoveredPartId
        this.hoveredPartId = hitPartId;
        
        // 高亮该部件下的所有mesh（保证整组一起变色）
        this.hoveredMeshes = targetMeshes;
        
        // 应用高亮
        this.applyHoverHighlight();
        
        //console.log(`[SimpleMouseController] Hover: ${hitPartId}, mesh: ${hitMesh.name}`);
        this.callbacks.onHover?.(hitPartId, this.hoveredMeshes);
      }
    } else {
      // 鼠标不在任何部件上
      if (this.hoveredPartId !== null) {
        //console.log(`[SimpleMouseController] 清除hover: ${this.hoveredPartId}`);
        this.clearHoverHighlight();
        this.hoveredPartId = null;
        this.hoveredMeshes = [];
        this.callbacks.onHover?.(null, []);
      }
    }
  }
  
  /**
   * 应用hover高亮效果
   */
  private applyHoverHighlight(): void {
    this.currentHighlightedKeys.clear();
    
    this.hoveredMeshes.forEach(mesh => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((mat, index) => {
        if (mat instanceof THREE.MeshStandardMaterial) {
          const key = `${mesh.uuid}_${index}`;
          this.currentHighlightedKeys.add(key);
          
          // 应用红色高亮
          mat.emissive.setHex(HIGHLIGHT_CONFIG.SELECTED_EMISSIVE);
          mat.emissiveIntensity = HIGHLIGHT_CONFIG.SELECTED_EMISSIVE_INTENSITY;
        }
      });
    });
  }
  
  /**
   * 清除hover高亮效果 - 恢复到原始值
   */
  private clearHoverHighlight(): void {
    // 遍历当前高亮的mesh，恢复原始值
    this.hoveredMeshes.forEach(mesh => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((mat, index) => {
        if (mat instanceof THREE.MeshStandardMaterial) {
          const key = `${mesh.uuid}_${index}`;
          const original = this.originalEmissives.get(key);
          if (original) {
            mat.emissive.copy(original.color);
            mat.emissiveIntensity = original.intensity;
          } else {
            // 如果没有存储原始值（不应该发生），设置为默认值
            mat.emissive.setHex(0x000000);
            mat.emissiveIntensity = 0;
          }
        }
      });
    });
    
    this.currentHighlightedKeys.clear();
  }
  
  private onClick(_event: MouseEvent): void {
    if (!this.enabled) return;
    
    const now = Date.now();
    const timeDiff = now - this.lastClickTime;
    
    if (timeDiff < this.doubleClickThreshold && this.hoveredPartId) {
      // 双击
      //console.log(`[SimpleMouseController] 双击选择: ${this.hoveredPartId}`);
      this.callbacks.onDoubleClick?.(this.hoveredPartId);
      this.lastClickTime = 0; // 重置，避免连续触发
    } else {
      this.lastClickTime = now;
    }
  }
  
  getHoveredPartId(): PartId | null {
    return this.hoveredPartId;
  }
  
  dispose(): void {
    this.clearHoverHighlight();
    this.container.removeEventListener('mousemove', this.boundOnMouseMove);
    this.container.removeEventListener('click', this.boundOnClick);
    this.originalEmissives.clear();
    this.currentHighlightedKeys.clear();
  }
}

export function createSimpleMouseController(
  camera: THREE.Camera,
  container: HTMLElement,
  callbacks?: SimpleMouseCallbacks
): SimpleMouseController {
  return new SimpleMouseController(camera, container, callbacks);
}

