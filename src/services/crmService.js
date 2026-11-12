/**
 * CRM: one lead record per conversation, kept in sync everywhere
 * (local JSON → Supabase `leads` → Google Sheets row), and the human handoff.
 *
 * Handoff rules:
 *  - Triggered when the AI says the customer agreed / asked for a human / is at the
 *    deal point, OR when the buying probability reaches the threshold (default 85%).
 *  - The bot sends the handoff message once, the sales team gets an email (+ Telegram)
 *    with the full customer details, and the customer is marked "waiting for the rep".
 *  - The bot KEEPS answering the customer's questions until a human rep actually
 *    replies (dashboard, phone, Facebook/Instagram inbox) — then it stops for good.
 *    Setting handoff.keep_bot_until_human = false brings back the old behaviour
 *    (bot silent right after the handoff).
 */
const storageService = require('./storageService');
const supabaseService = require('./supabaseService');
const googleSheetsService = require('./googleSheetsService');
const notificationService = require('./notificationService');
const businessHours = require('./businessHours');

const HANDOFF_STAGES = ['deal_closing', 'handed_off'];

// Real phone of a customer. WhatsApp "LID" ids are NOT phone numbers, so never show them as one.
function crmPhone(conv) {
  if (conv.customer_phone) return conv.customer_phone;
  if (conv.channel === 'whatsapp' && !String(conv.wa_jid || '').endsWith('@lid')) {
    return `+${String(conv.external_user_id).replace(/^\+/, '')}`;
  }
  return '';
}

function handoffConfig() {
  const h = storageService.getSettings().handoff || {};
  const keepBotUntilHuman = h.keep_bot_until_human !== false;
  const threshold = Number(h.closing_deal_threshold_percent);
  return {
    threshold: Number.isFinite(threshold) && threshold > 0 ? threshold : 85,
    repName: h.representative_name || 'فريق المبيعات',
    keepBotUntilHuman,
    message: h.handoff_message || 'تمام، {rep} في شركة atlead رح يتواصل معك بأسرع وقت لمتابعة كافة التفاصيل وترتيب كل شيء معك. شكراً لاهتمامك وثقتك.'
  };
}

const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());

// Active sales reps (Settings → فريق المبيعات).
function getTeam() {
  const members = storageService.getSettings().sales_team?.members;
  return (Array.isArray(members) ? members : [])
    .filter(m => m && m.active !== false && m.name && isEmail(m.email))
    .map(m => ({ id: String(m.id || m.email), name: String(m.name).trim(), email: String(m.email).trim().toLowerCase() }));
}

class CrmService {
  shouldHandoff(aiResult) {
    const { threshold } = handoffConfig();
    const prob = Number(aiResult?.buying_probability) || 0;
    return !!aiResult?.handoff_triggered
      || HANDOFF_STAGES.includes(aiResult?.lead_stage)
      || prob >= threshold;
  }

  handoffReason(aiResult) {
    const { threshold } = handoffConfig();
    if (aiResult?.handoff_triggered) return 'العميل وافق / طلب التواصل مع موظف';
    if (HANDOFF_STAGES.includes(aiResult?.lead_stage)) return 'العميل وصل لمرحلة ما قبل الشراء (Deal Closing)';
    return `نسبة الشراء وصلت ${Number(aiResult?.buying_probability) || 0}% (الحد ${threshold}%)`;
  }

  getTeam() {
    return getTeam();
  }

  /**
   * Assign the customer to a sales rep (round-robin over active reps).
   * Keeps the existing rep if they're still active. Returns the rep or null (no team).
   */
  assignRep(convId, forceRepId = null) {
    const conv = storageService.getConversationById(convId);
    if (!conv) return null;
    const team = getTeam();
    if (!team.length) return null;

    let rep = forceRepId ? team.find(m => m.id === forceRepId) : null;
    if (!rep && conv.assigned_to_id) rep = team.find(m => m.id === conv.assigned_to_id) || null;
    if (!rep) {
      const last = Number(storageService.getState('rr_index', -1));
      const next = (Number.isFinite(last) ? last + 1 : 0) % team.length;
      rep = team[next];
      storageService.setState('rr_index', next);
    }
    storageService.saveConversation({ id: conv.id, assigned_to_id: rep.id, assigned_to_name: rep.name, assigned_to_email: rep.email, assigned_at: new Date().toISOString() });
    return rep;
  }

  /**
   * Called right before the bot sends its handoff message: assigns a rep and returns
   * the text with the rep's name — and, outside working hours, WHEN they'll call.
   */
  prepareHandoffMessage(convId) {
    const cfg = handoffConfig();
    const rep = convId ? this.assignRep(convId) : null;
    const repName = rep?.name || cfg.repName;
    if (!businessHours.isOpen()) {
      const next = businessHours.nextOpening();
      const tpl = businessHours.getConfig().after_hours_message || businessHours.DEFAULTS.after_hours_message;
      return tpl.replace(/\{rep\}/g, repName).replace(/\{time\}/g, next ? next.label : 'بأقرب وقت');
    }
    return cfg.message.replace(/\{rep\}/g, repName);
  }

  keepBotUntilHuman() { return handoffConfig().keepBotUntilHuman; }

  getHandoffMessage(convId = null) {
    return this.prepareHandoffMessage(convId);
  }

  buildLeadFromConversation(conv) {
    const msgs = conv.messages || [];
    const customerMsgs = msgs.filter(m => m.sender === 'customer');
    const lastCustomer = customerMsgs[customerMsgs.length - 1];
    // "Waiting for the sales rep" after a real handoff (the bot may still be answering).
    const isHandoff = !!conv.handoff_at || (conv.is_bot_active === false && conv.pause_reason !== 'human_reply');
    const purchase = conv.purchase_status || (isHandoff ? 'pending_human' : 'not_purchased');
    return {
      conversation_id: conv.id,
      name: conv.customer_name || 'عميل محتمل',
      phone: crmPhone(conv),
      customer_email: conv.customer_email || '',
      channel: conv.channel,
      customer_handle: conv.customer_handle || '',
      company_name: conv.company_name || '',
      business_type: conv.business_type || '',
      customer_requests: conv.customer_requests || customerMsgs.slice(-3).map(m => m.content).join(' | '),
      identified_problem: conv.identified_problem || '',
      proposed_solution: conv.proposed_solution || '',
      customer_summary: conv.customer_summary || '',
      objections: conv.objections || '',
      lead_stage: conv.lead_stage || 'new',
      classification: conv.classification || 'Cold',
      buying_probability: Number(conv.interest_score) || 0,
      purchase_status: purchase,
      deal_status: purchase === 'won' ? 'won' : purchase === 'lost' ? 'lost' : isHandoff ? 'handed_off' : 'in_progress',
      bot_state: conv.is_bot_active !== false ? (conv.handoff_at ? 'waiting_human' : 'active') : (conv.pause_reason === 'human_reply' ? 'paused_staff' : 'handed_off'),
      handed_off_at: conv.handoff_at || null,
      human_notified_at: conv.human_notified_at || null,
      assigned_to_name: conv.assigned_to_name || '',
      assigned_to_email: conv.assigned_to_email || '',
      follow_up_count: conv.follow_up_count || 0,
      last_follow_up_at: conv.last_follow_up_at || null,
      next_follow_up_at: conv.next_follow_up_at || null,
      consultation_requested: !!(conv.consultation_requested || conv.consultation_booked),
      demo_requested: !!conv.demo_requested,
      notes: conv.notes || '',
      message_count: msgs.length,
      last_customer_message: lastCustomer?.content || '',
      first_contact_at: conv.created_at || null
    };
  }

  /**
   * Create/update the lead for a conversation and push it to Supabase + Google Sheets.
   */
  async upsertLead(convOrId) {
    const conv = typeof convOrId === 'string' ? storageService.getConversationById(convOrId) : storageService.getConversationById(convOrId?.id) || convOrId;
    if (!conv) return null;

    const existing = storageService.getLeads().find(l => l.conversation_id === conv.id);
    const data = this.buildLeadFromConversation(conv);
    // Keep manual decisions made by the sales team (won / lost / notes).
    if (existing && ['won', 'lost'].includes(existing.purchase_status)) {
      data.purchase_status = existing.purchase_status;
      data.deal_status = existing.deal_status;
    }
    const lead = storageService.saveLead({ ...(existing ? { id: existing.id } : {}), ...data });

    await supabaseService.saveLead(lead);
    // Simulator test chats are kept out of the real sales sheet.
    if (String(conv.channel).startsWith('simulator')) return lead;
    googleSheetsService.syncLead(lead).then(r => {
      if (!r.success && googleSheetsService.isConfigured()) console.warn('[CRM] Sheets:', r.message);
    });
    return lead;
  }

  /**
   * Hand the customer to a human: email (+ Telegram) the sales team, sync everywhere.
   * By default the bot keeps answering until a rep actually replies (see header).
   */
  async handoff(convId, reason) {
    let conv = storageService.getConversationById(convId);
    if (!conv) return null;
    const alreadyHandedOff = !!conv.handoff_at && !!conv.human_notified_at;
    const { keepBotUntilHuman } = handoffConfig();

    conv = storageService.saveConversation({
      id: conv.id,
      ...(keepBotUntilHuman
        ? {}
        : { is_bot_active: false, pause_reason: 'handoff', bot_paused_until: null }), // old behaviour: silent at once
      lead_stage: 'handed_off',
      purchase_status: ['won', 'lost'].includes(conv.purchase_status) ? conv.purchase_status : 'pending_human',
      handoff_at: conv.handoff_at || new Date().toISOString(),
      handoff_reason: reason || conv.handoff_reason || 'تحويل للموظف'
    });
    await supabaseService.saveConversation(conv);

    let lead = await this.upsertLead(conv);

    if (!alreadyHandedOff) {
      // Email in the background — never delays the conversation flow.
      const convId = conv.id;
      notificationService.sendHandoffEmail(conv, lead).then(async (result) => {
        if (result.success) {
          const updated = storageService.saveConversation({ id: convId, human_notified_at: new Date().toISOString() });
          await supabaseService.saveConversation(updated);
          await this.upsertLead(updated);
        } else {
          console.warn(`[CRM] Handoff email not sent for ${convId}: ${result.error}`);
        }
      }).catch(err => console.error('[CRM] handoff email error:', err.message));
    }
    console.log(`[CRM] Conversation ${conv.id} handed off to human (${reason}). ${keepBotUntilHuman ? 'Bot keeps answering until a rep replies.' : 'Bot is now silent for this customer.'}`);
    return { conv, lead };
  }

  // Move a customer to another rep and email the new rep the full details.
  async reassign(leadId, repId) {
    const lead = storageService.getLeads().find(l => l.id === leadId);
    const conv = lead?.conversation_id ? storageService.getConversationById(lead.conversation_id) : null;
    if (!conv) return { success: false, error: 'المحادثة الخاصة بهذا العميل غير موجودة' };
    const rep = this.assignRep(conv.id, repId);
    if (!rep) return { success: false, error: 'الموظف غير موجود أو غير مفعّل' };
    const updated = storageService.getConversationById(conv.id);
    await supabaseService.saveConversation(updated);
    const freshLead = await this.upsertLead(updated);
    let email = { success: false, skipped: true };
    if (updated.handoff_at || updated.is_bot_active === false) email = await notificationService.sendHandoffEmail(updated, freshLead);
    return { success: true, rep, email };
  }

  // Re-send the handoff email (e.g. Gmail wasn't configured when the handoff happened).
  async resendHandoffEmail(leadId) {
    const lead = storageService.getLeads().find(l => l.id === leadId);
    const conv = lead?.conversation_id ? storageService.getConversationById(lead.conversation_id) : null;
    if (!conv) return { success: false, error: 'المحادثة الخاصة بهذا العميل غير موجودة' };
    const result = await notificationService.sendHandoffEmail(conv, lead);
    if (result.success) {
      const updated = storageService.saveConversation({ id: conv.id, human_notified_at: new Date().toISOString() });
      await supabaseService.saveConversation(updated);
      await this.upsertLead(updated);
    }
    return result;
  }

  // Sales team marks the result from the CRM table.
  async setPurchaseStatus(leadId, status, notes) {
    const lead = storageService.getLeads().find(l => l.id === leadId);
    if (!lead) return null;
    const patch = { id: lead.id };
    if (status) {
      patch.purchase_status = status;
      patch.purchase_status_at = new Date().toISOString();
      patch.deal_status = status === 'won' ? 'won' : status === 'lost' ? 'lost' : status === 'pending_human' ? 'handed_off' : 'in_progress';
    }
    if (notes !== undefined) patch.notes = notes;
    const updated = storageService.saveLead(patch);

    if (lead.conversation_id && status && storageService.getConversationById(lead.conversation_id)) {
      const conv = storageService.saveConversation({ id: lead.conversation_id, purchase_status: status });
      if (conv) await supabaseService.saveConversation(conv);
    }
    await supabaseService.saveLead(updated);
    const sync = await googleSheetsService.syncLead({ ...updated, _manual: true });
    return { lead: updated, sync };
  }
}

const crm = new CrmService();
crm.crmPhone = crmPhone;
module.exports = crm;
