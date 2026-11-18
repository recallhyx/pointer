# 0003 Provider：用 pi-ai 兼容各家 OpenAI 接口

状态：已接受

## 背景

- 用户要能自己填接口地址和 Key，以后最好还能直接用已经付费的订阅，不必另开 API 账户。
- 市面上的"OpenAI 兼容"服务细节并不一致：用 `system` 还是 `developer` 角色、`max_tokens` 还是 `max_completion_tokens`、支不支持 `store` 字段、思考内容放在哪个字段、怎么关闭思考（`reasoning_effort`、`thinking: {type}`、`enable_thinking`……），各家都不同。这些规则会随厂商更新而变化，我们不想自己维护。
- 订阅能不能给第三方应用用，取决于各家条款。2026 年 10 月核实的情况：

| 订阅 | 第三方应用能否使用 | 依据 |
| --- | --- | --- |
| ChatGPT Plus / Pro | 可以。官方提供 Sign in with ChatGPT，开源项目和本地运行的个人项目可直接接入；闭源付费或远程托管的应用需要申请 | [OpenAI 文档](https://developers.openai.com/siwc/token-sharing-open-source) |
| Claude Pro / Max | 不可以。订阅登录只限 Claude Code 和 Claude.ai，第三方使用违反条款，可能无预警封禁 | [Claude Code 法律与合规](https://code.claude.com/docs/en/legal-and-compliance) |
| Gemini（Gemini CLI / Antigravity 登录） | 不可以。第三方借用其登录访问服务违反条款，已有大规模封号 | [Gemini CLI 条款](https://github.com/google-gemini/gemini-cli/blob/HEAD/docs/resources/tos-privacy.md) |
| GitHub Copilot | 只对正式合作的应用开放（如 OpenCode）；冒充官方集成标识可能导致账号被标记 | [GitHub Changelog](https://github.blog/changelog/2026-01-16-github-copilot-now-supports-opencode/) |
| 国内 Coding Plan | 技术上就是 Key + 接口地址。智谱 GLM Coding Plan 只能在指定编程工具里用，其他场景不扣套餐额度；Kimi Code 允许接入第三方开发工具 | [智谱文档](https://docs.bigmodel.cn/cn/coding-plan/overview)、[Kimi Code 文档](https://www.kimi.com/code/docs/) |

## 决策

### 兼容层用 pi-ai

用 [pi](https://github.com/badlogic/pi-mono) 的模型调用库 `@earendil-works/pi-ai`（MIT），在网页端运行：

- **兼容规则由它维护**：OpenAI 兼容接口按地址自动识别厂商差异（角色、参数名、`store`、思考参数格式），也可以按模型用 `compat` 字段覆盖。识别 `reasoning_content`、`reasoning`、`reasoning_text` 三个思考字段，流式事件统一成 `text_delta`、`thinking_delta`、`done`、`error`。
- **统一的思考开关**：我们只传"关闭思考"或某个思考档位，它负责翻译成各家的参数。划词要求首字快，默认关闭思考。
- **同时支持 Chat Completions 和 Responses 两种协议**：Responses 由它提供，作为高级选项开放，不需要额外开发。
- **网络请求走 Rust**：给它注入 `@tauri-apps/plugin-http` 的 `fetch`。请求实际由 Rust 的 reqwest 发出，绕开网页的跨域限制，代理也在 Rust 侧统一处理。
- **"额外请求参数"用它的 `onPayload` 回调实现**：这个回调可以返回改写后的请求体，用户填的 JSON 在这里合并进去。
- **只按需引入**：只引入 OpenAI 兼容和 Responses 两个实现（底层是 `openai` SDK），不引入 Anthropic、Google、Bedrock 等 SDK。版本锁定，升级时跑一遍下面的回归测试。

我们自己只保留几件很薄的事：

- **地址规范化**：去掉首尾空格和末尾的 `/`；用户贴了完整的 `/chat/completions` 或 `/responses` 地址时，去掉这段路径，并据此确定协议。不自动补 `/v1`。输入框下方实时显示最终的请求地址。
- **模型列表**：请求 `GET /models`，成功就提供下拉选择，同时允许手动输入。
- **测试连接和错误文案**：把 pi-ai 返回的错误和 HTTP 状态码映射成"地址不对、Key 无效、模型不存在、限流或额度用完、网络不通"。
- **思考内容的展示**：用户打开思考时，思考期间占位行显示"思考中 · 3s"并计时，可以点开查看；正文开始输出后自动折叠。
- **网络设置**：默认跟随系统代理，也可以手动填写代理；本机地址允许用 `http`。首字超时 15 秒，总超时 120 秒。
- **服务商预设表**：一张静态数据表，内容是预设名称、接口地址，以及少数 pi-ai 识别不了的厂商的 `compat` 覆盖值（例如百炼需要 `thinkingFormat: "qwen"`）。

### Provider 配置

第一版只有一类 Provider：**OpenAI 兼容**，填接口地址 + API Key + 模型名。高级选项（默认收起）：协议（Chat Completions 或 Responses）、自定义请求头、额外请求参数。

可以保存多个 Provider，全局选一个默认模型（某个 Provider 下的某个模型）。第一版不支持按 Action 单独选模型。

### 服务商预设

预设只是帮用户填好接口地址的模板，用户可以随时改。实现时再核对一遍地址，并确认每个预设在 pi-ai 里是否需要 `compat` 覆盖：

| 预设 | 接口地址 |
| --- | --- |
| OpenAI | `https://api.openai.com/v1` |
| DeepSeek | `https://api.deepseek.com/v1` |
| 阿里云百炼 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| 火山方舟 | `https://ark.cn-beijing.volces.com/api/v3` |
| Moonshot | `https://api.moonshot.cn/v1` |
| 智谱 | `https://open.bigmodel.cn/api/paas/v4` |
| 硅基流动 | `https://api.siliconflow.cn/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` |
| Ollama（本机） | `http://127.0.0.1:11434/v1` |
| LM Studio（本机） | `http://127.0.0.1:1234/v1` |
| 自定义 | 空 |

不为各家 Coding Plan 做预设：条款各不相同，有的明确不允许在编程工具以外使用。用户仍可以用"自定义"自己填。

### 不做的

- Claude、Gemini、Copilot 的订阅登录：条款禁止，或者只对正式合作方开放。pi-ai 自带 Claude 和 Copilot 的订阅登录，我们不启用。Claude 和 Gemini 可以用各自的 API Key 接入（Gemini 有上表里的兼容地址；Claude 可通过 OpenRouter 等聚合服务接入）。
- 读取 Codex CLI 保存在本机的登录凭据（`~/.codex/auth.json`）来"借用"订阅：OpenAI 已经有官方流程，不走这条灰色路径。

## 第二版：ChatGPT 订阅登录（设计备忘）

第一版不做，记在 `docs/backlog.md`。做的时候按下面的思路：

- pi-ai 自带的登录流程依赖 Node（`node:http` 回调服务器、`node:crypto`），在网页端跑不了，所以**登录这一步用 Rust 实现**。登录拿到 access token 后，交给 pi-ai 的 OpenAI Provider 走 Responses 协议推理。pi-ai 已经处理了订阅的请求限制：自动带 `store: false`，自动去掉不支持的字段，额度用完时返回可识别的错误。
- 按 OpenAI 官方的开源应用流程接入：打开系统浏览器授权，回调地址是 `http://127.0.0.1:1455/auth/callback`（端口被占用时可以换），使用 PKCE，首次登录用 `dynamic_agent_client` 动态注册，保存签发的 `client_id`。不需要 client secret。实现时可以对照 pi-ai 的 `auth/oauth/openai-chatgpt.ts`。
- 每台机器生成并保存一个稳定的主机标识（`urn:uuid:…` 格式的 `ext_agent_host_id`）。首次注册时 `agent_name_hint` 填 `Pointer`。
- 令牌和签发的 `client_id` 存进系统钥匙串 / 凭据管理器；access token 过期前由 Rust 自动刷新。
- 模型下拉框的选项来自 `GET https://api.openai.com/v1/models`，只显示 `visibility` 为 `list` 的模型。
- 订阅额度和用户在 Codex 等其他已连接应用里的用量共用 5 小时限额，用户还可以在 ChatGPT 设置里给 Pointer 单独设上限。所以"额度用完"是正常状态：在结果面板里提示，并给出切换到其他 Provider 的入口。
- 登录按钮的文案和样式遵循 OpenAI 的品牌规范。
- **分发方式会影响能否接入**：本地运行的个人项目和开源项目可以直接用；闭源正式分发前要先向 OpenAI 申请。

## 考虑过的方案

- **自己在 Rust 里写兼容层**：完全可控，但要自己追踪各家参数差异，这正是要避免的。
- **Rust 的 `genai` crate**：请求留在 Rust，和 ADR 0001 原来的分工一致。放弃原因：自定义的 OpenAI 兼容地址只走 Chat Completions；厂商差异的覆盖面不如 pi-ai；目前还是 0.7 beta，主要靠一个人维护。
- **Vercel AI SDK（`ai` + `@ai-sdk/openai-compatible`）**：社区最大、接口最稳定，同样可以注入 Tauri 的 `fetch`。放弃原因：各家关闭思考的参数要我们自己通过 `providerOptions` 逐个写，也没有 ChatGPT 订阅支持。作为 pi-ai 的备选：两者接入方式相同，我们在外面包一层自己的小接口，换库只影响这一层。
- **Node 边车进程，完整使用 pi-ai（包括它的登录流程）**：要随应用打包一个 Node 或 Bun 运行时，体积多出几十 MB，和"轻量"目标冲突。

## 后果

- **修改 ADR 0001 的分工**：原来是"Rust 负责调用模型"，现在改为网页端的 pi-ai 组装请求、解析流式结果，Rust 负责实际发送请求、处理代理、保管 Key。
- **Key 会经过网页端内存**：每次请求时，Rust 从钥匙串取出 Key 交给 pi-ai。网页端同时在渲染模型输出的 Markdown，所以 Markdown 必须做严格的 HTML 过滤，并配置严格的 CSP，防止被注入的脚本读到 Key。
- **依赖一个更新很快的库**：pi-ai 发版频繁，包名也改过一次（原来是 `@mariozechner/pi-ai`）。锁定版本，升级前跑回归测试；我们外面那层小接口保证必要时能换成 Vercel AI SDK。
- **回归测试**：每个预设至少验证一次测试连接、流式输出、关闭思考和错误文案。

## 原型里的实现（2026 年 10 月）

代码在 `apps/desktop/src/llm/`，只有 `client.ts` 直接 import pi-ai（锁定 `@earendil-works/pi-ai@1.1.0`）。

- **pi-ai 不认识的地址统一用经典写法**：实测 pi-ai 对它识别不了的地址按 OpenAI 自家的写法发请求（`developer` 角色、`max_completion_tokens`、带 `store`），而多数兼容服务只接受经典写法。所以除 `api.openai.com` 和 Azure OpenAI 外，默认都加上 `supportsDeveloperRole: false`、`maxTokensField: "max_tokens"`、`supportsStore: false`，预设里的 `compat` 再覆盖在上面。这是对"兼容规则由它维护"的补充：我们只维护这一条兜底，不按厂商逐个写。
- **关闭思考**：所有模型都按"支持思考"交给 pi-ai，让它发出各家的关闭参数；不支持思考的模型会忽略这个参数。`compat` 覆盖只有两个：百炼 `thinkingFormat: "qwen"`，火山方舟 `thinkingFormat: "deepseek"`（豆包和 DeepSeek 用同一个 `thinking: {type: "disabled"}` 开关）。
- **请求上限**：`maxTokens` 固定 4096。数值太大时本机小模型会拒绝请求；回答长度仍然靠提示词控制。
- **超时和重试**：首字 15 秒、总 120 秒，由我们自己计时并取消请求；pi-ai 最多重试 1 次。
- **测试连接**：发一条"只回答 OK"的请求，收到第一个字就取消，显示首字耗时。
- **Key 的读取**：Rust 用 keyring 存取，账号名是 `provider:<id>`，只允许这个格式，网页端读不到别的条目（`src-tauri/src/secrets.rs`）。
- **网络**：设置窗口和浮层都通过 `@tauri-apps/plugin-http` 发请求，CSP 的 `connect-src` 只放行 IPC，网页不能直接 `fetch` 外部地址。浏览器里调试时退回页面自己的 `fetch`，只能连允许跨域的服务。
- **本地 mock**：`pnpm mock` 在 `http://127.0.0.1:8787/v1` 起一个 OpenAI 兼容服务，同时支持 Chat Completions 和 Responses，用来在没有 Key 时调流程和错误文案，见 `apps/desktop/README.md`。

还没做到的：

- 没有用真实服务商跑过上面的回归测试；Responses 协议只对 mock 测过。
- 思考固定关闭，没有开关，也不展示思考内容（"思考中 · 3s"）。
- 没有手动代理设置。plugin-http 默认开启 reqwest 的 `system-proxy`，理论上跟随系统代理，还没在真机上确认。
- plugin-http 默认用 rustls 和内置的 Mozilla 根证书，不读系统证书库：公司网络里用自签根证书做 HTTPS 检查的代理会连不上。要支持的话改用 `native-tls` 或 `rustls-tls-native-roots`。
