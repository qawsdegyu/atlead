/**
 * Comment keyword rules (the "comment a word, get it in your DM" flow).
 *
 * A rule watches comments on chosen reels/posts (or all of them). When a comment contains
 * one of its keywords, the bot:
 *   1. replies under the comment with a fixed public reply (one of its variants), and
 *   2. sends ONE private reply (DM) with the owner's text + link + file + the free
 *      consultation form link.
 * Meta allows a single private reply per comment, so everything goes in that one message.
 * A matching rule replaces the AI comment analysis for that comment.
 */
const crypto = require('crypto');
const axios = require('axios');
const storageService = require('./storageService');

const GRAPH = 'https://graph.facebook.com/v21.0';

// Arabic/English text in a comparable form: lower case, no diacritics/tatweel, unified alef/yaa/taa.
function norm(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const DEFAULT_RULE = () => ({
  id: 'rule_atlead',
  name: 'Atlead — free consultation',
  enabled: true,
  platforms: ['instagram', 'facebook'],
  media_ids: [], // empty = every reel and post
  keywords: ['atlead', 'اتليد', 'أتليد'],
  match: 'contains',
  public_replies: [
    'أرسلنا لك التفاصيل على الخاص.',
    'تفقد رسائلك، أرسلنا لك رابط الاستشارة المجانية.',
    'وصلتك رسالة على الخاص فيها كل التفاصيل.'
  ],
  dm_text: 'أهلاً! شكراً لتعليقك. هذا نموذج الاستشارة المجانية، عبّيه خلال دقيقة وفريقنا بتواصل معك:',
  link_url: '',
  link_label: '',
  file_url: '',
  file_name: '',
  send_form: true,
  stats: { triggered: 0, last_at: null },
  created_at: new Date().toISOString()
});

class CommentRules {
  list() {
    const saved = storageService.getSettings().comment_rules;
    if (!Array.isArray(saved)) {
      // First run: the Atlead → consultation form flow is ready out of the box.
      const seeded = [DEFAULT_RULE()];
      storageService.updateSettings({ comment_rules: seeded });
      return seeded;
    }
    return saved;
  }

  get(id) { return this.list().find(r => r.id === id) || null; }

  clean(input = {}, existing = {}) {
    const words = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,،\n]/)).map(s => String(s).trim()).filter(Boolean);
    const platforms = words(input.platforms ?? existing.platforms ?? ['instagram', 'facebook']).filter(p => ['instagram', 'facebook'].includes(p));
    const rule = {
      ...existing,
      id: existing.id || input.id || `rule_${crypto.randomBytes(5).toString('hex')}`,
      name: String(input.name ?? existing.name ?? '').trim().slice(0, 80),
      enabled: input.enabled === undefined ? existing.enabled !== false : !!input.enabled,
      platforms: platforms.length ? platforms : ['instagram', 'facebook'],
      media_ids: words(input.media_ids ?? existing.media_ids ?? []),
      keywords: [...new Set(words(input.keywords ?? existing.keywords ?? []))].slice(0, 30),
      match: (input.match ?? existing.match) === 'exact' ? 'exact' : 'contains',
      public_replies: words(input.public_replies ?? existing.public_replies ?? []).slice(0, 10),
      dm_text: String(input.dm_text ?? existing.dm_text ?? '').trim().slice(0, 900),
      link_url: String(input.link_url ?? existing.link_url ?? '').trim().slice(0, 500),
      link_label: String(input.link_label ?? existing.link_label ?? '').trim().slice(0, 80),
      file_url: String(input.file_url ?? existing.file_url ?? '').trim().slice(0, 500),
      file_name: String(input.file_name ?? existing.file_name ?? '').trim().slice(0, 120),
      send_form: input.send_form === undefined ? !!existing.send_form : !!input.send_form,
      stats: existing.stats || { triggered: 0, last_at: null },
      created_at: existing.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    if (rule.link_url && !/^https?:\/\//i.test(rule.link_url)) rule.link_url = `https://${rule.link_url}`;
    if (!rule.name) rule.name = rule.keywords[0] ? `"${rule.keywords[0]}"` : 'Rule';
    return rule;
  }

  save(input) {
    const list = this.list();
    const existing = input.id ? list.find(r => r.id === input.id) : null;
    const rule = this.clean(input, existing || {});
    if (!rule.keywords.length) throw new Error('أضف كلمة مفتاحية واحدة على الأقل.');
    if (!rule.dm_text && !rule.link_url && !rule.file_url && !rule.send_form) throw new Error('أضف رسالة أو رابط أو ملف أو نموذج الاستشارة لإرساله على الخاص.');
    const next = existing ? list.map(r => (r.id === rule.id ? rule : r)) : [rule, ...list];
    storageService.updateSettings({ comment_rules: next });
    return rule;
  }

  remove(id) {
    const list = this.list();
    const next = list.filter(r => r.id !== id);
    storageService.updateSettings({ comment_rules: next });
    return next.length !== list.length;
  }

  /** Does this media id belong to the rule? FB comment webhooks send "pageid_postid". */
  coversMedia(rule, postId) {
    if (!rule.media_ids?.length) return true;
    const id = String(postId || '');
    return rule.media_ids.some(m => m === id || id.endsWith(`_${m}`) || String(m).endsWith(`_${id}`));
  }

  keywordIn(rule, text) {
    const t = norm(text);
    if (!t) return null;
    for (const kw of rule.keywords || []) {
      const k = norm(kw);
      if (!k) continue;
      if (rule.match === 'exact') { if (t === k) return kw; continue; }
      if ((` ${t} `).includes(` ${k} `) || (k.length >= 4 && t.includes(k))) return kw;
      // A keyword of several words also matches when all its words are in the comment, in any order.
      const words = k.split(' ');
      if (words.length > 1) {
        const have = new Set(t.split(' '));
        if (words.every(w => have.has(w) || (w.length >= 4 && t.includes(w)))) return kw;
      }
    }
    return null;
  }

  /** The first enabled rule that fires for this comment (specific reels win over "all posts"). */
  match({ platform, post_id, text, anyMedia = false }) {
    const rules = this.list().filter(r => r.enabled !== false && (r.platforms || []).includes(platform));
    const ordered = [...rules.filter(r => r.media_ids?.length), ...rules.filter(r => !r.media_ids?.length)];
    for (const rule of ordered) {
      if (!anyMedia && !this.coversMedia(rule, post_id)) continue;
      const keyword = this.keywordIn(rule, text);
      if (keyword) return { rule, keyword };
    }
    return null;
  }

  publicBase() {
    let base = '';
    try { base = require('./socialPublisher').publicBaseUrl(); } catch { /* optional */ }
    if (!base) base = require('./notificationService').getConfig().dashboardUrl || `http://localhost:${process.env.PORT || 3000}`;
    return base.replace(/\/+$/, '');
  }

  absolute(url) {
    if (!url) return '';
    return /^https?:\/\//i.test(url) ? url : `${this.publicBase()}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  formUrl(ref = '', lang = '') {
    const q = new URLSearchParams();
    if (ref) q.set('ref', ref);
    if (lang) q.set('lang', lang);
    const qs = q.toString();
    return `${this.publicBase()}/consult${qs ? `?${qs}` : ''}`;
  }

  publicReply(rule) {
    const options = (rule.public_replies || []).filter(Boolean);
    return options.length ? options[Math.floor(Math.random() * options.length)] : '';
  }

  /** The single private-reply message: text, link, file and the consultation form. */
  dmText(rule, { commentId = '' } = {}) {
    const lines = [];
    if (rule.dm_text) lines.push(rule.dm_text);
    if (rule.send_form) lines.push(this.formUrl(commentId));
    if (rule.link_url) lines.push(rule.link_label ? `${rule.link_label}: ${rule.link_url}` : rule.link_url);
    if (rule.file_url) lines.push(rule.file_name ? `${rule.file_name}: ${this.absolute(rule.file_url)}` : this.absolute(rule.file_url));
    return lines.join('\n\n').slice(0, 1900);
  }

  recordHit(ruleId) {
    const list = this.list().map(r => (r.id === ruleId
      ? { ...r, stats: { triggered: (r.stats?.triggered || 0) + 1, last_at: new Date().toISOString() } }
      : r));
    storageService.updateSettings({ comment_rules: list });
  }

  /** Dry run for the dashboard: which rule fires and exactly what is sent. */
  test({ platform = 'instagram', post_id = '', text = '' }) {
    // No reel chosen in the tester: try every rule, including reel-specific ones.
    const hit = this.match({ platform, post_id, text, anyMedia: !post_id });
    if (!hit) return { matched: false };
    return { matched: true, rule_id: hit.rule.id, rule_name: hit.rule.name, reel_only: !!hit.rule.media_ids?.length, keyword: hit.keyword, public_reply: this.publicReply(hit.rule), dm: this.dmText(hit.rule, { commentId: 'preview' }) };
  }

  /** The account's reels/videos (Facebook) and reels/posts (Instagram). */
  async media({ platform = 'all', reelsOnly = false } = {}) {
    const meta = require('./metaService');
    await meta.ensureOwnIds();
    const cfg = meta.config();
    const token = cfg.page_access_token;
    if (!token) return { connected: false, items: [], errors: ['فيسبوك/إنستغرام غير مربوط. اربط الحساب من الإعدادات أولاً.'] };
    const items = [];
    const errors = [];
    const get = (url, params) => axios.get(url, { params: { access_token: token, ...params }, timeout: 20000 }).then(r => r.data);
    // Every page of results (Graph returns 25–50 at a time), up to `max` items.
    const all = async (url, params, max = 300) => {
      const out = [];
      let data = await get(url, params);
      for (;;) {
        out.push(...(data.data || []));
        const next = data.paging?.next;
        if (!next || out.length >= max) break;
        data = await axios.get(next, { timeout: 20000 }).then(r => r.data);
      }
      return out.slice(0, max);
    };

    if (platform !== 'facebook' && cfg.instagram_account_id) {
      try {
        const list = await all(`${GRAPH}/${cfg.instagram_account_id}/media`, {
          fields: 'id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,comments_count,like_count',
          limit: 50
        });
        for (const m of list) {
          const isReel = m.media_product_type === 'REELS' || m.media_type === 'VIDEO';
          if (reelsOnly && !isReel) continue;
          items.push({
            id: m.id, ids: [m.id], platform: 'instagram', kind: isReel ? 'reel' : 'post',
            caption: m.caption || '', permalink: m.permalink || '',
            thumbnail: m.thumbnail_url || m.media_url || '',
            created_at: m.timestamp, comments: m.comments_count ?? null, likes: m.like_count ?? null
          });
        }
      } catch (e) {
        errors.push(`Instagram: ${e.response?.data?.error?.message || e.message}`);
      }
    } else if (platform === 'instagram') {
      errors.push('لا يوجد حساب إنستغرام تجاري مربوط بالصفحة.');
    }

    if (platform !== 'instagram' && cfg.page_id) {
      const fbLink = (u) => (!u ? '' : /^https?:/.test(u) ? u : `https://www.facebook.com${u.startsWith('/') ? '' : '/'}${u}`);
      const videos = new Map();
      try {
        const list = await all(`${GRAPH}/${cfg.page_id}/videos`, {
          fields: 'id,description,permalink_url,picture,created_time,comments.limit(0).summary(true)',
          limit: 50
        });
        for (const v of list) {
          const item = {
            id: v.id, ids: [v.id], platform: 'facebook', kind: 'reel',
            caption: v.description || '', permalink: fbLink(v.permalink_url),
            thumbnail: v.picture || '', created_at: v.created_time, comments: v.comments?.summary?.total_count ?? null, likes: null
          };
          videos.set(v.id, item);
          items.push(item);
        }
      } catch (e) {
        errors.push(`Facebook (videos): ${e.response?.data?.error?.message || e.message}`);
      }
      try {
        const posts = await all(`${GRAPH}/${cfg.page_id}/published_posts`, {
          fields: 'id,message,permalink_url,full_picture,created_time,attachments{media_type,target{id}},comments.limit(0).summary(true)',
          limit: 50
        });
        for (const p of posts) {
          // A reel/video also appears as a post: merge them, so comments on either id match its rules.
          const targetId = p.attachments?.data?.[0]?.target?.id;
          const video = targetId && videos.get(targetId);
          if (video) {
            video.ids.push(p.id);
            if (video.comments == null) video.comments = p.comments?.summary?.total_count ?? null;
            continue;
          }
          const isVideo = /video/i.test(p.attachments?.data?.[0]?.media_type || '');
          if (reelsOnly && !isVideo) continue;
          items.push({
            id: p.id, ids: [p.id], platform: 'facebook', kind: isVideo ? 'reel' : 'post',
            caption: p.message || '', permalink: p.permalink_url || '', thumbnail: p.full_picture || '',
            created_at: p.created_time, comments: p.comments?.summary?.total_count ?? null, likes: null
          });
        }
      } catch (e) {
        errors.push(`Facebook (posts): ${e.response?.data?.error?.message || e.message}`);
      }
    }

    items.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    // How many comments on each item triggered a rule (from our own records).
    const hits = {};
    for (const c of storageService.getComments()) {
      if (c.rule_id && c.post_id) hits[c.post_id] = (hits[c.post_id] || 0) + 1;
    }
    for (const it of items) {
      it.rule_hits = Object.entries(hits).reduce((n, [pid, k]) => (it.ids.some(id => pid === id || pid.endsWith(`_${id}`)) ? n + k : n), 0);
    }
    return { connected: true, items, errors };
  }
}

module.exports = new CommentRules();
module.exports.norm = norm;
