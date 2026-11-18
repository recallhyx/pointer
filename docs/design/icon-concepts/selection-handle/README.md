# 选区 + 浮标方向（已定稿）

想用一个符号贯穿应用图标、菜单栏和浮标，替换现在通用的四角星芒。

图形就是产品本身：一块圆角的选区高亮，右下角冒出一个实心圆点（浮标）。圆点周围留一圈空隙，这样在 16px 下两个形状也不会粘在一起。

`preview.png` 是整体对比图：上面一行是新方案，下面一行是现在的图标。正式文件在 `apps/desktop/src-tauri/icons/`（`source.svg` 和 `tray/*.svg`），浮标图形是 `apps/desktop/src/components/animated-icons/mark.tsx`。

修改后在仓库根目录运行 `node docs/design/icon-concepts/selection-handle/render.mjs` 重新生成。
