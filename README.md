## Bili Blocker（Chrome/Edge 扩展，MV3）

一个用于 **屏蔽 Bilibili 网页端不想看的内容** 的浏览器扩展：
- 自动移除 **推广/广告** 卡片
- 按 **UP 主（精确匹配）** 屏蔽
- 按 **视频 Tag（包含匹配）** 屏蔽
- 按 **标题关键词（包含匹配）** 屏蔽
- 支持 **Popup 管理规则** + **右键菜单一键屏蔽**

> 当前为纯原生 JS/HTML/CSS，无需构建，直接“加载已解压的扩展程序”即可。

### 开发调试（直接加载源码目录）

这是浏览器扩展开发的标准方式：Chrome/Edge 都支持加载未打包的扩展目录，修改代码后点刷新按钮即可测试。

#### Edge
1. 打开 `edge://extensions/`
2. 开启 **开发人员模式**
3. 点击 **加载解压缩**
4. 选择本项目根目录（包含 `manifest.json` 的目录）
5. 修改代码后，点击扩展卡片上的刷新按钮重新加载

#### Chrome
1. 打开 `chrome://extensions/`
2. 开启右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择本项目根目录（包含 `manifest.json` 的目录）
5. 修改代码后，点击扩展卡片上的刷新按钮重新加载

### 打包发布（上传到扩展商店）

如果要发布到 Chrome Web Store 或 Edge Add-ons，需要打包成 `.zip`：

```bash
# 在项目根目录执行
zip -r bili-blocker.zip manifest.json content.js background.js popup/
```

然后把 `bili-blocker.zip` 上传到：
- Chrome Web Store 开发者后台：https://chrome.google.com/webstore/devconsole
- Edge Add-ons 开发者中心：https://partner.microsoft.com/dashboard

### 使用方法

#### 1）在 Popup 里管理规则
点击浏览器工具栏里的扩展图标打开弹窗（`popup/popup.html`）：
- **启用/禁用插件**：顶部总开关
- **自动屏蔽推广内容**：开关 `blockAds`（默认开启）
- **屏蔽 UP 主（精确匹配）**：输入 UP 主名称并添加
- **屏蔽视频 Tag（包含匹配）**：输入 tag 并添加
- **屏蔽标题关键词（包含匹配）**：输入关键词并添加

修改规则后会写入 `chrome.storage.sync`，并会触发内容脚本在当前页面 **自动重新扫描**（无需刷新）。

#### 2）右键菜单一键屏蔽（推荐）
在 B 站页面里：
1. 把鼠标 **悬停在某个视频卡片上**（让扩展捕获到这张卡片的 UP 主/标题）
2. 右键点击页面空白处或卡片附近
3. 选择：
   - **Bili Blocker：屏蔽该 UP 主**
   - **Bili Blocker：屏蔽该标题（作为关键词）**

右键菜单还提供：
- **Bili Blocker：启用/禁用**（切换总开关）
- **Bili Blocker：立即重新扫描本页**（手动触发扫描）

### 规则匹配说明

- **UP 主（精确匹配）**：对比“提取到的 UP 主名”与规则列表，完全相等才命中。
- **标题关键词（包含匹配）**：把标题与关键词都做空白归一化并转小写，关键词是子串即命中。
- **Tag（包含匹配）**：从卡片内可抓到的 tag/话题文本拼接后做包含匹配；页面结构变化时可能抓不到 tag（属于已知限制）。
- **推广/广告识别**：多 selector + 文本兜底（含“广告/推广/赞助/广告合作”等字样）。B 站 DOM/样式名常变，后续可能需要补 selector。

### 支持的页面范围
`manifest.json` 中 `host_permissions` 与 `content_scripts.matches` 覆盖：
- `https://www.bilibili.com/*`
- `https://search.bilibili.com/*`

### 数据与隐私
- 所有规则仅存储在浏览器的 `chrome.storage.sync`（会随浏览器账号同步，取决于你是否开启同步）。
- 扩展不主动上传任何数据，也不向第三方服务发送请求。

### 开发/调试
- 内容脚本：在 B 站页面打开开发者工具（F12）即可查看 Console 输出（本项目默认不打印日志）。
- Service Worker：在扩展管理页打开该扩展的“Service worker”调试窗口。

### 已知限制
- B 站页面结构经常更新，部分卡片的 **UP 名/标题/tag** 选择器可能失效，需要在 `content.js` 的 `extractCardInfo()` 里补充候选 selector。
- “右键一键屏蔽”依赖 **先悬停卡片** 才能拿到 `lastHoveredCard`；如果没悬停到卡片，右键不会写入规则。

### 文件结构
- `manifest.json`：MV3 配置
- `content.js`：DOM 监听与屏蔽逻辑（`MutationObserver`）
- `background.js`：右键菜单与规则写入（service worker）
- `popup/`：弹窗 UI（`popup.html` / `popup.css` / `popup.js`）
