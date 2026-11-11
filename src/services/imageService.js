/**
 * Post image generation. Uses whichever AI key is configured (Gemini / OpenAI /
 * OpenRouter), and falls back to the free Pollinations service when none can
 * make images. Every image is saved as a 1080x1350 JPEG (Instagram's 4:5 portrait —
 * the size that takes the most space in the feed).
 *
 * Best model (Nov 2026, via OpenRouter): Nano Banana Pro (google/gemini-3-pro-image) —
 * Google's most advanced image generation + editing model; reads reference images
 * (the page's own posts + logo) and renders text inside the image. Nano Banana 2.1 is
 * the automatic fallback.
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
const DEFAULT_MODELS = { gemini: 'gemini-2.5-flash-image', openai: 'gpt-image-1', openrouter: 'google/gemini-3-pro-image' };
// Tried in order on OpenRouter (the first one that works wins).
const OPENROUTER_CHAIN = ['google/gemini-3-pro-image', 'google/gemini-nano-banana-2.1', 'google/gemini-3.1-flash-image'];
const POST_W = 1080;
const POST_H = 1350;
const ASPECT = '4:5';
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

  /** Data URL of a stored image (sent to the model as a reference / for editing). */
  dataUrl(name) {
    const file = this.filePath(name);
    if (!file || !fs.existsSync(file)) return null;
    const ext = path.extname(file).slice(1);
    return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${fs.readFileSync(file).toString('base64')}`;
  }

  /**
   * Store an image. kind "post" → 1080x1350 JPEG (cropped to 4:5);
   * kind "ref" → reference/logo, kept whole (max 1024px, PNG keeps transparency).
   */
  async save(buffer, kind = 'post', aspect = ASPECT) {
    let ext = 'jpg';
    let out = buffer;
    if (sharp && kind === 'media') {
      // Exact frame of the medium (a story is always 9:16, a cover 21:9…), long side up to 2048px.
      const [aw, ah] = String(aspect).split(':').map(Number);
      const w = aw >= ah ? 2048 : Math.round(2048 * aw / ah);
      const h = aw >= ah ? Math.round(2048 * ah / aw) : 2048;
      out = await sharp(buffer).rotate().resize(w, h, { fit: 'cover', position: 'attention' }).jpeg({ quality: 92 }).toBuffer();
    } else if (sharp && kind === 'ref') {
      const meta = await sharp(buffer).metadata();
      const png = !!meta.hasAlpha;
      const img = sharp(buffer).rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true });
      out = png ? await img.png().toBuffer() : await img.jpeg({ quality: 90 }).toBuffer();
      ext = png ? 'png' : 'jpg';
    } else if (sharp) {
      out = await sharp(buffer).rotate().resize(POST_W, POST_H, { fit: 'cover', position: 'attention' }).jpeg({ quality: 90 }).toBuffer();
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

  /**
   * One image from one provider. images = data URLs given to the model as input
   * (for editing: the image to edit first; then logo / design references).
   */
  async viaProvider(p, prompt, images = [], model = null, aspect = ASPECT) {
    const custom = storageService.getSettings().marketing?.image_model;
    model = model || (custom && String(custom).trim()) || DEFAULT_MODELS[p.type];
    if (p.type === 'gemini') {
      const parts = [{ text: prompt }, ...images.map(u => ({ inline_data: { mime_type: u.slice(5, u.indexOf(';')), data: u.split(',')[1] } }))];
      const res = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${p.key}`, {
        contents: [{ parts }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: aspect } }
      }, { timeout: 150000 });
      for (const part of res.data?.candidates?.[0]?.content?.parts || []) {
        const data = part.inlineData?.data || part.inline_data?.data;
        if (data) return Buffer.from(data, 'base64');
      }
      throw new Error('Gemini returned no image');
    }
    if (p.type === 'openai') {
      const res = await axios.post('https://api.openai.com/v1/images/generations', { model, prompt, size: aspect === '1:1' ? '1024x1024' : (Number(aspect.split(':')[0]) > Number(aspect.split(':')[1]) ? '1536x1024' : '1024x1536'), n: 1 }, {
        headers: { Authorization: `Bearer ${p.key}` }, timeout: 120000
      });
      const d = res.data?.data?.[0] || {};
      if (d.b64_json) return Buffer.from(d.b64_json, 'base64');
      if (d.url) return Buffer.from((await axios.get(d.url, { responseType: 'arraybuffer', timeout: 60000 })).data);
      throw new Error('OpenAI returned no image');
    }
    if (p.type === 'openrouter') {
      const content = images.length
        ? [{ type: 'text', text: prompt }, ...images.map(u => ({ type: 'image_url', image_url: { url: u } }))]
        : prompt;
      const messages = [{ role: 'user', content }];
      const post = (b) => axios.post('https://openrouter.ai/api/v1/chat/completions', b, { headers: { Authorization: `Bearer ${p.key}` }, timeout: 180000 });
      let res;
      try {
        res = await post({ model, messages, modalities: ['image', 'text'], image_config: { aspect_ratio: aspect, image_size: '2K' } });
      } catch (e) {
        // A provider that rejects an option still gets the request, without it.
        if (e.response?.status !== 400) throw e;
        res = await post({ model, messages, modalities: ['image', 'text'], image_config: { aspect_ratio: aspect } })
          .catch(() => post({ model, messages, modalities: ['image', 'text'] }));
      }
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
      params: { width: POST_W, height: POST_H, nologo: 'true', seed: Math.floor(Math.random() * 1e9) },
      responseType: 'arraybuffer', timeout: 120000
    });
    const buf = Buffer.from(res.data);
    if (buf.length < 5000) throw new Error('Pollinations returned no image');
    return buf;
  }

  /** (provider, model) pairs to try, best first. A pair that just failed is skipped for 10 minutes. */
  attempts() {
    const custom = String(storageService.getSettings().marketing?.image_model || '').trim();
    this._bad = this._bad || new Map();
    const out = [];
    for (const p of aiService.getProviders().filter(x => DEFAULT_MODELS[x.type])) {
      const models = p.type === 'openrouter' ? [...new Set([custom, ...OPENROUTER_CHAIN].filter(Boolean))] : [custom || DEFAULT_MODELS[p.type]];
      for (const model of models) out.push({ p, model });
    }
    return out.filter(a => Date.now() - (this._bad.get(`${a.p.key}|${a.model}`) || 0) > 10 * 60 * 1000);
  }

  /** A person pressed a button (e.g. after topping up credit): try every model again now. */
  resetCooldown() {
    this._bad = new Map();
    this._lastReason = null;
  }

  label(a) {
    const names = { 'google/gemini-3-pro-image': 'Nano Banana Pro', 'google/gemini-nano-banana-2.1': 'Nano Banana 2.1', 'google/gemini-3.1-flash-image': 'Nano Banana 2' };
    return names[a.model] || `${a.p.label} (${a.model})`;
  }

  /**
   * One image from a prompt. images = data URLs of the logo / design references
   * (for an edit, the image being edited comes first).
   * Returns { file, engine } or throws with the last error.
   */
  async generate(prompt, images = [], { allowFree = true, aspect = ASPECT, kind = 'post' } = {}) {
    const list = this.attempts();
    // Every model is resting after a recent failure → say why (e.g. no credit), not "no key".
    let lastErr = new Error(!list.length && this._lastReason ? this._lastReason : 'لا يوجد مفتاح AI يدعم توليد الصور (Gemini / OpenAI / OpenRouter)');
    for (const a of list) {
      if (images.length && a.p.type === 'openai' && !allowFree) continue; // can't edit through this endpoint
      try {
        const refs = a.p.type === 'openai' ? [] : images;
        return { file: await this.save(await this.viaProvider(a.p, prompt, refs, a.model, aspect), kind, aspect), engine: this.label(a) };
      } catch (e) {
        const reason = errMsg(e);
        lastErr = new Error(/credit|insufficient|payment|402/i.test(reason + (e.response?.status || ''))
          ? 'رصيد OpenRouter خلص — اشحن من openrouter.ai ← Credits وبعدين اضغط «كمّل الناقص».'
          : `${this.label(a)}: ${reason}`);
        this._lastReason = lastErr.message;
        this._bad.set(`${a.p.key}|${a.model}`, Date.now());
        console.error('[Images]', lastErr.message);
      }
    }
    if (allowFree && storageService.getSettings().marketing?.free_image_fallback !== false) {
      try {
        return { file: await this.save(await this.viaPollinations(prompt), kind, aspect), engine: 'Pollinations (مجاني)' };
      } catch (e) {
        const busy = /402|429/.test(e.message) ? 'مضغوط حالياً' : e.message;
        lastErr = new Error(`${lastErr.message} — والمولّد المجاني ${busy}. للحصول على صور مضمونة: حط مفتاح Gemini أو OpenAI بالإعدادات.`);
      }
    }
    throw lastErr;
  }

  /**
   * Edit an existing image by instruction ("make the title bigger", "use our blue").
   * The image itself goes first, then the logo / references. Returns { file, engine }.
   * Editing needs a model that reads images, so the free generator is never used here.
   */
  async edit(fileName, prompt, refs = [], { aspect = ASPECT, kind = 'post' } = {}) {
    const src = this.dataUrl(fileName) || (await this.ensureLocal(fileName) && this.dataUrl(fileName));
    if (!src) throw new Error('الصورة الأصلية مش موجودة');
    return this.generate(prompt, [src, ...refs], { allowFree: false, aspect, kind });
  }

  /** Several images in parallel; failures are returned as { error } so the rest still show. */
  async generateMany(prompts, images = []) {
    return Promise.all(prompts.map(async (p) => {
      try {
        const r = await this.generate(p.prompt, images);
        return { ...p, ...r };
      } catch (e) {
        return { ...p, error: e.message };
      }
    }));
  }
}

module.exports = new ImageService();
