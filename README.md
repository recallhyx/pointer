# 点拨 / Pointer

轻量划词 AI 工具。在任意应用里选中文字后，旁边浮出一个浮层：浮标 → Action Bar → 结果面板，点击解释或翻译后原地形变并流式输出。

支持 macOS 12+ 和 Windows 10 / 11。模型由你自己配置：任意 OpenAI 兼容接口、Anthropic、Gemini，或本机模型，API Key 存在系统钥匙串（Windows 是凭据管理器）里。安装包在公开仓库 [recallhyx/pointer 的 Releases](https://github.com/recallhyx/pointer/releases) 下载，文件名是 `Pointer-macos-universal.dmg` 和 `Pointer-windows-x64-setup.exe`。那里还没有正式发布的 Release 时，没有可下载的安装包。

## 仓库结构

pnpm workspace + Cargo workspace：

- [`apps/desktop/`](apps/desktop/)：桌面应用（Tauri 2 + React），运行方式和真机测试清单见它的 README
- [`apps/web/`](apps/web/)：产品落地页（Vite，部署在 Cloudflare Workers Static Assets），见它的 README
- [`scripts/`](scripts/)：仓库级脚本，如在 Linux 上交叉检查 macOS / Windows 的 `clippy-cross.sh`
- [`.github/workflows/`](.github/workflows/)：`ci.yml` 跑 lint、类型检查、测试和三个平台的 clippy；`package.yml` 在推 `v*` 标签时打 macOS 和 Windows 的安装包并建草稿 Release，也可以在 Actions 页面手动运行（见 `docs/packaging.md`）

```bash
pnpm install
pnpm dev          # 浏览器里的模拟桌面 http://localhost:1420
pnpm web          # 落地页 http://127.0.0.1:1430
pnpm tauri dev    # 桌面应用
pnpm typecheck && pnpm test && pnpm build
cargo clippy --all-targets && cargo test
```

## 文档

- [`CONTEXT.md`](CONTEXT.md)：术语表和已定事项
- [`docs/adr/`](docs/adr/)：技术栈、单窗口浮层、追问时如何拿到键盘输入、用 pi-ai 兼容各家 OpenAI 接口、环境信息（标签页标题、网址等）怎么获取
- [`docs/prompts.md`](docs/prompts.md)：解释、翻译的提示词
- [`docs/packaging.md`](docs/packaging.md)：打包、自签名、正式签名与公证，以及 CI 发版
- [`docs/backlog.md`](docs/backlog.md)：第二版及以后的功能
- [`docs/design/icon-concepts/selection-handle/`](docs/design/icon-concepts/selection-handle/)：应用图标定稿方案（选区高亮加浮标圆点）和对比图

## 许可证

仓库里的代码以 [Apache License 2.0](LICENSE) 授权。这包括用代码绘制浮标的组件，例如 `apps/desktop/src/components/animated-icons/mark.tsx`、`apps/web/src/demo/icons.tsx` 和 `docs/design/icon-concepts/selection-handle/render.mjs`。

改编自第三方项目的代码，以及落地页 `apps/web/public/margin/` 里的配图，继续使用它们各自的许可和署名。记载在 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)，并在落地页页脚重复配图的作者、来源和许可证。这些第三方内容不进入下面的保留清单。

名称和图标是另一件事，不随上面的代码许可一起给出：

- **商标和产品名。** 「点拨」和「Pointer」是这个产品的名称。Apache 许可证第 6 条不授予商标、商号或产品名的使用权。发布修改版时请使用其他名称。本仓库没有记载这些名称是否已经注册。
- **图标文件的著作权。** 下列第一方图形文件不按 Apache-2.0 提供，著作权保留。它们是应用图标、菜单栏 / 托盘图标、网站图标，以及同一图形的定稿对比图。发布修改版时请换成其他图标，不要继续分发这些文件。

  - `apps/desktop/src-tauri/icons/source.svg`
  - `apps/desktop/src-tauri/icons/icon.png`
  - `apps/desktop/src-tauri/icons/icon.icns`
  - `apps/desktop/src-tauri/icons/icon.ico`
  - `apps/desktop/src-tauri/icons/32x32.png`
  - `apps/desktop/src-tauri/icons/128x128.png`
  - `apps/desktop/src-tauri/icons/128x128@2x.png`
  - `apps/desktop/src-tauri/icons/tray/tray-template.svg`
  - `apps/desktop/src-tauri/icons/tray/tray-template.png`
  - `apps/desktop/src-tauri/icons/tray/tray-template@2x.png`
  - `apps/desktop/src-tauri/icons/tray/tray-windows.svg`
  - `apps/desktop/src-tauri/icons/tray/tray-windows.png`
  - `apps/web/public/favicon.svg`
  - `docs/design/icon-concepts/selection-handle/preview.png`

除此之外没有别的保留。这次说明不增加商业条款，也没有在仓库里写明版权人的姓名。
