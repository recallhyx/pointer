# 桌面应用（最小原型）

用来在真机上验证几件纸上定不下来的事：

- 出现延迟：松开鼠标到气泡第一帧画出来，能不能做到 ≤150ms（CONTEXT.md）
- 窗口抖动：每次划词设一次窗口、形变只在网页里做，真机上抖不抖（ADR 0001）
- 环境采集：各浏览器能不能拿到窗口标题和网址（ADR 0004）
- 点浮层会不会抢走原应用的焦点、把选区弄没

后来接上了模型：点「解释」或「翻译」后，面板流式显示默认服务的真实回答（`docs/prompts.md` 的提示词，ADR 0003 的 pi-ai）。没配置模型时面板显示「还没配置模型」和「去设置」。要看发给模型的第一条用户消息，用下面的 `pnpm mock`，它会把收到的应用、网址、上下文回显在回答里。

## 运行

需要 Node 20+、pnpm、Rust（stable）。macOS 需要 Xcode Command Line Tools；Windows 需要 MSVC 生成工具和 WebView2（Windows 10/11 一般自带）。

```bash
pnpm install      # 在仓库根目录
pnpm tauri dev
```

根目录的 `pnpm dev`、`pnpm tauri …`、`pnpm mock` 会转发到这个包；也可以在 `apps/desktop/` 下直接运行。

启动后没有窗口，只有托盘（macOS 菜单栏）图标。在任意应用里划词即可。

**macOS**：第一次启动会弹出「辅助功能」授权。到「系统设置 → 隐私与安全性 → 辅助功能」里打开对终端（`pnpm tauri dev` 时）或打包后的应用的授权。授权后不用重启，鼠标监听会每 2 秒重试一次。

**Electron / Chromium 应用**（Chrome、VS Code、Slack 等）默认不开放辅助功能树，系统也可能报告不出当前聚焦的应用。取词找不到聚焦应用时，会改用 NSWorkspace 的最前台应用。macOS 上 Chrome / Chromium 浏览器优先设置 `AXEnhancedUserInterface = true`，Electron 等其他应用优先设置 `AXManualAccessibility = true`；属性不支持或未实现时尝试另一种，并保留两次调用结果。Chromium 路径还读取一次应用的 `AXRole`，请求启用原生辅助功能。成功和两种属性均不支持的结果按进程缓存，临时失败冷却 3 秒后可重试（`src-tauri/src/platform/accessible.rs`）。Chrome 的增强模式可能延迟约 2 秒启用，初始化期间后续划词也会在原有约 400ms 截止时间内重试，不反复发送成功的启用请求；若首次仍未就绪，可稍等后重新划词。Windows 上第一次在某个应用里取词时，会对焦点窗口请求一次 `AccessibleObjectFromWindow(OBJID_CLIENT)`（即 `WM_GETOBJECT`），Chromium 收到后会打开网页的辅助功能树，随后 UIA 重试到截止时间为止。失败时日志的 `error: no-focused-element` 也会带上应用名和 bundle id。

**剪贴板兜底**（macOS 和 Windows，设置「触发与快捷键」里可关，默认开）：只在全局快捷键唤出时使用（CONTEXT.md「取词方式」）；自动触发读不到文字就不出浮标，不模拟复制。辅助功能拿不到选中文字时（如企业微信、自绘界面的应用），模拟一次复制（macOS ⌘C；Windows 用 SendInput 发 Ctrl+C，并先松开按住的 Alt / Shift；Win 键不动，避免弹出开始菜单），等剪贴板变化（macOS `changeCount`，Windows `GetClipboardSequenceNumber`）（最多 150ms），读出文字后把原来的剪贴板内容（所有条目、所有类型）原样放回。剪贴板没变化就当作没选中文字，不出浮层；超时后再观察 250ms，宿主应用这时才写入的话，同样把原来的内容放回。排除名单里的应用不会走这一步。这种方式没有位置和上下文，日志里 `method` 记为 `clipboard`（`src-tauri/src/platform/clipboard.rs`）。Windows 上只能原样恢复以内存块保存的格式（各种文字、CF_DIB 图片、文件列表、HTML、RTF 等）；GDI 句柄类格式（CF_ENHMETAFILE、CF_METAFILEPICT、CF_PALETTE）和私有格式不会恢复，CF_BITMAP 由系统从 CF_DIB 重新合成。

**只看动画**：`pnpm dev` 后用浏览器打开 http://localhost:1420 ，是一个模拟桌面，可以划词、看形变（红色虚线是模拟的窗口边界，绿色点线是可点击区域）。延迟和焦点问题只能在真机上测。

**配置模型**：托盘菜单「设置…」打开设置窗口（浏览器里是 http://localhost:1420/#settings ）。在「模型」页添加服务：选服务商预设、填 API Key 和模型名，可以点「获取模型列表」和「测试连接」。第一个添加的服务自动成为默认服务，浮层只用默认服务。Key 存在系统钥匙串（macOS 钥匙串 / Windows 凭据管理器），条目名 `dev.pointer.desktop` / `provider:<id>`，不写进 `settings.json`。

**没有 Key 时用 mock**：

```bash
pnpm mock   # http://127.0.0.1:8787/v1
```

在设置里选「自定义」，接口地址填 `http://127.0.0.1:8787/v1`，Key 随便填。可用的模型：

| 模型 | 行为 |
| --- | --- |
| `mock-chat` | 正常流式回答，带表格、公式、代码块和链接，并回显收到的应用、网址、上下文、额外请求参数和对话轮数 |
| `mock-thinking` | 先输出一段 `reasoning_content`，再输出正文 |
| `mock-slow` | 20 秒后才出第一个字，用来看首字超时（15 秒） |
| `mock-error-500` / `mock-429` | 直接返回 500 / 429 |
| 其他名字 | 404「模型不存在」 |

Key 以 `bad` 开头时返回 401。`/chat/completions` 和 `/responses` 都支持，在「高级选项 → 协议」里切换。浏览器里的 harness 和设置页直接从页面请求 mock（它允许跨域）；`pnpm tauri dev` 里请求走 Rust。

## 怎么用

- 触发：拖选、双击、三击、Shift+点击。键盘选中不会自动触发，按 Alt+\` 手动唤出（直接出 Action Bar）。自动触发可以关，快捷键可以改或关（设置 →「触发与快捷键」）。
- 排除名单（设置 →「排除名单」）：默认有密码管理器、终端和远程桌面。名单里的应用划词不出气泡，也不读文字；用快捷键唤出时照常工作，但只发选中的文字和应用名。「最近划词的应用」列出最近 8 个宿主应用，点一下就加进名单。
- 气泡 / 展开方式（设置 →「触发与快捷键」）：默认悬停约 150ms（也可点）展开 Action Bar；可选「点击展开」或「不显示划词图标」直接出 Action Bar。鼠标远离 150px 以上、滚动、3 秒没碰，气泡自己消失。
- Action Bar：解释、翻译展开成结果面板；复制、搜索做完显示一个勾然后消失。
- 关闭：Esc、点浮层外面、面板上的 ×。
- 追问：回答完成（或停止）后，面板底部的输入框可以接着问，Enter 发送，Shift+Enter 换行。每次都把整段对话发给模型，环境信息只在第一条消息里。重新生成只重做最后一问；停止后再追问，已输出的部分就是那一问的回答；出错时要先重试才能追问。点进输入框后浮层进入驻留：拿到键盘焦点，点外面和划词都不再关闭或触发浮层，触发快捷键也不响应，只能用 Esc 或 × 关掉；可拖动结果面板顶栏移动；对话随面板关闭结束（ADR 0002）。
- 托盘菜单：「设置…」（普通窗口，可以聚焦和输入，和不抢焦点的浮层分开）、「打开日志文件夹」、「退出」。第一行提示当前的快捷键。
- 设置 →「通用」：
  - 界面语言：跟随系统（中、英、日、韩、西、法系统用对应语言，其余用英文）、简体中文、English、日本語、한국어、Español 或 Français。设置窗口、浮层和托盘菜单立即或在下次划词时切换。文案在 `src/i18n/zh.ts`（源语言）和 `en.ts`、`ja.ts`、`ko.ts`、`es.ts`、`fr.ts`，每份必须和中文有相同的键，`src/i18n/i18n.test.ts` 会检查；托盘和原生错误提示在 `src-tauri/src/i18n.rs`。回答语言是「上下文」里的母语和「母语译成」，和界面语言无关。
  - 开机自启（macOS 写 `~/Library/LaunchAgents` 里的 plist，Windows 写注册表的 Run 项）。
- 浮层窗口：每次划词把窗口设成能装下气泡、Action Bar 和最高面板的大小，之后不再改窗口，只切换鼠标穿透（ADR 0001）。
- 结果面板：顶部有复制、重新生成（输出中换成停止）、关闭；翻译多一个「原文语言 → 目标语言」按钮，点开在面板顶部列出可选语言（不含原文语言），选一个就用它重新请求，只对这一次翻译有效。出错时显示一行中文错误和「重试」。

## 日志

每次划词写一行 JSON 到 `captures.jsonl`，不记录选中的文字本身：

| type | 字段 |
| --- | --- |
| `capture` | 手势、取词方式（`ax` / `uia` 等）、应用、耗时 `captureMs`、字数、有没有拿到位置和上下文；失败时有 `error` |
| `environment` | 耗时 `envMs`，有没有拿到标题、网址、文件名 |
| `show` | 出现延迟 `showLatencyMs`：松开鼠标到气泡第一帧 |

位置：macOS `~/Library/Logs/dev.pointer.desktop/`，Windows `%LOCALAPPDATA%\dev.pointer.desktop\logs\`。开发模式下同样的内容也会打印在终端里（`[pointer] …`）。

macOS 取词失败时，`capture` 行的 `ax` 字段保留辅助功能接口诊断：`trusted` 是本进程的辅助功能授权状态，`attempts` 是取词尝试次数，`enableAttempted` 表示这次是否发送了启用请求。`enableAccessibility` 保存最近一次启用请求的最终属性设置结果，即使本次使用的是缓存；`enableCalls` 保留完整的属性尝试顺序和真实错误码，`enableRole` 保留激活时读取 `AXRole` 的调用结果，`initializing` 表示是否仍处于成功请求后的初始化等待窗口。`focusedApplication`、`selectionFailure`、`focusedElementFailure` 记录焦点查找或选中文字读取失败的调用。

每个调用包含 `operation`、`attribute`、原始 `code` 和 SDK 错误名 `name`。例如 `-25204` / `kAXErrorCannotComplete` 是请求无法完成，`-25205` / `kAXErrorAttributeUnsupported` 是属性不支持，`-25211` / `kAXErrorAPIDisabled` 是接口被禁用，`-25212` / `kAXErrorNoValue` 是属性没有值。接口返回成功但结果为空或类型不符时，`code` 仍为 `0`，用 `valueIssue` 单独说明，不伪造系统错误码。诊断不包含属性返回的文字、网址或界面内容。

快捷键走剪贴板兜底前，会另写一行 `capture-ax-failure`，用同一个 `session` 关联原始 AX 失败与后续 `capture` 成功，避免兜底掩盖真实错误。

## 测试清单

向上流式增长的动画回归可在 Vite 启动后运行 `node scripts/test-panel-growth.mjs webkit`，需要可用的 Playwright 和 WebKit。也可用 `PLAYWRIGHT_MODULE` 指向已有 Playwright 模块的绝对路径，用 `POINTER_TEST_URL` 指定开发服务器地址。测试使用真实 Overlay 和模拟流式回答，逐帧检查向上面板底边、向下面板顶边及内容层对齐，覆盖快速首字、连续出字、重新生成收缩、普通 / Retina 缩放和减少动态效果。截图写入系统临时目录；不修改模型或应用设置。将参数换为 `chromium` 可用本机 Chrome 复测。

请在 macOS 和 Windows 上各跑一遍，把结果（或 `captures.jsonl`）发回来。

固定窗口失败恢复可用同一 Playwright 环境运行 `node scripts/test-pin-recovery.mjs`。它检查失败后旧回答继续、固定按钮重试、回答完成后的快照恢复，以及迟到的新窗口不会拿走新选区的回答。固定窗口等待绘制超时只会取消未完成的交接，不会用计时器隐藏旧面板。

1. **出现延迟**：在 Chrome、Safari / Edge、VS Code、备忘录 / 记事本、微信或飞书里各划词 10 次左右，看日志里的 `showLatencyMs`。目标 ≤150ms。顺便记下 `captureMs`，看时间花在取词还是显示。
2. **窗口抖动**：试几次「气泡 → Action Bar → 面板」，看形变时浮层有没有跳一下、闪一下、边缘被裁掉。外接屏和 Retina / 高 DPI 屏都试一下，Windows 上试 125% 和 150% 缩放。
3. **环境**：在下面的浏览器里打开一个普通网页，划词后点「解释」，看面板里 `<environment>` 有没有 `window_title` 和 `url`，网址的查询参数有没有去掉：

   | 浏览器 | macOS | Windows |
   | --- | --- | --- |
   | Chrome | | |
   | Edge | | |
   | Safari | | — |
   | Firefox | | |
   | Arc | | |

   再试一个本地文件（Word / Pages / 预览里的 PDF），看有没有 `document`。
4. **焦点**：在输入框里选中文字后点 Action Bar 和面板上的按钮，原应用的选区和光标还在不在，原窗口标题栏有没有变灰（失焦）。
5. **取不到的应用**：哪些应用划词没反应，日志里对应的 `error` 是什么。
6. **资源占用**：空闲时 CPU 是否接近 0%，内存多少（活动监视器 / 任务管理器里看 `pointer` 和 WebView 进程加起来）。
7. **钥匙串和网络**：在设置里存一个 Key，退出再打开应用后 Key 还在；macOS 第一次读 Key 时会不会弹钥匙串授权框。开着系统代理时「测试连接」能不能通。
8. **打包和签名**（macOS）：按 [`docs/packaging.md`](../../docs/packaging.md) 建自签名证书，打包、装进「应用程序」并授予辅助功能；改一行代码再打包覆盖安装，看授权是否还在、划词是否还有反应。Windows 上装一次 NSIS 安装包，看能否正常启动和卸载。
9. **设置生效**：把快捷键改成别的组合，新的立刻能用、旧的失效，托盘第一行跟着变；改成一个被其他应用占用的组合（如 macOS 的 ⌘ + 空格），看是否提示失败并保留原来的。在终端里划词不出气泡，按快捷键能唤出且面板里没有 `<environment>` 的窗口标题。打开开机自启后注销再登录，看是否自动启动。
10. **追问焦点**：在输入框里选中文字、点「解释」，回答完后点追问输入框：
    - 能不能直接打字，中文输入法的候选框位置对不对、有没有被浮层盖住；
    - macOS：菜单栏是不是还是原应用，原应用的选区还在不在；
    - Windows：原窗口标题栏变灰是预期的，按 Esc 关掉后前台和光标有没有回到原窗口；
    - 驻留时点浮层外面、在别处划词，浮层都不应该消失。
11. **形变**（浏览器 harness 里量过，真机上再看一遍）：
    - 在屏幕右侧划词，Action Bar 从浮标向左长出来，不先跳到左边再变宽；
    - 三击一段多行文字、或从下往上拖选，指针在第一行附近晃动时浮标不消失；
    - 选中屏幕底部附近的词点「解释」，面板整体移到选区上方，不盖住选中的词；
    - 气泡展开成 Action Bar、Action Bar 展开成面板时略微冲过再弹回，之后回答变长、追问时面板不再回弹；
    - 点进追问输入框不跳；输入几行后在中间点一下，光标落在点的位置，拖动能选中文字；
    - 驻留时拖动面板顶栏，面板紧跟指针，不拖尾。

## 没做的

- 临时按键真正注册（Action Bar 角标 1–4 已显示；按键生效与「仅不可编辑选区」判断尚未接线）
- 取词诊断日志的应用内查看/导出（关于页和托盘可打开日志文件夹）；首次启动引导
- 思考固定关闭，没有开关，也不展示思考内容；手动代理设置
- 翻译语言只有简中、英、日、韩、法、西六种。方向先按书写系统分（汉字、假名、谚文、拉丁字母），拉丁字母再用 franc-min 区分英语、法语和西班牙语，少于 30 个字母的短选区没有重音就当英语、靠西法各自独有的重音字母区分，其余只要英语得分不太低也当英语；母语是日语时，只有出现日语不用的简体字才把纯汉字当中文
- 在原应用里打字时气泡消失
- 正式签名、公证和自动更新（打包配置和自签名流程见 [`docs/packaging.md`](../../docs/packaging.md)）
- 浏览器模拟桌面（harness）自己的工具栏和示例文字只有中文，只有里面的浮层随「界面语言」切换
- Linux 只是为了能编译：没有全局鼠标监听，只能用 Alt+\` 取 X11 主选区

## 已知缺口

- 没有用真实服务商测过：关闭思考是否生效、首字延迟、错误文案只对 mock 和单元测试验证过。Responses 协议也只对 mock 测过。
- 请求用 rustls 和内置的 Mozilla 根证书，不读系统证书库：公司网络里用自签根证书做 HTTPS 检查的代理会连不上（ADR 0003）。
- 浏览器里调试时 Key 存在 `localStorage`，只能连允许跨域的服务；这只影响 harness 和 `/#settings`，不影响应用本身。
- 浮层的 JS 包约 617KB（主要是 KaTeX 和 highlight.js），在浮层窗口启动时一次加载，不影响每次划词的出现延迟，但会增加常驻内存，后面可以按需加载。

## 代码

- `src-tauri/src/controller/`：手势判断、取词和环境的后台线程、会话、鼠标穿透、出现延迟计时；`mod.rs` 开头写了各把锁和主线程之间的规则
  - `shortcuts.rs`：触发快捷键、OCR 快捷键、Esc 的注册与暂停（可单测）
  - `pinned.rs`：固定浮层的窗口、拖动和鼠标穿透
  - `screen_ocr.rs`：屏幕 OCR 的框选、结果暂存和大图查看
- `src-tauri/src/platform/clipboard.rs`：剪贴板兜底：发复制快捷键、判断是否有新内容、恢复原剪贴板（可单测）
- `src-tauri/src/platform/accessible.rs`：为 Electron / Chromium 应用打开辅助功能树并重试的逻辑，macOS 和 Windows 共用（可单测）
- `src-tauri/src/platform/macos/`：CGEventTap、AX 取词和环境、NSPanel
- `src-tauri/src/platform/windows/`：低级鼠标钩子、UIA 取词和环境、不抢焦点的窗口
- `src-tauri/src/env.rs`：标题、网址、文件名的清洗（ADR 0004 的隐私规则）
- `src-tauri/src/secrets.rs`：Key 存进系统钥匙串，只允许 `provider:<id>` 格式的账号名
- `src-tauri/src/settings_window.rs`：设置窗口（label `settings`），第一次打开时创建
- `src/main.tsx`：按窗口 label 分流到浮层、设置窗口或浏览器 harness，各自只加载自己的代码和样式
- `src/overlay/Overlay.tsx`：浮层状态机和形变；`placement.ts`：放置规则；`useAnswer.ts`：一次回答的生命周期（换 key 即取消，每帧最多刷新一次）；`Markdown.tsx`：回答渲染（丢弃原始 HTML，不加载图片，链接用系统浏览器打开）
- `src/llm/`：`client.ts` 是 pi-ai 的薄封装（只有这里 import pi-ai）；`endpoint.ts` 地址规范化；`presets.ts` 服务商预设；`errors.ts` 错误文案；`prompts.ts`、`message.ts`、`language.ts`、`prepare.ts` 从设置和选区构建请求
- `src/i18n/`：界面文案和当前语言（`t()` 用于 React 之外，`useT()` 在组件里随语言重渲染）；`src-tauri/src/i18n.rs`：原生侧的少量文案
- `src/shared/`：设置读写（tauri-plugin-store，浏览器里用 localStorage）、Key 读写、运行环境判断和请求用的 `fetch`
- `src/settings/`：设置窗口，shadcn/ui（`src/components/ui`）+ lucide-animated 图标（`src/components/animated-icons`），Tailwind 只作用于这个窗口
- `src/harness/`：浏览器里的模拟桌面
- `scripts/mock-llm.mjs`：本地 OpenAI 兼容 mock（`pnpm mock`）

## 命令

| 位置 | 命令 |
| --- | --- |
| 仓库根目录或 `apps/desktop/` | `pnpm dev`、`pnpm test`、`pnpm typecheck`、`pnpm build`、`pnpm tauri dev`、`pnpm tauri build`、`pnpm mock` |
| 仓库根目录（Cargo workspace，产物在根目录 `target/`） | `cargo test`、`cargo clippy --all-targets` |
| 仓库根目录（Linux 上检查 macOS / Windows） | `scripts/clippy-cross.sh [macos\|windows]` |

交叉检查只跑 clippy，不链接。`ring`（plugin-http 的 rustls 带进来的）要为目标平台编译 C 代码，所以需要目标平台的 C 头文件：macOS 用 zig 自带的（`pip install ziglang`），Windows 用 [cargo-xwin](https://github.com/rust-cross/cargo-xwin) 下载的 MSVC CRT 和 Windows SDK（还需要 `clang-cl`、`llvm-lib`、`lld-link`，Ubuntu 上装 `clang-tools-18 llvm-18 lld-18`）。另外加两个 target：`rustup target add aarch64-apple-darwin x86_64-pc-windows-msvc`。
