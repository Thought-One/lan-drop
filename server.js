#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const sea = (() => {
  try {
    const s = require('node:sea');
    return s && typeof s.isSea === 'function' && s.isSea();
  } catch {
    return false;
  }
})();

const RAW_ARGS = process.argv.slice(sea ? 1 : 2);

const HELP = `
局域网互传 / LAN Drop  (零依赖, 单文件运行)

用法:
  lan-drop.exe [选项]
  node server.js [选项]

选项:
  -p, --port <端口>    监听端口 (默认 8080)
  -d, --dir  <目录>    共享目录 (默认 程序所在目录下的 lan-drop 文件夹)
  -n, --name <名称>    本机显示名称 (默认 计算机名)
  -o, --open           启动后自动打开浏览器 (默认不打开, 点击控制台链接打开)
  -h, --help           显示帮助

启动后自动放行防火墙, 并在控制台显示访问链接, 点击链接即可打开浏览器。
其他电脑用浏览器访问本机 IP:端口 即可上传下载, 无需安装任何东西。
`;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-p' || a === '--port') out.port = argv[++i];
    else if (a === '-d' || a === '--dir') out.dir = argv[++i];
    else if (a === '-n' || a === '--name') out.name = argv[++i];
    else if (a === '-o' || a === '--open') out.open = true;
    else if (a === '--fw-only') out.fwOnly = true;
    else if (a === '-h' || a === '--help') out.help = true;
  }
  return out;
}

const args = parseArgs(RAW_ARGS);
if (args.help) {
  console.log(HELP.trim());
  process.exit(0);
}

const BASE_DIR = sea ? path.dirname(process.execPath) : process.cwd();
const PORT = Number(args.port || process.env.PORT || 8080);
const ROOT = path.resolve(args.dir || process.env.SHARE_DIR || path.join(BASE_DIR, 'lan-drop'));
const DEVICE_NAME = args.name || process.env.DEVICE_NAME || os.hostname();
const OPEN_BROWSER = Boolean(args.open);
const PUBLIC_DIR = path.join(__dirname, 'public');

const RULE_NAME = `LAN Drop ${PORT}`;

function isAdmin() {
  if (process.platform !== 'win32') return true;
  const r = spawnSync('net', ['session'], { stdio: 'ignore', windowsHide: true });
  return r.status === 0;
}

function firewallRuleExists() {
  if (process.platform !== 'win32') return true;
  const r = spawnSync(
    'netsh',
    ['advfirewall', 'firewall', 'show', 'rule', `name=${RULE_NAME}`],
    { stdio: 'ignore', windowsHide: true }
  );
  return r.status === 0;
}

function addFirewallRule() {
  if (process.platform !== 'win32') return true;
  spawnSync('netsh', ['advfirewall', 'firewall', 'delete', 'rule', `name=${RULE_NAME}`], {
    stdio: 'ignore',
    windowsHide: true,
  });
  const r = spawnSync(
    'netsh',
    [
      'advfirewall', 'firewall', 'add', 'rule',
      `name=${RULE_NAME}`,
      'dir=in', 'action=allow', 'protocol=TCP', `localport=${PORT}`, 'profile=any',
    ],
    { stdio: 'ignore', windowsHide: true }
  );
  return r.status === 0;
}

function elevateForFirewall() {
  const exe = process.execPath;
  const pass = RAW_ARGS.concat(['--fw-only']);
  const list = pass.map((a) => `'${String(a).replace(/'/g, "''")}'`).join(',');
  const cmd =
    `Start-Process -Verb RunAs -Wait -WindowStyle Hidden ` +
    `-FilePath '${exe.replace(/'/g, "''")}' -ArgumentList @(${list})`;
  try {
    spawnSync('powershell', ['-NoProfile', '-Command', cmd], { stdio: 'ignore', windowsHide: true });
  } catch {}
}

function ensureFirewall() {
  if (process.platform !== 'win32') return;
  if (firewallRuleExists()) return;

  if (isAdmin()) {
    if (addFirewallRule()) console.log(`  [防火墙] 已放行 TCP ${PORT}`);
    else console.log(`  [防火墙] 放行失败, 其他电脑可能无法连接`);
    return;
  }

  console.log(`  [防火墙] 未放行 TCP ${PORT}, 正在请求管理员权限...`);
  elevateForFirewall();
  if (firewallRuleExists()) console.log(`  [防火墙] 已放行 TCP ${PORT}`);
  else console.log(`  [防火墙] 未放行, 其他电脑可能无法连接 (可右键以管理员身份运行)`);
}

if (args.fwOnly) {
  const ok = addFirewallRule();
  process.exit(ok ? 0 : 1);
}

fs.mkdirSync(ROOT, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-File-Name');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-File-Name, Content-Length');
}

function json(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  cors(res);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
  });
  res.end(body);
}

function safeName(raw) {
  if (!raw) return null;
  let name = path.basename(String(raw)).replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').trim();
  if (!name || name === '.' || name === '..') return null;
  return name;
}

async function uniquePath(name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let candidate = path.join(ROOT, name);
  let i = 1;
  while (true) {
    try {
      await fsp.access(candidate);
      candidate = path.join(ROOT, `${base} (${i})${ext}`);
      i++;
    } catch {
      return candidate;
    }
  }
}

async function listFiles() {
  const entries = await fsp.readdir(ROOT, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (!e.isFile() || e.name.endsWith('.part')) continue;
    try {
      const st = await fsp.stat(path.join(ROOT, e.name));
      files.push({ name: e.name, size: st.size, mtime: st.mtimeMs });
    } catch {}
  }
  files.sort((a, b) => b.mtime - a.mtime);
  return files;
}

function contentDisposition(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function embeddedAsset(name) {
  if (!sea) return null;
  try {
    return Buffer.from(require('node:sea').getAsset(name));
  } catch {
    return null;
  }
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');

  if (rel === 'index.html') {
    const buf = embeddedAsset('index.html') || readDiskAsset(rel);
    return sendAsset(res, rel, buf);
  }

  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) {
      cors(res);
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    cors(res);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

function readDiskAsset(rel) {
  try {
    return fs.readFileSync(path.join(PUBLIC_DIR, rel));
  } catch {
    return null;
  }
}

function sendAsset(res, rel, buf) {
  cors(res);
  if (!buf) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  res.end(buf);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;

  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (pathname === '/api/info' && req.method === 'GET') {
      return json(res, 200, {
        name: DEVICE_NAME,
        dir: ROOT,
        port: PORT,
        files: (await listFiles()).length,
      });
    }

    if (pathname === '/api/files' && req.method === 'GET') {
      return json(res, 200, { name: DEVICE_NAME, files: await listFiles() });
    }

    if (pathname === '/api/upload' && req.method === 'POST') {
      const name = safeName(url.searchParams.get('name') || req.headers['x-file-name']);
      if (!name) return json(res, 400, { error: '文件名无效' });
      const dest = await uniquePath(name);
      const tmp = dest + '.part';
      const ws = fs.createWriteStream(tmp);
      let received = 0;
      let aborted = false;
      req.on('data', (c) => (received += c.length));
      req.on('error', () => {
        aborted = true;
        ws.destroy();
        fsp.unlink(tmp).catch(() => {});
      });
      ws.on('error', () => {
        aborted = true;
        fsp.unlink(tmp).catch(() => {});
        if (!res.headersSent) json(res, 500, { error: '写入失败' });
      });
      ws.on('finish', async () => {
        if (aborted) return;
        await fsp.rename(tmp, dest);
        return json(res, 200, { ok: true, name: path.basename(dest), size: received });
      });
      req.pipe(ws);
      return;
    }

    if (pathname === '/api/download' && req.method === 'GET') {
      const name = safeName(url.searchParams.get('name'));
      if (!name) return json(res, 400, { error: '文件名无效' });
      const file = path.join(ROOT, name);
      let st;
      try {
        st = await fsp.stat(file);
        if (!st.isFile()) throw new Error('not file');
      } catch {
        return json(res, 404, { error: '文件不存在' });
      }
      cors(res);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': st.size,
        'Content-Disposition': contentDisposition(name),
        'X-File-Name': encodeURIComponent(name),
      });
      const rs = fs.createReadStream(file);
      rs.on('error', () => res.destroy());
      rs.pipe(res);
      return;
    }

    if (pathname === '/api/files' && req.method === 'DELETE') {
      const name = safeName(url.searchParams.get('name'));
      if (!name) return json(res, 400, { error: '文件名无效' });
      try {
        await fsp.unlink(path.join(ROOT, name));
      } catch {
        return json(res, 404, { error: '文件不存在' });
      }
      return json(res, 200, { ok: true });
    }

    if (pathname.startsWith('/api/')) return json(res, 404, { error: '未知接口' });

    return serveStatic(req, res, pathname);
  } catch (err) {
    if (!res.headersSent) json(res, 500, { error: String(err && err.message || err) });
    else res.destroy();
  }
});

function localIPv4() {
  const out = [];
  const VIRTUAL = /virtual|vmware|vethernet|hyper-v|zerotier|loopback|bluetooth|docker|tap|tun|wsl/i;
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL.test(name)) continue;
    for (const ni of list || []) {
      if (ni.family !== 'IPv4' || ni.internal) continue;
      if (ni.address.startsWith('169.254.')) continue;
      out.push(ni.address);
    }
  }
  return out;
}

function hyperlink(url) {
  const supported =
    process.stdout.isTTY &&
    (process.env.WT_SESSION || process.env.TERM_PROGRAM || process.env.TERM || process.env.ConEmuANSI);
  if (!supported) return url;
  return `\u001b]8;;${url}\u001b\\${url}\u001b]8;;\u001b\\`;
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {}
}

console.log('');
console.log('  局域网互传 / LAN Drop');
console.log('  ----------------------------------------');
ensureFirewall();

server.listen(PORT, '0.0.0.0', () => {
  const ips = localIPv4();
  console.log(`  本机名称 : ${DEVICE_NAME}`);
  console.log(`  共享目录 : ${ROOT}`);
  if (ips.length === 0) {
    console.log(`  访问地址 : ${hyperlink(`http://localhost:${PORT}`)}`);
  } else {
    for (const ip of ips) console.log(`  访问地址 : ${hyperlink(`http://${ip}:${PORT}`)}`);
  }
  console.log('  ----------------------------------------');
  console.log(`  点击上面的链接即可打开浏览器 (本机用 ${hyperlink(`http://localhost:${PORT}`)})`);
  console.log('  其他电脑在浏览器输入上面地址即可互传文件');
  console.log('  关闭本窗口即可停止服务');
  console.log('');
  if (OPEN_BROWSER) openBrowser(`http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  端口 ${PORT} 已被占用, 请用 --port 换一个端口, 例如: lan-drop.exe -p 8081\n`);
  } else {
    console.error('\n  启动失败:', err.message, '\n');
  }
  process.exit(1);
});
