// State
let currentTab = 'inbox';
let conversations = [];
let activeConvId = null;
let currentLead = null;
let simulatorConvId = null;

// DOM Elements
const conversationList = document.getElementById('conversation-list');
const chatMessages = document.getElementById('chat-messages');
const activeChatName = document.getElementById('active-chat-name');
const activeChatChannel = document.getElementById('active-chat-channel');
const activeChatAvatar = document.getElementById('active-chat-avatar');
const activeChatBadgeArea = document.getElementById('active-chat-badge-area');
const botStatusLabel = document.getElementById('bot-status-label');
const btnToggleBot = document.getElementById('btn-toggle-bot');
const handoffAlertBox = document.getElementById('handoff-alert-box');

// Toast helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <i class="fa-solid ${type === 'success' ? 'fa-circle-check' : type === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-info'}"></i>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Navigation Tabs
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const tab = item.dataset.tab;
    switchTab(tab);
  });
});

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelector(`.nav-item[data-tab="${tab}"]`)?.classList.add('active');

  document.querySelectorAll('.view-panel').forEach(panel => panel.classList.remove('active'));
  document.getElementById(`view-${tab}`)?.classList.add('active');

  const titles = {
    inbox: 'صندوق المحادثات الموحد',
    crm: 'إدارة الصفقات والـ CRM',
    comments: 'التعليقات والتحويل للخاص',
    simulator: 'مختبر تجربة البوت والفويس',
    knowledge: 'قاعدة المعرفة والأعمال السابقة',
    marketing: 'التسويق الذكي وجدولة البوستات',
    settings: 'إعدادات الربط والـ APIs'
  };
  document.getElementById('current-tab-title').textContent = titles[tab] || '';

  if (tab === 'inbox') loadConversations();
  if (tab === 'crm') { loadLeads(); loadStats(); }
  if (tab === 'comments') loadComments();
  if (tab === 'settings') loadSettings();
  if (tab === 'knowledge') loadKnowledge();
  if (tab === 'marketing' && window.mkOpen) window.mkOpen();
}

// 1. INBOX LOGIC
async function loadConversations(filterChannel = 'all') {
  try {
    const res = await fetch('/api/conversations');
    const data = await res.json();
    if (data.success) {
      conversations = data.conversations;
      renderConversationList(filterChannel);
      if (conversations.length > 0 && !activeConvId) {
        selectConversation(conversations[0].id);
      }
    }
  } catch (err) {
    console.error('Error loading conversations:', err);
  }
}

function renderConversationList(filter = 'all') {
  conversationList.innerHTML = '';
  const searchVal = document.getElementById('conv-search')?.value.toLowerCase() || '';

  let filtered = conversations.filter(c => {
    const matchSearch = (c.customer_name || '').toLowerCase().includes(searchVal) ||
                        (c.customer_phone || '').toLowerCase().includes(searchVal);
    if (!matchSearch) return false;
    if (filter === 'all') return true;
    if (filter === 'deal_closing') return c.lead_stage === 'deal_closing' || c.lead_stage === 'handed_off';
    return c.channel === filter;
  });

  if (filtered.length === 0) {
    conversationList.innerHTML = `
      <li style="text-align: center; padding: 30px 10px; color: var(--text-muted); font-size: 13px;">
        لا توجد محادثات مطابقة
      </li>
    `;
    return;
  }

  filtered.forEach(c => {
    const li = document.createElement('li');
    li.className = `conv-item ${c.id === activeConvId ? 'active' : ''}`;
    li.onclick = () => selectConversation(c.id);

    const channelIcon = {
      whatsapp: 'fa-brands fa-whatsapp',
      instagram_dm: 'fa-brands fa-instagram',
      facebook_messenger: 'fa-brands fa-facebook-messenger',
      simulator: 'fa-solid fa-flask'
    }[c.channel] || 'fa-solid fa-comments';

    const lastMsg = escapeHtml(c.messages && c.messages.length > 0 ? c.messages[c.messages.length - 1].content : 'محادثة جديدة');
    const isBotOff = c.is_bot_active === false;

    li.innerHTML = `
      <div class="channel-avatar ${c.channel}">
        <i class="${channelIcon}"></i>
      </div>
      <div class="conv-details">
        <div class="conv-top">
          <span class="conv-name">${escapeHtml(c.customer_name || 'عميل محتمل')}</span>
          <span class="conv-time">${formatTime(c.last_message_at || c.created_at)}</span>
        </div>
        <div class="conv-preview">${lastMsg}</div>
        <div class="conv-meta">
          <span class="badge-pill ${c.classification === 'Hot' ? 'danger' : c.classification === 'Warm' ? 'warning' : 'info'}" style="padding: 2px 8px; font-size: 10px;">
            ${c.classification || 'Cold'} (${c.interest_score || 20}%)
          </span>
          ${isBotOff && c.pause_reason === 'human_reply' ? `
            <span class="badge-pill warning" style="padding: 2px 8px; font-size: 10px;">
              <i class="fa-solid fa-user-pen"></i> موظف يتابع
            </span>
          ` : isBotOff ? `
            <span class="badge-pill danger" style="padding: 2px 8px; font-size: 10px;">
              <i class="fa-solid fa-hand-holding-hand"></i> محول للبشري
            </span>
          ` : `
            <span class="badge-pill success" style="padding: 2px 8px; font-size: 10px;">
              <i class="fa-solid fa-robot"></i> بوت مفعل
            </span>
          `}
        </div>
      </div>
    `;
    conversationList.appendChild(li);
  });
}

function selectConversation(id) {
  activeConvId = id;
  const conv = conversations.find(c => c.id === id);
  if (!conv) return;

  renderConversationList();

  // Header update
  activeChatName.textContent = conv.customer_name || 'عميل محتمل';
  activeChatChannel.textContent = `${conv.channel} • ${conv.customer_phone || conv.customer_handle || conv.external_user_id}`;
  
  const iconClass = {
    whatsapp: 'fa-brands fa-whatsapp',
    instagram_dm: 'fa-brands fa-instagram',
    facebook_messenger: 'fa-brands fa-facebook-messenger',
    simulator: 'fa-solid fa-flask'
  }[conv.channel] || 'fa-solid fa-comments';

  activeChatAvatar.className = `channel-avatar ${conv.channel}`;
  activeChatAvatar.innerHTML = `<i class="${iconClass}"></i>`;

  // Status Badge
  const isOff = conv.is_bot_active === false;
  const offLabel = botOffLabel(conv);
  activeChatBadgeArea.innerHTML = isOff
    ? `<span class="badge-pill ${conv.pause_reason === 'human_reply' ? 'warning' : 'danger'}"><i class="fa-solid ${conv.pause_reason === 'human_reply' ? 'fa-user-pen' : 'fa-lock'}"></i> ${escapeHtml(offLabel)}</span>`
    : `<span class="badge-pill success"><i class="fa-solid fa-bolt"></i> الرد الآلي للبوت نشط</span>`;

  // Side Panel
  botStatusLabel.textContent = isOff ? offLabel : 'مفعل ويعمل';
  btnToggleBot.className = isOff ? 'btn btn-success btn-sm' : 'btn btn-danger btn-sm';
  btnToggleBot.innerHTML = isOff ? '<i class="fa-solid fa-play"></i> إعادة تفعيل البوت' : '<i class="fa-solid fa-pause"></i> إيقاف البوت';
  handoffAlertBox.style.display = isOff ? 'block' : 'none';
  if (isOff) {
    handoffAlertBox.innerHTML = conv.pause_reason === 'human_reply'
      ? `<i class="fa-solid fa-user-pen"></i> موظف رد على هذا العميل${conv.pause_source ? ' (' + escapeHtml(conv.pause_source) + ')' : ''}، فتوقف البوت حتى ما يتدخل بالمحادثة.${conv.bot_paused_until ? ' بيرجع يرد بعد انتهاء المدة.' : ' اضغط "إعادة تفعيل البوت" لما تخلص.'}`
      : conv.pause_reason === 'manual'
        ? '<i class="fa-solid fa-pause"></i> تم إيقاف البوت يدوياً لهذا العميل.'
        : `<i class="fa-solid fa-bell"></i> العميل وصل لمرحلة الشراء وتحوّل للموظف — البوت ما رح يرد عليه نهائياً.${conv.assigned_to_name ? '<br>الموظف المسؤول: <b>' + escapeHtml(conv.assigned_to_name) + '</b>' : ''}${conv.handoff_reason ? '<br>السبب: ' + escapeHtml(conv.handoff_reason) : ''}`;
  }

  document.getElementById('side-lead-stage').textContent = conv.lead_stage || 'new';
  document.getElementById('side-lead-class').textContent = conv.classification || 'Cold';
  document.getElementById('side-lead-score').textContent = `${conv.interest_score || 20}%`;
  document.getElementById('side-score-bar').style.width = `${conv.interest_score || 20}%`;
  document.getElementById('side-lead-problem').textContent = conv.identified_problem || 'لم تحدد بعد';
  document.getElementById('side-lead-solution').textContent = conv.proposed_solution || 'لم يحدد بعد';

  // Render Messages
  renderMessages(conv.messages || []);
}

function renderMessages(messages) {
  chatMessages.innerHTML = '';
  if (messages.length === 0) {
    chatMessages.innerHTML = '<div style="text-align: center; color: var(--text-muted); margin-top: 50px;">لا توجد رسائل سابقة في هذه المحادثة</div>';
    return;
  }

  messages.forEach(m => {
    const row = document.createElement('div');
    row.className = `msg-row ${m.sender}`;

    let contentHtml = escapeHtml(m.content);

    if (m.media_type === 'image' && m.media_url) {
      contentHtml = `<a href="${escapeHtml(m.media_url)}" target="_blank" rel="noopener"><img src="${escapeHtml(m.media_url)}" alt="صورة" style="max-width: 220px; max-height: 220px; border-radius: 8px; display: block; margin-bottom: 6px;"></a>${escapeHtml(m.content)}`;
    }

    if (m.is_voice) {
      contentHtml = `
        <div class="voice-badge">
          <i class="fa-solid fa-microphone"></i> رسالة صوتية (فويس)
        </div>
        ${m.media_url ? `<audio controls src="${m.media_url}" style="width: 100%; height: 32px; margin-bottom: 6px;"></audio>` : ''}
        <div style="font-size: 13px; color: #f8fafc; font-style: italic;">
          "${escapeHtml(m.voice_transcript || m.content)}"
        </div>
      `;
    }

    const senderLabel = m.sender === 'customer' ? 'العميل' : m.sender === 'bot' ? 'مساعد atlead الذكي' : 'الموظف البشري';

    let quoteHtml = '';
    if (m.reply_to_content) {
      const qLabel = m.reply_to_sender === 'customer' ? 'العميل' : m.reply_to_sender === 'comment' ? 'تعليق' : m.reply_to_sender === 'bot' ? 'البوت' : 'الموظف';
      quoteHtml = `<div class="msg-quote"><span class="msg-quote-author">${qLabel}</span>${escapeHtml(String(m.reply_to_content).slice(0, 160))}</div>`;
    }
    const statusIcon = m.delivery_status === 'failed' ? ' <i class="fa-solid fa-circle-exclamation" title="فشل الإرسال للمنصة" style="color:#f87171"></i>'
      : m.delivery_status === 'simulated' ? ' <i class="fa-solid fa-flask" title="محاكاة — القناة غير مربوطة" style="color:#fbbf24"></i>' : '';

    row.innerHTML = `
      <div class="msg-bubble">
        ${quoteHtml}
        ${contentHtml}
      </div>
      <div class="msg-info">
        <span>${senderLabel}</span>
        <span>•</span>
        <span>${formatTime(m.created_at)}</span>${statusIcon}
      </div>
    `;
    chatMessages.appendChild(row);
  });

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Toggle Bot active/pause on active conversation
btnToggleBot.addEventListener('click', async () => {
  if (!activeConvId) return;
  const conv = conversations.find(c => c.id === activeConvId);
  if (!conv) return;

  const newStatus = !conv.is_bot_active;
  try {
    const res = await fetch(`/api/conversations/${activeConvId}/toggle-bot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: newStatus })
    });
    const data = await res.json();
    if (data.success) {
      conv.is_bot_active = newStatus;
      showToast(data.message, newStatus ? 'success' : 'info');
      selectConversation(activeConvId);
    }
  } catch (err) {
    showToast('حدث خطأ أثناء تبديل حالة البوت', 'error');
  }
});

// Manual reply form
document.getElementById('manual-reply-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('manual-reply-text');
  const text = input.value.trim();
  if (!text || !activeConvId) return;

  try {
    const res = await fetch(`/api/conversations/${activeConvId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const data = await res.json();
    if (data.success) {
      input.value = '';
      const conv = conversations.find(c => c.id === activeConvId);
      if (conv) {
        if (!conv.messages) conv.messages = [];
        conv.messages.push(data.data);
        renderMessages(conv.messages);
      }
      showToast('تم إرسال الرد بنجاح!', 'success');
    }
  } catch (err) {
    showToast('فشل إرسال الرد اليدوي', 'error');
  }
});

// Filters
document.querySelectorAll('.filter-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    renderConversationList(chip.dataset.filter);
  });
});

document.getElementById('conv-search')?.addEventListener('input', () => {
  const activeFilter = document.querySelector('.filter-chip.active')?.dataset.filter || 'all';
  renderConversationList(activeFilter);
});

// 2. CRM & LEADS
let crmTeam = [];
async function loadLeads() {
  try {
    try { crmTeam = (await (await fetch('/api/team')).json()).team || []; } catch (e) { crmTeam = []; }
    const res = await fetch('/api/leads');
    const data = await res.json();
    if (data.success) {
      renderLeadsTable(data.leads);
    }
  } catch (err) {
    console.error('Error loading leads:', err);
  }
}

function renderLeadsTable(leads) {
  const tbody = document.getElementById('crm-leads-table-body');
  tbody.innerHTML = '';

  if (leads.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align: center; color: var(--text-muted); padding: 30px;">لا يوجد عملاء مسجلين بعد</td></tr>`;
    return;
  }

  const channelLabel = { whatsapp: 'واتساب', instagram_dm: 'إنستغرام', facebook_messenger: 'ماسنجر', simulator: 'محاكي' };
  const purchaseOptions = [
    ['not_purchased', 'لم يشترِ بعد'],
    ['pending_human', 'بانتظار الموظف ⏳'],
    ['won', 'اشترى ✅'],
    ['lost', 'لم يشترِ ❌']
  ];

  leads.forEach(l => {
    const tr = document.createElement('tr');
    const prob = Number(l.buying_probability) || 0;
    const status = l.purchase_status || (l.deal_status === 'won' ? 'won' : l.deal_status === 'lost' ? 'lost' : (l.deal_status === 'agreed' || l.deal_status === 'handed_off') ? 'pending_human' : 'not_purchased');
    tr.innerHTML = `
      <td>
        <strong>${escapeHtml(l.name || 'عميل محتمل')}</strong>
        ${l.customer_summary ? `<div style="font-size: 11px; color: var(--text-muted); max-width: 220px; margin-top: 4px;" title="${escapeHtml(l.customer_summary)}">${escapeHtml(l.customer_summary.slice(0, 90))}${l.customer_summary.length > 90 ? '…' : ''}</div>` : ''}
      </td>
      <td style="direction: ltr; text-align: right;">${escapeHtml(l.phone || l.customer_handle || 'غير مسجل')}</td>
      <td><span class="badge-pill info" style="font-size: 11px;">${escapeHtml(channelLabel[l.channel] || l.channel)}</span></td>
      <td>${escapeHtml(l.lead_stage || 'New')}</td>
      <td>
        <span class="badge-pill ${l.classification === 'Hot' ? 'danger' : l.classification === 'Warm' ? 'warning' : 'info'}" style="font-size: 11px;">
          ${escapeHtml(l.classification || 'Cold')}
        </span>
      </td>
      <td>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-weight: 700;">${prob}%</span>
          <div class="progress-bar-bg" style="width: 60px; margin: 0;">
            <div class="progress-bar-fill" style="width: ${prob}%;"></div>
          </div>
        </div>
      </td>
      <td style="max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(l.customer_requests || l.identified_problem || '')}">${escapeHtml(l.customer_requests || l.identified_problem || '-')}</td>
      <td style="max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #38bdf8;">${escapeHtml(l.proposed_solution || '-')}</td>
      <td>
        <select class="form-control purchase-select" data-lead="${escapeHtml(l.id)}" style="font-size: 12px; padding: 4px 6px; min-width: 130px;">
          ${purchaseOptions.map(([v, t]) => `<option value="${v}" ${v === status ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        ${l.human_notified_at ? '<div style="font-size: 10.5px; color: #34d399; margin-top: 3px;"><i class="fa-solid fa-envelope-circle-check"></i> تم إبلاغ الموظف</div>' : ''}
      </td>
      <td>
        ${crmTeam.length ? `<select class="form-control assign-select" data-lead="${escapeHtml(l.id)}" style="font-size: 12px; padding: 4px 6px; min-width: 110px;">
          <option value="">${l.assigned_to_name ? escapeHtml(l.assigned_to_name) : '— غير مُسند —'}</option>
          ${crmTeam.filter(m => m.name !== l.assigned_to_name).map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join('')}
        </select>` : escapeHtml(l.assigned_to_name || '-')}
      </td>
      <td>
        ${l.google_sheet_synced ? `
          <span class="badge-pill success" style="font-size: 11px;"><i class="fa-solid fa-check"></i> مرحل</span>
        ` : `
          <span class="badge-pill warning" style="font-size: 11px;"><i class="fa-solid fa-clock"></i> قيد الانتظار</span>
        `}
      </td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="syncLeadToSheet('${escapeHtml(l.id)}')" title="مزامنة فورية مع Google Sheet">
          <i class="fa-solid fa-cloud-arrow-up"></i>
        </button>
        <button class="btn btn-secondary btn-sm" onclick="notifyLead('${escapeHtml(l.id)}')" title="إرسال تفاصيل العميل للموظف بالإيميل">
          <i class="fa-solid fa-envelope"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.assign-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      if (!sel.value) return;
      const res = await fetch(`/api/leads/${encodeURIComponent(sel.dataset.lead)}/assign`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rep_id: sel.value })
      });
      const data = await res.json();
      showToast(data.message, data.success ? 'success' : 'error');
      loadLeads();
    });
  });

  tbody.querySelectorAll('.purchase-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const res = await fetch(`/api/leads/${encodeURIComponent(sel.dataset.lead)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purchase_status: sel.value })
      });
      const data = await res.json();
      showToast(data.message, data.success ? 'success' : 'error');
      loadLeads();
    });
  });
}

async function syncLeadToSheet(leadId) {
  try {
    showToast('جاري الترحيل إلى Google Sheets...', 'info');
    const res = await fetch(`/api/leads/${leadId}/sync-sheet`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      loadLeads();
      loadStats();
    } else {
      showToast(data.message, 'error');
    }
  } catch (err) {
    showToast('فشل الترحيل إلى جوجل شيت', 'error');
  }
}

// Sync all
document.getElementById('btn-sync-all-sheets')?.addEventListener('click', async () => {
  showToast('جاري مزامنة كل العملاء مع Google Sheets...', 'info');
  const res = await fetch('/api/leads/sync-all', { method: 'POST' });
  const data = await res.json();
  showToast(data.message, data.success ? 'success' : 'error');
  loadLeads();
  loadStats();
});

async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    if (data.success) {
      const s = data.stats;
      document.getElementById('stat-total-convs').textContent = s.totalConversations;
      document.getElementById('stat-hot-leads').textContent = s.hotLeads;
      document.getElementById('stat-handed-deals').textContent = s.handedOffDeals;
      document.getElementById('stat-synced-sheets').textContent = s.syncedSheets;
    }
  } catch (err) {
    console.error('Error stats:', err);
  }
}

// 3. COMMENTS
async function loadComments() {
  try {
    const res = await fetch('/api/comments');
    const data = await res.json();
    if (data.success) {
      renderCommentsTable(data.comments);
    }
  } catch (err) {
    console.error('Error comments:', err);
  }
}

function renderCommentsTable(comments) {
  const tbody = document.getElementById('comments-table-body');
  tbody.innerHTML = '';

  if (comments.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 30px;">لا توجد تعليقات مسجلة بعد</td></tr>`;
    return;
  }

  comments.forEach(c => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <span class="badge-pill ${c.platform === 'facebook' ? 'info' : 'warning'}" style="font-size: 11px;">
          <i class="fa-brands fa-${c.platform}"></i> ${c.platform}
        </span>
      </td>
      <td><strong>${escapeHtml(c.user_name || 'متابع')}</strong></td>
      <td style="max-width: 200px;">"${escapeHtml(c.comment_text)}"</td>
      <td>
        <span class="badge-pill ${c.is_interested ? 'danger' : 'info'}" style="font-size: 11px;">
          ${c.is_interested ? '🔥 مهتم بالشراء / استفسار' : 'تفاعل عام'}
        </span>
      </td>
      <td style="max-width: 220px; color: #38bdf8;">${c.status === 'pending' ? '⏳ بانتظار الرد...' : c.status === 'skipped' ? '🔒 محوّل لموظف — البوت ما رد' : escapeHtml(c.bot_reply_text || '-')}</td>
      <td>
        ${c.dm_triggered ? `
          <span class="badge-pill success" style="font-size: 11px;"><i class="fa-solid fa-paper-plane"></i> تم إرسال DM خاص</span>
          ${c.dm_text ? `<div style="font-size: 11px; color: #94a3b8; margin-top: 4px; max-width: 250px;">"${escapeHtml(c.dm_text)}"</div>` : ''}
        ` : `
          <span style="color: var(--text-muted); font-size: 11px;">غير مطلوب</span>
        `}
      </td>
      <td style="font-size: 11px; color: var(--text-muted);">${formatTime(c.created_at)}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Simulate comment button
document.getElementById('btn-simulate-comment-modal')?.addEventListener('click', async () => {
  const text = prompt('أدخل نص التعليق الذي ترغب بمحاكاته على فيسبوك أو إنستغرام:', 'كم سعر النظام لو سمحت وبدي تفاصيل؟');
  if (!text) return;

  try {
    showToast('جاري فحص التعليق وتطبيق الرد والرسالة الخاصة...', 'info');
    const res = await fetch('/api/comments/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, platform: 'facebook', user_name: 'عميل مجرب' })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`تم استلام التعليق — البوت رح يرد بعد ${data.delay_seconds ?? 10} ثواني`, 'success');
      loadComments();
      setTimeout(loadComments, ((data.delay_seconds ?? 10) + 4) * 1000);
    }
  } catch (err) {
    showToast('فشل محاكاة التعليق', 'error');
  }
});

// 4. SIMULATOR & VOICE LAB
const simMessages = document.getElementById('sim-messages');
const simTextInput = document.getElementById('sim-text-input');
const btnSendSimText = document.getElementById('btn-send-sim-text');

async function sendSimMessage(text) {
  if (!text) return;

  // Add customer message bubble
  appendSimBubble('customer', text);
  simTextInput.value = '';

  try {
    const res = await fetch('/api/simulator/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, conversation_id: simulatorConvId })
    });
    const data = await res.json();
    if (data.success) {
      simulatorConvId = data.conversation.id;
      appendSimBubble('bot', data.reply);
      updateSimulatorInspector(data);
    }
  } catch (err) {
    appendSimBubble('bot', 'حدث خطأ أثناء معالجة الرسالة في المختبر.');
  }
}

function appendSimBubble(sender, text, isVoice = false) {
  const row = document.createElement('div');
  row.className = `msg-row ${sender}`;
  row.innerHTML = `
    <div class="msg-bubble">
      ${isVoice ? '<div class="voice-badge"><i class="fa-solid fa-microphone"></i> تسجيل صوتي</div>' : ''}
      ${escapeHtml(text)}
    </div>
    <div class="msg-info">
      <span>${sender === 'customer' ? 'أنت (المستخدم)' : 'مساعد atlead الذكي'}</span>
      <span>•</span>
      <span>الآن</span>
    </div>
  `;
  simMessages.appendChild(row);
  simMessages.scrollTop = simMessages.scrollHeight;
}

function updateSimulatorInspector(data) {
  const ai = data.ai_details || {};
  document.getElementById('sim-inspect-stage').textContent = ai.lead_stage || 'discovery';
  document.getElementById('sim-inspect-class').textContent = ai.classification || 'Warm';
  document.getElementById('sim-inspect-score').textContent = `${ai.buying_probability || 40}%`;
  document.getElementById('sim-inspect-score-bar').style.width = `${ai.buying_probability || 40}%`;
  document.getElementById('sim-inspect-active').innerHTML = data.bot_active !== false ? 'مفعل 🟢' : 'موقوف (محول للبشري) 🛑';
  document.getElementById('sim-inspect-handoff').textContent = ai.handoff_triggered ? 'نعم (تم الاتفاق والتحويل!)' : 'لا';
  document.getElementById('sim-inspect-problem').textContent = ai.identified_problem || '-';
  document.getElementById('sim-inspect-solution').textContent = ai.proposed_solution || '-';

  if (ai.handoff_triggered || ai.lead_stage === 'deal_closing' || data.bot_active === false) {
    document.getElementById('sim-handoff-banner').style.display = 'block';
  }
}

btnSendSimText?.addEventListener('click', () => sendSimMessage(simTextInput.value.trim()));
simTextInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendSimMessage(simTextInput.value.trim());
});

document.querySelectorAll('.sim-quick-btn').forEach(btn => {
  btn.addEventListener('click', () => sendSimMessage(btn.dataset.text));
});

// Voice file simulation upload
document.getElementById('sim-voice-upload')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('audio', file);
  if (simulatorConvId) formData.append('conversation_id', simulatorConvId);

  appendSimBubble('customer', 'جاري رفع الفويس وتفريغه صوتياً...', true);

  try {
    const res = await fetch('/api/simulator/voice', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.success) {
      simulatorConvId = data.conversation.id;
      // Replace last user bubble with transcript
      simMessages.lastElementChild.previousElementSibling?.remove();
      appendSimBubble('customer', data.transcription_failed ? '🎤 فويس (ما قدر يفرّغه)' : `🎤 (تم التفريغ الصوتي): "${data.transcript}"`, true);
      appendSimBubble('bot', data.reply);
      updateSimulatorInspector(data);
      showToast('تم استقبال الفويس والتفريغ والرد الذكي بنجاح!', 'success');
    }
  } catch (err) {
    showToast('فشل تفريغ الفويس الصوتي', 'error');
  }
});

document.getElementById('sim-image-upload')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('image', file);
  if (simulatorConvId) formData.append('conversation_id', simulatorConvId);
  appendSimBubble('customer', '🖼️ جاري رفع الصورة وتحليلها...', true);
  try {
    const res = await fetch('/api/simulator/image', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.success) {
      simulatorConvId = data.conversation.id;
      simMessages.lastElementChild?.remove();
      appendSimBubble('customer', data.understood ? `🖼️ (البوت فهم الصورة): ${data.image_description}` : '🖼️ صورة (ما قدر يحللها — تأكد من مفتاح الذكاء الاصطناعي)', true);
      appendSimBubble('bot', data.reply);
      updateSimulatorInspector(data);
    } else {
      showToast(data.message || 'فشل تحليل الصورة', 'error');
    }
  } catch (err) {
    showToast('فشل رفع الصورة', 'error');
  }
  e.target.value = '';
});

document.getElementById('btn-reset-simulator')?.addEventListener('click', () => {
  simulatorConvId = null;
  simMessages.innerHTML = '';
  document.getElementById('sim-handoff-banner').style.display = 'none';
  document.getElementById('sim-inspect-stage').textContent = 'new';
  document.getElementById('sim-inspect-class').textContent = 'Cold';
  document.getElementById('sim-inspect-score').textContent = '20%';
  document.getElementById('sim-inspect-score-bar').style.width = '20%';
  document.getElementById('sim-inspect-active').textContent = 'مفعل 🟢';
  document.getElementById('sim-inspect-handoff').textContent = 'لا';
  document.getElementById('sim-inspect-problem').textContent = '-';
  document.getElementById('sim-inspect-solution').textContent = '-';
  appendSimBubble('bot', 'أهلاً وسهلاً بك في شركة atlead! كيف بنقدر نساعدك ونطور مبيعات شركتك اليوم؟');
});

// 5. KNOWLEDGE BASE TAB
async function loadKnowledge() {
  try {
    const res = await fetch('/api/knowledge');
    const data = await res.json();
    if (data.success) {
      document.getElementById('kb-system-prompt-preview').value = data.system_prompt || '';
      const extra = document.getElementById('kb-extra-text');
      if (extra) extra.value = data.extra_text || '';
      const status = document.getElementById('kb-docs-status');
      if (status) {
        status.textContent = `محمّل من Supabase: ${data.documents.map(d => `${d.title} (${d.chars.toLocaleString()} حرف)`).join(' • ')} • ${data.faq_count} سؤال شائع بأجوبة معتمدة`;
      }
      const editor = document.getElementById('kb-documents-editor');
      if (editor) {
        editor.innerHTML = (data.documents || []).map(doc => `
          <div class="glass-card" data-kb-doc="${escapeHtml(doc.id)}" style="padding: 14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:8px;">
              <strong>${escapeHtml(doc.title || 'وثيقة')}</strong>
              <span class="form-hint">${escapeHtml(doc.doc_type || 'text')} • ${Number(doc.chars || 0).toLocaleString()} حرف</span>
            </div>
            <input class="form-control kb-doc-title" value="${escapeHtml(doc.title || '')}" style="margin-bottom:8px;" aria-label="عنوان الوثيقة">
            ${doc.hint ? `<div class="form-hint" style="margin-bottom:6px;">${escapeHtml(doc.hint)}</div>` : ''}
            <textarea class="form-control kb-doc-content" rows="10" aria-label="محتوى الوثيقة">${escapeHtml(doc.content || '')}</textarea>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; gap:12px;">
              <label style="display:flex; align-items:center; gap:6px; font-size:12.5px; cursor:pointer;">
                <input type="checkbox" class="kb-doc-active" ${doc.is_active !== false ? 'checked' : ''}>
                <span>البوت بيجاوب من هاي الوثيقة</span>
              </label>
              <button type="button" class="btn btn-primary kb-doc-save"><i class="fa-solid fa-floppy-disk"></i> حفظ الوثيقة</button>
            </div>
          </div>`).join('');
        editor.querySelectorAll('.kb-doc-save').forEach(btn => btn.addEventListener('click', async () => {
          const card = btn.closest('[data-kb-doc]');
          btn.disabled = true;
          try {
            const res = await fetch(`/api/knowledge/${encodeURIComponent(card.dataset.kbDoc)}`, {
              method: 'PUT', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                title: card.querySelector('.kb-doc-title').value,
                content: card.querySelector('.kb-doc-content').value,
                is_active: card.querySelector('.kb-doc-active').checked
              })
            });
            const result = await res.json();
            showToast(result.message || (result.success ? 'تم الحفظ' : 'فشل الحفظ'), result.success ? 'success' : 'error');
            if (result.success) loadKnowledge();
          } catch (err) {
            showToast('فشل حفظ الوثيقة: ' + err.message, 'error');
          } finally { btn.disabled = false; }
        }));
      }
    }
  } catch (err) {
    console.error('Error kb:', err);
  }
}

document.getElementById('kb-new-doc-save')?.addEventListener('click', async () => {
  const btn = document.getElementById('kb-new-doc-save');
  const title = document.getElementById('kb-new-doc-title').value.trim();
  const content = document.getElementById('kb-new-doc-content').value.trim();
  if (!title || !content) return showToast('اكتب عنوان ومحتوى للوثيقة', 'error');
  btn.disabled = true;
  try {
    const res = await fetch('/api/knowledge/docs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content })
    });
    const data = await res.json();
    showToast(data.message || (data.success ? 'تمت الإضافة' : 'فشلت الإضافة'), data.success ? 'success' : 'error');
    if (data.success) {
      document.getElementById('kb-new-doc-title').value = '';
      document.getElementById('kb-new-doc-content').value = '';
      loadKnowledge();
    }
  } catch (err) {
    showToast('فشلت الإضافة: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('kb-extra-save')?.addEventListener('click', async () => {
  const btn = document.getElementById('kb-extra-save');
  btn.disabled = true;
  try {
    const res = await fetch('/api/knowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extra_text: document.getElementById('kb-extra-text').value })
    });
    const data = await res.json();
    showToast(data.message || (data.success ? 'تم الحفظ' : 'فشل الحفظ'), data.success ? 'success' : 'error');
    if (data.success) loadKnowledge();
  } catch (err) {
    showToast('فشل الحفظ: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// 6. SETTINGS TAB
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    if (data.success) {
      const s = data.settings;
      // Meta
      document.getElementById('meta-access-token').value = s.meta?.page_access_token || '';
      document.getElementById('meta-page-id').value = s.meta?.page_id || '';
      document.getElementById('meta-ig-id').value = s.meta?.instagram_account_id || '';
      document.getElementById('meta-verify-token').value = s.meta?.verify_token || 'attlead_meta_verify_token_2026';
      document.getElementById('meta-auto-reply-comments').checked = s.meta?.auto_reply_comments !== false;
      document.getElementById('meta-auto-dm-on-interest').checked = s.meta?.auto_dm_on_interest !== false;
      document.getElementById('meta-app-secret').value = s.meta?.app_secret || '';
      document.getElementById('meta-app-id').value = s.meta?.app_id || '';
      document.getElementById('meta-login-config-id').value = s.meta?.login_config_id || '';
      loadMetaOauthInfo();
      document.getElementById('meta-comment-reply-template').value = s.meta?.comment_reply_template || '';
      document.getElementById('meta-auto-dm-template').value = s.meta?.auto_dm_template || '';

      // Bot behaviour
      document.getElementById('bot-reply-delay').value = s.bot?.reply_delay_seconds ?? 10;
      document.getElementById('bot-quote-replies').checked = s.bot?.quote_replies !== false;
      document.getElementById('bot-typing-indicator').checked = s.bot?.typing_indicator !== false;
      document.getElementById('bot-pause-on-human').checked = s.bot?.pause_on_human_reply !== false;
      document.getElementById('bot-human-pause-hours').value = String(s.bot?.human_pause_hours ?? 0);
      document.getElementById('wa-mode').value = s.whatsapp?.mode || 'qr';
      applyWaModeVisibility();

      // WhatsApp
      document.getElementById('wa-phone-id').value = s.whatsapp?.phone_number_id || '';
      document.getElementById('wa-token').value = s.whatsapp?.access_token || '';
      document.getElementById('wa-linked-phone').value = s.whatsapp?.linked_phone || '00962780908299';
      document.getElementById('wa-verify-token').value = s.whatsapp?.verify_token || 'attlead_whatsapp_verify_token_2026';

      // Supabase
      document.getElementById('supa-url').value = s.supabase?.url || '';
      document.getElementById('supa-key').value = s.supabase?.service_role_key || s.supabase?.anon_key || '';
      // Checked by default while Supabase isn't set up yet, so entering credentials just works.
      document.getElementById('supa-enabled').checked = s.supabase?.enabled !== false || !s.supabase?.url;

      // Google Sheets
      document.getElementById('sheet-webhook-url').value = s.google_sheets?.webhook_url || '';
      document.getElementById('sheet-name').value = s.google_sheets?.sheet_name || 'Leads';
      document.getElementById('sheet-id').value = s.google_sheets?.sheet_id || '';
      document.getElementById('sheet-sa-json').value = s.google_sheets?.service_account_json || '';
      document.getElementById('sheet-auto-sync').checked = s.google_sheets?.auto_sync !== false;
      document.getElementById('google-form-url').value = s.google_sheets?.form_url || '';
      document.getElementById('google-form-auto-sync').checked = s.google_sheets?.form_auto_sync !== false;
      showServiceAccountEmail(s.google_sheets?.service_account_email || '');

      // Notifications
      notifyRecipients = Array.isArray(s.notifications?.recipients) ? [...s.notifications.recipients] : [];
      renderNotifyRecipients();
      document.getElementById('gmail-user').value = s.notifications?.gmail_user || '';
      document.getElementById('gmail-app-password').value = s.notifications?.gmail_app_password || '';
      document.getElementById('dashboard-url').value = s.notifications?.dashboard_url || window.location.origin;
      document.getElementById('notify-enabled').checked = s.notifications?.enabled !== false;
      document.getElementById('notify-new-messages').checked = s.notifications?.notify_new_messages_after_handoff !== false;
      document.getElementById('handoff-threshold').value = s.handoff?.closing_deal_threshold_percent ?? 85;
      loadNotifyLog();

      // Sales team / hours / follow-ups / report / backup / images
      teamMembers = Array.isArray(s.sales_team?.members) ? s.sales_team.members.map(m => ({ ...m })) : [];
      renderTeam();
      const bh = s.business_hours || {};
      document.getElementById('bh-enabled').checked = bh.enabled !== false;
      const days = Array.isArray(bh.days) ? bh.days.map(Number) : [0, 1, 2, 3, 4];
      document.querySelectorAll('.bh-day').forEach(cb => { cb.checked = days.includes(Number(cb.value)); });
      document.getElementById('bh-start').value = bh.start || '09:00';
      document.getElementById('bh-end').value = bh.end || '17:00';
      document.getElementById('bh-after-msg').value = bh.after_hours_message || 'تمام 🙏 دوامنا خلص هلق، بس {rep} رح يتواصل معك {time} لمتابعة كل التفاصيل وترتيب كل شيء معك. شكراً لاهتمامك وثقتك.';
      document.getElementById('bh-hold-emails').checked = !!bh.hold_emails_until_open;
      const fu = s.follow_up || {};
      document.getElementById('fu-enabled').checked = fu.enabled !== false;
      document.getElementById('fu-after-hours').value = String(fu.after_hours ?? 20);
      document.getElementById('fu-min-prob').value = fu.min_probability ?? 50;
      document.getElementById('fu-max').value = String(fu.max_per_customer ?? 2);
      document.getElementById('fu-use-ai').checked = fu.use_ai !== false;
      document.getElementById('fu-template').value = fu.template || 'أهلين {name} 👋 حبيت أطمّن عليك، إذا عندك أي سؤال بخصوص {topic} أنا موجود وبساعدك بكل سرور. شو رأيك نكمل؟';
      document.getElementById('rep-enabled').checked = s.daily_report?.enabled !== false;
      document.getElementById('rep-time').value = s.daily_report?.time || '20:00';
      document.getElementById('bk-enabled').checked = s.backup?.enabled !== false;
      document.getElementById('bk-keep').value = String(s.backup?.keep_days ?? 14);
      document.getElementById('image-understanding-enabled').checked = s.ai?.image_understanding_enabled !== false;
      loadBackupInfo();
      loadSupabaseSyncStatus();

      // AI
      document.getElementById('openrouter-api-key').value = s.ai?.openrouter_api_key || '';
      document.getElementById('openrouter-model').value = s.ai?.openrouter_model || 'openai/gpt-4o-mini';
      document.getElementById('voice-transcription-enabled').checked = s.ai?.voice_transcription_enabled !== false;

      // Handoff
      document.getElementById('handoff-rep-name').value = s.handoff?.representative_name || 'م. مهند من قسم المبيعات';
      document.getElementById('handoff-message-text').value = s.handoff?.handoff_message || '';

      // Dynamic host for callback URLs
      const origin = window.location.origin;
      document.getElementById('meta-webhook-url-display').value = `${origin}/webhook/meta`;
      document.getElementById('wa-webhook-url-display').value = `${origin}/webhook/whatsapp`;

      updateNavbarPills(s);
    }
  } catch (err) {
    console.error('Error settings:', err);
  }
}

document.getElementById('btn-save-all-settings')?.addEventListener('click', async () => {
  const payload = {
    meta: {
      page_access_token: document.getElementById('meta-access-token').value,
      page_id: document.getElementById('meta-page-id').value,
      instagram_account_id: document.getElementById('meta-ig-id').value,
      verify_token: document.getElementById('meta-verify-token').value,
      auto_reply_comments: document.getElementById('meta-auto-reply-comments').checked,
      auto_dm_on_interest: document.getElementById('meta-auto-dm-on-interest').checked,
      app_secret: document.getElementById('meta-app-secret').value,
      app_id: document.getElementById('meta-app-id').value.trim(),
      login_config_id: document.getElementById('meta-login-config-id').value.trim(),
      comment_reply_template: document.getElementById('meta-comment-reply-template').value,
      auto_dm_template: document.getElementById('meta-auto-dm-template').value
    },
    sales_team: { members: teamMembers },
    business_hours: {
      enabled: document.getElementById('bh-enabled').checked,
      days: [...document.querySelectorAll('.bh-day')].filter(cb => cb.checked).map(cb => Number(cb.value)),
      start: document.getElementById('bh-start').value || '09:00',
      end: document.getElementById('bh-end').value || '17:00',
      after_hours_message: document.getElementById('bh-after-msg').value.trim(),
      hold_emails_until_open: document.getElementById('bh-hold-emails').checked
    },
    follow_up: {
      enabled: document.getElementById('fu-enabled').checked,
      after_hours: Number(document.getElementById('fu-after-hours').value) || 20,
      min_probability: Number(document.getElementById('fu-min-prob').value) || 50,
      max_per_customer: Number(document.getElementById('fu-max').value) || 2,
      use_ai: document.getElementById('fu-use-ai').checked,
      template: document.getElementById('fu-template').value.trim()
    },
    daily_report: {
      enabled: document.getElementById('rep-enabled').checked,
      time: document.getElementById('rep-time').value || '20:00'
    },
    backup: {
      enabled: document.getElementById('bk-enabled').checked,
      keep_days: Number(document.getElementById('bk-keep').value) || 14
    },
    bot: {
      reply_delay_seconds: Math.max(0, Number(document.getElementById('bot-reply-delay').value) || 0),
      quote_replies: document.getElementById('bot-quote-replies').checked,
      typing_indicator: document.getElementById('bot-typing-indicator').checked,
      pause_on_human_reply: document.getElementById('bot-pause-on-human').checked,
      human_pause_hours: Number(document.getElementById('bot-human-pause-hours').value) || 0
    },
    whatsapp: {
      phone_number_id: document.getElementById('wa-phone-id').value,
      access_token: document.getElementById('wa-token').value,
      linked_phone: document.getElementById('wa-linked-phone').value,
      verify_token: document.getElementById('wa-verify-token').value,
      mode: document.getElementById('wa-mode').value
    },
    supabase: {
      url: document.getElementById('supa-url').value,
      service_role_key: document.getElementById('supa-key').value,
      enabled: document.getElementById('supa-enabled').checked
    },
    google_sheets: {
      webhook_url: document.getElementById('sheet-webhook-url').value,
      sheet_name: document.getElementById('sheet-name').value,
      sheet_id: document.getElementById('sheet-id').value,
      service_account_json: document.getElementById('sheet-sa-json').value.trim(),
      auto_sync: document.getElementById('sheet-auto-sync').checked,
      form_url: document.getElementById('google-form-url').value.trim(),
      form_auto_sync: document.getElementById('google-form-auto-sync').checked
    },
    notifications: {
      recipients: notifyRecipients,
      gmail_user: document.getElementById('gmail-user').value.trim(),
      gmail_app_password: document.getElementById('gmail-app-password').value,
      dashboard_url: document.getElementById('dashboard-url').value.trim(),
      enabled: document.getElementById('notify-enabled').checked,
      notify_new_messages_after_handoff: document.getElementById('notify-new-messages').checked
    },
    ai: {
      provider: 'openrouter',
      openrouter_api_key: document.getElementById('openrouter-api-key').value,
      openrouter_model: document.getElementById('openrouter-model').value.trim() || 'openai/gpt-4o-mini',
      voice_transcription_enabled: document.getElementById('voice-transcription-enabled').checked,
      image_understanding_enabled: document.getElementById('image-understanding-enabled').checked
    },
    handoff: {
      representative_name: document.getElementById('handoff-rep-name').value,
      handoff_message: document.getElementById('handoff-message-text').value,
      auto_stop_bot_after_handoff: true,
      closing_deal_threshold_percent: Number(document.getElementById('handoff-threshold').value) || 85
    }
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast('تم حفظ وتحديث الإعدادات بنجاح!', 'success');
      loadSettings();
    } else {
      showToast(data.message || 'فشل حفظ الإعدادات', 'error');
    }
  } catch (err) {
    showToast('فشل حفظ الإعدادات', 'error');
  }
});

// One-click Meta connect: return link + which permissions are granted.
async function loadMetaOauthInfo() {
  try {
    const d = await (await fetch('/api/meta/oauth/info')).json();
    if (!d.success) return;
    document.getElementById('meta-oauth-redirect').value = d.redirect_uri;
    if (!document.getElementById('meta-app-id').value && d.app_id) document.getElementById('meta-app-id').value = d.app_id;
    const granted = new Set(d.granted || []);
    document.getElementById('meta-scopes-list').innerHTML = Object.entries(d.scopes).map(([k, label]) =>
      `<div>${granted.size ? (granted.has(k) ? '✅' : '❌') : '•'} <code>${escapeHtml(k)}</code> — ${escapeHtml(label)}</div>`).join('') +
      (d.connected_at ? `<div style="margin-top:4px;">آخر ربط: ${escapeHtml(new Date(d.connected_at).toLocaleString('en-GB'))}</div>` : '');
  } catch { /* optional */ }
}

// The connect button needs App ID + Secret saved first.
document.getElementById('btn-meta-oauth')?.addEventListener('click', async (e) => {
  const appId = document.getElementById('meta-app-id').value.trim();
  const secret = document.getElementById('meta-app-secret').value.trim();
  if (!appId || !secret) {
    e.preventDefault();
    showToast('اكتب App ID و App Secret أولاً', 'error');
    return;
  }
  e.preventDefault();
  // Save them (and anything else typed) before leaving for Facebook.
  await fetch('/api/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meta: { app_id: appId, app_secret: secret, login_config_id: document.getElementById('meta-login-config-id').value.trim(), page_id: document.getElementById('meta-page-id').value.trim() } })
  });
  location.href = '/api/meta/oauth/start';
});

// Back from Facebook: show the result.
window.addEventListener('DOMContentLoaded', () => {
  const q = new URLSearchParams(location.search);
  const r = q.get('meta_oauth');
  if (!r) return;
  switchTab('settings');
  showToast(q.get('msg') || (r === 'ok' ? 'تم الربط ✅' : 'فشل الربط'), r === 'ok' ? 'success' : 'error');
  const box = document.getElementById('meta-diagnose-result');
  box.style.display = 'block';
  box.innerHTML = `${r === 'ok' ? '✅' : r === 'partial' ? '⚠️' : '❌'} ${escapeHtml(q.get('msg') || '')}`;
  history.replaceState(null, '', '/?tab=settings');
});

// Test Connection Buttons
document.getElementById('btn-meta-diagnose')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-meta-diagnose');
  const box = document.getElementById('meta-diagnose-result');
  btn.disabled = true;
  box.style.display = 'block';
  box.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> عم نسأل Meta مباشرة...';
  try {
    const data = await (await fetch('/api/meta/diagnose')).json();
    if (!data.success) throw new Error(data.message);
    const rows = data.checks.map(c => `
      <div style="padding: 6px 0; border-bottom: 1px solid var(--border-color);">
        ${c.ok ? '✅' : '❌'} <strong>${escapeHtml(c.label)}:</strong> ${escapeHtml(c.detail || '')}
        ${!c.ok && c.fix ? `<div style="color: var(--accent-amber); font-size: 12px;">👉 ${escapeHtml(c.fix)}</div>` : ''}
      </div>`).join('');
    const log = (data.webhook_log || []).slice(0, 15).map(e =>
      `<div>${escapeHtml(new Date(e.at).toLocaleTimeString())} — <strong>${escapeHtml(e.object)}</strong> ${escapeHtml(e.kind)} ${escapeHtml(e.detail || '')}</div>`).join('');
    box.innerHTML = rows + `
      <div style="margin-top: 10px;"><strong>آخر أحداث وصلت من Meta (منذ آخر تشغيل للسيرفر):</strong></div>
      ${log || '<div style="color: var(--text-muted);">ولا حدث لهلأ — ابعت رسالة أو تعليق تجريبي واضغط الزر مرة ثانية.</div>'}`;
  } catch (err) {
    box.innerHTML = `❌ ${escapeHtml(err.message)}`;
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('btn-test-meta-conn')?.addEventListener('click', async () => {
  const token = document.getElementById('meta-access-token').value;
  showToast('جاري فحص اتصال Meta API...', 'info');
  const res = await fetch('/api/settings/test-meta', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page_access_token: token, page_id: document.getElementById('meta-page-id').value, app_secret: document.getElementById('meta-app-secret').value })
  });
  const data = await res.json();
  showToast(data.message, data.success ? 'success' : 'error');
});

document.getElementById('btn-test-whatsapp-conn')?.addEventListener('click', async () => {
  const phoneId = document.getElementById('wa-phone-id').value;
  const token = document.getElementById('wa-token').value;
  showToast('جاري فحص اتصال WhatsApp API...', 'info');
  const res = await fetch('/api/settings/test-whatsapp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone_number_id: phoneId, access_token: token })
  });
  const data = await res.json();
  showToast(data.message, data.success ? 'success' : 'error');
});

document.getElementById('btn-test-supabase-conn')?.addEventListener('click', async () => {
  const url = document.getElementById('supa-url').value;
  const key = document.getElementById('supa-key').value;
  showToast('جاري فحص اتصال Supabase...', 'info');
  const res = await fetch('/api/settings/test-supabase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, key })
  });
  const data = await res.json();
  showToast(data.message, data.success ? 'success' : 'error');
});

document.getElementById('btn-test-sheet-conn')?.addEventListener('click', async () => {
  showToast('جاري فحص الربط مع Google Sheets...', 'info');
  const res = await fetch('/api/settings/test-google-sheets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      webhook_url: document.getElementById('sheet-webhook-url').value,
      sheet_id: document.getElementById('sheet-id').value,
      sheet_name: document.getElementById('sheet-name').value,
      service_account_json: document.getElementById('sheet-sa-json').value.trim()
    })
  });
  const data = await res.json();
  if (data.service_account_email) showServiceAccountEmail(data.service_account_email);
  showToast(data.message, data.success ? 'success' : 'error');
});

// Modals
document.getElementById('btn-open-sheet-script-modal')?.addEventListener('click', async () => {
  const modal = document.getElementById('modal-script');
  modal.style.display = 'flex';
  const res = await fetch('/google_apps_script.js');
  const text = await res.text();
  document.getElementById('apps-script-code-box').value = text;
});

document.getElementById('btn-show-sql-schema')?.addEventListener('click', async () => {
  const modal = document.getElementById('modal-sql');
  modal.style.display = 'flex';
  const res = await fetch('/supabase_schema.sql');
  const text = await res.text();
  document.getElementById('sql-schema-code-box').value = text;
});

// Sync current lead from side panel
document.getElementById('btn-sync-current-lead')?.addEventListener('click', async () => {
  if (!activeConvId) return;
  const res = await fetch('/api/leads');
  const data = await res.json();
  const lead = (data.leads || []).find(l => l.conversation_id === activeConvId);
  if (lead) {
    await syncLeadToSheet(lead.id);
  } else {
    showToast('هذه المحادثة لم تصل بعد لمرحلة تأهيل العميل كـ Lead مسجل', 'info');
  }
});

// Helper functions
function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function updateNavbarPills(s) {
  const metaPill = document.getElementById('pill-meta');
  const waPill = document.getElementById('pill-whatsapp');
  const supaPill = document.getElementById('pill-supabase');
  const sheetsPill = document.getElementById('pill-sheets');

  if (s.meta?.page_access_token) {
    metaPill.className = 'badge-pill success';
    metaPill.innerHTML = '<i class="fa-brands fa-meta"></i> <span>Meta متصل</span>';
  } else {
    metaPill.className = 'badge-pill warning';
    metaPill.innerHTML = '<i class="fa-brands fa-meta"></i> <span>Meta جاهز للربط</span>';
  }

  if ((s.whatsapp?.mode || 'qr') === 'qr') {
    waPill.className = s.whatsapp?.qr_connected_number ? 'badge-pill success' : 'badge-pill warning';
    waPill.innerHTML = s.whatsapp?.qr_connected_number
      ? `<i class="fa-brands fa-whatsapp"></i> <span>WhatsApp +${escapeHtml(s.whatsapp.qr_connected_number)}</span>`
      : '<i class="fa-brands fa-whatsapp"></i> <span>WhatsApp غير مربوط</span>';
  } else if (s.whatsapp?.phone_number_id && s.whatsapp?.access_token) {
    waPill.className = 'badge-pill success';
    waPill.innerHTML = '<i class="fa-brands fa-whatsapp"></i> <span>WhatsApp متصل</span>';
  } else {
    waPill.className = 'badge-pill info';
    waPill.innerHTML = '<i class="fa-brands fa-whatsapp"></i> <span>WhatsApp جاهز</span>';
  }

  if (s.supabase?.url && (s.supabase?.service_role_key || s.supabase?.anon_key)) {
    supaPill.className = 'badge-pill success';
    supaPill.innerHTML = '<i class="fa-solid fa-database"></i> <span>Supabase متصل</span>';
  } else {
    supaPill.className = 'badge-pill info';
    supaPill.innerHTML = '<i class="fa-solid fa-database"></i> <span>Supabase محلي/نشط</span>';
  }

  if (s.google_sheets?.webhook_url || s.google_sheets?.sheet_id) {
    sheetsPill.className = 'badge-pill success';
    sheetsPill.innerHTML = '<i class="fa-solid fa-table"></i> <span>Sheets متزامن</span>';
  } else {
    sheetsPill.className = 'badge-pill warning';
    sheetsPill.innerHTML = '<i class="fa-solid fa-table"></i> <span>Sheets بانتظار الرابط</span>';
  }
}

// Initial Run
window.addEventListener('DOMContentLoaded', () => {
  loadConversations().then(() => {
    const target = new URLSearchParams(window.location.search).get('conversation');
    if (target && conversations.some(c => c.id === target)) selectConversation(target);
  });
  loadStats();
  loadSettings();
  // Welcome message in simulator
  appendSimBubble('bot', 'أهلاً وسهلاً بك في شركة atlead! كيف بنقدر نساعدك ونطور مبيعات شركتك اليوم؟');
});


// 7. WHATSAPP QR LINKING
let waPollTimer = null;

function applyWaModeVisibility() {
  const mode = document.getElementById('wa-mode')?.value || 'qr';
  document.getElementById('wa-qr-section').style.display = mode === 'qr' ? '' : 'none';
  document.getElementById('wa-cloud-section').style.display = mode === 'cloud_api' ? '' : 'none';
  if (mode === 'qr') startWaPolling(); else stopWaPolling();
}

function startWaPolling() {
  if (waPollTimer) return;
  refreshWaStatus();
  waPollTimer = setInterval(() => {
    if (!document.getElementById('view-settings').classList.contains('active')) return;
    refreshWaStatus();
  }, 2500);
}
function stopWaPolling() { clearInterval(waPollTimer); waPollTimer = null; }

async function refreshWaStatus() {
  try {
    const res = await fetch('/api/whatsapp/status');
    const st = await res.json();
    renderWaStatus(st);
  } catch (e) { /* ignore */ }
}

function renderWaStatus(st) {
  const statusEl = document.getElementById('wa-qr-status');
  const img = document.getElementById('wa-qr-img');
  const help = document.getElementById('wa-qr-help');
  const code = document.getElementById('wa-pairing-code');
  const btnConnect = document.getElementById('btn-wa-connect');
  const btnPair = document.getElementById('btn-wa-pair');
  const btnLogout = document.getElementById('btn-wa-logout');

  img.style.display = 'none'; help.style.display = 'none'; code.style.display = 'none';
  btnConnect.style.display = ''; btnPair.style.display = ''; btnLogout.style.display = 'none';
  statusEl.className = 'wa-qr-status';

  if (st.status === 'connected') {
    statusEl.classList.add('ok');
    statusEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> مربوط بالرقم +${escapeHtml(st.connected_number || '')}${st.connected_name ? ' — ' + escapeHtml(st.connected_name) : ''}`;
    if (st.number_mismatch) {
      statusEl.innerHTML += `<div style="color:#fbbf24; font-size:12px; margin-top:6px;">⚠️ الرقم المربوط مختلف عن الرقم المدخل (${escapeHtml(st.expected_number)})</div>`;
    }
    btnConnect.style.display = 'none'; btnPair.style.display = 'none'; btnLogout.style.display = '';
  } else if (st.status === 'qr') {
    statusEl.innerHTML = 'امسح الكود من هاتفك';
    if (st.qr) { img.src = st.qr; img.style.display = ''; }
    if (st.pairing_code) { code.textContent = st.pairing_code; code.style.display = ''; }
    help.style.display = '';
    btnConnect.style.display = 'none';
  } else if (st.status === 'connecting') {
    statusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الاتصال...';
    btnConnect.style.display = 'none';
  } else {
    statusEl.innerHTML = 'غير مربوط — اضغط "توليد QR"';
  }
}

document.getElementById('wa-mode')?.addEventListener('change', applyWaModeVisibility);

document.getElementById('btn-wa-connect')?.addEventListener('click', async () => {
  const res = await fetch('/api/whatsapp/connect', { method: 'POST' });
  const data = await res.json();
  if (!data.success) showToast(data.message, 'error');
  renderWaStatus(data);
  startWaPolling();
});

document.getElementById('btn-wa-pair')?.addEventListener('click', async () => {
  const phone = document.getElementById('wa-linked-phone').value;
  showToast('جاري توليد كود الربط...', 'info');
  const res = await fetch('/api/whatsapp/pairing-code', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone })
  });
  const data = await res.json();
  if (data.success) {
    showToast('واتساب ← الأجهزة المرتبطة ← ربط جهاز ← الربط برقم الهاتف، وأدخل الكود', 'success');
    refreshWaStatus();
  } else showToast(data.message, 'error');
});

document.getElementById('btn-wa-logout')?.addEventListener('click', async () => {
  if (!confirm('متأكد بدك تفصل رقم الواتساب عن البوت؟')) return;
  const res = await fetch('/api/whatsapp/logout', { method: 'POST' });
  const data = await res.json();
  showToast(data.message || 'تم الفصل', 'info');
  renderWaStatus(data);
});


// 8. EMAIL NOTIFICATIONS + SHEETS HELPERS
let notifyRecipients = [];

function renderNotifyRecipients() {
  const box = document.getElementById('notify-email-list');
  if (!box) return;
  box.innerHTML = notifyRecipients.length
    ? notifyRecipients.map((e, i) => `<span class="email-chip">${escapeHtml(e)} <button type="button" data-i="${i}" title="حذف">×</button></span>`).join('')
    : '<span style="font-size: 12px; color: var(--text-muted);">لا يوجد إيميلات بعد</span>';
  box.querySelectorAll('button[data-i]').forEach(b => b.addEventListener('click', () => {
    notifyRecipients.splice(Number(b.dataset.i), 1);
    renderNotifyRecipients();
    showToast('اضغط "حفظ وتحديث الإعدادات" لتثبيت التغيير', 'info');
  }));
}

document.getElementById('btn-add-notify-email')?.addEventListener('click', () => {
  const input = document.getElementById('notify-email-input');
  const email = input.value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showToast('اكتب إيميل صحيح', 'error');
  if (!notifyRecipients.includes(email)) notifyRecipients.push(email);
  input.value = '';
  renderNotifyRecipients();
  showToast('تمت الإضافة — اضغط "حفظ وتحديث الإعدادات" لتثبيتها', 'info');
});

document.getElementById('btn-test-email')?.addEventListener('click', async () => {
  showToast('جاري إرسال إيميل تجريبي... (احفظ الإعدادات أولاً إذا عدلت شي)', 'info');
  const res = await fetch('/api/notifications/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipients: notifyRecipients })
  });
  const data = await res.json();
  showToast(data.message, data.success ? 'success' : 'error');
  loadNotifyLog();
});

async function loadNotifyLog() {
  const box = document.getElementById('notify-log');
  if (!box) return;
  try {
    const res = await fetch('/api/notifications/log');
    const data = await res.json();
    const items = (data.log || []).slice(0, 6);
    box.innerHTML = items.length ? items.map(n => `
      <div class="notify-log-item">
        <span>${n.status === 'sent' ? '✅' : '❌'}</span>
        <span>${escapeHtml(n.subject || n.type)}</span>
        <span style="color: var(--text-muted);">${formatTime(n.created_at)}</span>
        ${n.error ? `<div style="color:#f87171; font-size: 11px; width: 100%;">${escapeHtml(n.error)}</div>` : ''}
      </div>`).join('') : '<span style="color: var(--text-muted);">لا يوجد إشعارات بعد</span>';
  } catch (e) { /* ignore */ }
}

function showServiceAccountEmail(email) {
  const box = document.getElementById('sheet-sa-email-box');
  if (!box) return;
  box.style.display = email ? '' : 'none';
  document.getElementById('sheet-sa-email').value = email || '';
}

document.getElementById('sheet-sa-json')?.addEventListener('input', (e) => {
  try {
    const j = JSON.parse(e.target.value);
    if (j.client_email) showServiceAccountEmail(j.client_email);
  } catch (err) { /* still typing */ }
});

async function notifyLead(leadId) {
  showToast('جاري إرسال تفاصيل العميل بالإيميل...', 'info');
  const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}/notify`, { method: 'POST' });
  const data = await res.json();
  showToast(data.message, data.success ? 'success' : 'error');
  loadLeads();
}

// 9. SYSTEM HEALTH CHECK
document.getElementById('btn-run-health')?.addEventListener('click', async () => {
  const box = document.getElementById('health-results');
  const btn = document.getElementById('btn-run-health');
  btn.disabled = true;
  box.innerHTML = '<div style="color: var(--text-muted); font-size: 13px;"><i class="fa-solid fa-spinner fa-spin"></i> جاري الفحص... (حتى 25 ثانية)</div>';
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    const icon = { ok: '✅', warn: '⚠️', error: '❌' };
    box.innerHTML = `
      <div class="health-summary">
        <span class="badge-pill success">${data.summary.ok} شغال</span>
        <span class="badge-pill warning">${data.summary.warn} تنبيه</span>
        <span class="badge-pill danger">${data.summary.error} مشكلة</span>
      </div>
      ${data.results.map(r => `
        <div class="health-row ${r.status}">
          <span class="health-icon">${icon[r.status]}</span>
          <div><strong>${escapeHtml(r.label)}</strong><div class="health-msg">${escapeHtml(r.message)}</div></div>
        </div>`).join('')}`;
  } catch (e) {
    box.innerHTML = '<div style="color:#f87171">تعذر تشغيل الفحص</div>';
  } finally {
    btn.disabled = false;
  }
});

// Why is the bot off for this customer?
function botOffLabel(conv) {
  if (conv.pause_reason === 'human_reply') {
    const until = conv.bot_paused_until ? ` لغاية ${new Date(conv.bot_paused_until).toLocaleString('ar-JO', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'numeric' })}` : ' لحد ما ترجّعه';
    return `موقوف — موظف رد${conv.pause_source ? ' من ' + conv.pause_source : ''}${until}`;
  }
  if (conv.pause_reason === 'manual') return 'موقوف يدوياً';
  return 'محوّل للموظف — البوت ما بيرد';
}

// 10. SALES TEAM / FOLLOW-UPS / REPORT / BACKUP
let teamMembers = [];

function renderTeam() {
  const box = document.getElementById('team-list');
  if (!box) return;
  box.innerHTML = teamMembers.length ? teamMembers.map((m, i) => `
    <div class="team-row">
      <label title="مفعّل"><input type="checkbox" data-active="${i}" ${m.active !== false ? 'checked' : ''}></label>
      <strong>${escapeHtml(m.name)}</strong>
      <span style="direction: ltr; color: var(--text-muted);">${escapeHtml(m.email)}</span>
      <button type="button" class="btn btn-secondary btn-sm" data-remove="${i}" title="حذف"><i class="fa-solid fa-trash"></i></button>
    </div>`).join('') : '<span style="font-size: 12px; color: var(--text-muted);">ما في موظفين — الإيميلات بتروح للإدارة.</span>';
  box.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => { teamMembers.splice(Number(b.dataset.remove), 1); renderTeam(); showToast('اضغط "حفظ وتحديث الإعدادات" للتثبيت', 'info'); }));
  box.querySelectorAll('[data-active]').forEach(cb => cb.addEventListener('change', () => { teamMembers[Number(cb.dataset.active)].active = cb.checked; }));
}

document.getElementById('btn-add-team')?.addEventListener('click', () => {
  const name = document.getElementById('team-new-name').value.trim();
  const email = document.getElementById('team-new-email').value.trim().toLowerCase();
  if (!name) return showToast('اكتب اسم الموظف', 'error');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showToast('اكتب إيميل صحيح', 'error');
  if (teamMembers.some(m => m.email === email)) return showToast('الإيميل موجود', 'error');
  teamMembers.push({ id: email, name, email, active: true });
  document.getElementById('team-new-name').value = '';
  document.getElementById('team-new-email').value = '';
  renderTeam();
  showToast('تمت الإضافة — اضغط "حفظ وتحديث الإعدادات"', 'info');
});

document.getElementById('btn-followup-preview')?.addEventListener('click', async () => {
  const data = await (await fetch('/api/follow-ups/preview')).json();
  const box = document.getElementById('fu-preview');
  const labels = { whatsapp: 'واتساب', instagram_dm: 'إنستغرام', facebook_messenger: 'ماسنجر' };
  box.innerHTML = data.candidates.length
    ? '<div style="margin-top:8px;">رح تنبعت متابعة لـ:</div>' + data.candidates.map(c => `<div>• ${escapeHtml(c.name)} (${labels[c.channel] || c.channel}، ${c.score}%، ساكت من ${c.silent_hours} ساعة)</div>`).join('')
    : '<div style="margin-top:8px; color: var(--text-muted);">ما في عملاء بحاجة متابعة هلق.</div>';
});

document.getElementById('btn-report-now')?.addEventListener('click', async () => {
  showToast('جاري إرسال التقرير...', 'info');
  const data = await (await fetch('/api/reports/daily/send', { method: 'POST' })).json();
  showToast(data.message, data.success ? 'success' : 'error');
  loadNotifyLog();
});

async function loadBackupInfo() {
  try {
    const data = await (await fetch('/api/backup/list')).json();
    const el = document.getElementById('bk-last');
    if (el) el.textContent = data.last ? `آخر نسخة: ${formatTime(data.last.at)} — backups/${data.last.folder} (عدد النسخ: ${data.backups.length})` : 'لسا ما في نسخ احتياطية.';
  } catch (e) { /* ignore */ }
}

document.getElementById('btn-backup-now')?.addEventListener('click', async () => {
  const data = await (await fetch('/api/backup/now', { method: 'POST' })).json();
  showToast(data.message, data.success ? 'success' : 'error');
  loadBackupInfo();
});

// 11. SUPABASE SYNC STATUS
async function loadSupabaseSyncStatus() {
  const box = document.getElementById('supabase-sync-status');
  if (!box) return;
  try {
    const s = await (await fetch('/api/supabase/status')).json();
    if (!s.enabled) {
      box.innerHTML = '⚠️ Supabase مش مربوط — المحادثات محفوظة على السيرفر بس. أول ما تربطه، كل البيانات القديمة بتنرفع لحالها.';
      return;
    }
    const r = s.remote || {};
    const row = (label, local, remote) => `<div>${label}: <b>${remote ?? '?'}</b> محفوظ بـ Supabase من أصل ${local}</div>`;
    box.innerHTML =
      row('المحادثات', s.local.conversations, r.conversations) +
      row('الرسائل', s.local.messages, r.messages) +
      row('العملاء', s.local.leads, r.leads) +
      row('التعليقات', s.local.comments, r.comments) +
      (s.pending ? `<div style="color:#fbbf24;">⏳ ${s.pending} تغيير بانتظار الحفظ (بيعيد المحاولة تلقائياً)</div>` : '<div style="color:#34d399;">✅ كل تغيير بينحفظ تلقائياً خلال ثانيتين</div>') +
      (s.last_full_sync ? `<div>آخر فحص كامل: ${formatTime(s.last_full_sync)}</div>` : '') +
      (s.last_error ? `<div style="color:#f87171;">${escapeHtml(s.last_error.message)}</div>` : '');
  } catch (e) {
    box.textContent = 'تعذر قراءة حالة المزامنة';
  }
}

document.getElementById('btn-supabase-sync')?.addEventListener('click', async () => {
  showToast('جاري حفظ كل البيانات بـ Supabase...', 'info');
  const data = await (await fetch('/api/supabase/sync', { method: 'POST' })).json();
  showToast(data.message, data.success ? 'success' : 'error');
  loadSupabaseSyncStatus();
});
