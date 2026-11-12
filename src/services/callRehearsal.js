/**
 * Call rehearsal (admin test): a second AI plays a realistic customer and talks, in text, to the
 * call AI using the exact same call script and tools as the real voice call. Then the real
 * after-call analysis runs. Used to check, before real customers: answers only from the company
 * files, no invented prices/numbers, the right buy / no-buy verdict, booking and saved details.
 * Runs on a test conversation (channel "simulator_call"): nothing goes to Google Sheets or Telegram.
 */
const crypto = require('crypto');
const storageService = require('./storageService');

const PERSONAS = {
  buyer: {
    name: 'سامي',
    lang: 'ar',
    first: 'مرحبا، وصلني الرابط',
    probes: { 2: 'قبل ما نكمل، كم السعر تقريباً؟', 5: 'وسؤال كمان: بتربطوا النظام مع برنامج Odoo؟' },
    brief: `أنت سامي، صاحب عيادة أسنان اسمها "عيادة الابتسامة" في عمّان (خلدا). عندك 6 موظفين، وبتجيكم حوالي 400 رسالة بالشهر على واتساب وإنستغرام، وبتردوا يدوي من موبايل السكرتيرة، والمشكلة إنه كثير رسائل بتضيع بالليل وبتخسروا حجوزات. بدك نظام يرد فوراً ويحجز مواعيد. بدك تبدأ هالشهر، والميزانية جاهزة إذا السعر معقول، وإنت صاحب القرار. إيميلك sami@smileclinic.jo.
خلال المكالمة: اسأل مرة "كم السعر؟"، واسأل مرة "بتربطوا مع برنامج Odoo؟". إذا عرض عليك موعد مع المهندس وافق على أول وقت بيقترحه.`
  },
  not_buyer: {
    name: 'ليث',
    lang: 'ar',
    first: 'أهلين',
    probes: { 2: 'كم بتكلف الأنظمة عندكم بالعادة؟' },
    brief: `أنت ليث، طالب جامعي سنة ثالثة. بتسأل بس بدافع الفضول لأنك بتكتب مشروع تخرج عن الشات بوت. ما عندك شركة ولا ميزانية، ومش ناوي تشتري، ومش صاحب قرار بأي شركة. إذا سألوك عن موعد مع مهندس اعتذر بلطف.`
  },
  en_buyer: {
    name: 'Sarah',
    lang: 'en',
    first: 'Hi, I got the link',
    probes: { 2: 'Before we go on, how much does it cost?', 5: 'Do you integrate with Shopify?' },
    brief: `You are Sarah, owner of "Bloom", an online flower shop in Dubai. 3 staff, about 1,200 Instagram and WhatsApp messages a month, answered manually and often late, losing orders. You want automated replies and order follow-up within 2 weeks. You have a budget and you decide. Email sarah@bloomflowers.ae. Ask once "how much does it cost?". If offered a meeting with the engineer, accept the first time offered.`
  }
};

const jobs = new Map();

function customerSystem(p) {
  return `${p.brief}

You are the CUSTOMER in a phone call with a sales assistant from atlead. Speak ${p.lang === 'en' ? 'English' : 'Jordanian Arabic'}, short natural replies (1-2 sentences), answer only what you are asked, stay in character. Reply with your next spoken line only.`;
}

async function run(jobId, personaKey, maxTurns) {
  const ai = require('./aiService');
  const callService = require('./callService');
  const knowledge = require('./knowledgeService');
  const job = jobs.get(jobId);
  const p = PERSONAS[personaKey];
  try {
    const conv = storageService.saveConversation({
      channel: 'simulator_call', external_user_id: `rehearsal_${jobId}`, customer_name: p.name, lead_stage: 'new', is_bot_active: true
    });
    storageService.addMessage(conv.id, { sender: 'customer', content: p.lang === 'en' ? 'Tell me more about your system' : 'بدي أعرف أكثر عن نظامكم', media_type: 'text' });
    job.conversation_id = conv.id;
    const session = callService.createSession(storageService.getConversationById(conv.id));
    session.status = 'in_progress'; session.started_at = new Date().toISOString();
    session.mock_calendar = !require('./calendarService').isActive(); // simulated calendar when Google Calendar is not connected
    callService.save(session);
    job.calendar = session.mock_calendar ? 'simulated' : 'google';

    const system = `${callService.instructions(session, storageService.getConversationById(conv.id), p.lang)}

(اختبار نصي للمكالمة: نفس القواعد تماماً. أعد JSON فقط: {"say":"ما تقوله للعميل الآن","tool":"","args":{}}. الأدوات المتاحة بحقل tool: get_free_times، book_engineer_meeting (args: {"start":"YYYY-MM-DD HH:MM"})، end_call. استخدم أداة واحدة بكل رد إذا لزم، وإلا اترك tool فارغاً.)`;
    const assistantHistory = []; // {role, text}
    const customerHistory = [];
    const lines = [];
    const toolLog = [];
    const say = (role, text) => { const l = { id: crypto.randomUUID(), role, text }; lines.push(l); callService.addTranscript(session.token, [l]); };

    let customerLine = p.first;
    let ended = false;
    for (let turn = 0; turn < maxTurns && !ended; turn++) {
      say('customer', customerLine);
      job.progress = `turn ${turn + 1}`;
      let input = `العميل: ${customerLine}`;
      for (let step = 0; step < 3; step++) { // a reply may need a tool first
        const { text } = await ai.chatWithFailover(system, assistantHistory, input, { json: true, temperature: 0.6, timeout: 40000 });
        let out;
        try { out = JSON.parse(String(text).replace(/^```json|```$/g, '').trim()); } catch { out = { say: String(text || '') }; }
        assistantHistory.push({ role: 'user', text: input }, { role: 'model', text: JSON.stringify(out) });
        if (out.say) say('assistant', String(out.say));
        if (!out.tool) break;
        const result = await callService.tool(session.token, out.tool, out.args || {});
        toolLog.push({ tool: out.tool, args: out.args || {}, result });
        if (out.tool === 'end_call') { ended = true; break; }
        input = `[نتيجة الأداة ${out.tool}]: ${JSON.stringify(result)}`;
      }
      if (ended) break;
      customerHistory.push({ role: 'model', text: customerLine });
      const lastAssistant = [...lines].reverse().find(l => l.role === 'assistant')?.text || '';
      customerHistory.push({ role: 'user', text: lastAssistant });
      const next = await ai.chatWithFailover(customerSystem(p), customerHistory.slice(0, -1), `Sales assistant: ${lastAssistant}`, { json: false, temperature: 0.7, timeout: 40000 });
      customerLine = String(next.text || '').replace(/^["']|["']$/g, '').trim() || (p.lang === 'en' ? 'Okay.' : 'تمام.');
      // Fixed probe questions on set turns (price, an unknown integration) to test "no guessing".
      if (p.probes?.[turn + 1]) customerLine = p.probes[turn + 1];
    }

    // No-guessing check on every line the assistant said.
    const ground = [knowledge.groundingText(), ...lines.filter(l => l.role === 'customer').map(l => l.text), JSON.stringify(toolLog)].join('\n');
    const flagged = lines.filter(l => l.role === 'assistant').map(l => ({ text: l.text, check: ai.ungroundedNumbers(l.text, ground) }))
      .filter(x => x.check.price || x.check.numbers.length);

    job.progress = 'analysing';
    await callService.finish(session.token, { reason: 'rehearsal' });
    const done = callService.get(session.token);
    const c = storageService.getConversationById(conv.id);
    Object.assign(job, {
      status: 'done',
      persona: personaKey,
      transcript: lines.map(l => `${l.role === 'assistant' ? 'المساعد' : 'العميل'}: ${l.text}`),
      tools: toolLog,
      ungrounded: flagged,
      analysis: done.analysis,
      saved: {
        ai_call_status: c.ai_call_status, ai_call_qualified: c.ai_call_qualified, classification: c.classification, interest_score: c.interest_score,
        company_name: c.company_name, business_type: c.business_type, location: c.location, team_size: c.team_size, monthly_volume: c.monthly_volume,
        channels_used: c.channels_used, current_tools: c.current_tools, goals: c.goals, budget: c.budget, timeline: c.timeline,
        decision_maker: c.decision_maker, customer_email: c.customer_email, appointment_label: c.appointment_label || null,
        handed_to_sales: !!c.handoff_at, summary_message_to_customer: c.messages[c.messages.length - 1]?.content
      }
    });
    // The exact row Google Sheets would get for this customer.
    const lead = storageService.getLeads().find(l => l.conversation_id === conv.id);
    if (lead) {
      const sheets = require('./googleSheetsService');
      const row = sheets.leadToRow(lead);
      job.sheet_row = Object.fromEntries(sheets.headers().map((h, i) => [h, row[i]]).filter(([, v]) => v !== '' && v !== undefined));
    }
    // Test data is removed afterwards so it never mixes with real customers.
    if (job.cleanup) {
      storageService.deleteConversation(conv.id);
      require('./supabaseService').deleteConversation(c).catch(() => {});
    }
  } catch (e) {
    job.status = 'error';
    job.error = e.response?.data?.error?.message || e.message;
  }
}

module.exports = {
  PERSONAS,
  start(persona = 'buyer', { maxTurns = 14, cleanup = true } = {}) {
    if (!PERSONAS[persona]) throw new Error('unknown persona');
    const id = crypto.randomBytes(6).toString('hex');
    jobs.set(id, { id, status: 'running', persona, cleanup, started_at: new Date().toISOString() });
    run(id, persona, Math.min(20, Math.max(4, maxTurns)));
    return jobs.get(id);
  },
  get(id) { return jobs.get(id) || null; }
};
