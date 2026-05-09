# 放置 Live2D 模型文件

## 支持的结构

### 方式 1：解压后的文件夹（推荐）

```
models/
├── hiyori_free/
│   ├── hiyori_free.model3.json    # 模型入口
│   ├── hiyori_free.moc3           # 模型数据
│   ├── hiyori_free.physics3.json  # 物理参数（可选）
│   ├── textures/
│   │   └── texture_00.png
│   ├── motions/
│   │   ├── Idle/
│   │   ├── Happy/
│   │   └── ...
│   └── expressions/
│       ├── Happy.exp3.json
│       └── ...
```

### 方式 2：ZIP 压缩包

```
models/
└── hiyori_free.zip    # 包含上述所有文件的 ZIP
```

## 使用步骤

1. 把模型文件夹（或 ZIP）放到这个 `models/` 目录下
2. 编辑 `src/renderer/services/model-config.ts` 设置模型路径
3. 运行 `npm run dev` 启动

## 常见模型来源

- Live2D Cubism SDK 示例模型：https://www.live2d.com/download/cubism-sdk/
  下载后解压，放在 `Samples/Resources/` 下
