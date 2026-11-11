/**
 * Background jobs — runs every minute:
 *  1. Send staff emails that were held outside working hours.
 *  2. Send (at most one) follow-up to a quiet interested customer.
 *  3. Daily report at the configured time.
 *  4. Daily backup.
 */
const storageService = require('./storageService');
const supabaseService = require('./supabaseService');
const notificationService = require('./notificationService');
const followUpService = require('./followUpService');
const reportService = require('./reportService');
const backupService = require('./backupService');

// Which sender to use for a conversation's channel.
function getAdapter(conv) {
  if (!conv) return null;
  if (conv.channel === 'whatsapp') return require('./whatsappService').getAdapter();
  if (conv.channel === 'instagram_dm' || conv.channel === 'facebook_messenger') return require('./metaService').getAdapter(conv.channel);
  return null;
}

class SchedulerService {
  constructor() {
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 60 * 1000);
    setTimeout(() => this.tick(), 30 * 1000);
    console.log('[Scheduler] Started (follow-ups, daily report, backups, queued emails).');
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    const step = async (name, fn) => {
      try { await fn(); } catch (err) { console.error(`[Scheduler] ${name} error:`, err.message); }
    };
    await step('email queue', () => notificationService.flushQueue(async (item) => {
      if (item.type !== 'handoff' || !item.conversationId) return;
      const conv = storageService.saveConversation({ id: item.conversationId, human_notified_at: new Date().toISOString() });
      if (conv) {
        await supabaseService.saveConversation(conv);
        await require('./crmService').upsertLead(conv);
      }
    }));
    await step('supabase sync', () => require('./supabaseSync').tick());
    await step('sheets retry', () => this.retryUnsyncedLeads());
    await step('follow-up', () => followUpService.runOnce(getAdapter));
    await step('daily report', () => reportService.maybeSend());
    await step('backup', () => backupService.maybeRun());
    this.running = false;
  }

  /**
   * Every 10 minutes: customers that never reached Google Sheets / Form (e.g. they
   * came in before the sheet was connected, or Google was down) are sent again.
   * At most 5 per run to stay inside Google's write quota.
   */
  async retryUnsyncedLeads() {
    const now = Date.now();
    if (this._lastSheetsRetry && now - this._lastSheetsRetry < 10 * 60 * 1000) return;
    this._lastSheetsRetry = now;
    const sheets = require('./googleSheetsService');
    if (!sheets.isConfigured()) return;
    const cfg = storageService.getSettings().google_sheets || {};
    const formOn = !!(cfg.form_url && cfg.form_auto_sync !== false);
    const sheetOn = !!(sheets.getApiConfig() || cfg.webhook_url);
    const pending = storageService.getLeads().filter(l =>
      !String(l.channel || '').startsWith('simulator') &&
      ((sheetOn && !l.google_sheet_synced) || (formOn && !l.google_form_fp))
    ).slice(0, 5);
    for (const lead of pending) {
      // Not "_manual": the Form's change-detection still applies, so no duplicate rows.
      const r = await sheets.syncLead(lead);
      console.log(`[Scheduler] sheets retry ${lead.id}: ${r.success ? 'ok' : r.message}`);
    }
  }
}

const scheduler = new SchedulerService();
scheduler.getAdapter = getAdapter;
module.exports = scheduler;
