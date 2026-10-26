/* GoVibe Mix desktop shell. Serves the bundled website files from a private govibe:// address (a secure origin, so AudioWorklet, workers, IndexedDB and the microphone work),
   applies the same Content Security Policy as the website, allows the microphone only for the app itself, and sends every outside link to the normal browser. */
const { app, BrowserWindow, protocol, net, session, shell, Menu } = require('electron');
const path = require('path'), fs = require('fs'), { pathToFileURL } = require('url');

const SITE = path.join(__dirname, 'site');
const ORIGIN = 'govibe://app';
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: data: https://*.replicate.delivery; connect-src 'self' blob: data: https:; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'";
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8' };

protocol.registerSchemesAsPrivileged([{ scheme: 'govibe', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);

/* resolve a request path inside SITE only (no climbing out with ..) */
function resolve(urlPath) {
  let p = decodeURIComponent(urlPath); if (p === '/' || p === '') p = '/index.html';
  const full = path.normalize(path.join(SITE, p));
  if (full !== SITE && !full.startsWith(SITE + path.sep)) return null;
  return fs.existsSync(full) && fs.statSync(full).isFile() ? full : null;
}
module.exports = { resolve, SITE };

function createWindow() {
  const win = new BrowserWindow({ width: 1280, height: 860, minWidth: 380, minHeight: 560, backgroundColor: '#0b0b14', title: 'GoVibe Mix', autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
  win.loadURL(ORIGIN + '/index.html');
  win.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith(ORIGIN)) return { action: 'allow' }; if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
}

if (require.main === module || process.versions.electron) {
  app.whenReady().then(() => {
    protocol.handle('govibe', (req) => {
      const u = new URL(req.url), file = resolve(u.pathname);
      if (!file) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(file).toString()).then((r) => new Response(r.body, { status: 200, headers: { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' } }));
    });
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      const h = Object.assign({}, details.responseHeaders); if (details.url.startsWith(ORIGIN)) { h['Content-Security-Policy'] = [CSP]; h['X-Content-Type-Options'] = ['nosniff']; }
      cb({ responseHeaders: h });
    });
    /* the microphone is only for our own pages, nothing else is granted */
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => cb(permission === 'media' && details.requestingUrl.startsWith(ORIGIN) && !(details.mediaTypes || []).includes('video')));
    session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => permission === 'media' && origin.startsWith(ORIGIN));
    Menu.setApplicationMenu(null);
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
