/**
 * Market research for the post planner. Everything here uses official / public sources:
 *  - Competitors: Instagram Business Discovery (public posts + engagement of other business accounts).
 *  - Our own posts: what worked, and at which hours (Facebook Page + Instagram).
 *  - Customers: what people actually ask the bot about (inbox + comments).
 *  - News: Google News headlines for the configured keywords.
 * Each source fails on its own — a missing permission never blocks the rest.
 */
const axios = require('axios');
const storageService = require('./storageService');
const businessHours = require('./businessHours');

const GRAPH = 'https://graph.facebook.com/v21.0';
const CACHE_HOURS = 4;
const errMsg = (e) => e.response?.data?.error?.message || e.message;
const meta = () => storageService.getSettings().meta || {};
const mk = () => storageService.getSettings().marketing || {};
const toList = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,\n]+/)).map(x => String(x).trim()).filter(Boolean);
const cleanUser = (u) => String(u).trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/[/?].*$/, '');

const DEFAULT_KEYWORDS = ['أتمتة المبيعات', 'الذكاء الاصطناعي للشركات', 'التسويق الرقمي'];

// Typical high-engagement hours for a business audience in Jordan / the Levant (local time).
// weekday: 0 = Sunday. Friday & Saturday are the weekend.
const BASE_HOURS = {
  work: [{ h: 9, why: 'بداية الدوام — الناس بتفتح السوشال أول ما توصل' }, { h: 13, why: 'استراحة الغدا' }, { h: 20, why: 'ذروة المسا بعد الدوام' }],
  fri: [{ h: 14, why: 'بعد صلاة الجمعة والغدا' }, { h: 18, why: 'عصر الجمعة — تصفح مرتاح' }, { h: 21, why: 'سهرة الجمعة' }],
  sat: [{ h: 11, why: 'صباح السبت المتأخر' }, { h: 17, why: 'عصر السبت' }, { h: 21, why: 'سهرة قبل بداية الأسبوع' }]
};

class MarketResearch {
  competitors() { return [...new Set(toList(mk().competitors).map(cleanUser).filter(Boolean))].slice(0, 8); }
  keywords() { const k = toList(mk().keywords); return (k.length ? k : DEFAULT_KEYWORDS).slice(0, 4); }

  /** Public profile + recent posts of another Instagram business/creator account. */
  async fetchCompetitor(username) {
    const cfg = meta();
    if (!cfg.page_access_token || !cfg.instagram_account_id) {
      return { username, error: 'لازم ربط حساب إنستغرام أعمال (بطاقة Meta بالإعدادات) عشان نقرأ حسابات المنافسين.' };
    }
    try {
      const fields = `business_discovery.username(${username}){username,name,followers_count,media_count,media.limit(15){caption,like_count,comments_count,timestamp,permalink,media_type}}`;
      const res = await axios.get(`${GRAPH}/${cfg.instagram_account_id}`, { params: { fields, access_token: cfg.page_access_token }, timeout: 20000 });
      const bd = res.data?.business_discovery || {};
      const posts = (bd.media?.data || []).map(p => ({
        caption: String(p.caption || '').slice(0, 600),
        likes: p.like_count || 0,
        comments: p.comments_count || 0,
        engagement: (p.like_count || 0) + (p.comments_count || 0) * 3, // a comment is worth more than a like
        timestamp: p.timestamp,
        permalink: p.permalink,
        type: p.media_type
      }));
      const avg = posts.length ? Math.round(posts.reduce((s, p) => s + p.engagement, 0) / posts.length) : 0;
      return {
        username: bd.username || username,
        name: bd.name || username,
        followers: bd.followers_count || 0,
        media_count: bd.media_count || 0,
        avg_engagement: avg,
        posts: posts.sort((a, b) => b.engagement - a.engagement)
      };
    } catch (e) {
      const m = errMsg(e);
      return { username, error: /cannot be found|does not exist|Invalid user/i.test(m) ? 'الحساب مش موجود أو مش حساب أعمال/صانع محتوى (الحسابات الشخصية ما بتنقرأ).' : m };
    }
  }

  /** Our own recent posts with engagement (used for "what worked" and best hours). */
  async fetchOwnPosts() {
    const cfg = meta();
    const out = [];
    if (!cfg.page_access_token) return out;
    if (cfg.instagram_account_id) {
      try {
        const res = await axios.get(`${GRAPH}/${cfg.instagram_account_id}/media`, {
          params: { fields: 'caption,like_count,comments_count,timestamp,permalink', limit: 40, access_token: cfg.page_access_token }, timeout: 20000
        });
        for (const p of res.data?.data || []) {
          out.push({ platform: 'instagram', text: String(p.caption || '').slice(0, 300), engagement: (p.like_count || 0) + (p.comments_count || 0) * 3, timestamp: p.timestamp, permalink: p.permalink });
        }
      } catch (e) { console.warn('[Research] own IG posts:', errMsg(e)); }
    }
    if (cfg.page_id) {
      try {
        const res = await axios.get(`${GRAPH}/${cfg.page_id}/posts`, {
          params: { fields: 'message,created_time,permalink_url,likes.summary(true).limit(0),comments.summary(true).limit(0)', limit: 40, access_token: cfg.page_access_token }, timeout: 20000
        });
        for (const p of res.data?.data || []) {
          out.push({
            platform: 'facebook', text: String(p.message || '').slice(0, 300),
            engagement: (p.likes?.summary?.total_count || 0) + (p.comments?.summary?.total_count || 0) * 3,
            timestamp: p.created_time, permalink: p.permalink_url
          });
        }
      } catch (e) { console.warn('[Research] own FB posts:', errMsg(e)); }
    }
    return out;
  }

  /** Fresh headlines for the configured keywords (Google News RSS — no key needed). */
  async fetchNews() {
    const items = [];
    for (const kw of this.keywords().slice(0, 3)) {
      try {
        const res = await axios.get('https://news.google.com/rss/search', {
          params: { q: `${kw} when:7d`, hl: 'ar', gl: 'JO', ceid: 'JO:ar' }, timeout: 12000, responseType: 'text'
        });
        const matches = String(res.data).match(/<item>[\s\S]*?<\/item>/g) || [];
        for (const it of matches.slice(0, 4)) {
          const title = (it.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
          const clean = title.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
          if (clean) items.push({ keyword: kw, title: clean.slice(0, 180) });
        }
      } catch (e) { console.warn(`[Research] news "${kw}":`, e.message); }
    }
    return items;
  }

  /** What real customers ask about — the best source of post ideas. No names, only topics. */
  customerSignals() {
    const real = (c) => !String(c.channel || '').startsWith('simulator') && !String(c.id || '').startsWith('conv_demo_');
    const convs = storageService.getConversations().filter(real).slice(0, 80);
    const pick = (field) => [...new Set(convs.map(c => String(c[field] || '').trim()).filter(Boolean))].slice(0, 15).map(s => s.slice(0, 140));
    const comments = storageService.getComments().filter(c => !c.simulated && c.is_interested).slice(0, 20).map(c => String(c.comment_text || '').slice(0, 120));
    return {
      problems: pick('identified_problem'),
      requests: pick('customer_requests'),
      objections: pick('objections'),
      business_types: pick('business_type'),
      comments
    };
  }

  /** All research, cached for a few hours (refresh = true forces a new fetch). */
  async gather({ refresh = false } = {}) {
    const cached = storageService.getState('marketing_research');
    const key = JSON.stringify([this.competitors(), this.keywords()]);
    if (!refresh && cached && cached.key === key && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_HOURS * 3600 * 1000) {
      return { ...cached, customers: this.customerSignals() };
    }
    const [competitors, ownPosts, news] = await Promise.all([
      Promise.all(this.competitors().map(u => this.fetchCompetitor(u))),
      this.fetchOwnPosts(),
      this.fetchNews()
    ]);
    const research = { key, fetched_at: new Date().toISOString(), competitors, own_posts: ownPosts, news };
    storageService.setState('marketing_research', research);
    return { ...research, customers: this.customerSignals() };
  }

  /** Compact text version for the AI prompt. */
  toPromptText(r) {
    const lines = [];
    const comp = (r.competitors || []).filter(c => !c.error);
    if (comp.length) {
      lines.push('## المنافسون (أعلى منشوراتهم تفاعلاً على إنستغرام)');
      for (const c of comp) {
        lines.push(`- @${c.username} (${c.followers} متابع، متوسط التفاعل ${c.avg_engagement}):`);
        for (const p of c.posts.slice(0, 4)) lines.push(`   • [${p.likes} لايك، ${p.comments} تعليق] ${p.caption.replace(/\s+/g, ' ').slice(0, 220)}`);
      }
    }
    const own = [...(r.own_posts || [])].sort((a, b) => b.engagement - a.engagement).slice(0, 5);
    if (own.length) {
      lines.push('## أنجح منشوراتنا السابقة');
      for (const p of own) lines.push(`- [تفاعل ${p.engagement}] ${p.text.replace(/\s+/g, ' ').slice(0, 180)}`);
    }
    const cs = r.customers || {};
    if (cs.problems?.length || cs.requests?.length || cs.comments?.length) {
      lines.push('## شو بيسألوا العملاء فعلياً (من محادثات البوت والتعليقات)');
      if (cs.business_types?.length) lines.push(`- مجالات العملاء: ${cs.business_types.join('، ')}`);
      if (cs.problems?.length) lines.push(`- مشاكلهم: ${cs.problems.join(' | ')}`);
      if (cs.requests?.length) lines.push(`- طلباتهم: ${cs.requests.join(' | ')}`);
      if (cs.objections?.length) lines.push(`- اعتراضاتهم/ترددهم: ${cs.objections.join(' | ')}`);
      if (cs.comments?.length) lines.push(`- تعليقات مهتمة: ${cs.comments.join(' | ')}`);
    }
    if (r.news?.length) {
      lines.push('## عناوين أخبار هذا الأسبوع بالمجال');
      for (const n of r.news.slice(0, 10)) lines.push(`- ${n.title}`);
    }
    return lines.join('\n') || 'لا توجد بيانات سوق متاحة حالياً — اعتمد على معرفتك بالمجال وبالسوق الأردني/العربي.';
  }

  /**
   * The best posting slots from now on (today first, then tomorrow).
   * Starts from typical regional hours and promotes the hours where OUR posts did best.
   */
  bestTimes(ownPosts = [], count = 3, from = new Date()) {
    const tz = businessHours.getConfig().timezone;
    // Average engagement per local hour from our own posts (needs a few posts to mean anything).
    const byHour = {};
    for (const p of ownPosts) {
      if (!p.timestamp) continue;
      const h = businessHours.localParts(new Date(p.timestamp), tz).hour;
      (byHour[h] = byHour[h] || []).push(p.engagement || 0);
    }
    const ownHours = ownPosts.length >= 8
      ? Object.entries(byHour).filter(([, v]) => v.length >= 2)
        .map(([h, v]) => ({ h: Number(h), avg: v.reduce((s, x) => s + x, 0) / v.length }))
        .sort((a, b) => b.avg - a.avg).slice(0, 2).filter(x => x.avg > 0)
      : [];

    const now = businessHours.localParts(from, tz);
    const slots = [];
    for (let offset = 0; offset <= 2 && slots.length < count; offset++) {
      const weekday = (now.weekday + offset) % 7;
      const base = weekday === 5 ? BASE_HOURS.fri : weekday === 6 ? BASE_HOURS.sat : BASE_HOURS.work;
      const day = [
        ...ownHours.filter(o => o.h >= 7 && o.h <= 23).map(o => ({ h: o.h, why: 'أعلى تفاعل على منشوراتكم السابقة بهالساعة 📈', own: true })),
        ...base
      ].filter((s, i, arr) => arr.findIndex(x => Math.abs(x.h - s.h) < 2) === i) // no two slots within 2 hours
        .sort((a, b) => a.h - b.h);
      for (const s of day) {
        const minutesUntil = offset * 1440 + s.h * 60 - now.minutes;
        if (minutesUntil < 20) continue; // already passed (or too close)
        const date = new Date(from.getTime() + minutesUntil * 60000);
        date.setSeconds(0, 0);
        const hh = String(s.h).padStart(2, '0');
        slots.push({
          iso: date.toISOString(),
          label: `${offset === 0 ? 'اليوم' : offset === 1 ? 'بكرا' : `يوم ${businessHours.DAY_NAMES[weekday]}`} الساعة ${hh}:00`,
          reason: s.why,
          from_own_data: !!s.own
        });
        if (slots.length >= count) break;
      }
    }
    return slots;
  }
}

module.exports = new MarketResearch();
