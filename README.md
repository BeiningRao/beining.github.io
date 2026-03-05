# zotero-auto-ingest-organizer

一个 **Zotero 7 插件（可发布版原型）**，用于：

1. 定时扫描下载目录中的 PDF；
2. 自动导入到 Zotero；
3. 通过 Crossref 自动补全题名/摘要/期刊/DOI；
4. 根据“标题 + 摘要”关键词自动归入集合（文件夹）；
5. 自动创建结构化“摘要笔记”。

---

## 一、快速安装（Windows / macOS / Linux）

### 1) 打包为 xpi

在仓库根目录执行：

```bash
cd addon
zip -r ../zotero-auto-ingest-organizer.xpi .
# Windows PowerShell 可用：
# Compress-Archive 只支持 .zip，先打 zip 再改扩展名：
# Compress-Archive -Path * -DestinationPath ..\zotero-auto-ingest-organizer.zip -Force
# Rename-Item ..\zotero-auto-ingest-organizer.zip zotero-auto-ingest-organizer.xpi -Force
```

### 2) 安装到 Zotero

1. 打开 Zotero 7
2. `工具 -> 插件`
3. 右上角齿轮 `Install Add-on From File...`
4. 选择 `zotero-auto-ingest-organizer.xpi`
5. 重启 Zotero

---

## 二、默认行为

- 扫描目录：`~/Downloads`
- 扫描频率：30 秒
- 支持文件：`.pdf`
- 元数据来源：Crossref
- 摘要笔记句子数：3

---

## 三、可配置项（发布前建议）

本插件将配置保存在 Zotero Prefs（前缀：`extensions.zotero-auto-ingest-organizer.`）。

| Key | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `enabled` | bool | `true` | 是否启用自动扫描 |
| `downloadDir` | string | `~/Downloads` | 下载扫描目录 |
| `scanIntervalSec` | number | `30` | 扫描间隔（秒） |
| `metadataProvider` | string | `crossref` | `crossref` 或 `none` |
| `summarySentences` | number | `3` | 摘要笔记使用前 N 句 |
| `classifyRulesJSON` | JSON string | 内置规则 | 关键词到集合路径映射 |

### `classifyRulesJSON` 示例

```json
{
  "llm": "AI/LLM",
  "transformer": "AI/NLP",
  "medical": "Medical/Clinical",
  "vision": "CV"
}
```

---

## 四、调试与日志

- 出错日志会写入 Zotero 日志（关键词：`[auto-ingest]`）。
- 常见问题排查：
  - **没有自动导入**：检查 `downloadDir` 是否存在、是否是 PDF。
  - **没有摘要**：Crossref 不一定有摘要，属于数据源限制。
  - **没有分类**：检查 `classifyRulesJSON` 是否是合法 JSON。

---

## 五、发布到 GitHub（你问的那部分）

> 可以在 **PowerShell**、**Git Bash**、**Windows Terminal** 任一终端执行。

### 第一次发布

```bash
git remote add origin git@github.com:<你的用户名>/<你的仓库名>.git
# 或 https
# git remote add origin https://github.com/<你的用户名>/<你的仓库名>.git

git push -u origin work
```

### 如果提示 `remote origin already exists`

```bash
git remote set-url origin git@github.com:<你的用户名>/<你的仓库名>.git
# 或 https 地址

git push -u origin work
```

---

## 六、GitHub Release（建议）

1. 打标签：

```bash
git tag -a v0.2.4 -m "zotero auto ingest organizer v0.2.4"
git push origin v0.2.4
```

2. 在 GitHub 仓库 `Releases` 页面创建 `v0.2.4`。
3. 上传 `zotero-auto-ingest-organizer.xpi` 作为附件。



## 七、安装失败时的快速自检（Windows）

```powershell
# 1) 检查你安装的确实是 .xpi
Get-ChildItem D:\code\beining.github.io\zotero-auto-ingest-organizer.*

# 2) 检查包内根目录是否有 manifest.json 和 bootstrap.js
tar -tf D:\code\beining.github.io\zotero-auto-ingest-organizer.xpi | Select-Object -First 20
```

若 `tar -tf` 里没有 `manifest.json` / `bootstrap.js`，说明打包目录不对（必须在 `addon` 目录里执行打包）。


## 八、兼容性兜底（Zotero 8）

本包已加入 `install.rdf`（bootstrap 扩展清单）以兼容 Zotero 传统插件安装路径。
若你仍安装失败，请在 Zotero 的 `about:config` 中检查：

- `xpinstall.signatures.required` 是否可设为 `false`（若存在该项）

然后重启 Zotero 再安装。
