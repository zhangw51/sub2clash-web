# 订阅转换 · 纯本地网页版

把机场订阅转换成 **Clash / mihomo**、**provider**、**Base64**、**节点列表** 或 **Surge** 配置。

**所有解析都在浏览器里完成 —— 订阅内容不会发送到任何服务器。**

👉 在线使用：https://zhangw51.github.io/sub2clash-web/

## ✨ 特点

- 🔒 **纯本地**：单文件 HTML，无后端、无埋点、无任何第三方请求；订阅数据不出浏览器
- 🧩 **8 种协议**：ss / ssr / vmess / vless(含 Reality) / trojan / hysteria / hysteria2 / tuic
- 📦 **5 种输出**：Clash(mihomo) / provider / Base64 / 节点列表 / Surge
- 🩺 **内置血泪教训**：DNS 配置已修好国内直连问题（不用国外 DoH 做 fallback，节点域名走国内 DNS 解析），不会出现"全部 Timeout"
- 🔍 **筛选**：Include / Exclude 正则过滤、自然序排序、去重
- 📱 **响应式**：手机上也能用

## 📖 怎么用

三种提供订阅内容的方式：

| 方式 | 说明 |
|---|---|
| 粘贴内容（推荐） | 新标签页打开订阅链接 → 全选复制 → 粘进来。最可靠 |
| 本地文件 | 把订阅文件拖进页面 |
| 订阅链接 | 直接填链接点「尝试拉取」—— 受浏览器 CORS 限制，大概率取不到 |

然后选输出格式，点「开始转换」，复制或下载即可。

### 为什么不能一键拉取？

机场的订阅接口没有开放跨域许可（`Access-Control-Allow-Origin`），浏览器会拦截页面发起的请求 ——
这是所有纯前端工具的共同限制。浏览器也不允许自定义 `User-Agent`，部分机场会因 UA 不对返回网页。

### 想要"自动更新"？

用 **provider 模式**：生成的配置里不含任何节点密钥，只有一条订阅引用（你自己的机场链接），
由 Clash 内核定期自行拉取更新 —— 不依赖任何第三方转换服务：

```yaml
proxy-providers:
  proxy-sub:
    type: http
    url: <你的机场订阅链接>
    interval: 3600
    header: { User-Agent: [clash-verge/v2.4.2] }
    health-check: { enable: true, url: https://www.gstatic.com/generate_204, interval: 300 }
```

## ⚠️ 注意

- 生成的配置（内嵌节点模式）**含节点密钥**，请勿上传公开仓库或公开分享
- Reality 协议需要 mihomo 系内核（Clash Verge Rev / ClashX Meta / mihomo），Clash for Windows 不支持

## 🛠️ 本地构建

源码就三个文件：`engine.js`（转换引擎）、`ui.html`（界面模板）、`tools/build.js`（打包脚本）。

```bash
node tools/build.js      # 生成单文件 index.html
node tools/check.js      # 静态自检（id / API / 事件接线一致性）
node tools/test_ui.js    # jsdom 端到端测试
node tools/test_browser.js  # 真实 Chromium 渲染测试（需 playwright-core）
```

转换引擎与 Python 版 `sub2clash` 逐字节对齐（5 种输出格式 diff 全等）。
