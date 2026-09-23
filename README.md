# LAN Drop · 局域网互传

零依赖的局域网文件互传工具。**只需一台电脑运行程序**，其他电脑用浏览器打开主机地址即可上传 / 下载文件，客机无需安装任何东西。

支持 Windows，可打包成**单文件 exe**，双击即用（目标电脑无需安装 Node.js）。

---

## 特性

- **单端运行**：只有主机需要启动程序，其他设备纯浏览器访问
- **双向传输**：任意一端都能上传和下载（谁开页面谁就能传）
- **零依赖**：仅使用 Node.js 内置模块，无需 `npm install`
- **单文件 exe**：基于 Node.js SEA 打包，双击运行，内置网页资源
- **自动放行防火墙**：首次运行自动请求管理员权限并添加 TCP 入站规则
- **多文件上传**：支持多选、拖拽上传、实时进度条
- **中文文件名**：完整支持 UTF-8 文件名上传与下载
- **重名保护**：同名文件自动改名为 `name (1).ext`
- **安全写入**：先写 `.part` 临时文件，完成后重命名，中断不留残片
- **美观界面**：深色响应式 UI，适配桌面与移动端浏览器

---

## 快速开始

### 方式一：使用 exe（推荐，目标电脑无需 Node.js）

1. 下载 / 双击 `lan-drop.exe`
2. 首次运行弹出 UAC 提权窗口，点「是」以自动放行防火墙
3. 控制台会显示访问地址，点击链接即可打开浏览器（默认不自动弹出）
4. 其他电脑在浏览器输入控制台显示的地址，例如 `http://192.168.1.23:8080`

上传的文件保存在 exe 同目录下的 `lan-drop` 文件夹中。

### 方式二：从源码运行（需要 Node.js）

```bash
node server.js
# 或
npm start
# Windows 也可双击 start.bat
```

浏览器打开控制台输出的地址即可。默认共享目录为启动目录下的 `lan-drop` 文件夹。

---

## 命令行参数

```
-p, --port <端口>    监听端口，默认 8080
-d, --dir  <目录>    共享目录，默认程序所在目录下的 lan-drop 文件夹
-n, --name <名称>    本机显示名称，默认计算机名
-o, --open           启动后自动打开浏览器（默认不打开，需点击控制台链接）
-h, --help           显示帮助
```

示例：

```bash
lan-drop.exe -p 8081 -d D:\share -n 我的电脑
```

---

## 打包为单文件 exe

基于 [Node.js Single Executable Applications (SEA)](https://nodejs.org/api/single-executable-applications.html)，在 PowerShell 中执行：

```powershell
cd H:\programs\p2p

# 1) 生成 SEA blob
node --experimental-sea-config sea-config.json

# 2) 复制 node.exe 作为基础可执行文件
Copy-Item (Get-Command node).Source .\dist\lan-drop.exe -Force

# 3) 注入 blob，生成单文件 exe
npx --yes postject .\dist\lan-drop.exe NODE_SEA_BLOB .\build\sea-prep.blob `
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
```

> 注意：每次执行第 3 步前必须重新执行第 2 步，否则会报 `Resource with that name already exists`。

可选打包压缩包：

```powershell
Compress-Archive -Path .\dist\lan-drop.exe, .\使用说明.txt -DestinationPath .\lan-drop.zip -Force
```

---

## HTTP API

所有接口均开启 CORS，方便跨设备访问。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/info` | 主机信息（名称、共享目录、端口、文件数） |
| `GET` | `/api/files` | 文件列表（名称、大小、修改时间） |
| `POST` | `/api/upload?name=<文件名>` | 上传文件，请求体为原始二进制 |
| `GET` | `/api/download?name=<文件名>` | 下载文件 |
| `DELETE` | `/api/files?name=<文件名>` | 删除文件 |

---

## 工作原理

- 主机运行 HTTP 服务，监听 `0.0.0.0`，向局域网暴露网页与 API
- 网页由服务端内置（exe 模式下通过 SEA 资源嵌入），打开即自动连接并加载文件列表
- 上传：浏览器将文件以二进制 `POST` 到 `/api/upload`，服务端流式写入共享目录
- 下载：服务端流式读取文件，并设置 `Content-Disposition` 触发浏览器下载
- 文件名经过安全过滤（去除路径分隔符与非法字符），并做重名处理

---

## 常见问题

**其他电脑打不开？**

1. 确认在同一局域网（同一 WiFi / 路由器）
2. 确认首次运行时点了 UAC 的「是」；否则右键 exe 选「以管理员身份运行」
3. 临时关闭 VPN / ZeroTier / 代理后重试
4. 路由器若开启「AP 隔离 / 客户端隔离」，同网段设备无法互访，需关闭
5. 检查 Windows 防火墙是否已有 `LAN Drop <端口>` 的入站允许规则

**浏览器提示「此站点的连接不安全」？**

这是 HTTP 明文访问的正常提示，内网自用无风险，功能不受影响，忽略即可。如需消除，可改用 HTTPS + 自签名证书，但客机仍需手动信任证书。

**端口被占用？**

```bash
lan-drop.exe -p 8081
```

**exe 首次运行被 SmartScreen 拦截？**

注入 SEA blob 后微软数字签名失效，属正常现象。点击「更多信息」→「仍要运行」即可。

---

## 安全说明

- 默认**无鉴权**，任何能访问该端口的设备都可上传 / 下载 / 删除文件
- CORS 为 `*`，接口对外完全开放
- 仅适用于**可信内网**环境，请勿直接暴露到公网

---

## 项目结构

```
.
├── server.js          # 服务端（HTTP 服务 + API + 防火墙处理 + SEA 支持）
├── public/
│   └── index.html     # 网页界面（单文件，无外部依赖）
├── sea-config.json    # Node.js SEA 打包配置
├── start.bat          # Windows 源码启动脚本
├── 使用说明.txt        # 面向普通用户的说明
└── package.json
```

---

## License

MIT
