# Pet Sprite Forge 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 TDD 推进核心导出逻辑；完成后运行验证命令并保留本地预览服务。步骤使用复选框语法跟踪进度。

**目标：** 在 `D:\SnowLeaf\works\pet-sprite-forge` 创建一个中文、全交互的浏览器工具，把上传视频制作成 Cloak 兼容的宠物精灵图和 `manifest.json`。

**架构：** 使用 Vite + React + TypeScript。浏览器端用 `HTMLVideoElement` 和 Canvas 抽帧、取样抠图、重组动画；纯函数负责状态模型、manifest、sprite 布局和导出包结构，便于测试。

**技术栈：** React、TypeScript、Vitest、Canvas API、JSZip、Lucide React、Vite。

---

### 任务 1：项目骨架和核心导出契约

**文件：**
- 创建：`package.json`
- 创建：`tsconfig.json`
- 创建：`vite.config.ts`
- 创建：`src/lib/__tests__/exporter.test.ts`
- 创建：`src/lib/exporter.ts`

- [ ] **步骤 1：编写失败测试**

测试 `buildCloakManifest`、`normalizeStateFrames`、`createSpriteLayout`。

- [ ] **步骤 2：运行测试验证失败**

运行：`npm test -- --run src/lib/__tests__/exporter.test.ts`
预期：FAIL，导出函数尚未存在或尚未实现。

- [ ] **步骤 3：写最小实现**

实现四状态映射、补齐帧、manifest 字段和 sprite 布局。

- [ ] **步骤 4：运行测试验证通过**

运行：`npm test -- --run src/lib/__tests__/exporter.test.ts`
预期：PASS。

### 任务 2：视频抽帧、抠图和打包

**文件：**
- 创建：`src/lib/video.ts`
- 创建：`src/lib/cutout.ts`
- 创建：`src/lib/package.ts`
- 创建：`src/lib/__tests__/cutout.test.ts`

- [ ] **步骤 1：编写抠图阈值测试**

测试背景色距离小于容差时 alpha 变 0，主体像素保留。

- [ ] **步骤 2：运行测试验证失败**

运行：`npm test -- --run src/lib/__tests__/cutout.test.ts`
预期：FAIL，抠图函数尚未实现。

- [ ] **步骤 3：实现 Canvas 工具**

实现抽帧、像素抠图、sprite 合成和 zip 打包。

- [ ] **步骤 4：运行测试验证通过**

运行：`npm test -- --run`
预期：PASS。

### 任务 3：中文交互 UI

**文件：**
- 创建：`src/App.tsx`
- 创建：`src/App.css`
- 创建：`src/main.tsx`
- 创建：`src/components/*`

- [ ] **步骤 1：实现方向 2 的媒体实验室布局**

顶部项目栏、左侧四状态分镜、中间透明预览/帧采样/时间轴、右侧 manifest/导出检查器。

- [ ] **步骤 2：接入上传和抽帧状态**

上传视频、读取时长、自动生成四段默认区间、用户调整每段起止时间和抽帧间隔。

- [ ] **步骤 3：接入预览和导出**

生成透明帧、播放预览、生成 sprite 和 manifest、下载 zip。

### 任务 4：验证和设计 QA

**文件：**
- 创建：`design-qa.md`

- [ ] **步骤 1：运行自动验证**

运行：`npm test -- --run`、`npm run build`。

- [ ] **步骤 2：启动本地服务**

运行：`npm run dev -- --host 127.0.0.1`。

- [ ] **步骤 3：浏览器检查**

打开本地 URL，检查布局、中文文案、交互和导出状态。

- [ ] **步骤 4：记录设计 QA**

对照 `docs/product-design/selected-direction-media-lab.png`，在 `design-qa.md` 写明结果。
