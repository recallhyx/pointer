# 打包与签名

产物：macOS 是 `.app` 和 `.dmg`，Windows 是 NSIS 安装包（`.exe`）。版本号取自 `apps/desktop/package.json` 的 `version`，发版前改这一处即可。

## 本地打包

```bash
pnpm tauri build                                   # 当前平台，产物在 target/release/bundle/
pnpm tauri build --target universal-apple-darwin   # macOS 通用包（先 rustup target add x86_64-apple-darwin）
```

只能在目标平台上打包：macOS 包要在 Mac 上打，Windows 包要在 Windows 上打（Linux 上的 `scripts/clippy-cross.sh` 只做检查，不出包）。

## macOS：自用阶段的自签名证书

macOS 的「辅助功能」授权绑在应用的签名上。不签名或 ad-hoc 签名时，每次重新构建签名都会变，系统会把它当成新应用，授权失效，要去系统设置里删掉旧条目再重新打开。用一张固定的本地自签名证书签名，重新构建后授权仍然有效（CONTEXT.md「签名」）。

一次性准备：

1. 打开「钥匙串访问」→ 菜单「钥匙串访问 → 证书助理 → 创建证书…」。
2. 名称填 `Pointer Local Signing`（随意，下面要用），身份类型选「自签名根证书」，证书类型选「代码签名」，创建。
3. 确认能找到这个身份：

   ```bash
   security find-identity -p codesigning
   ```

   列表里会出现 `Pointer Local Signing`，未受信任的自签名证书会带 `CSSMERR_TP_NOT_TRUSTED`，不影响签名。

之后每次打包：

```bash
APPLE_SIGNING_IDENTITY="Pointer Local Signing" pnpm tauri build
```

不要把这个名字写进 `tauri.conf.json`：没有这张证书的机器（包括 CI）会因此打包失败。

这样签出来的包只能在本机用。拷到别的 Mac 上会被 Gatekeeper 拦下（「无法验证开发者」），要右键「打开」或执行 `xattr -dr com.apple.quarantine /Applications/Pointer.app`。

## macOS：正式分发（Developer ID + 公证）

需要 Apple Developer Program 会员（每年 99 美元，`docs/backlog.md`）。`package.yml` 在下面的 secrets 存在时才签名和公证，都没设时照常出未签名的包。设了 secrets 之后，每次打包的 macOS 包都会公证（包括手动运行），要多等几分钟。

| Secret | 内容 |
| --- | --- |
| `APPLE_CERTIFICATE` | 「Developer ID Application」证书连同私钥导出的 `.p12`，base64 编码（`base64 -i cert.p12 \| pbcopy`） |
| `APPLE_CERTIFICATE_PASSWORD` | 导出 `.p12` 时设的密码 |
| `APPLE_SIGNING_IDENTITY` | 证书的完整名称，如 `Developer ID Application: 名字 (TEAMID)` |
| `APPLE_ID` | 用来公证的 Apple ID 邮箱 |
| `APPLE_PASSWORD` | 这个 Apple ID 的 App 专用密码（appleid.apple.com 里生成），不是登录密码 |
| `APPLE_TEAM_ID` | 开发者团队 ID |

只设前三个是只签名不公证，下载后仍会被 Gatekeeper 警告；六个都设才会公证。

应用开了 `macOSPrivateApi`（NSPanel 要用），不能上 Mac App Store，但不影响 Developer ID 分发和公证。

## Windows

不签名时，下载的安装包会被 SmartScreen 拦下（「Windows 已保护你的电脑」→「更多信息」→「仍要运行」）。自签名证书对 SmartScreen 没用。可选的签名方式：

- **Azure Trusted Signing**：按月付费，不用自己保管证书。在 `bundle.windows.signCommand` 里调用它的签名工具。
- **OV 代码签名证书**：从 CA 购买，现在一般放在硬件令牌或云 HSM 里。导入后在 `bundle.windows` 里配 `certificateThumbprint`、`digestAlgorithm: "sha256"` 和 `timestampUrl`，或同样用 `signCommand`。

两种方式签名后 SmartScreen 的信任都要靠下载量慢慢积累，刚开始仍可能出警告。选哪种等正式分发时再定，`package.yml` 目前不签 Windows 包。

## CI 打包与发版

`.github/workflows/package.yml` 只在打标签时自动运行：

- 推送 `v*` 标签（如 `v0.1.0`）：打 macOS 通用包（`.dmg`）和 Windows x64 安装包（`.exe`）。上传前复制成落地页使用的稳定文件名，两个平台都成功后，草稿 Release 里只挂这两个文件：`Pointer-macos-universal.dmg`、`Pointer-windows-x64-setup.exe`。Tauri 自己带版本号的文件名不会进 Release。检查后手动把草稿发布成正式 Release。安装包同时作为构建产物（artifact）保存 7 天（`retention-days`），产物名字仍带提交短哈希（如 `pointer-macos-universal-1a2b3c4`），里面的文件已经是稳定名字。只重跑 `release` job 时会更新同一个草稿：覆盖这两个稳定名字，并删掉草稿里其他旧附件。已经发布的 Release 会直接失败，不会被改写。
- 落地页的下载地址固定指向公开仓库 `https://github.com/recallhyx/pointer/releases/latest/download/` 下的这两个文件名，不指向 `recallhyx/pointer-app`。`releases/latest` 会跳过草稿和预发布，所以在 `recallhyx/pointer` 上把 Release 正式发布之前，没有可下载的安装包。工作流把草稿建在它实际运行的那个仓库。在私有的 `pointer-app` 上打包，不会让公开下载链接出现文件。
- 平时的提交和推送不打包（CI 照旧，只在推送到 `main` 或更新已有 PR 时跑）。要某个分支的包，到 Actions 页面手动运行 Package 并选这个分支：只打包，安装包在这次运行页面底部的 Artifacts 里。手动运行时选的是 `v*` 标签，则和推送标签一样，会建（或补传）草稿 Release。

发版：改 `apps/desktop/package.json` 的 `version`，提交并合并后，在要发版的提交上打标签并推送，如 `git tag v0.1.0 && git push origin v0.1.0`。只有以 `v` 开头的标签会触发。打标签的提交的信息里如果含 `[skip ci]`，推送这个标签也不会触发打包。

构建 job 只有读权限，建 Release 的 job 才有写权限，它直接取构建 job 上传的安装包，不重新构建。

不设 Rust 构建缓存：缓存只有写它的那个 ref 和默认分支能读，标签之间互相读不到，写了也用不上。所以每次打包两个平台的 Rust 部分都从头编译。

macOS 构建用 `macos-15` 镜像。GitHub 只保留最新的两个 macOS 版本，旧镜像会下线（`macos-14` 在 2026-11-02 下线），到期要改 `package.yml` 和 `ci.yml` 里的 macOS runner。

### 费用

私有仓库按 runner 的每分钟单价计费，每个 job 的用时向上取整到分钟。官方单价（2026-10 查看）：macOS $0.062、Windows $0.010、Linux $0.006。GitHub Free 每月含 2000 分钟免费额度，用完后如果没有绑定付款方式，工作流会被直接拦住。免费额度具体怎么折算、已经用了多少，以 GitHub 账单页的用量为准。

没有缓存时，一次打包实测 macOS 7 分钟、Windows 14 分钟，约 $0.58。平时的提交不消耗这部分，手动运行同样计费。仓库设为公开后，标准 runner 的 Actions 不计费。

## 没做的

- 自动更新（tauri-plugin-updater）：自用阶段不做（CONTEXT.md），正式分发时再加，届时还要生成更新签名密钥并在 Release 里附上 `latest.json`。
- Windows ARM64 的包。
- 以上签名流程都还没实际跑过：自签名后重新构建授权是否保持，要在 Mac 上验证（`apps/desktop/README.md` 测试清单第 8 条）。
