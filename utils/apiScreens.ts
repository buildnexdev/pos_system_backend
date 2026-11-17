/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Animated HTML screens for API root and browser 404 responses
 * Edit Date: 2026-11-12
 */

export type ApiScreenKind = 'home' | 'notfound' | 'error';

function wantsHtml(acceptHeader?: string): boolean {
  const accept = String(acceptHeader || '').toLowerCase();
  if (!accept || accept.includes('*/*')) return true;
  if (accept.includes('text/html')) return true;
  if (accept.includes('application/json') && !accept.includes('text/html')) return false;
  return true;
}

function shell(kind: ApiScreenKind, title: string, body: string): string {
  const accent =
    kind === 'home' ? '#0f766e' : kind === 'error' ? '#b91c1c' : '#c2410c';
  const glow =
    kind === 'home' ? 'rgba(15,118,110,.35)' : kind === 'error' ? 'rgba(185,28,28,.35)' : 'rgba(194,65,12,.35)';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    :root {
      --ink: #0b1220;
      --muted: #64748b;
      --card: rgba(255,255,255,.86);
      --accent: ${accent};
      --glow: ${glow};
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; }
    body {
      font-family: "Segoe UI", system-ui, sans-serif;
      color: var(--ink);
      overflow: hidden;
      background:
        radial-gradient(1200px 600px at 10% -10%, var(--glow), transparent 55%),
        radial-gradient(900px 500px at 90% 110%, rgba(37,99,235,.18), transparent 50%),
        linear-gradient(160deg, #f8fafc 0%, #eef2ff 45%, #f0fdfa 100%);
    }
    .orb {
      position: absolute;
      border-radius: 50%;
      filter: blur(2px);
      opacity: .55;
      animation: float 8s ease-in-out infinite;
      pointer-events: none;
    }
    .orb.a { width: 180px; height: 180px; left: 8%; top: 18%; background: var(--glow); animation-delay: 0s; }
    .orb.b { width: 120px; height: 120px; right: 12%; top: 28%; background: rgba(37,99,235,.25); animation-delay: -2s; }
    .orb.c { width: 90px; height: 90px; left: 22%; bottom: 16%; background: rgba(14,165,233,.22); animation-delay: -4s; }
    @keyframes float {
      0%, 100% { transform: translateY(0) scale(1); }
      50% { transform: translateY(-22px) scale(1.05); }
    }
    .wrap {
      min-height: 100%;
      display: grid;
      place-items: center;
      padding: 24px;
      position: relative;
      z-index: 1;
    }
    .card {
      width: min(560px, 100%);
      background: var(--card);
      backdrop-filter: blur(14px);
      border: 1px solid rgba(148,163,184,.35);
      border-radius: 24px;
      padding: 36px 32px 28px;
      box-shadow: 0 24px 60px rgba(15,23,42,.12);
      text-align: center;
      animation: rise .7s cubic-bezier(.2,.8,.2,1) both;
    }
    @keyframes rise {
      from { opacity: 0; transform: translateY(18px) scale(.98); }
      to { opacity: 1; transform: none; }
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--accent) 12%, white);
      color: var(--accent);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: .04em;
      text-transform: uppercase;
      margin-bottom: 14px;
    }
    .pulse {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 0 0 var(--glow);
      animation: pulse 1.8s infinite;
    }
    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 var(--glow); }
      70% { box-shadow: 0 0 0 12px transparent; }
      100% { box-shadow: 0 0 0 0 transparent; }
    }
    .mark {
      width: 84px; height: 84px; margin: 8px auto 18px;
      border-radius: 22px;
      display: grid; place-items: center;
      background: linear-gradient(145deg, color-mix(in srgb, var(--accent) 18%, white), white);
      border: 1px solid rgba(148,163,184,.35);
      position: relative;
      animation: spinSoft 10s linear infinite;
    }
    .mark::after {
      content: "";
      position: absolute; inset: -8px;
      border-radius: 28px;
      border: 2px dashed color-mix(in srgb, var(--accent) 35%, transparent);
      animation: spinSoft 14s linear infinite reverse;
    }
    @keyframes spinSoft {
      to { transform: rotate(360deg); }
    }
    .mark span {
      font-size: 34px;
      animation: bob 2.4s ease-in-out infinite;
      display: block;
    }
    @keyframes bob {
      0%,100% { transform: translateY(0); }
      50% { transform: translateY(-6px); }
    }
    h1 {
      margin: 0 0 8px;
      font-size: clamp(1.5rem, 3vw, 2rem);
      letter-spacing: -.02em;
    }
    p {
      margin: 0 auto;
      max-width: 42ch;
      color: var(--muted);
      line-height: 1.55;
      font-size: .95rem;
    }
    .actions {
      display: flex; flex-wrap: wrap; gap: 10px; justify-content: center;
      margin-top: 22px;
    }
    a.btn, .btn {
      appearance: none; border: 0; cursor: pointer; text-decoration: none;
      display: inline-flex; align-items: center; justify-content: center;
      padding: 11px 16px; border-radius: 999px; font-weight: 700; font-size: .88rem;
      transition: transform .15s ease, box-shadow .15s ease;
    }
    a.btn:hover { transform: translateY(-1px); }
    .primary {
      background: var(--accent); color: #fff;
      box-shadow: 0 10px 24px var(--glow);
    }
    .ghost {
      background: #fff; color: var(--ink);
      border: 1px solid #e2e8f0;
    }
    .meta {
      margin-top: 22px;
      padding-top: 14px;
      border-top: 1px solid #e2e8f0;
      display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap;
      color: var(--muted); font-size: .75rem;
    }
    .path {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      background: #f1f5f9; padding: 2px 8px; border-radius: 6px; color: #334155;
    }
  </style>
</head>
<body>
  <div class="orb a"></div>
  <div class="orb b"></div>
  <div class="orb c"></div>
  <div class="wrap">
    <div class="card">
      ${body}
    </div>
  </div>
</body>
</html>`;
}

export function apiHomeHtml(port: number | string): string {
  const body = `
    <div class="badge"><span class="pulse"></span> API Online</div>
    <img src="/api/uploads/brand/buildnex-shopos-logo.png" alt="BuildNex ShopOS" style="width:120px;height:120px;object-fit:cover;border-radius:22px;margin:8px auto 14px;display:block;background:#000;box-shadow:0 16px 36px rgba(15,23,42,.18)" />
    <h1>BuildNex ShopOS API</h1>
    <p>Your commerce backend is running. Use authenticated JSON endpoints from the panel, or check health below.</p>
    <div class="actions">
      <a class="btn primary" href="/api/health">Check Health</a>
      <a class="btn ghost" href="${process.env.CLIENT_URL || 'http://localhost:5173'}/login">Open Panel</a>
    </div>
    <div class="meta">
      <span>Port <strong>${port}</strong></span>
      <span>Base path <span class="path">/api</span></span>
    </div>
  `;
  return shell('home', 'BuildNex ShopOS API', body);
}

export function apiNotFoundHtml(pathName: string): string {
  const body = `
    <div class="badge"><span class="pulse"></span> Not Found</div>
    <div class="mark"><span>🔎</span></div>
    <h1>Route not found</h1>
    <p>No API endpoint matches <span class="path">${pathName}</span>. Try health check or return to the API home screen.</p>
    <div class="actions">
      <a class="btn primary" href="/api">API Home</a>
      <a class="btn ghost" href="/api/health">Health</a>
    </div>
    <div class="meta">
      <span>Status <strong>404</strong></span>
      <span>BuildNex ShopOS</span>
    </div>
  `;
  return shell('notfound', 'API route not found', body);
}

export function apiErrorHtml(message = 'Server error'): string {
  const body = `
    <div class="badge"><span class="pulse"></span> Error</div>
    <div class="mark"><span>⚠️</span></div>
    <h1>Something went wrong</h1>
    <p>${message}</p>
    <div class="actions">
      <a class="btn primary" href="/api">API Home</a>
      <a class="btn ghost" href="/api/health">Health</a>
    </div>
  `;
  return shell('error', 'API error', body);
}

export { wantsHtml };
