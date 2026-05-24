import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { decodeRouteParam, fileExists } from './filesystem-utils.js';
import { sendJson, sendText } from './http-utils.js';

const STATIC_MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
};

function resolveStaticPath(distDir, urlPathname) {
  const decodedPathname = decodeRouteParam(urlPathname);
  const relativePath = decodedPathname === '/' ? 'index.html' : decodedPathname.replace(/^\/+/, '');
  const filePath = path.resolve(distDir, relativePath);

  if (filePath !== distDir && !filePath.startsWith(`${distDir}${path.sep}`)) {
    return null;
  }

  return filePath;
}

export async function serveStaticFile(req, res, url, distDir) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 404, { message: '接口不存在' });
    return true;
  }

  let filePath = resolveStaticPath(distDir, url.pathname);
  if (!filePath) {
    sendText(res, 403, 'Forbidden');
    return true;
  }

  if (!(await fileExists(filePath))) {
    filePath = path.join(distDir, 'index.html');
  }

  if (!(await fileExists(filePath))) {
    sendText(res, 500, '前端构建产物不存在，请先执行 npm run build');
    return true;
  }

  const content = await readFile(filePath);
  const contentType = STATIC_MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  res.end(content);
  return true;
}
