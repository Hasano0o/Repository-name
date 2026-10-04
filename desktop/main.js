// Bandly للويندوز — يلف نسخة الويب من التطبيق (web/ = ناتج expo export) داخل نافذة.
// طلبات الشبكة تمر من هنا (Node) بدل المتصفح: عشان صفحة الراوتر ما تنحجب بـ CORS،
// والكوكيز وهيدر Referer تشتغل مثل الجوال.
'use strict';
const { app, BrowserWindow, protocol, net, ipcMain, dialog, shell, safeStorage, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const WEB_DIR = path.join(__dirname, 'web');
const ORIGIN = 'app://bandly';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

// ───────── ملفات الواجهة ─────────
function serveApp() {
  protocol.handle('app', async (req) => {
    const { pathname } = new URL(req.url);
    let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
    let file = path.normalize(path.join(WEB_DIR, rel));
    if (!file.startsWith(WEB_DIR)) return new Response('forbidden', { status: 403 });
    let ok = false;
    try { ok = rel !== '' && fs.statSync(file).isFile(); } catch {}
    if (!ok) file = path.join(WEB_DIR, 'index.html'); // صفحة واحدة — كل المسارات ترجع للتطبيق
    return net.fetch(pathToFileURL(file).toString());
  });
}

// ───────── الشبكة ─────────
const jar = new Map(); // host → Map(name → value)
const inflight = new Map(); // id → AbortController

function storeCookies(host, setCookies) {
  if (!setCookies || !setCookies.length) return;
  let m = jar.get(host);
  if (!m) jar.set(host, (m = new Map()));
  for (const sc of setCookies) {
    const first = sc.split(';')[0];
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    const expired = /max-age=0\b/i.test(sc) || /expires=thu, 01 jan 1970/i.test(sc);
    if (expired || value === '') m.delete(name); else m.set(name, value);
  }
}
function cookieHeader(host) {
  const m = jar.get(host);
  if (!m || !m.size) return null;
  return [...m].map(([k, v]) => `${k}=${v}`).join('; ');
}

ipcMain.handle('net:fetch', async (_e, id, req) => {
  const ctrl = new AbortController();
  inflight.set(id, ctrl);
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    let url = new URL(req.url);
    let method = req.method || 'GET';
    let body = req.body;
    for (let hop = 0; hop < 6; hop++) {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol');
      const headers = new Headers();
      for (const [k, v] of req.headers || []) {
        const lk = k.toLowerCase();
        if (lk === 'host' || lk === 'content-length' || lk === 'connection') continue;
        headers.set(k, v);
      }
      if (!headers.has('cookie')) {
        const c = cookieHeader(url.host);
        if (c) headers.set('cookie', c);
      }
      if (!headers.has('user-agent')) headers.set('user-agent', `Bandly-Desktop/${app.getVersion()}`);
      const res = await fetch(url, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
        redirect: 'manual',
        signal: ctrl.signal,
      });
      storeCookies(url.host, res.headers.getSetCookie ? res.headers.getSetCookie() : []);
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        url = new URL(loc, url);
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
          method = 'GET';
          body = undefined;
        }
        continue;
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      const out = [];
      res.headers.forEach((v, k) => { if (k !== 'set-cookie') out.push([k, v]); });
      return { status: res.status, statusText: res.statusText, headers: out, body: buf, url: url.toString() };
    }
    throw new Error('too many redirects');
  } finally {
    clearTimeout(timer);
    inflight.delete(id);
  }
});
ipcMain.on('net:abort', (_e, id) => inflight.get(id)?.abort());

// ───────── كلمات المرور (مشفّرة بتشفير الويندوز) ─────────
const secretsFile = () => path.join(app.getPath('userData'), 'secrets.json');
function readSecrets() {
  try { return JSON.parse(fs.readFileSync(secretsFile(), 'utf8')); } catch { return {}; }
}
function writeSecrets(obj) {
  fs.mkdirSync(path.dirname(secretsFile()), { recursive: true });
  fs.writeFileSync(secretsFile(), JSON.stringify(obj));
}
const canEncrypt = () => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } };
ipcMain.handle('secret:get', (_e, key) => {
  const v = readSecrets()[key];
  if (v == null) return null;
  if (v.startsWith('enc:')) {
    try { return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64')); } catch { return null; }
  }
  return Buffer.from(v.slice(4), 'base64').toString('utf8'); // raw:
});
ipcMain.handle('secret:set', (_e, key, value) => {
  const all = readSecrets();
  all[key] = canEncrypt()
    ? 'enc:' + safeStorage.encryptString(String(value)).toString('base64')
    : 'raw:' + Buffer.from(String(value), 'utf8').toString('base64');
  writeSecrets(all);
});
ipcMain.handle('secret:del', (_e, key) => {
  const all = readSecrets();
  delete all[key];
  writeSecrets(all);
});

// ───────── رسائل وروابط ─────────
ipcMain.handle('ui:dialog', async (e, title, message, buttons, cancelId) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const opts = {
    type: 'none',
    title: title || 'Bandly',
    message: title || message || '',
    detail: title ? message || '' : '',
    buttons: buttons && buttons.length ? buttons : ['حسناً'],
    cancelId: typeof cancelId === 'number' ? cancelId : 0,
    defaultId: 0,
    noLink: true,
  };
  const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
  return r.response;
});
const SAFE_EXTERNAL = /^(https?|mailto|tel|tg|whatsapp):/i;
ipcMain.on('ui:open', (_e, url) => {
  if (typeof url === 'string' && SAFE_EXTERNAL.test(url)) shell.openExternal(url);
});

// ───────── النافذة ─────────
let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 400,
    minHeight: 560,
    title: 'Bandly',
    backgroundColor: '#eceff4',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win.show());

  // أي رابط خارجي ينفتح في المتصفح، والنافذة ما تطلع من التطبيق
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (SAFE_EXTERNAL.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (ev, url) => {
    if (!url.startsWith(ORIGIN)) {
      ev.preventDefault();
      if (SAFE_EXTERNAL.test(url)) shell.openExternal(url);
    }
  });
  // F5 = تحديث، F12 = أدوات المطور (للدعم الفني)
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F5') win.webContents.reload();
    if (input.key === 'F12') win.webContents.toggleDevTools();
  });

  win.loadURL(ORIGIN + '/');
}

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(() => {
  serveApp();
  // الميكروفون والكاميرا لوضع الفني والإشعارات فقط
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => {
    cb(['media', 'notifications', 'clipboard-sanitized-write'].includes(perm));
  });
  createWindow();
  // الراوترات والإعدادات محفوظة في تخزين المتصفح، وكرومium يأجّل كتابتها للقرص —
  // نكتبها كل كم ثانية وعند الإغلاق عشان ما تضيع لو انطفى الجهاز أو انقفل البرنامج غصب
  setInterval(() => { try { session.defaultSession.flushStorageData(); } catch {} }, 3000);
});

const flush = () => { try { session.defaultSession.flushStorageData(); } catch {} };
app.on('before-quit', flush);
app.on('session-end', flush); // إيقاف تشغيل الويندوز / تسجيل الخروج
process.on('SIGTERM', () => { flush(); app.quit(); });

app.on('window-all-closed', () => app.quit());
