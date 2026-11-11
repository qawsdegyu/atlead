/**
 * Test helpers: a private data folder per test file, and a fake internet.
 * Every HTTP call made with axios is answered by the routes registered here, so
 * nothing ever reaches Facebook, Instagram, Telegram or an AI provider.
 *
 * Must be required BEFORE any src/ module (storage picks its folder at load time).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlead-test-'));
process.env.DATA_DIR = dataDir;
process.env.VERCEL = '1'; // importing server.js must not start a listener / background jobs
delete process.env.RAILWAY_PUBLIC_DOMAIN;
for (const k of ['META_APP_ID', 'META_APP_SECRET', 'META_LOGIN_CONFIG_ID', 'TELEGRAM_BOT_TOKEN',
  'GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'GROQ_API_KEY',
  'SUPABASE_URL', 'SUPABASE_KEY', 'ADMIN_PASSWORD']) delete process.env[k];

const axios = require('axios');

const routes = [];
const calls = [];

/** fake(method, urlRegex, handler(req) → { status, data } | data) */
function fake(method, pattern, handler) {
  routes.unshift({ method: method.toUpperCase(), pattern, handler });
}

function reset() {
  routes.length = 0;
  calls.length = 0;
}

async function bodyOf(config) {
  const d = config.data;
  if (d && typeof d === 'object' && typeof d.get === 'function') { // FormData
    const out = {};
    for (const [k, v] of d.entries()) out[k] = typeof v === 'string' ? v : `<file ${v.size} bytes>`;
    return out;
  }
  if (typeof d === 'string') { try { return JSON.parse(d); } catch { return d; } }
  return d || null;
}

axios.defaults.adapter = async (config) => {
  const url = config.url + (config.params ? `?${new URLSearchParams(config.params)}` : '');
  const method = (config.method || 'get').toUpperCase();
  const req = { method, url, params: config.params || {}, body: await bodyOf(config) };
  calls.push(req);
  const route = routes.find(r => r.method === method && r.pattern.test(url));
  const reply = (status, data) => {
    const response = { data, status, statusText: String(status), headers: {}, config, request: {} };
    if (status >= 400) {
      const err = new Error(`Request failed with status code ${status}`);
      err.response = response; err.config = config;
      throw err;
    }
    return response;
  };
  if (!route) return reply(599, { error: { message: `no fake route for ${method} ${url}` } });
  const out = await route.handler(req);
  if (out && out.__status) return reply(out.__status, out.data);
  return reply(200, out);
};

/** helper for a route answer with a status code */
const status = (code, data) => ({ __status: code, data });

/** A small real JPEG, used as "generated" image bytes. */
async function jpeg(color = '#0284c7') {
  const sharp = require('sharp');
  // Noise makes it a realistic size (real images are tens of KB; tiny replies are treated as errors).
  return sharp({ create: { width: 400, height: 300, channels: 3, background: color, noise: { type: 'gaussian', mean: 128, sigma: 40 } } }).jpeg().toBuffer();
}

/** Start the real Express app on a random port. */
async function startApp() {
  const app = require('../server');
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise(r => server.close(r)) };
}

/** fetch() that does not follow redirects (Node's fetch is not routed through axios). */
async function http(base, pathName, { method = 'GET', json, headers = {}, form } = {}) {
  const opts = { method, redirect: 'manual', headers: { ...headers } };
  if (json !== undefined) { opts.body = JSON.stringify(json); opts.headers['Content-Type'] = 'application/json'; }
  if (form) { opts.body = new URLSearchParams(form).toString(); opts.headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
  const res = await fetch(base + pathName, opts);
  const text = await res.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, location: res.headers.get('location'), body };
}

module.exports = { dataDir, fake, reset, calls, status, jpeg, startApp, http };
