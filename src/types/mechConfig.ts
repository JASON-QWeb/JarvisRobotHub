/**
 * mechConfig.ts - 机甲部件类型定义和层级配置
 * 
 * 基于 Robot.glb 的节点结构：
 * Scene (Group)
 * └── Robot (Object3D)
 *     ├── Head (Mesh)
 *     ├── neck (Mesh)
 *     ├── mainbody (Mesh)
 *     ├── Leftarm (Object3D)
 *     │   ├── Leftdownarm (Mesh)
 *     │   ├── Lefthand (Mesh)
 *     │   └── Leftupperarm (Mesh)
 *     ├── Rightarm (Object3D)
 *     │   ├── Rightdownarm (Mesh)
 *     │   ├── Righthand (Mesh)
 *     │   └── Rightupperarm (Mesh)
 *     ├── Leftleg (Object3D)
 *     │   ├── Leftdownleg (Mesh)
 *     │   ├── Leftfeet (Mesh)
 *     │   └── Leftupperleg (Mesh)
 *     └── Rightleg (Object3D)
 *         ├── Rightdownleg (Mesh)
 *         ├── Rightfeet (Mesh)
 *         └── Rightupperleg (Mesh)
 */

import * as THREE from 'three';

// ============================================
// 部件 ID 类型定义
// ============================================

/** 所有可识别的部件ID */
export type PartId =
  // 大部件（第一级）
  | 'Head' | 'neck' | 'mainbody'
  | 'Leftarm' | 'Rightarm'
  | 'Leftleg' | 'Rightleg'
  // 左臂子部件
  | 'Leftupperarm' | 'Leftdownarm' | 'Lefthand'
  // 右臂子部件
  | 'Rightupperarm' | 'Rightdownarm' | 'Righthand'
  // 左腿子部件
  | 'Leftupperleg' | 'Leftdownleg' | 'Leftfeet'
  // 右腿子部件
  | 'Rightupperleg' | 'Rightdownleg' | 'Rightfeet';

/** 大部件（第一级拆解） */
export type MajorPartId = 'Head' | 'neck' | 'mainbody' | 'Leftarm' | 'Rightarm' | 'Leftleg' | 'Rightleg';

/** 有子部件的大部件 */
export type ParentPartId = 'Leftarm' | 'Rightarm' | 'Leftleg' | 'Rightleg';

// ============================================
// 部件配置接口
// ============================================

/** 单个部件的配置 */
export interface PartConfig {
  id: PartId;
  displayName: string;             // 显示名称（中文）
  node: THREE.Object3D | null;     // 对应的 Three.js 对象
  parentId?: MajorPartId;          // 所属大部件（子部件才有）
  explodeDir: THREE.Vector3;       // 拆解方向（归一化）
  explodeDistance: number;         // 拆解距离
  originalPosition?: THREE.Vector3;// 原始位置
  originalRotation?: THREE.Euler;  // 原始旋转
}

/** 机甲层级结构 */
export interface MechHierarchy {
  majorParts: MajorPartId[];                          // 第一级大部件列表
  childrenMap: Partial<Record<ParentPartId, PartId[]>>; // 大部件 → 子零件列表
}

// ============================================
// 预设配置
// ============================================

/** 机甲层级结构配置 */
export const MECH_HIERARCHY: MechHierarchy = {
  // 大部件列表（第一级拆解时展示）
  majorParts: ['Head', 'neck', 'mainbody', 'Leftarm', 'Rightarm', 'Leftleg', 'Rightleg'],
  
  // 子部件映射
  childrenMap: {
    'Leftarm': ['Leftupperarm', 'Leftdownarm', 'Lefthand'],
    'Rightarm': ['Rightupperarm', 'Rightdownarm', 'Righthand'],
    'Leftleg': ['Leftupperleg', 'Leftdownleg', 'Leftfeet'],
    'Rightleg': ['Rightupperleg', 'Rightdownleg', 'Rightfeet']
  }
};

/** 部件显示名称（中文） */
export const PART_DISPLAY_NAMES: Record<PartId, string> = {
  // 大部件
  Head: '头部',
  neck: '颈部',
  mainbody: '主体',
  Leftarm: '左臂',
  Rightarm: '右臂',
  Leftleg: '左腿',
  Rightleg: '右腿',
  // 左臂子部件
  Leftupperarm: '左上臂',
  Leftdownarm: '左下臂',
  Lefthand: '左手',
  // 右臂子部件
  Rightupperarm: '右上臂',
  Rightdownarm: '右下臂',
  Righthand: '右手',
  // 左腿子部件
  Leftupperleg: '左大腿',
  Leftdownleg: '左小腿',
  Leftfeet: '左脚',
  // 右腿子部件
  Rightupperleg: '右大腿',
  Rightdownleg: '右小腿',
  Rightfeet: '右脚'
};

/** 部件显示名称（英文） */
export const PART_DISPLAY_NAMES_EN: Record<PartId, string> = {
  // Major parts
  Head: 'Head',
  neck: 'Neck',
  mainbody: 'Body',
  Leftarm: 'Left Arm',
  Rightarm: 'Right Arm',
  Leftleg: 'Left Leg',
  Rightleg: 'Right Leg',
  // Left arm sub-parts
  Leftupperarm: 'Left Upper Arm',
  Leftdownarm: 'Left Forearm',
  Lefthand: 'Left Hand',
  // Right arm sub-parts
  Rightupperarm: 'Right Upper Arm',
  Rightdownarm: 'Right Forearm',
  Righthand: 'Right Hand',
  // Left leg sub-parts
  Leftupperleg: 'Left Thigh',
  Leftdownleg: 'Left Shin',
  Leftfeet: 'Left Foot',
  // Right leg sub-parts
  Rightupperleg: 'Right Thigh',
  Rightdownleg: 'Right Shin',
  Rightfeet: 'Right Foot'
};

/** 根据语言获取部件名称 */
export function getPartDisplayName(partId: PartId, lang: 'zh' | 'en' = 'zh'): string {
  return lang === 'en' ? PART_DISPLAY_NAMES_EN[partId] : PART_DISPLAY_NAMES[partId];
}

/** 拆解方向预设 - 朝各个方向分散（保持整体位置稳定） */
export const EXPLODE_OFFSETS: Record<PartId, { direction: [number, number, number]; distance: number }> = {
  // 大部件拆解方向 - 修正左右方向，减少下移
  Head: { direction: [0, 0.8, 0.4], distance: 0.5 },          // 头：向上+前
  neck: { direction: [0, 0.5, 0.3], distance: 0.3 },          // 颈：向上+前
  mainbody: { direction: [0, 0.1, 0.5], distance: 0.2 },      // 主体：略向上+前（补偿整体下移）
  Leftarm: { direction: [1, 0.2, 0.3], distance: 0.6 },       // 左臂：向右+略上+前（用户视角左）
  Rightarm: { direction: [-1, 0.2, 0.3], distance: 0.6 },     // 右臂：向左+略上+前（用户视角右）
  // 腿部更明显向下拆解，减少左右偏移
  Leftleg: { direction: [0.15, -0.65, 0.2], distance: 0.55 },
  Rightleg: { direction: [-0.15, -0.65, 0.2], distance: 0.55 },
  
  // 左臂子部件（方向也交换）
  Leftupperarm: { direction: [0.5, 0.2, 0.4], distance: 0.25 },
  Leftdownarm: { direction: [0.4, 0.1, 0.5], distance: 0.3 },
  Lefthand: { direction: [0.3, 0, 0.6], distance: 0.35 },
  
  // 右臂子部件（方向也交换）
  Rightupperarm: { direction: [-0.5, 0.2, 0.4], distance: 0.25 },
  Rightdownarm: { direction: [-0.4, 0.1, 0.5], distance: 0.3 },
  Righthand: { direction: [-0.3, 0, 0.6], distance: 0.35 },
  
  // 左腿子部件（方向也交换，减少下移）
  Leftupperleg: { direction: [0.3, 0, 0.4], distance: 0.25 },
  Leftdownleg: { direction: [0.2, -0.1, 0.5], distance: 0.3 },
  Leftfeet: { direction: [0.1, -0.2, 0.5], distance: 0.35 },
  
  // 右腿子部件（方向也交换，减少下移）
  Rightupperleg: { direction: [-0.3, 0, 0.4], distance: 0.25 },
  Rightdownleg: { direction: [-0.2, -0.1, 0.5], distance: 0.3 },
  Rightfeet: { direction: [-0.1, -0.2, 0.5], distance: 0.35 }
};

// ============================================
// 工厂函数
// ============================================

/**
 * 创建部件配置
 */
export function createPartConfig(id: PartId, node: THREE.Object3D | null = null): PartConfig {
  const offset = EXPLODE_OFFSETS[id];
  const displayName = PART_DISPLAY_NAMES[id];
  
  // 确定父部件
  let parentId: MajorPartId | undefined;
  for (const [parent, children] of Object.entries(MECH_HIERARCHY.childrenMap)) {
    if (children?.includes(id)) {
      parentId = parent as MajorPartId;
      break;
    }
  }
  
  return {
    id,
    displayName,
    node,
    parentId,
    explodeDir: new THREE.Vector3(...offset.direction).normalize(),
    explodeDistance: offset.distance,
    originalPosition: node ? node.position.clone() : undefined,
    originalRotation: node ? node.rotation.clone() : undefined
  };
}

/**
 * 获取部件的子部件列表
 */
export function getChildParts(partId: PartId): PartId[] {
  return MECH_HIERARCHY.childrenMap[partId as ParentPartId] || [];
}

/**
 * 检查是否是大部件
 */
export function isMajorPart(partId: PartId): partId is MajorPartId {
  return MECH_HIERARCHY.majorParts.includes(partId as MajorPartId);
}

/**
 * 检查是否有子部件
 */
export function hasChildren(partId: PartId): partId is ParentPartId {
  const children = MECH_HIERARCHY.childrenMap[partId as ParentPartId];
  return children !== undefined && children.length > 0;
}

/**
 * 获取所有部件ID列表
 */
export function getAllPartIds(): PartId[] {
  return Object.keys(PART_DISPLAY_NAMES) as PartId[];
}

// ============================================
// 高亮颜色配置
// ============================================

export const HIGHLIGHT_CONFIG = {
  // 选中颜色（红色）
  SELECTED_COLOR: 0xff4444,
  SELECTED_EMISSIVE: 0xff2222,
  SELECTED_EMISSIVE_INTENSITY: 0.5,
  
  // 悬停颜色（橙色）
  HOVER_COLOR: 0xff8844,
  HOVER_EMISSIVE: 0xff6622,
  HOVER_EMISSIVE_INTENSITY: 0.3,
  
  // 淡化透明度
  DIM_OPACITY: 0.3,
  
  // 动画时长
  TRANSITION_DURATION: 300  // 毫秒
};

// ============================================
// 视图状态类型
// ============================================

/** 机甲视图状态 */
export type MechViewState = 'Assembled' | 'MajorExploded' | 'PartList' | 'PartDetailExploded';

/** 材质模式 */
export type MaterialMode = 'default' | 'metal' | 'wire';

/** UI 状态 */
export interface MechUIState {
  state: MechViewState;
  currentMajorPart: MajorPartId | null;   // 当前选中的大部件
  currentSubPart: PartId | null;           // 当前选中的子零件
  highlightedIndex: number;                // 当前高亮的索引（在列表中）
  explosionFactor: number;                 // 当前拆解因子 (0-1)
}

/** 创建初始 UI 状态 */
export function createInitialUIState(): MechUIState {
  return {
    state: 'Assembled',
    currentMajorPart: null,
    currentSubPart: null,
    highlightedIndex: 0,
    explosionFactor: 0
  };
}

