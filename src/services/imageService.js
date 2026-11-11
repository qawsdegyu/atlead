/**
 * Post image generation. Uses whichever AI key is configured (Gemini / OpenAI /
 * OpenRouter), and falls back to the free Pollinations service when none can
 * make images. Every image is saved as a 1080x1080 JPEG (what Instagram requires).
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const storageService = require('./storageService');
const aiService = require('./aiService');

let sharp = null;
try { sharp = require('sharp'); } catch { console.warn('[Images] "sharp" not installed — images are saved as generated (run npm install).'); }

const BUCKET = 'marketing-images';
const DEFAULT_MODELS ={ gemini: 'gemini-2.5-flash-image', openai: 'gpt-image-1', openrouter: 'google/gemini-2.5-flash-image' };
const errMsg = (e) => e.response?.data?.error?.message || e.message;
const fromDataUrl = (url) => Buffer.from(String(url).split(',').pop(), 'base64');

class ImageService {
  constructor() { this._backedUp = new Set(); }

  dir() {
    const dir = path.join(storageService.getUploadsDir(), 'marketing');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  filePath(name) {
    // Only our own generated names — never a path from the outside.
    return /^mk_[a-z0-9]+\.(jpg|png|webp)$/.test(String(name)) ? path.join(this.dir(), name) : null;
  }

  /** Normalise any image to a square JPEG and store it. Returns the file name. */
  async save(buffer) {
    let ext = 'jpg';
    let out = buffer;
    if (sharp) {
      out = await sharp(buffer).rotate().resize(1080, 1080, { fit: 'cover', position: 'attention' }).jpeg({ quality: 88 }).toBuffer();
    } else if (buffer[0] === 0x89 && buffer[1] === 0x50) {
      ext = 'png';
    }
    const name = `mk_${Date.now().toString(36)}${crypto.randomBytes(8).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(this.dir(), name), out);
    // Copy in the database storage too, so a redeploy / wiped disk never loses a post image.
    this.backup(name, out);
    return name;
  }

  backup(name, buffer) {
    const sb = require('./supabaseService');
    if (!sb.isEnabled()) return Promise.resolve(false);
    return sb.uploadFile(BUCKET, name, buffer, name.endsWith('.png') ? 'image/png' : 'image/jpeg')
      .then(ok => { if (ok) this._backedUp.add(name); return ok; });
  }

  /** Local path of an image, restored from the database storage if the disk lost it. */
  async ensureLocal(name) {
    const file = this.filePath(name);
    if (!file) return null;
    if (fs.existsSync(file)) return file;
    const buf = await require('./supabaseService').downloadFile(BUCKET, name);
    if (!buf) return null;
    fs.writeFileSync(file, buf);
    console.log(`[Images] Restored ${name} from Supabase Storage`);
    return file;
  }

  /** Upload any local images that are not in the database yet (scheduler retry). */
  async backupMissing(names) {
    const sb = require('./supabaseService');
    if (!sb.isEnabled()) return 0;
    let n = 0;
    for (const name of names) {
      if (this._backedUp.has(name)) continue;
      const file = this.filePath(name);
      if (file && fs.existsSync(file) && await this.backup(name, fs.readFileSync(file))) n++;
    }
    return n;
  }

  async viaProvider(p, prompt) {
    const custom = storageService.getSettings().marketing?.image_model;
    const model = (custom && String(custom).trim()) || DEFAULT_MODELS[p.type];
    if (p.type === 'gemini') {
      const res = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${p.key}`, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
      }, { timeout: 90000 });
      for (const part of res.data?.candidates?.[0]?.content?.parts || []) {
        const data = part.inlineData?.data || part.inline_data?.data;
        if (data) return Buffer.from(data, 'base64');
      }
      throw new Error('Gemini returned no image');
    }
    if (p.type === 'openai') {
      const res = await axios.post('https://api.openai.com/v1/images/generations', { model, prompt, size: '1024x1024', n: 1 }, {
        headers: { Authorization: `Bearer ${p.key}` }, timeout: 120000
      });
      const d = res.data?.data?.[0] || {};
      if (d.b64_json) return Buffer.from(d.b64_json, 'base64');
      if (d.url) return Buffer.from((await axios.get(d.url, { responseType: 'arraybuffer', timeout: 60000 })).data);
      throw new Error('OpenAI returned no image');
    }
    if (p.type === 'openrouter') {
      const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model, messages: [{ role: 'user', content: prompt }], modalities: ['image', 'text']
      }, { headers: { Authorization: `Bearer ${p.key}` }, timeout: 120000 });
      const url = res.data?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      if (!url) throw new Error(res.data?.error?.message || 'OpenRouter returned no image');
      return url.startsWith('data:') ? fromDataUrl(url) : Buffer.from((await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 })).data);
    }
    throw new Error(`${p.label} لا يدعم توليد الصور`);
  }

  /** The free service allows one request at a time per visitor → queue them, retry once. */
  viaPollinations(prompt) {
    const job = (this._pq || Promise.resolve()).catch(() => {}).then(async () => {
      try { return await this.pollinationsOnce(prompt); } catch (e) {
        await new Promise(r => setTimeout(r, 4000));
        return this.pollinationsOnce(prompt);
      }
    });
    this._pq = job;
    return job;
  }

  async pollinationsOnce(prompt) {
    const res = await axios.get(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 900))}`, {
      params: { width: 1080, height: 1080, nologo: 'true', seed: Math.floor(Math.random() * 1e9) },
      responseType: 'arraybuffer', timeout: 120000
    });
    const buf = Buffer.from(res.data);
    if (buf.length < 5000) throw new Error('Pollinations returned no image');
    return buf;
  }

  /** One image from a prompt. Returns { file, engine } or throws with the last error. */
  async generate(prompt) {
    const providers = aiService.getProviders().filter(p => DEFAULT_MODELS[p.type]);
    let lastErr = new Error('لا يوجد مفتاح AI يدعم توليد الصور (Gemini / OpenAI / OpenRouter)');
    // A provider that just failed (no credit, model not allowed) is skipped for 10 minutes.
    this._bad = this._bad || new Map();
    for (const p of providers) {
      if (Date.now() - (this._bad.get(p.key) || 0) < 10 * 60 * 1000) continue;
      try {
        return { file: await this.save(await this.viaProvider(p, prompt)), engine: p.label };
      } catch (e) {
        lastErr = new Error(`${p.label}: ${errMsg(e)}`);
        this._bad.set(p.key, Date.now());
        console.error('[Images]', lastErr.message);
      }
    }
    if (storageService.getSettings().marketing?.free_image_fallback !== false) {
      try {
        return { file: await this.save(await this.viaPollinations(prompt)), engine: 'Pollinations (مجاني)' };
      } catch (e) {
        const busy = /402|429/.test(e.message) ? 'مضغوط حالياً' : e.message;
        lastErr = new Error(`${lastErr.message} — والمولّد المجاني ${busy}. للحصول على صور مضمونة: حط مفتاح Gemini أو OpenAI بالإعدادات.`);
      }
    }
    throw lastErr;
  }

  /** Several images in parallel; failures are returned as { error } so the rest still show. */
  async generateMany(prompts) {
    return Promise.all(prompts.map(async (p) => {
      try {
        const r = await this.generate(p.prompt);
        return { ...p, ...r };
      } catch (e) {
        return { ...p, error: e.message };
      }
    }));
  }
}

module.exports = new ImageService();
