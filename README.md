# Run Current Line / Selection — Positron 扩展

为 Positron（和 VS Code）添加类似 **RStudio Run 按钮** 的编辑器工具栏按钮，支持逐行运行代码或运行选中的代码。

## 🎯 功能

| 功能 | 说明 |
|------|------|
| **▶ 运行当前行/选中代码** | 点击按钮或按 `Cmd+Enter` / `Ctrl+Enter` 运行代码 |
| **⏫ 运行光标以上的所有代码** | 从文件开头运行到光标所在位置 |
| **自动下移光标** | 运行当前行后自动移到下一行（RStudio 风格，可配置） |
| **编辑器工具栏图标** | 在编辑器右上角显示运行按钮 |
| **右键菜单** | 右键菜单中也有「运行当前行或选中代码」选项 |
| **Positron + VS Code 双支持** | Positron 中优先使用内置控制台；VS Code 中降级使用终端 |

## 📦 安装

### 方式一：手动安装 VSIX

```bash
cd positron-run-line
npm install
npm run compile
npx vsce package
```

然后在 Positron/VS Code 中：
`Cmd+Shift+P` → `Extensions: Install from VSIX...` → 选择生成的 `.vsix` 文件

### 方式二：开发模式

1. 用 Positron/VS Code 打开本目录
2. 按 `F5` 启动扩展开发模式
3. 在新打开的窗口中测试

## ⚙️ 配置

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| `positronRunLine.moveCursorAfterRun` | `true` | 运行当前行后自动将光标移到下一行 |
| `positronRunLine.focusConsoleAfterRun` | `false` | 运行代码后是否将焦点移到控制台 |

## ⌨️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Cmd+Enter` / `Ctrl+Enter` | 运行当前行或选中代码（Positron 内置） |
| `Cmd+Shift+Enter` / `Ctrl+Shift+Enter` | 运行光标以上的所有代码 |

## 🏗️ 技术架构

```
positron-run-line/
├── package.json          # 扩展清单：命令、菜单、快捷键、配置
├── tsconfig.json         # TypeScript 编译配置
├── src/
│   └── extension.ts      # 核心逻辑
├── out/                  # 编译输出
└── .vscode/
    ├── launch.json       # 调试配置（支持 VS Code 和 Positron）
    └── tasks.json        # 构建任务
```

### 工作流程

```
用户点击按钮 / 按快捷键
         │
         ▼
  positron-run-line.run 命令
         │
         ├─── 在 Positron 中？
         │    ├── 是 → workbench.action.positronConsole.executeCode
         │    │        (自动判断选中/当前行)
         │    └── 否 → workbench.action.terminal.runSelectedText
         │             (手动选中当前行后发送到终端)
         │
         ▼
   (可选) 自动移动光标到下一行
```

### 按钮位置

在 Positron 中的效果（编辑器右上角会出现 ▶ ⏫ 两个按钮）：

```
┌──────────────────────────────────────────────┐
│  📄 script.R           ▶ ⏫  ...  ✕ │  ← 编辑器标签页
├──────────────────────────────────────────────┤
│  1  library(ggplot2)                         │
│  2  data <- read.csv("data.csv")    ← 光标在这
│  3  plot(data$x, data$y)                     │
│  ...                                         │
└──────────────────────────────────────────────┘
```

点击 ▶ 运行第 2 行，光标自动跳到第 3 行，完全复刻 RStudio 的体验！
