/**
 * Supabase sync — makes sure EVERY conversation, message, customer (lead) and
 * comment ends up in Supabase, no matter which part of the code changed it.
 *
 *  - The storage layer reports every change here; changes are batched (2s) and
 *    written to Supabase in order.
 *  - Messages are append-only: we remember how many messages of each conversation
 *    are already in Supabase and only send the new ones (in batches).
 *  - If Supabase is down, nothing is lost: the item stays "dirty" and is retried
 *    every minute, plus a full check every 10 minutes.
 *  - Data saved before Supabase was connected is backfilled automatically.
 */
const storageService = require('./storageService');
const supabaseService = require('./supabaseService');

const FLUSH_DELAY_MS = 2000;
const FULL_SYNC_EVERY_MS = 10 * 60 * 1000;

class SupabaseSync {
  constructor() {
    this.dirty = { conversation: new Set(), lead: new Set(), comment: new Set() };
    this.timer = null;
    this.flushing = null;
    this.lastFullSync = null;
    this.lastError = null;
    this.lastStats = null;
    storageService.setChangeListener((type, id) => this.markDirty(type, id));
  }

  enabled() {
    return supabaseService.isEnabled();
  }

  markDirty(type, id) {
    if (!id || !this.dirty[type]) return;
    this.dirty[type].add(id);
    if (!this.enabled()) return; // kept dirty → sent once Supabase is connected
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush().catch(() => {}), FLUSH_DELAY_MS);
  }

  pendingCount() {
    return this.dirty.conversation.size + this.dirty.lead.size + this.dirty.comment.size;
  }

  // Per-conversation count of messages already stored in Supabase (persisted).
  _state() {
    const target = supabaseService.currentTarget();
    let st = storageService.getState('sb_sync', null);
    if (!st || st.target !== target) st = { target, msgCounts: {} }; // new database → resend everything
    return st;
  }

  _saveState(st) {
    storageService.setState('sb_sync', st);
  }

  async syncConversation(convId, st = this._state()) {
    const conv = storageService.getConversationById(convId);
    if (!conv) return true;
    const saved = await supabaseService.saveConversation(conv);
    const uuid = saved?.id || null;
    if (!uuid) return false;

    const msgs = conv.messages || [];
    let done = Math.min(Number(st.msgCounts[convId]) || 0, msgs.length);
    if (done < msgs.length) {
      const ok = await supabaseService.saveMessagesBulk(msgs.slice(done), conv, uuid);
      if (!ok) return false;
      done = msgs.length;
    }
    st.msgCounts[convId] = done;
    return true;
  }

  // Write everything that changed. Failed items stay dirty for the next try.
  async flush() {
    if (this.flushing) return this.flushing;
    if (!this.enabled()) return { skipped: true };
    this.flushing = (async () => {
      const st = this._state();
      const take = (set) => { const ids = [...set]; set.clear(); return ids; };
      let failed = 0;

      for (const id of take(this.dirty.conversation)) {
        if (!(await this.syncConversation(id, st))) { this.dirty.conversation.add(id); failed++; }
      }
      this._saveState(st);
      for (const id of take(this.dirty.lead)) {
        const lead = storageService.getLeads().find(l => l.id === id);
        if (lead && !(await supabaseService.saveLead(lead))) { this.dirty.lead.add(id); failed++; }
      }
      for (const id of take(this.dirty.comment)) {
        const c = storageService.getCommentByCommentId(id);
        if (c && !(await supabaseService.saveComment(c))) { this.dirty.comment.add(id); failed++; }
      }
      if (failed) this.lastError = { at: new Date().toISOString(), message: `${failed} عنصر لم يُحفظ — ستُعاد المحاولة تلقائياً` };
      return { failed };
    })();
    try {
      return await this.flushing;
    } finally {
      this.flushing = null;
      // Changes that arrived while flushing get their own run.
      if (this.pendingCount() && this.enabled()) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.flush().catch(() => {}), FLUSH_DELAY_MS);
      }
    }
  }

  /**
   * Check everything: conversations (+ all their unsent messages), leads, comments.
   * Unchanged records are skipped (cheap), so this is safe to run often.
   */
  async fullSync() {
    if (!this.enabled()) return { success: false, message: 'Supabase غير مربوط' };
    if (this.flushing) await this.flushing;
    const started = Date.now();
    const st = this._state();
    const stats = { conversations: 0, messages: 0, leads: 0, comments: 0, failed: 0 };

    for (const conv of storageService.getConversations()) {
      const before = Number(st.msgCounts[conv.id]) || 0;
      if (await this.syncConversation(conv.id, st)) {
        stats.conversations++;
        stats.messages += Math.max(0, (st.msgCounts[conv.id] || 0) - before);
        this.dirty.conversation.delete(conv.id);
      } else {
        stats.failed++;
        this.dirty.conversation.add(conv.id);
      }
    }
    this._saveState(st);
    for (const lead of storageService.getLeads()) {
      if (await supabaseService.saveLead(lead)) { stats.leads++; this.dirty.lead.delete(lead.id); } else { stats.failed++; this.dirty.lead.add(lead.id); }
    }
    for (const c of storageService.getComments()) {
      if (await supabaseService.saveComment(c)) { stats.comments++; this.dirty.comment.delete(c.comment_id); } else { stats.failed++; this.dirty.comment.add(c.comment_id); }
    }

    this.lastFullSync = new Date().toISOString();
    this.lastStats = { ...stats, ms: Date.now() - started };
    this.lastError = stats.failed ? { at: this.lastFullSync, message: `${stats.failed} عنصر ما انحفظ` } : null;
    if (stats.messages || stats.failed) {
      console.log(`[Supabase] Sync: ${stats.conversations} conversations, ${stats.messages} new messages, ${stats.leads} leads, ${stats.comments} comments${stats.failed ? `, ${stats.failed} FAILED (will retry)` : ''}.`);
    }
    return {
      success: stats.failed === 0,
      message: stats.failed
        ? `حُفظت معظم البيانات، وسيُعاد إرسال ${stats.failed} عنصر تلقائياً.`
        : `كل البيانات محفوظة بـ Supabase (${stats.conversations} محادثة، ${stats.messages} رسالة جديدة، ${stats.leads} عميل، ${stats.comments} تعليق)`,
      stats
    };
  }

  // Called every minute by the scheduler.
  async tick() {
    if (!this.enabled()) return;
    if (!this.lastFullSync || Date.now() - new Date(this.lastFullSync).getTime() > FULL_SYNC_EVERY_MS) {
      await this.fullSync();
    } else if (this.pendingCount()) {
      await this.flush();
    }
  }

  async status() {
    const convs = storageService.getConversations();
    const local = {
      conversations: convs.length,
      messages: convs.reduce((n, c) => n + (c.messages?.length || 0), 0),
      leads: storageService.getLeads().length,
      comments: storageService.getComments().length
    };
    const remote = this.enabled() ? await supabaseService.countRows() : null;
    return {
      enabled: this.enabled(),
      target: supabaseService.currentTarget(),
      local,
      remote,
      pending: this.pendingCount(),
      last_full_sync: this.lastFullSync,
      last_stats: this.lastStats,
      last_error: this.lastError
    };
  }
}

module.exports = new SupabaseSync();
