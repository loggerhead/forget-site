# ForgetSite

一个自用的 Chrome MV3 扩展：按域名定期删除 Chrome 浏览历史。

## 功能

- **一键加入当前网站**：点扩展图标，在弹窗里点「加入清理列表」；也可以在页面上右键选择「将当前网站加入定期清理列表」，或按 `Alt+Shift+A`。
- **查看规则列表**：弹窗里可以看到所有规则、上次清理时间和删除条数；设置页可以编辑域名和周期。
- **自定义周期**：每条规则独立设置，最小 1 小时，最长 180 天。
- **立即清理**：单条规则或全部规则都可以手动触发。
- **仅本机**：规则保存在 `chrome.storage.local`，不上传、不同步。

## 安装

1. 打开 `chrome://extensions`。
2. 开启右上角「开发者模式」。
3. 点「加载已解压的扩展程序」，选择本目录：
   `/Users/bytedance/my-projects/forget-site`
4. 建议把扩展固定到工具栏，方便一键加入当前网站。

## 使用

### 加入当前网站

- 点工具栏图标 → 确认域名和周期 → 「加入清理列表」。
- 或右键页面 → 「将当前网站加入定期清理列表」。
- 或按 `Alt+Shift+A`。快捷键可在 `chrome://extensions/shortcuts` 修改。

弹窗会自动把 `www.`、`m.`、`mobile.`、`amp.`、`wap.` 这类常见前缀去掉，例如在 `www.example.com` 上会建议加入 `example.com`。域名输入框可以手动修改。

### 匹配规则

- 规则 `example.com` 匹配 `example.com` 及其所有子域名（`www.example.com`、`a.b.example.com` 等）。
- 规则 `www.example.com` 只匹配 `www.example.com` 及其子域名，不匹配 `example.com`。
- 规则只删除历史记录，不会关闭当前标签页，也不影响 Cookie、缓存、下载、书签或密码。

### 周期

- 每条规则独立设置，范围 1 小时 ~ 180 天。
- 后台每 5 分钟检查一次到期规则；Chrome 关闭时不执行，下次启动会补跑。
- 新增规则默认使用设置页里的「默认周期」，首次自动清理在加入后满一个周期时发生；想立刻清一次就点「清理」。

### 设置页

在弹窗点右上角齿轮，或在 `chrome://extensions` 里点「扩展程序选项」，可以：

- 添加、编辑、删除规则；
- 修改每条规则的域名和周期；
- 单条/全部立即清理；
- 修改新增规则的默认周期。

## 权限说明

- `history`：读取并删除浏览历史。扩展只会删除匹配规则的 URL，不会上传任何历史数据。
- `tabs`：读取当前标签页 URL，用于一键加入当前网站。
- `storage`：保存规则。
- `alarms`：每 5 分钟检查到期规则。
- `contextMenus`：提供右键菜单。

## 限制

- 只清理 Chrome 浏览历史，不清理 Cookie、localStorage、缓存、下载记录、favicon、Top Sites 等衍生数据。
- 如果开启了 Chrome Sync，通过历史 API 的删除会同步到其他设备；只想本机删除，请先在 `chrome://settings/syncSetup` 关闭「历史记录」同步。
- Google 账号的 My Activity 是另一套数据，清 Chrome 本地历史不会清它。
- Chrome 必须运行；扩展无法在 Chrome 完全关闭时执行清理。
- 历史搜索基于 Chrome 的 history API，极少数百分号编码/IDN 形式的 URL 可能匹配不到。

## 开发

无需构建，直接加载本目录即可。修改代码后，在 `chrome://extensions` 点扩展卡片上的刷新按钮；修改弹窗/设置页后重新打开页面。

```bash
# 单元测试 + service worker 模拟测试
npm test

# 重新生成图标
python3 scripts/make_icons.py
```

### 文件结构

```
manifest.json      MV3 清单
background.js      service worker：alarms、右键菜单、快捷键、清理逻辑
lib.js             共享常量、域名/周期校验、storage 读写、RPC
popup.html/css/js  工具栏弹窗：一键加入、查看列表
options.html/css/js 设置页：完整规则管理
icons/             16/32/48/128 图标
scripts/           图标生成脚本
tests/             lib.js 单元测试 + service worker 模拟测试
```

## 手动验收

1. 加载扩展，打开 `https://example.com`。
2. 点图标 → 确认域名是 `example.com` → 加入。
3. 打开 `chrome://history`，确认有 example.com 的记录。
4. 回到弹窗点「清理」，刷新历史页，确认记录消失。
5. 在设置页添加一条 `example.org` 规则，周期设为 1 小时；点「清理」验证单条清理。
6. 在任意 http/https 页面按 `Alt+Shift+A`，确认工具栏图标短暂显示 `✓`。
