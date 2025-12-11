/**
 * explodeController.ts - 层级拆解/拆解视图控制器
 * 
 * 支持两种类型的网格拆解：
 * - 普通 Mesh：直接移动位置
 * - SkinnedMesh：移动整个对象（包括父级）
 */

import * as THREE from 'three';
import { MechModel, MechPart, getPartsArray } from './loadMech';

// 拆解配置
export const EXPLODE_CONFIG = {
  SMOOTHING: 0.08,
  ROTATION_AMOUNT: 0.1,
  GLOBAL_SCALE: 1.0,
  PART_SCALE: 0.6,
  CHANGE_THRESHOLD: 0.001,
  MAX_CHANGE_PER_FRAME: 0.05,
  DEBUG_ENABLED: false
};

export type ExplosionLevel = 'global' | 'part';

export interface ExplosionState {
  globalFactor: number;
  partFactor: number;
  currentLevel: ExplosionLevel;
  isAnimating: boolean;
  focusRootName: string | null;
}

// 部件数据缓存
interface PartData {
  basePosition: THREE.Vector3;
  baseRotation: THREE.Euler;
  baseScale: THREE.Vector3;
  explodeDirection: THREE.Vector3;
  explodeDistance: number;
  isSkinnedMesh: boolean;
  parent: THREE.Object3D | null;
  parentBasePosition: THREE.Vector3;
}

/**
 * 拆解控制器类
 */
export class ExplodeController {
  private model: MechModel | null = null;
  private partsArray: MechPart[] = [];
  
  private globalFactorCurrent: number = 0;
  private globalFactorTarget: number = 0;
  private partFactorCurrent: number = 0;
  private partFactorTarget: number = 0;
  
  private focusRoot: THREE.Object3D | null = null;
  private currentLevel: ExplosionLevel = 'global';
  
  private partDataCache: Map<string, PartData> = new Map();
  
  public onGlobalFactorChange?: (factor: number) => void;
  public onPartFactorChange?: (factor: number) => void;
  
  constructor() {}
  
  /**
   * 设置模型
   */
  setModel(model: MechModel): void {
    this.model = model;
    this.partsArray = getPartsArray(model);
    this.initPartData();
  }
  
  /**
   * 初始化部件数据
   */
  private initPartData(): void {
    if (!this.partsArray.length) return;
    
    this.partDataCache.clear();
    
    this.partsArray.forEach(part => {
      const mesh = part.mesh;
      const isSkinnedMesh = (mesh as THREE.SkinnedMesh).isSkinnedMesh === true;
      
      // 对于 SkinnedMesh，我们需要获取它的父级容器
      const parent = mesh.parent;
      const parentBasePosition = new THREE.Vector3();
      
      if (parent) {
        parent.getWorldPosition(parentBasePosition);
      }
      
      this.partDataCache.set(part.name, {
        basePosition: mesh.position.clone(),
        baseRotation: mesh.rotation.clone(),
        baseScale: mesh.scale.clone(),
        explodeDirection: part.explodeDirection.clone(),
        explodeDistance: part.explodeDistance,
        isSkinnedMesh,
        parent,
        parentBasePosition
      });
      
      if (EXPLODE_CONFIG.DEBUG_ENABLED) {
        //console.log(`[Explode] 初始化部件: ${part.name}, SkinnedMesh: ${isSkinnedMesh}`);
      }
    });
  }
  
  // ============================================
  // 拆解控制
  // ============================================
  
  setGlobalExplosionTarget(factor: number): void {
    this.globalFactorTarget = Math.max(0, Math.min(1, factor));
  }
  
  increaseGlobalExplosion(amount: number = 0.02): void {
    this.globalFactorTarget = Math.min(1, this.globalFactorTarget + amount);
  }
  
  decreaseGlobalExplosion(amount: number = 0.02): void {
    this.globalFactorTarget = Math.max(0, this.globalFactorTarget - amount);
  }
  
  getGlobalExplosionFactor(): number {
    return this.globalFactorCurrent;
  }
  
  setPartExplosionTarget(factor: number): void {
    this.partFactorTarget = Math.max(0, Math.min(1, factor));
  }
  
  increasePartExplosion(amount: number = 0.02): void {
    this.partFactorTarget = Math.min(1, this.partFactorTarget + amount);
  }
  
  decreasePartExplosion(amount: number = 0.02): void {
    this.partFactorTarget = Math.max(0, this.partFactorTarget - amount);
  }
  
  getPartExplosionFactor(): number {
    return this.partFactorCurrent;
  }
  
  setFocusRoot(object: THREE.Object3D | null): void {
    this.focusRoot = object;
    
    if (object) {
      this.currentLevel = 'part';
      this.partFactorCurrent = 0;
      this.partFactorTarget = 0;
    } else {
      this.currentLevel = 'global';
    }
  }
  
  getFocusRoot(): THREE.Object3D | null {
    return this.focusRoot;
  }
  
  getCurrentLevel(): ExplosionLevel {
    return this.currentLevel;
  }
  
  setExplosionFactor(level: ExplosionLevel, factor: number): void {
    if (level === 'global') {
      this.setGlobalExplosionTarget(factor);
    } else {
      this.setPartExplosionTarget(factor);
    }
  }
  
  getCurrentExplosionFactor(): number {
    return this.currentLevel === 'global' ? this.globalFactorCurrent : this.partFactorCurrent;
  }
  
  increaseCurrentExplosion(amount: number = 0.02): void {
    if (this.currentLevel === 'global' || !this.focusRoot) {
      this.increaseGlobalExplosion(amount);
    } else {
      this.increasePartExplosion(amount);
    }
  }
  
  decreaseCurrentExplosion(amount: number = 0.02): void {
    if (this.currentLevel === 'global' || !this.focusRoot) {
      this.decreaseGlobalExplosion(amount);
    } else {
      this.decreasePartExplosion(amount);
    }
  }
  
  // ============================================
  // 更新
  // ============================================
  
  update(_deltaTime?: number): void {
    if (!this.model) return;
    
    // 更新因子
    const prevGlobal = this.globalFactorCurrent;
    this.globalFactorCurrent = this.smoothValue(
      this.globalFactorCurrent,
      this.globalFactorTarget,
      EXPLODE_CONFIG.SMOOTHING
    );
    
    if (Math.abs(this.globalFactorCurrent - prevGlobal) > EXPLODE_CONFIG.CHANGE_THRESHOLD) {
      this.onGlobalFactorChange?.(this.globalFactorCurrent);
    }
    
    const prevPart = this.partFactorCurrent;
    this.partFactorCurrent = this.smoothValue(
      this.partFactorCurrent,
      this.partFactorTarget,
      EXPLODE_CONFIG.SMOOTHING
    );
    
    if (Math.abs(this.partFactorCurrent - prevPart) > EXPLODE_CONFIG.CHANGE_THRESHOLD) {
      this.onPartFactorChange?.(this.partFactorCurrent);
    }
    
    // 更新部件
    this.updatePartPositions();
  }
  
  private smoothValue(current: number, target: number, smoothing: number): number {
    const diff = target - current;
    const clampedDiff = Math.max(
      -EXPLODE_CONFIG.MAX_CHANGE_PER_FRAME,
      Math.min(EXPLODE_CONFIG.MAX_CHANGE_PER_FRAME, diff * smoothing)
    );
    
    const newValue = current + clampedDiff;
    
    if (Math.abs(newValue - target) < EXPLODE_CONFIG.CHANGE_THRESHOLD) {
      return target;
    }
    
    return newValue;
  }
  
  /**
   * 更新部件位置
   */
  private updatePartPositions(): void {
    if (!this.partsArray.length) return;
    
    this.partsArray.forEach(part => {
      const data = this.partDataCache.get(part.name);
      if (!data) return;
      
      // 计算有效因子
      const effectiveFactor = this.globalFactorCurrent * EXPLODE_CONFIG.GLOBAL_SCALE;
      
      // 计算偏移
      const explodeOffset = data.explodeDirection
        .clone()
        .multiplyScalar(data.explodeDistance * effectiveFactor * 2); // 加大距离
      
      // 根据网格类型应用拆解
      if (data.isSkinnedMesh) {
        // 对于 SkinnedMesh，直接设置其位置偏移
        // SkinnedMesh 的位置可以被设置，它会整体移动
        part.mesh.position.copy(data.basePosition).add(explodeOffset);
      } else {
        // 普通网格
        part.mesh.position.copy(data.basePosition).add(explodeOffset);
      }
      
      // 添加旋转效果
      if (effectiveFactor > 0.01) {
        const rotAmount = effectiveFactor * EXPLODE_CONFIG.ROTATION_AMOUNT;
        part.mesh.rotation.set(
          data.baseRotation.x + data.explodeDirection.x * rotAmount,
          data.baseRotation.y + data.explodeDirection.y * rotAmount,
          data.baseRotation.z + data.explodeDirection.z * rotAmount
        );
      } else {
        part.mesh.rotation.copy(data.baseRotation);
      }
    });
  }
  
  // ============================================
  // 重置
  // ============================================
  
  reset(): void {
    this.globalFactorTarget = 0;
    this.partFactorTarget = 0;
  }
  
  resetGlobal(): void {
    this.globalFactorTarget = 0;
  }
  
  resetPart(): void {
    this.partFactorTarget = 0;
  }
  
  resetImmediate(): void {
    this.globalFactorCurrent = 0;
    this.globalFactorTarget = 0;
    this.partFactorCurrent = 0;
    this.partFactorTarget = 0;
    this.updatePartPositions();
  }
  
  getState(): ExplosionState {
    return {
      globalFactor: this.globalFactorCurrent,
      partFactor: this.partFactorCurrent,
      currentLevel: this.currentLevel,
      isAnimating: 
        Math.abs(this.globalFactorCurrent - this.globalFactorTarget) > EXPLODE_CONFIG.CHANGE_THRESHOLD ||
        Math.abs(this.partFactorCurrent - this.partFactorTarget) > EXPLODE_CONFIG.CHANGE_THRESHOLD,
      focusRootName: this.focusRoot?.name || null
    };
  }
  
  isFullyAssembled(): boolean {
    return this.globalFactorCurrent < 0.01 && this.partFactorCurrent < 0.01;
  }
  
  isFullyExploded(): boolean {
    if (this.currentLevel === 'part') {
      return this.partFactorCurrent > 0.99;
    }
    return this.globalFactorCurrent > 0.99;
  }
  
  dispose(): void {
    this.model = null;
    this.focusRoot = null;
    this.partDataCache.clear();
  }
}

/**
 * 工厂函数
 */
export function createExplodeController(): ExplodeController {
  return new ExplodeController();
}

/**
 * 辅助函数
 */
export function factorToPercent(factor: number): number {
  return Math.round(factor * 100);
}
