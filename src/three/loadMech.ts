/**
 * loadMech.ts - 机甲模型加载模块
 * 
 * 基于 Robot.glb 的节点结构自动绑定部件配置
 * 
 * 模型路径：/public/assets/models/Robot.glb
 * 模型结构：
 * Scene (Group)
 * └── Robot (Object3D)
 *     ├── Head, neck, mainbody
 *     ├── Leftarm (Leftupperarm, Leftdownarm, Lefthand)
 *     ├── Rightarm (Rightupperarm, Rightdownarm, Righthand)
 *     ├── Leftleg (Leftupperleg, Leftdownleg, Leftfeet)
 *     └── Rightleg (Rightupperleg, Rightdownleg, Rightfeet)
 */

import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import {
  PartId,
  PartConfig,
  MajorPartId,
  getAllPartIds,
  createPartConfig,
  MECH_HIERARCHY,
  PART_DISPLAY_NAMES,
  HIGHLIGHT_CONFIG,
  MaterialMode
} from '../types/mechConfig';

// ============================================
// 类型定义
// ============================================

/** 机甲模型数据结构 */
export interface MechModel {
  root: THREE.Group;                              // 根节点
  robotNode: THREE.Object3D | null;               // Robot 节点
  parts: Map<PartId, PartConfig>;                 // 部件配置映射
  originalMaterials: Map<string, THREE.Material>; // 原始材质存储
  boundingBox: THREE.Box3;                        // 包围盒
  center: THREE.Vector3;                          // 中心点
}

/** 加载配置 */
export interface LoadConfig {
  modelPath?: string;
  onProgress?: (progress: number) => void;
  scale?: number;
  autoCenter?: boolean;
}

// ============================================
// 模型加载
// ============================================

/**
 * 加载机甲模型
 */
export async function loadMechModel(
  scene: THREE.Scene,
  config: LoadConfig = {}
): Promise<MechModel> {
  const {
    modelPath = '/assets/models/robot.glb',
    onProgress,
    scale = 1,
    autoCenter = true
  } = config;

  const loader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
  loader.setDRACOLoader(dracoLoader);

  return new Promise((resolve, reject) => {
    loader.load(
      modelPath,
      (gltf: GLTF) => {
        //console.log('✅ 模型加载成功！');
        printModelStructure(gltf.scene);
        
        const mechModel = processLoadedModel(gltf, scale, autoCenter);
        scene.add(mechModel.root);
        
        //console.log(`📦 共绑定 ${mechModel.parts.size} 个部件`);
        resolve(mechModel);
      },
      (progress) => {
        if (onProgress && progress.total > 0) {
          onProgress((progress.loaded / progress.total) * 100);
        }
      },
      (error) => {
        //console.error('模型加载失败:', error);
        // 创建占位模型
        const placeholderModel = createPlaceholderMech();
        scene.add(placeholderModel.root);
        resolve(placeholderModel);
      }
    );
  });
}

/**
 * 打印模型结构（调试用）
 */
function printModelStructure(object: THREE.Object3D, depth: number = 0): void {
  if (depth > 6) return;
  
  const indent = '  '.repeat(depth);
  const type = object.type;
  let info = '';
  
  if (object instanceof THREE.Mesh) {
    const geo = object.geometry as THREE.BufferGeometry;
    const vertCount = geo.attributes.position?.count || 0;
    info = ` [Mesh: ${vertCount} verts]`;
  }
  
  //console.log(`${indent}├─ ${object.name || '(unnamed)'} <${type}>${info}`);
  
  object.children.forEach(child => printModelStructure(child, depth + 1));
}

/**
 * 处理加载的模型，建立部件映射
 */
function processLoadedModel(gltf: GLTF, scale: number, autoCenter: boolean): MechModel {
  const originalScene = gltf.scene;
  const root = new THREE.Group();
  root.name = 'MechRoot';
  
  // 添加原始场景到根节点
  root.add(originalScene);
  
  // 查找 Robot 节点
  let robotNode: THREE.Object3D | null = null;
  originalScene.traverse((node) => {
    if (node.name === 'Robot' || node.name === 'robot') {
      robotNode = node;
    }
  });
  
  if (!robotNode) {
    // 如果没有 Robot 节点，使用整个场景
    robotNode = originalScene;
    //console.warn('⚠️ 未找到 Robot 节点，使用整个场景作为根');
  }
  
  // 建立部件映射
  const parts = new Map<PartId, PartConfig>();
  const originalMaterials = new Map<string, THREE.Material>();
  const allPartIds = getAllPartIds();
  
  // 遍历模型，按名称绑定部件
  originalScene.traverse((node) => {
    const nodeName = node.name;
    
    // 检查是否匹配预定义的部件名称
    for (const partId of allPartIds) {
      // 不区分大小写匹配
      if (nodeName.toLowerCase() === partId.toLowerCase()) {
        const config = createPartConfig(partId, node);
        parts.set(partId, config);
        
        // 存储原始材质
        if (node instanceof THREE.Mesh && node.material) {
          storeMaterial(node, originalMaterials);
        }
        
        // 递归存储子节点材质
        node.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material) {
            storeMaterial(child, originalMaterials);
          }
        });
        
        // 设置阴影
        node.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        
        //console.log(`  📌 绑定部件: ${partId} → ${nodeName}`);
        break;
      }
    }
  });
  
  // 计算包围盒
  originalScene.updateMatrixWorld(true);
  const boundingBox = new THREE.Box3().setFromObject(originalScene);
  const size = new THREE.Vector3();
  boundingBox.getSize(size);
  const center = new THREE.Vector3();
  boundingBox.getCenter(center);
  
  //console.log(`📐 模型尺寸: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`);
  
  // 自动调整
  if (autoCenter) {
    const maxDim = Math.max(size.x, size.y, size.z);
    const targetSize = 2.5;
    const autoScale = maxDim > 0 ? targetSize / maxDim : 1;
    
    root.scale.setScalar(scale * autoScale);
    root.position.y = -boundingBox.min.y * scale * autoScale;
    root.position.x = -center.x * scale * autoScale;
    root.position.z = -center.z * scale * autoScale;
    
    //console.log(`🔧 自动缩放: ${autoScale.toFixed(3)}`);
  } else {
    root.scale.setScalar(scale);
  }
  
  // 整体下移，避免初始过于贴近标题
  const MODEL_Y_OFFSET = -1.2;
  root.position.y += MODEL_Y_OFFSET;
  
  // 重新计算变换后的包围盒
  root.updateMatrixWorld(true);
  const finalBoundingBox = new THREE.Box3().setFromObject(root);
  const finalCenter = new THREE.Vector3();
  finalBoundingBox.getCenter(finalCenter);
  
  return {
    root,
    robotNode,
    parts,
    originalMaterials,
    boundingBox: finalBoundingBox,
    center: finalCenter
  };
}

/**
 * 存储原始材质
 */
function storeMaterial(mesh: THREE.Mesh, storage: Map<string, THREE.Material>): void {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  materials.forEach((mat, index) => {
    const key = `${mesh.uuid}_${index}`;
    if (!storage.has(key)) {
      storage.set(key, mat.clone());
    }
    // 设置材质为可透明
    if (mat instanceof THREE.MeshStandardMaterial) {
      mat.transparent = true;
      mat.side = THREE.DoubleSide;
    }
  });
}

// ============================================
// 部件高亮和材质操作
// ============================================

/**
 * 高亮部件（变红）
 */
export function highlightPart(model: MechModel, partId: PartId): void {
  const config = model.parts.get(partId);
  if (!config || !config.node) return;
  
  setPartEmissive(config.node, HIGHLIGHT_CONFIG.SELECTED_EMISSIVE, HIGHLIGHT_CONFIG.SELECTED_EMISSIVE_INTENSITY);
}

/**
 * 取消高亮部件
 */
export function unhighlightPart(model: MechModel, partId: PartId): void {
  const config = model.parts.get(partId);
  if (!config || !config.node) return;
  
  setPartEmissive(config.node, 0x000000, 0);
}

/**
 * 设置部件发光
 */
function setPartEmissive(node: THREE.Object3D, color: number, intensity: number): void {
  node.traverse((child) => {
    if (child instanceof THREE.Mesh && child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((mat) => {
        if (mat instanceof THREE.MeshStandardMaterial) {
          mat.emissive = new THREE.Color(color);
          mat.emissiveIntensity = intensity;
        }
      });
    }
  });
}

/**
 * 淡化部件（降低透明度）
 */
export function dimPart(model: MechModel, partId: PartId, opacity: number = HIGHLIGHT_CONFIG.DIM_OPACITY): void {
  const config = model.parts.get(partId);
  if (!config || !config.node) return;
  
  setPartOpacity(config.node, opacity);
}

/**
 * 恢复部件透明度
 */
export function restorePart(model: MechModel, partId: PartId): void {
  const config = model.parts.get(partId);
  if (!config || !config.node) return;
  
  setPartOpacity(config.node, 1);
  setPartEmissive(config.node, 0x000000, 0);
}

/**
 * 设置部件透明度
 */
function setPartOpacity(node: THREE.Object3D, opacity: number): void {
  node.traverse((child) => {
    if (child instanceof THREE.Mesh && child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((mat) => {
        if (mat instanceof THREE.MeshStandardMaterial) {
          mat.opacity = opacity;
        }
      });
    }
  });
}

/**
 * 恢复所有部件
 */
export function restoreAllParts(model: MechModel): void {
  model.parts.forEach((_, partId) => {
    restorePart(model, partId);
  });
}

/**
 * 淡化除指定部件外的所有部件
 */
export function dimOtherParts(model: MechModel, exceptPartIds: PartId[]): void {
  model.parts.forEach((_, partId) => {
    if (!exceptPartIds.includes(partId)) {
      dimPart(model, partId);
    }
  });
}

// ============================================
// 部件位置操作
// ============================================

/**
 * 获取部件的世界位置
 */
export function getPartWorldPosition(model: MechModel, partId: PartId): THREE.Vector3 | null {
  const config = model.parts.get(partId);
  if (!config || !config.node) return null;
  
  const worldPos = new THREE.Vector3();
  config.node.getWorldPosition(worldPos);
  return worldPos;
}

/**
 * 获取部件配置
 */
export function getPartConfig(model: MechModel, partId: PartId): PartConfig | undefined {
  return model.parts.get(partId);
}

/**
 * 获取大部件的子部件列表
 */
export function getChildPartConfigs(model: MechModel, majorPartId: MajorPartId): PartConfig[] {
  const children = MECH_HIERARCHY.childrenMap[majorPartId as keyof typeof MECH_HIERARCHY.childrenMap];
  if (!children) return [];
  
  return children
    .map(childId => model.parts.get(childId))
    .filter((config): config is PartConfig => config !== undefined);
}

// ============================================
// 占位模型（备用）
// ============================================

/**
 * 创建占位模型
 */
function createPlaceholderMech(): MechModel {
  const root = new THREE.Group();
  root.name = 'PlaceholderMech';
  
  const parts = new Map<PartId, PartConfig>();
  const originalMaterials = new Map<string, THREE.Material>();
  
  // 创建简单的占位几何体
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x117733,
    metalness: 0.7,
    roughness: 0.3,
    transparent: true
  });
  
  const goldMaterial = new THREE.MeshStandardMaterial({
    color: 0xd4af37,
    metalness: 0.8,
    roughness: 0.2,
    transparent: true
  });

  // 简单的部件配置
  const placeholderParts: Array<{
    id: PartId;
    geometry: THREE.BufferGeometry;
    position: [number, number, number];
    material: THREE.Material;
  }> = [
    { id: 'mainbody', geometry: new THREE.BoxGeometry(0.7, 0.9, 0.4), position: [0, 0.5, 0], material: bodyMaterial },
    { id: 'Head', geometry: new THREE.SphereGeometry(0.2, 16, 16), position: [0, 1.2, 0], material: goldMaterial },
    { id: 'Leftarm', geometry: new THREE.CapsuleGeometry(0.08, 0.5, 8, 16), position: [-0.5, 0.5, 0], material: bodyMaterial },
    { id: 'Rightarm', geometry: new THREE.CapsuleGeometry(0.08, 0.5, 8, 16), position: [0.5, 0.5, 0], material: bodyMaterial },
    { id: 'Leftleg', geometry: new THREE.CapsuleGeometry(0.1, 0.6, 8, 16), position: [-0.2, -0.3, 0], material: bodyMaterial },
    { id: 'Rightleg', geometry: new THREE.CapsuleGeometry(0.1, 0.6, 8, 16), position: [0.2, -0.3, 0], material: bodyMaterial },
  ];
  
  placeholderParts.forEach(({ id, geometry, position, material }) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = id;
    mesh.position.set(...position);
    mesh.castShadow = true;
    root.add(mesh);
    
    const config = createPartConfig(id, mesh);
    parts.set(id, config);
  });

  const boundingBox = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  boundingBox.getCenter(center);

  return {
    root,
    robotNode: root,
    parts,
    originalMaterials,
    boundingBox,
    center
  };
}

// ============================================
// 动画效果
// ============================================

/**
 * 更新发光效果（呼吸灯）
 */
export function updateGlowEffects(model: MechModel, time: number): void {
  // 可以在这里添加呼吸灯效果
  // 目前保留为空，后续可扩展
}

// 导出兼容旧接口的类型
export interface MechPart {
  name: string;
  mesh: THREE.Object3D;
  basePosition: THREE.Vector3;
  baseRotation: THREE.Euler;
  explodeDirection: THREE.Vector3;
  explodeDistance: number;
  depth: number;
}

/**
 * 将 MechModel 转换为旧格式的 parts 数组（兼容性）
 */
export function getPartsArray(model: MechModel): MechPart[] {
  const partsArray: MechPart[] = [];
  
  model.parts.forEach((config, partId) => {
    if (config.node) {
      partsArray.push({
        name: partId,
        mesh: config.node,
        basePosition: config.originalPosition || config.node.position.clone(),
        baseRotation: config.originalRotation || config.node.rotation.clone(),
        explodeDirection: config.explodeDir,
        explodeDistance: config.explodeDistance,
        depth: config.parentId ? 1 : 0
      });
    }
  });
  
  return partsArray;
}

// ============================================
// 材质模式切换
// ============================================

/**
 * 应用全局材质模式
 */
export function applyMaterialMode(model: MechModel, mode: MaterialMode): void {
  if (!model) return;
  
  model.parts.forEach((config) => {
    if (!config.node) return;
    
    config.node.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((mat, index) => {
        if (!(mat instanceof THREE.MeshStandardMaterial)) return;
        
        const key = `${child.uuid}_${index}`;
        const original = model.originalMaterials.get(key) as THREE.MeshStandardMaterial | undefined;
        
        if (mode === 'default') {
          if (original) {
            mat.copy(original);
          }
          mat.wireframe = false;
          mat.needsUpdate = true;
          return;
        }
        
        // 先还原再覆盖，避免累积修改
        if (original) {
          mat.copy(original);
        }
        
        if (mode === 'metal') {
          mat.color.setHex(0xd4af37); // 金属金色
          mat.metalness = 1;
          mat.roughness = 0.3;
          mat.envMapIntensity = 1;
          mat.emissiveIntensity = Math.max(mat.emissiveIntensity, 0.2);
          mat.wireframe = false;
        } else if (mode === 'wire') {
          mat.color.setHex(0x00d4ff);
          mat.emissive.setHex(0x003366);
          mat.emissiveIntensity = 0.3;
          mat.metalness = 0.0;
          mat.roughness = 1.0;
          mat.wireframe = true;
        }
        
        mat.needsUpdate = true;
      });
    });
  });
}
