<h1 align="center">JARVIS Robot HUB - Jarvis 机甲控制系统</h1>

<p align="center">
  3D 机甲模型交互展示系统，在指尖拆解检视你的机甲
</p>

<p align="center">
  <a href="README.md">
    <img src="https://img.shields.io/badge/中文-README-blue" alt="中文 README" />
  </a>
  <a href="README_EN.md">
    <img src="https://img.shields.io/badge/English-README-green" alt="English README" />
  </a>
  <img src="https://img.shields.io/badge/Three.js-000000?logo=three.js&logoColor=white" alt="Three.js" />
  <img src="https://img.shields.io/badge/Blender-F5792A?logo=blender&logoColor=white" alt="Blender" />
</p>
<p align="center">
  <img src="./pic1.png" alt="JARVIS Robot HUB 截图" width="720">
</p>

## 🎮 操作指南

### 键盘控制

| 按键 | 功能 | 说明 |
|------|------|------|
| **A** | 拆解 | 长按使机甲部件向外拆解分散 |
| **S** | 聚拢 | 长按使机甲部件向中心聚拢 |
| **↑** | 切换材质 | 向上循环切换材质模式（默认 → 金属 → 线框） |
| **↓** | 切换材质 | 向下循环切换材质模式 |
| **←** | 切换组件 | 在组件视图中，向左切换选中的组件 |
| **→** | 切换组件 | 在组件视图中，向右切换选中的组件 |
| **Enter** | 确认选择 | 确认选择当前高亮的部件，进入组件视图 |
| **ESC** | 返回 | 返回上一级视图（组件视图 → 整机视图） |

### 鼠标控制

| 操作 | 功能 | 说明 |
|------|------|------|
| **悬停** | 高亮部件 | 鼠标悬停在部件上时高亮显示 |
| **双击** | 进入组件视图 | 双击某个大部件进入该组件的详细视图 |
| **拖拽（左键）** | 旋转视角 | 按住左键拖拽旋转 3D 视角 |
| **滚轮** | 缩放 | 滚动鼠标滚轮缩放视图 |
| **右键拖拽** | 平移 | 按住右键拖拽平移视图 |

### 手势操作

> 使用前请确保已允许浏览器访问摄像头

**左手：切换模式（数字手势）**
- ☝️ 比划 1：切换到「监视模式」
- ✌️ 比划 2：切换到「缩放模式」
- 🤟 比划 3：切换到「拆解模式」
- 🖖 比划 4：切换到「组件模式」

**右手：操作控制**

**监视模式**
- ✋ 五指张开并移动：旋转视角

**缩放模式**
- ✋ 张开：放大
- ✊ 握拳：缩小

**拆解模式**
- ✋ 张开：拆解
- ✊ 握拳：聚合
- 👆 食指指向：点击/选择当前光标目标

**组件模式**
- ✋ 上下挥：切换材质
- ✋ 左右挥：切换组件

### ⚙️ 本地开发与运行

```bash
npm install
npm run dev
```

---

本项目使用 **MIT License** 开源。
