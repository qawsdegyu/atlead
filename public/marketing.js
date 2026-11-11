/**
 * Smart marketing tab: post wizard (topic → image → caption → time),
 * market research view, scheduled/published posts, Telegram setup.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const STEPS = [
    { key: 'topic', label: 'الموضوع', icon: 'fa-lightbulb' },
    { key: 'image', label: 'الصورة', icon: 'fa-image' },
    { key: 'caption', label: 'الكابشن', icon: 'fa-pen-nib' },
    { key: 'time', label: 'وقت النشر', icon: 'fa-clock' },
    { key: 'done', label: 'النشر', icon: 'fa-rocket' }
  ];
  const STATUS = {
    topic: ['اختيار الموضوع', 'info'], image: ['اختيار الصورة', 'info'], caption: ['اختيار الكابشن', 'info'], time: ['اختيار الوقت', 'info'],
    scheduled: ['مجدول', 'warning'], publishing: ['جاري النشر', 'warning'], published: ['انتشر', 'success'], partial: ['انتشر جزئياً', 'warning'],
    failed: ['فشل', 'danger'], cancelled: ['ملغي', 'danger']
  };
  const CH_LABEL = { facebook: 'فيسبوك', instagram: 'إنستغرام', telegram: 'قناة تليجرام', _error: 'خطأ' };

  let overview = null;
  let plan = null;
  let busy = false;

  async function api(url, body, method = 'POST') {
    const opts = { method, headers: {} };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(url, method === 'GET' ? undefined : opts);
    let data;
    try { data = await res.json(); } catch { data = { success: false, message: `خطأ من السيرفر (${res.status})` }; }
    if (!data.success) throw new Error(data.message || 'حصل خطأ');
    return data;
  }

  // ---------- loading overlay for slow AI steps ----------
  function loading(msg) {
    $('mk-wizard-body').innerHTML = `<div class="mk-loading"><div class="mk-spinner"></div><p>${esc(msg)}</p><small>ممكن ياخد لحد دقيقة — لا تسكّر الصفحة</small></div>`;
  }

  async function run(msg, fn) {
    if (busy) return;
    busy = true;
    switchPane('wizard');
    const prev = plan;
    loading(msg);
    try {
      const data = await fn();
      if (data.plan) setPlan(data.plan);
      if (data.message) showToast(data.message, 'success');
    } catch (e) {
      showToast(e.message, 'error');
      plan = prev;
      render();
    } finally {
      busy = false;
      refreshList();
    }
  }

  function setPlan(p) {
    plan = p;
    const url = new URL(location.href);
    url.searchParams.set('tab', 'marketing');
    if (p) url.searchParams.set('plan', p.id); else url.searchParams.delete('plan');
    url.searchParams.delete('topic');
    history.replaceState(null, '', url);
    render();
  }

  // ---------- step indicator ----------
  function stepIndex(status) {
    if (['scheduled', 'publishing', 'published', 'partial', 'failed', 'cancelled'].includes(status)) return 4;
    return Math.max(0, STEPS.findIndex(s => s.key === status));
  }

  function renderSteps() {
    const cur = plan ? stepIndex(plan.status) : -1;
    $('mk-steps').innerHTML = STEPS.map((s, i) => `
      <div class="mk-step ${i < cur ? 'done' : i === cur ? 'current' : ''}">
        <span class="mk-step-dot">${i < cur ? '<i class="fa-solid fa-check"></i>' : `<i class="fa-solid ${s.icon}"></i>`}</span>
        <span>${s.label}</span>
      </div>`).join('<div class="mk-step-line"></div>');
  }

  const backBtn = () => `<button class="btn btn-secondary btn-sm" data-act="back"><i class="fa-solid fa-arrow-right"></i> رجوع</button>`;
  const summary = () => {
    if (!plan) return '';
    const bits = [];
    if (plan.topic && stepIndex(plan.status) > 0) bits.push(`<span><i class="fa-solid fa-lightbulb"></i> ${esc(plan.topic.title)}</span>`);
    if (plan.image && stepIndex(plan.status) > 1) bits.push(`<img src="${esc(plan.image.url)}" alt="">`);
    return bits.length ? `<div class="mk-summary">${bits.join('')}</div>` : '';
  };

  // ---------- wizard body ----------
  function render() {
    renderSteps();
    const body = $('mk-wizard-body');
    if (!plan || plan.status === 'cancelled') {
      body.innerHTML = `<div class="mk-empty"><i class="fa-solid fa-wand-magic-sparkles"></i>
        <p>${plan ? 'تم إلغاء هذا البوست.' : 'ما في بوست قيد التحضير.'} اضغط <b>بوست جديد</b> وبندرس السوق ونقترحلك 3 مواضيع.</p>
        <div class="mk-custom-topic"><input id="mk-custom-new" class="form-control" placeholder="أو اكتب موضوع من عندك وابدأ فيه مباشرة..."><button class="btn btn-secondary" data-act="custom-new">ابدأ بموضوعي</button></div></div>`;
      return;
    }
    const s = plan.status;
    if (s === 'topic') {
      body.innerHTML = `
        ${plan.market_summary ? `<div class="mk-insight"><i class="fa-solid fa-chart-line"></i> <div><b>السوق اليوم:</b> ${esc(plan.market_summary)}</div></div>` : ''}
        <h4 class="mk-q">1. اختار موضوع البوست</h4>
        <div class="mk-options">${(plan.topics || []).map((t, i) => `
          <button class="mk-option" data-act="topic" data-i="${i}">
            <span class="mk-letter">${'ABC'[i] || i + 1}</span>
            <div><div class="mk-opt-title">${esc(t.title)} ${t.format ? `<span class="mk-tag">${esc(t.format)}</span>` : ''}</div>
            <div class="mk-opt-text">${esc(t.angle)}</div>
            ${t.why ? `<div class="mk-opt-why"><i class="fa-regular fa-lightbulb"></i> ${esc(t.why)}</div>` : ''}</div>
          </button>`).join('')}
        </div>
        <div class="mk-custom-topic"><input id="mk-custom-topic" class="form-control" placeholder="ولا واحد عاجبك؟ اكتب موضوعك..."><button class="btn btn-secondary" data-act="custom">استخدم موضوعي</button></div>
        <div class="mk-actions"><button class="btn btn-secondary btn-sm" data-act="regen" data-step="topics"><i class="fa-solid fa-rotate"></i> اقترح 3 مواضيع غيرهم</button>
        <button class="btn btn-danger btn-sm" data-act="cancel">إلغاء</button></div>`;
    } else if (s === 'image') {
      const imgs = plan.images || [];
      body.innerHTML = `${summary()}
        <h4 class="mk-q">2. اختار الصورة</h4>
        ${plan.image_error ? `<div class="mk-alert">${esc(plan.image_error)}<br><small>تقدر ترفع صورة من جهازك، أو تجرّب مرة ثانية.</small></div>` : ''}
        <div class="mk-images">${imgs.map((im, i) => `
          <button class="mk-image" data-act="image" data-i="${i}">
            <img src="${esc(im.url)}" alt="" loading="lazy">
            <span class="mk-letter">${'ABCDEFGHI'[i]}</span>
            <span class="mk-image-meta">${esc(im.style || '')}${im.engine && im.engine !== 'upload' ? ` · ${esc(im.engine)}` : ''}</span>
          </button>`).join('')}
          <label class="mk-image mk-upload"><input type="file" accept="image/*" id="mk-upload" hidden>
            <i class="fa-solid fa-cloud-arrow-up"></i><span>ارفع صورتك</span></label>
        </div>
        <div class="mk-actions">${backBtn()}<button class="btn btn-secondary btn-sm" data-act="regen" data-step="images"><i class="fa-solid fa-rotate"></i> ولّد صور جديدة</button></div>`;
      $('mk-upload').addEventListener('change', (e) => {
        const f = e.target.files[0];
        if (!f) return;
        const fd = new FormData();
        fd.append('image', f);
        run('جاري رفع الصورة...', () => api(`/api/marketing/plans/${plan.id}/image-upload`, fd));
      });
    } else if (s === 'caption') {
      body.innerHTML = `${summary()}
        <h4 class="mk-q">3. اختار الكابشن</h4>
        <div class="mk-options">${(plan.captions || []).map((c, i) => `
          <div class="mk-option mk-caption" data-i="${i}">
            <span class="mk-letter">${'ABC'[i]}</span>
            <div style="flex:1;min-width:0;"><div class="mk-opt-title">${esc(c.style)}</div>
              <div class="mk-caption-text">${esc(c.text)}</div>
              <div class="mk-hashtags">${esc((c.hashtags || []).join(' '))}</div>
              <div class="mk-actions" style="margin-top:10px;">
                <button class="btn btn-primary btn-sm" data-act="caption" data-i="${i}"><i class="fa-solid fa-check"></i> اختار هذا</button>
                <button class="btn btn-secondary btn-sm" data-act="edit-caption" data-i="${i}"><i class="fa-solid fa-pen"></i> عدّل قبل ما تختار</button>
              </div></div>
          </div>`).join('')}
        </div>
        <div id="mk-caption-editor" style="display:none;margin-top:14px;">
          <textarea id="mk-caption-edit" class="form-control" rows="9"></textarea>
          <div class="mk-actions"><button class="btn btn-primary btn-sm" data-act="caption-custom"><i class="fa-solid fa-check"></i> اعتمد النص المعدّل</button></div>
        </div>
        <div class="mk-actions">${backBtn()}<button class="btn btn-secondary btn-sm" data-act="regen" data-step="captions"><i class="fa-solid fa-rotate"></i> اكتب كابشنات غيرهم</button></div>`;
    } else if (s === 'time') {
      body.innerHTML = `${summary()}
        <h4 class="mk-q">4. اختار ساعة النشر</h4>
        <div class="mk-options mk-times">${(plan.times || []).map((t, i) => `
          <button class="mk-option" data-act="time" data-i="${i}">
            <span class="mk-letter">${'ABC'[i]}</span>
            <div><div class="mk-opt-title"><i class="fa-regular fa-clock"></i> ${esc(t.label)}</div>
            <div class="mk-opt-text">${esc(t.reason)}</div></div>
          </button>`).join('') || '<p class="form-hint">ما في أوقات مقترحة.</p>'}
        </div>
        <div class="mk-custom-topic"><input type="datetime-local" id="mk-custom-time" class="form-control"><button class="btn btn-secondary" data-act="time-custom">وقت من عندي</button>
          <button class="btn btn-success" data-act="now"><i class="fa-solid fa-bolt"></i> انشر الآن</button></div>
        <div class="mk-preview-wrap">${preview()}</div>
        <div class="mk-actions">${backBtn()}</div>`;
    } else {
      body.innerHTML = renderFinal();
    }
  }

  function preview() {
    if (!plan.image) return '';
    return `<div class="mk-preview"><div class="mk-preview-head"><span class="logo-badge" style="width:28px;height:28px;font-size:12px;">at</span> <b>atlead</b></div>
      <img src="${esc(plan.image.url)}" alt=""><div class="mk-preview-caption">${esc(plan.caption || '')}</div></div>`;
  }

  function resultsHtml(p) {
    const r = p.results || {};
    const rows = Object.entries(r).map(([k, v]) => `<div class="mk-result ${v.ok ? 'ok' : 'bad'}">
      <i class="fa-solid ${v.ok ? 'fa-circle-check' : 'fa-circle-xmark'}"></i> <b>${CH_LABEL[k] || k}</b>
      ${v.ok ? (v.url ? `<a href="${esc(v.url)}" target="_blank" rel="noopener">فتح البوست ↗</a>` : 'تم') : `<span>${esc(v.error || 'فشل')}</span>`}</div>`);
    return rows.join('');
  }

  function renderFinal() {
    const s = plan.status;
    const [label, cls] = STATUS[s] || [s, 'info'];
    const head = s === 'scheduled'
      ? `<div class="mk-big-status warning"><i class="fa-solid fa-calendar-check"></i><div><b>البوست مجدول: ${esc(plan.scheduled_label || '')}</b><small>رح ينزل لحاله بهالوقت على: ${enabledChannels()}. وبيوصلك تأكيد على تليجرام.</small></div></div>`
      : `<div class="mk-big-status ${cls}"><i class="fa-solid ${s === 'published' ? 'fa-rocket' : s === 'publishing' ? 'fa-spinner fa-spin' : 'fa-triangle-exclamation'}"></i><div><b>${label}</b>${plan.error ? `<small>${esc(plan.error)}</small>` : ''}</div></div>`;
    return `${head}
      <div class="mk-results">${resultsHtml(plan)}</div>
      <div class="mk-preview-wrap">${preview()}</div>
      <div class="mk-actions">
        ${s === 'scheduled' || s === 'failed' ? backBtn().replace('رجوع', 'تغيير الوقت') : ''}
        ${s === 'scheduled' ? '<button class="btn btn-success btn-sm" data-act="now-final"><i class="fa-solid fa-bolt"></i> انشر الآن</button><button class="btn btn-danger btn-sm" data-act="cancel">إلغاء الجدولة</button>' : ''}
        ${s === 'failed' || s === 'partial' ? '<button class="btn btn-primary btn-sm" data-act="retry"><i class="fa-solid fa-rotate-right"></i> أعد محاولة النشر</button>' : ''}
        <button class="btn btn-secondary btn-sm" data-act="new"><i class="fa-solid fa-plus"></i> بوست جديد</button>
      </div>`;
  }

  function enabledChannels() {
    const ch = overview?.channels || {};
    const on = Object.values(ch).filter(c => c.enabled).map(c => c.label + (c.ready ? '' : ' ⚠️'));
    return esc(on.join('، ') || 'ولا منصة مفعّلة!');
  }

  // ---------- actions ----------
  $('mk-wizard-body').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || busy) return;
    const act = b.dataset.act;
    const i = Number(b.dataset.i);
    const P = plan ? `/api/marketing/plans/${plan.id}` : '';
    if (act === 'topic') run('جاري تصميم 3 صور مختلفة للموضوع...', () => api(`${P}/topic`, { index: i }));
    else if (act === 'custom' || act === 'custom-new') {
      const v = $(act === 'custom' ? 'mk-custom-topic' : 'mk-custom-new').value.trim();
      if (!v) return showToast('اكتب الموضوع أولاً', 'error');
      if (act === 'custom') run('جاري تصميم الصور لموضوعك...', () => api(`${P}/topic`, { custom: v }));
      else run('جاري تصميم الصور لموضوعك...', () => api('/api/marketing/plans', { topic: v }));
    } else if (act === 'image') run('جاري كتابة 3 كابشنات...', () => api(`${P}/image`, { index: i }));
    else if (act === 'caption') run('جاري حساب أفضل أوقات النشر...', () => api(`${P}/caption`, { index: i }));
    else if (act === 'edit-caption') {
      const c = plan.captions[i];
      $('mk-caption-editor').style.display = 'block';
      $('mk-caption-edit').value = `${c.text}\n\n${(c.hashtags || []).join(' ')}`;
      $('mk-caption-edit').focus();
    } else if (act === 'caption-custom') {
      const t = $('mk-caption-edit').value.trim();
      if (!t) return showToast('النص فاضي', 'error');
      run('جاري حساب أفضل أوقات النشر...', () => api(`${P}/caption`, { text: t }));
    } else if (act === 'time') run('جاري الجدولة...', () => api(`${P}/schedule`, { index: i }));
    else if (act === 'time-custom') {
      const v = $('mk-custom-time').value;
      if (!v) return showToast('اختار التاريخ والساعة', 'error');
      run('جاري الجدولة...', () => api(`${P}/schedule`, { iso: new Date(v).toISOString() }));
    } else if (act === 'now' || act === 'now-final') {
      if (!confirm(`رح ينزل البوست هلق على: ${enabledChannels().replace(/&[a-z]+;/g, '')}. متأكد؟`)) return;
      run('جاري النشر على المنصات...', () => api(`${P}/schedule`, { now: true }));
    } else if (act === 'regen') {
      const msgs = { topics: 'جاري دراسة السوق واقتراح مواضيع جديدة...', images: 'جاري توليد صور جديدة...', captions: 'جاري كتابة كابشنات جديدة...' };
      run(msgs[b.dataset.step], () => api(`${P}/regenerate`, { step: b.dataset.step }));
    } else if (act === 'back') run('...', () => api(`${P}/back`, {}));
    else if (act === 'retry') run('جاري إعادة النشر...', () => api(`${P}/retry`, {}));
    else if (act === 'cancel') {
      if (!confirm('إلغاء هذا البوست؟')) return;
      run('...', () => api(`${P}/cancel`, {}));
    } else if (act === 'new') newPlan();
  });

  function newPlan(extra = {}) {
    run('جاري دراسة السوق والمنافسين واقتراح 3 مواضيع...', () => api('/api/marketing/plans', extra));
  }

  $('mk-btn-new-plan').addEventListener('click', () => newPlan());
  $('mk-btn-send-brief').addEventListener('click', () => run('جاري دراسة السوق وإرسال الاقتراحات على تليجرام...', () => api('/api/marketing/brief/send', {})));

  // ---------- sub tabs ----------
  function switchPane(name) {
    document.querySelectorAll('.mk-subtab').forEach(b => b.classList.toggle('active', b.dataset.mk === name));
    document.querySelectorAll('.mk-pane').forEach(p => p.classList.toggle('active', p.id === `mk-pane-${name}`));
    if (name === 'research') loadResearch();
    if (name === 'history') renderHistory();
    if (name === 'setup') fillSetup();
  }
  document.querySelectorAll('.mk-subtab').forEach(b => b.addEventListener('click', () => switchPane(b.dataset.mk)));

  // ---------- overview / status strip ----------
  async function refreshList() {
    try {
      overview = await api('/api/marketing/overview', undefined, 'GET');
    } catch (e) { return; }
    const ch = overview.channels || {};
    const pills = [
      overview.telegram.configured ? ['success', 'fa-brands fa-telegram', 'تليجرام مربوط'] : ['danger', 'fa-brands fa-telegram', 'تليجرام مش مربوط'],
      overview.ai_ready ? ['success', 'fa-solid fa-brain', 'AI جاهز'] : ['warning', 'fa-solid fa-brain', 'ما في مفتاح AI'],
      ...Object.values(ch).filter(c => c.enabled).map(c => [c.ready ? 'success' : 'warning', 'fa-solid fa-share-nodes', `${c.label}: ${c.ready ? 'جاهز للنشر' : 'ناقص ربط'}`])
    ];
    const next = (overview.plans || []).filter(p => p.status === 'scheduled').sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0];
    $('mk-status-strip').innerHTML = pills.map(([c, i, t]) => `<span class="badge-pill ${c}"><i class="${i}"></i> ${esc(t)}</span>`).join('') +
      (next ? `<span class="badge-pill info"><i class="fa-solid fa-calendar"></i> البوست الجاي: ${esc(next.scheduled_label)}</span>` : '') +
      (overview.telegram.configured ? '' : ' <a href="#" class="mk-link" id="mk-go-setup">اربطه من هون ←</a>');
    $('mk-go-setup')?.addEventListener('click', (e) => { e.preventDefault(); switchPane('setup'); });
    if (document.querySelector('.mk-subtab.active')?.dataset.mk === 'history') renderHistory();
    // A scheduled post was published in the background → show the result.
    const fresh = plan && !busy ? (overview.plans || []).find(x => x.id === plan.id) : null;
    if (fresh && (fresh.status !== plan.status || fresh.updated_at !== plan.updated_at) && ['scheduled', 'publishing', 'published', 'partial', 'failed'].includes(fresh.status)) {
      plan = fresh;
      render();
    }
  }

  function renderHistory() {
    const list = overview?.plans || [];
    if (!list.length) { $('mk-history-body').innerHTML = '<div class="mk-empty"><p>ما في بوستات لسا.</p></div>'; return; }
    $('mk-history-body').innerHTML = `<div class="mk-history">${list.map(p => {
      const [label, cls] = STATUS[p.status] || [p.status, 'info'];
      return `<div class="mk-history-item" data-id="${esc(p.id)}">
        ${p.image ? `<img src="${esc(p.image.url)}" alt="">` : '<div class="mk-noimg"><i class="fa-regular fa-image"></i></div>'}
        <div class="mk-history-info">
          <div class="mk-opt-title">${esc(p.topic?.title || (p.topics || []).map(t => t.title).join(' / ') || 'بوست')}</div>
          <div class="form-hint">${esc(p.date)} · ${p.source === 'morning' ? 'رسالة الصباح' : p.source === 'competitor' ? 'مستوحى من منافس' : 'يدوي'}${p.scheduled_label ? ` · ⏰ ${esc(p.scheduled_label)}` : ''}</div>
          <div class="mk-results compact">${resultsHtml(p)}</div>
        </div>
        <span class="badge-pill ${cls}">${label}</span>
      </div>`;
    }).join('')}</div>`;
  }
  $('mk-history-body').addEventListener('click', (e) => {
    const item = e.target.closest('.mk-history-item');
    if (!item || e.target.closest('a')) return;
    const p = (overview.plans || []).find(x => x.id === item.dataset.id);
    if (p) { setPlan(p); switchPane('wizard'); }
  });

  // ---------- research ----------
  async function loadResearch(refresh = false) {
    const box = $('mk-research-body');
    box.innerHTML = `<div class="mk-loading"><div class="mk-spinner"></div><p>جاري قراءة السوق والمنافسين...</p></div>`;
    let r;
    try { r = await api(`/api/marketing/research${refresh ? '?refresh=1' : ''}`, undefined, 'GET'); } catch (e) {
      box.innerHTML = `<div class="mk-alert">${esc(e.message)}</div>`; return;
    }
    const comps = r.competitors || [];
    const cs = r.customers || {};
    box.innerHTML = `
      <div class="form-hint" style="margin-bottom:12px;">آخر تحديث: ${new Date(r.fetched_at).toLocaleString('en-GB')}</div>
      <div class="glass-card">
        <h4 class="mk-card-title"><i class="fa-brands fa-instagram" style="color:#e1306c;"></i> المنافسون — أكثر بوستاتهم تفاعلاً</h4>
        ${!comps.length ? '<p class="form-hint">ما في منافسين مضافين. أضفهم من تبويب <b>الإعدادات والربط</b>.</p>' : comps.map(c => c.error
          ? `<div class="mk-comp"><b>@${esc(c.username)}</b> <span class="mk-alert inline">${esc(c.error)}</span></div>`
          : `<div class="mk-comp"><div class="mk-comp-head"><b>@${esc(c.username)}</b> <span class="form-hint">${c.followers.toLocaleString()} متابع · متوسط تفاعل ${c.avg_engagement}</span></div>
            ${(c.posts || []).map(p => `<div class="mk-comp-post">
              <div class="mk-comp-stats"><span>❤️ ${p.likes}</span><span>💬 ${p.comments}</span></div>
              <div class="mk-comp-cap">${esc(p.caption.slice(0, 220)) || '<i>بدون نص</i>'}</div>
              <div class="mk-comp-actions">
                ${p.permalink ? `<a href="${esc(p.permalink)}" target="_blank" rel="noopener" class="mk-link">فتح ↗</a>` : ''}
                <button class="btn btn-secondary btn-sm" data-inspire="${esc(p.caption.slice(0, 400))}"><i class="fa-solid fa-wand-magic-sparkles"></i> اعمل بوست أحسن عن نفس الموضوع</button>
              </div></div>`).join('')}</div>`).join('')}
      </div>
      <div class="grid-2">
        <div class="glass-card">
          <h4 class="mk-card-title"><i class="fa-solid fa-comments" style="color:#34d399;"></i> شو بيسألوا عملاءك (من البوت والتعليقات)</h4>
          ${[['مجالاتهم', cs.business_types], ['مشاكلهم', cs.problems], ['طلباتهم', cs.requests], ['اعتراضاتهم', cs.objections], ['تعليقات مهتمة', cs.comments]]
            .filter(([, v]) => v && v.length).map(([k, v]) => `<div class="mk-signal"><b>${k}</b><ul>${v.slice(0, 6).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('') || '<p class="form-hint">لسا ما في محادثات كافية.</p>'}
        </div>
        <div class="glass-card">
          <h4 class="mk-card-title"><i class="fa-solid fa-clock" style="color:#f59e0b;"></i> أفضل أوقات النشر الجاية</h4>
          ${(r.best_times || []).map(t => `<div class="mk-signal"><b>${esc(t.label)}</b><div class="form-hint">${esc(t.reason)}</div></div>`).join('')}
          <p class="form-hint">${r.own_count >= 8 ? `محسوبة من تفاعل ${r.own_count} بوست سابق إلكم + أوقات الذروة بالمنطقة.` : 'محسوبة من أوقات الذروة بالأردن والمنطقة — بتصير أدق كل ما تنشروا أكتر.'}</p>
          <h4 class="mk-card-title" style="margin-top:16px;"><i class="fa-solid fa-trophy" style="color:#fbbf24;"></i> أنجح بوستاتكم</h4>
          ${(r.own_top || []).map(p => `<div class="mk-signal"><span class="form-hint">تفاعل ${p.engagement} · ${p.platform === 'instagram' ? 'إنستغرام' : 'فيسبوك'}</span><div>${esc(p.text.slice(0, 140)) || '<i>بدون نص</i>'}</div></div>`).join('') || '<p class="form-hint">ما قدرنا نقرأ بوستاتكم (تأكد من ربط Meta).</p>'}
        </div>
      </div>
      <div class="glass-card">
        <h4 class="mk-card-title"><i class="fa-solid fa-newspaper" style="color:#60a5fa;"></i> أخبار المجال هالأسبوع</h4>
        ${(r.news || []).map(n => `<div class="mk-news"><span class="mk-tag">${esc(n.keyword)}</span> ${esc(n.title)} <button class="btn btn-secondary btn-sm" data-news="${esc(n.title)}">بوست عن هالخبر</button></div>`).join('') || '<p class="form-hint">ما في أخبار حالياً.</p>'}
      </div>`;
  }
  $('mk-research-body').addEventListener('click', (e) => {
    const ins = e.target.closest('[data-inspire]');
    const news = e.target.closest('[data-news]');
    if (ins) {
      const topic = prompt('شو عنوان البوست تبعك؟ (بنكتبه بأسلوبنا وبدون نسخ)', ins.dataset.inspire.split('\n')[0].slice(0, 80));
      if (topic) run('جاري تصميم الصور...', () => api('/api/marketing/plans', { topic, inspired_by: ins.dataset.inspire }));
    } else if (news) {
      run('جاري تصميم الصور...', () => api('/api/marketing/plans', { topic: `رأينا بخبر: ${news.dataset.news}`.slice(0, 140), inspired_by: news.dataset.news }));
    }
  });
  $('mk-btn-refresh-research').addEventListener('click', () => loadResearch(true));

  // ---------- setup ----------
  async function fillSetup() {
    let s;
    try { s = (await api('/api/settings', undefined, 'GET')).settings; } catch { return; }
    const m = s.marketing || {}; const t = s.telegram || {};
    $('mk-tg-token').value = t.bot_token || '';
    $('mk-tg-chats').value = (t.chat_ids || []).join(', ');
    $('mk-tg-channel').value = t.channel_id || '';
    $('mk-tg-handoffs').checked = t.notify_handoffs !== false;
    $('mk-competitors').value = (m.competitors || []).map(c => `@${c}`).join('\n');
    $('mk-keywords').value = (m.keywords || []).join('، ');
    $('mk-business').value = m.business_description || '';
    $('mk-morning-time').value = m.morning_time || '09:00';
    $('mk-language').value = m.language || 'ar';
    $('mk-brand-style').value = m.brand_style || '';
    $('mk-image-model').value = m.image_model || '';
    $('mk-enabled').checked = m.enabled !== false;
    $('mk-free-images').checked = m.free_image_fallback !== false;
    $('mk-pub-fb').checked = m.publish_facebook !== false;
    $('mk-pub-ig').checked = m.publish_instagram !== false;
    $('mk-pub-tg').checked = m.publish_telegram_channel === true;
    $('mk-public-url').value = m.public_url || '';
    if (!m.public_url && overview?.public_url) $('mk-public-url').placeholder = `${overview.public_url} (تلقائي)`;
    const ch = overview?.channels || {};
    $('mk-channels-status').innerHTML = Object.values(ch).map(c => `<div class="mk-result ${c.ready ? 'ok' : 'bad'}"><i class="fa-solid ${c.ready ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i> <b>${esc(c.label)}</b> ${c.ready ? 'جاهز' : esc(c.note)}</div>`).join('');
  }

  $('mk-btn-save-setup').addEventListener('click', async () => {
    const body = {
      telegram: {
        bot_token: $('mk-tg-token').value.trim(),
        chat_ids: $('mk-tg-chats').value,
        channel_id: $('mk-tg-channel').value.trim(),
        notify_handoffs: $('mk-tg-handoffs').checked
      },
      marketing: {
        competitors: $('mk-competitors').value.split(/[\n,،]+/).map(x => x.trim().replace(/^@/, '')).filter(Boolean),
        keywords: $('mk-keywords').value.split(/[\n,،]+/).map(x => x.trim()).filter(Boolean),
        business_description: $('mk-business').value.trim(),
        morning_time: $('mk-morning-time').value || '09:00',
        language: $('mk-language').value,
        brand_style: $('mk-brand-style').value.trim(),
        image_model: $('mk-image-model').value.trim(),
        enabled: $('mk-enabled').checked,
        free_image_fallback: $('mk-free-images').checked,
        publish_facebook: $('mk-pub-fb').checked,
        publish_instagram: $('mk-pub-ig').checked,
        publish_telegram_channel: $('mk-pub-tg').checked,
        public_url: $('mk-public-url').value.trim()
      }
    };
    try {
      await api('/api/settings', body);
      showToast('تم حفظ إعدادات التسويق ✅', 'success');
      await refreshList();
      fillSetup();
    } catch (e) { showToast(e.message, 'error'); }
  });

  $('mk-btn-tg-test').addEventListener('click', async () => {
    try {
      const r = await api('/api/marketing/telegram/test', { bot_token: $('mk-tg-token').value.trim() });
      showToast(r.message, 'success');
    } catch (e) { showToast(e.message, 'error'); }
  });

  $('mk-btn-tg-detect').addEventListener('click', async () => {
    const out = $('mk-tg-detect-result');
    out.textContent = 'جاري البحث...';
    try {
      const r = await api('/api/marketing/telegram/detect', { bot_token: $('mk-tg-token').value.trim() });
      out.innerHTML = r.chats.map(c => `<button type="button" class="btn btn-secondary btn-sm" data-chat="${esc(c.id)}" style="margin:4px 0 0 4px;">${esc(c.name)} (${esc(c.type)}) — ${esc(c.id)}</button>`).join('') + '<div>اضغط على محادثتك عشان تنضاف، ثم احفظ.</div>';
    } catch (e) { out.textContent = e.message; }
  });
  $('mk-tg-detect-result').addEventListener('click', (e) => {
    const b = e.target.closest('[data-chat]');
    if (!b) return;
    const cur = $('mk-tg-chats').value.split(/[\s,]+/).filter(Boolean);
    if (!cur.includes(b.dataset.chat)) cur.push(b.dataset.chat);
    $('mk-tg-chats').value = cur.join(', ');
  });

  // ---------- open the tab (also from the Telegram link: ?tab=marketing&plan=...&topic=1) ----------
  let opened = false;
  window.mkOpen = async function () {
    await refreshList();
    if (opened) return;
    opened = true;
    const q = new URLSearchParams(location.search);
    const id = q.get('plan');
    let p = id ? (overview?.plans || []).find(x => x.id === id) : null;
    if (id && !p) { try { p = (await api(`/api/marketing/plans/${encodeURIComponent(id)}`, undefined, 'GET')).plan; } catch { /* gone */ } }
    // Otherwise continue the newest unfinished post.
    if (!p) p = (overview?.plans || []).find(x => ['topic', 'image', 'caption', 'time'].includes(x.status)) || null;
    plan = p;
    render();
    const topic = q.get('topic');
    if (p && p.status === 'topic' && topic !== null && p.topics?.[Number(topic)]) {
      run('جاري تصميم 3 صور مختلفة للموضوع...', () => api(`/api/marketing/plans/${p.id}/topic`, { index: Number(topic) }));
    }
  };

  window.addEventListener('DOMContentLoaded', () => {
    if (new URLSearchParams(location.search).get('tab') === 'marketing') switchTab('marketing');
  });
  // Keep the status of scheduled posts fresh while the tab is open.
  setInterval(() => { if (currentTab === 'marketing' && !busy) refreshList(); }, 60000);
})();
