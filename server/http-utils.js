const MAX_JSON_BODY_LENGTH = 2 * 1024 * 1024;
const ALLOWED_ORIGINS = new Set([
  'http://127.0.0.1:5173',
  'http://localhost:5173',
]);

export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function buildCorsHeaders(origin) {
  if (!ALLOWED_ORIGINS.has(origin)) {
    return {};
  }

  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
  };
}

export function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  const origin = res.req?.headers.origin;
  res.writeHead(statusCode, {
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
    ...buildCorsHeaders(origin),
  });
  res.end(body);
}

export function sendText(res, statusCode, message) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

export function writeSseHeaders(req, res) {
  res.writeHead(200, {
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream; charset=utf-8',
    'X-Accel-Buffering': 'no',
    ...buildCorsHeaders(req.headers.origin),
  });
}

export function sendSseEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let rejected = false;
    req.on('data', (chunk) => {
      if (rejected) {
        return;
      }
      body += chunk;
      if (body.length > MAX_JSON_BODY_LENGTH) {
        rejected = true;
        reject(new HttpError(413, '请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (rejected) {
        return;
      }
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new HttpError(400, '请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}
