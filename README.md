# Pet Sprite Forge

Pet Sprite Forge 是一个面向 Cloak 桌面宠物资源的制作工具。用户可以上传视频，将视频拆分为多个动作片段，抽帧、抠图、预览动作流畅度，并导出 Cloak 可读取的 `sprite.png`、`pet.png` 和 `manifest.json`。

当前版本：`0.1.0`

## 功能

- 上传并预览原视频。
- 将源视频划分为 4 个 Cloak 状态片段：休息、用户输入、AI 输出、点击。
- 支持为每个片段选择导出状态，适配视频分镜顺序不固定的情况。
- 支持调整片段起止时间，并在原视频上预览当前片段。
- 默认每 2 帧抽取 1 帧，支持按片段调整抽帧间隔。
- 支持颜色背景抠图、边缘清理、羽化和容差调节。
- 支持预览抽帧后的动作播放效果。
- 导出 Cloak 兼容资源包。

## 开发

```bash
npm install
npm run dev
```

## 验证

```bash
npm test -- --run
npm run build
```

## 版本说明

### 0.1.0

- 初始版本。
- 完成视频上传、分段、抽帧、抠图、动作预览和 Cloak manifest 导出流程。
- 增加状态映射，明确 `user_typing -> playing` 等 Cloak 行为映射。
