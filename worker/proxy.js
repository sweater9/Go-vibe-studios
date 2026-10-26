/**
 * GoVibe Mix — keyless CORS proxy for Replicate (Cloudflare Worker).
 *
 * - Forwards ONLY the paths the generator needs, to api.replicate.com.
 * - Passes the caller's Authorization header through. It never stores, logs or inspects it.
 * - /file?url=… streams a generated audio file, only from replicate.delivery hosts.
 *
 * Optional env var ALLOWED_ORIGIN: set it to your site (e.g. https://yourname.pages.dev)
 * so other sites cannot use your proxy. Defaults to "*".
 */
const PREDICT = /^\/v1\/models\/[\w.-]+\/[\w.-]+\/predictions$/;
const POLL = /^\/v1\/predictions\/[\w-]+$/;

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Prefer',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);

    if (url.pathname === '/file' && request.method === 'GET') {
      let target;
      try { target = new URL(url.searchParams.get('url')); } catch (_) { return new Response('bad url', { status: 400, headers: cors }); }
      if (target.protocol !== 'https:' || !(target.hostname === 'replicate.delivery' || target.hostname.endsWith('.replicate.delivery'))) {
        return new Response('forbidden host', { status: 403, headers: cors });
      }
      const up = await fetch(target.href);
      const h = new Headers(cors);
      h.set('Content-Type', up.headers.get('Content-Type') || 'application/octet-stream');
      return new Response(up.body, { status: up.status, headers: h });
    }

    const okPath = (request.method === 'POST' && PREDICT.test(url.pathname)) || (request.method === 'GET' && POLL.test(url.pathname));
    if (!okPath) return new Response('not allowed', { status: 404, headers: cors });

    const headers = new Headers({ 'Content-Type': 'application/json' });
    const auth = request.headers.get('Authorization'); if (auth) headers.set('Authorization', auth);
    const prefer = request.headers.get('Prefer'); if (prefer) headers.set('Prefer', prefer);

    const up = await fetch('https://api.replicate.com' + url.pathname, {
      method: request.method, headers, body: request.method === 'POST' ? request.body : undefined
    });
    const h = new Headers(cors); h.set('Content-Type', 'application/json');
    return new Response(up.body, { status: up.status, headers: h });
  }
};
