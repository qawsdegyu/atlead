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
    { key: 'caption', label: 'النص', icon: 'fa-pen-nib' },
    { key: 'time', label: 'وقت النشر', icon: 'fa-clock' },
    { key: 'done', label: 'النشر', icon: 'fa-rocket' }
  ];
  const STATUS = {
    topic: ['اختيار الموضوع', 'info'], image: ['اختيار الصورة', 'info'], caption: ['اختيار النص', 'info'], time: ['اختيار الوقت', 'info'],
    scheduled: ['مجدول', 'warning'], publishing: ['جاري النشر', 'warning'], published: ['نُشر', 'success'], partial: ['نُشر جزئياً', 'warning'],
    failed: ['فشل', 'danger'], cancelled: ['ملغي', 'danger']
  };
  const CH_LABEL = { facebook: 'فيسبوك', instagram: 'إنستغرام', telegram: 'قناة تليجرام', _error: 'خطأ' };

  let overview = null;
  let plan = null;
  let busy = false;
  let focusFile = null;   // image open in the studio (image step)
  let captionDraft = '';  // caption being refined in the caption chat

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
    $('mk-wizard-body').innerHTML = `<div class="mk-loading"><div class="mk-spinner"></div><p>${esc(msg)}</p><small>قد يستغرق ذلك حتى دقيقة — لا تغلق الصفحة</small></div>`;
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

  async function chatCall(logId, msg, waiting, fn) {
    if (busy) return;
    busy = true;
    const log = $(logId);
    if (log) {
      log.querySelector('.mk-chat-empty')?.remove();
      log.insertAdjacentHTML('beforeend', `<div class="mk-msg me">${esc(msg)}</div><div class="mk-msg ai typing"><i class="fa-solid fa-spinner fa-spin"></i> ${esc(waiting)}</div>`);
      log.scrollTop = log.scrollHeight;
    }
    document.querySelectorAll('#mk-wizard-body [data-act="image-send"], #mk-wizard-body [data-act="caption-send"]').forEach(x => { x.disabled = true; });
    try {
      await fn();
    } catch (err) {
      showToast(err.message, 'error');
      log?.querySelector('.typing')?.remove();
      document.querySelectorAll('#mk-wizard-body [data-act="image-send"], #mk-wizard-body [data-act="caption-send"]').forEach(x => { x.disabled = false; });
    } finally {
      busy = false;
    }
  }

  function setPlan(p) {
    if (!p || !plan || p.id !== plan.id || p.status !== plan.status) { focusFile = null; captionDraft = ''; }
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
        <p>${plan ? 'تم إلغاء هذا المنشور.' : 'لا يوجد منشور قيد التحضير.'} اضغط <b>منشور جديد</b> وسندرس السوق ونقترح عليك 3 مواضيع.</p>
        <div class="mk-custom-topic"><input id="mk-custom-new" class="form-control" placeholder="أو اكتب موضوعاً من عندك وابدأ به مباشرة..."><button class="btn btn-secondary" data-act="custom-new">ابدأ بموضوعي</button></div></div>`;
      return;
    }
    const s = plan.status;
    if (s === 'topic') {
      body.innerHTML = `
        ${plan.market_summary ? `<div class="mk-insight"><i class="fa-solid fa-chart-line"></i> <div><b>السوق اليوم:</b> ${esc(plan.market_summary)}</div></div>` : ''}
        <h4 class="mk-q">1. اختر موضوع المنشور</h4>
        <div class="mk-options">${(plan.topics || []).map((t, i) => `
          <button class="mk-option" data-act="topic" data-i="${i}">
            <span class="mk-letter">${'ABC'[i] || i + 1}</span>
            <div><div class="mk-opt-title">${esc(t.title)} ${t.format ? `<span class="mk-tag">${esc(t.format)}</span>` : ''}</div>
            <div class="mk-opt-text">${esc(t.angle)}</div>
            ${t.why ? `<div class="mk-opt-why"><i class="fa-regular fa-lightbulb"></i> ${esc(t.why)}</div>` : ''}</div>
          </button>`).join('')}
        </div>
        <div class="mk-custom-topic"><input id="mk-custom-topic" class="form-control" placeholder="لم يعجبك أي منها؟ اكتب موضوعك..."><button class="btn btn-secondary" data-act="custom">استخدم موضوعي</button></div>
        <div class="mk-actions"><button class="btn btn-secondary btn-sm" data-act="regen" data-step="topics"><i class="fa-solid fa-rotate"></i> اقترح 3 مواضيع أخرى</button>
        <button class="btn btn-danger btn-sm" data-act="cancel">إلغاء</button></div>`;
    } else if (s === 'image') {
      const imgs = plan.images || [];
      if (focusFile && !imgs.some(im => im.file === focusFile)) focusFile = null;
      const fi = imgs.findIndex(im => im.file === focusFile);
      const f = fi >= 0 ? imgs[fi] : null;
      const chat = f ? (plan.image_chat || []).filter(c => c.target === f.file || c.result === f.file || (f.root && (c.target === f.root))) : [];
      body.innerHTML = `${summary()}
        <h4 class="mk-q">2. اختر الصورة</h4>
        <p class="form-hint" style="margin:-8px 0 12px;">اضغط على أي صورة لتكبيرها وتعديلها بالمحادثة، أو اعتمدها مباشرة.</p>
        ${plan.image_error ? `<div class="mk-alert">${esc(plan.image_error)}<br><small>يمكنك رفع صورة من جهازك، أو المحاولة مرة أخرى.</small></div>` : ''}
        ${f ? `
        <div class="mk-studio">
          <div class="mk-studio-img"><img src="${esc(f.url)}" alt="">
            <span class="mk-image-meta">${esc(f.style || '')}${f.engine && f.engine !== 'upload' ? ` · ${esc(f.engine)}` : ''}</span></div>
          <div class="mk-chat">
            <div class="mk-chat-head"><b><i class="fa-solid fa-wand-magic-sparkles"></i> عدّل هذه الصورة</b>
              <button class="btn btn-secondary btn-sm" data-act="close-studio" title="رجوع للصور"><i class="fa-solid fa-xmark"></i></button></div>
            <div class="mk-chat-log" id="mk-image-log">${chat.length ? chat.map(c => c.role === 'user'
              ? `<div class="mk-msg me">${esc(c.text)}</div>`
              : `<div class="mk-msg ai">${esc(c.text)}${c.result && c.result !== f.file ? ` <a href="#" data-act="focus-file" data-file="${esc(c.result)}">افتح النسخة</a>` : ''}</div>`).join('')
              : '<div class="mk-chat-empty">اكتب أي تعديل بلغتك — مثلاً: «كبّر العنوان»، «اجعل الخلفية كحلية»، «غيّر الجملة إلى…»، «أضف صورة موظف مبتسم».</div>'}</div>
            <div class="mk-chips">${['كبّر العنوان واجعله أوضح', 'اجعل الألوان أقرب للهوية', 'بسّط التصميم وقلّل العناصر', 'اجعل الصورة أكثر واقعية'].map(t => `<button class="mk-chip" data-act="image-chip" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div>
            <div class="mk-chat-input"><textarea id="mk-image-msg" class="form-control" rows="2" placeholder="ما التعديل المطلوب؟"></textarea>
              <button class="btn btn-primary" data-act="image-send"><i class="fa-solid fa-paper-plane"></i></button></div>
            <button class="btn btn-success" data-act="image" data-i="${fi}" style="width:100%;margin-top:10px;"><i class="fa-solid fa-check"></i> اعتمد هذه الصورة وانتقل إلى النص</button>
          </div>
        </div>` : ''}
        <div class="mk-images">${imgs.map((im, i) => `
          <button class="mk-image${im.file === focusFile ? ' focused' : ''}" data-act="focus" data-i="${i}" title="اضغط للتكبير والتعديل">
            <img src="${esc(im.url)}" alt="" loading="lazy">
            <span class="mk-letter">${i + 1}</span>
            <span class="mk-image-meta">${esc(im.style || '')}${im.engine && im.engine !== 'upload' ? ` · ${esc(im.engine)}` : ''}</span>
          </button>`).join('')}
          <label class="mk-image mk-upload"><input type="file" accept="image/*" id="mk-upload" hidden>
            <i class="fa-solid fa-cloud-arrow-up"></i><span>ارفع صورة</span></label>
        </div>
        <div class="mk-actions">${backBtn()}<button class="btn btn-secondary btn-sm" data-act="regen" data-step="images"><i class="fa-solid fa-rotate"></i> ولّد صور جديدة</button></div>`;
      const ilog = $('mk-image-log'); if (ilog) ilog.scrollTop = ilog.scrollHeight;
      $('mk-image-msg')?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); body.querySelector('[data-act="image-send"]').click(); } });
      $('mk-upload').addEventListener('change', (e) => {
        const f = e.target.files[0];
        if (!f) return;
        const fd = new FormData();
        fd.append('image', f);
        run('جاري رفع الصورة...', () => api(`/api/marketing/plans/${plan.id}/image-upload`, fd));
      });
    } else if (s === 'caption') {
      body.innerHTML = `${summary()}
        <h4 class="mk-q">3. اختر النص</h4>
        <div class="mk-options">${(plan.captions || []).map((c, i) => `
          <div class="mk-option mk-caption" data-i="${i}">
            <span class="mk-letter">${'ABC'[i]}</span>
            <div style="flex:1;min-width:0;"><div class="mk-opt-title">${esc(c.style)}</div>
              <div class="mk-caption-text">${esc(c.text)}</div>
              <div class="mk-hashtags">${esc((c.hashtags || []).join(' '))}</div>
              <div class="mk-actions" style="margin-top:10px;">
                <button class="btn btn-primary btn-sm" data-act="caption" data-i="${i}"><i class="fa-solid fa-check"></i> اختر هذا</button>
                <button class="btn btn-secondary btn-sm" data-act="chat-caption" data-i="${i}"><i class="fa-solid fa-wand-magic-sparkles"></i> عدّله بالذكاء الاصطناعي</button>
                <button class="btn btn-secondary btn-sm" data-act="edit-caption" data-i="${i}"><i class="fa-solid fa-pen"></i> عدّل يدوياً</button>
              </div></div>
          </div>`).join('')}
        </div>
        <div id="mk-caption-editor" style="display:none;margin-top:14px;">
          <textarea id="mk-caption-edit" class="form-control" rows="9"></textarea>
          <div class="mk-actions"><button class="btn btn-primary btn-sm" data-act="caption-custom"><i class="fa-solid fa-check"></i> اعتمد النص المعدّل</button></div>
        </div>
        ${captionDraft ? `
        <div class="mk-studio mk-studio-caption" id="mk-caption-studio">
          <div class="mk-chat" style="flex:1;">
            <div class="mk-chat-head"><b><i class="fa-solid fa-wand-magic-sparkles"></i> عدّل النص بالمحادثة</b>
              <button class="btn btn-secondary btn-sm" data-act="close-caption-chat" title="إغلاق"><i class="fa-solid fa-xmark"></i></button></div>
            <textarea id="mk-caption-draft" class="form-control mk-draft" rows="8">${esc(captionDraft)}</textarea>
            <div class="mk-chat-log" id="mk-caption-log">${(plan.caption_chat || []).slice(-10).map(c => `<div class="mk-msg ${c.role === 'user' ? 'me' : 'ai'}">${esc(c.text)}</div>`).join('') || '<div class="mk-chat-empty">اطلب أي تعديل — «أقصر»، «أكثر رسمية»، «أضف سؤالاً في البداية»، «بالإنجليزية».</div>'}</div>
            <div class="mk-chips">${['اجعله أقصر', 'افتتاحية أقوى', 'نبرة أكثر رسمية', 'أضف رموزاً تعبيرية خفيفة', 'هاشتاغات أكثر'].map(t => `<button class="mk-chip" data-act="caption-chip" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div>
            <div class="mk-chat-input"><textarea id="mk-caption-msg" class="form-control" rows="2" placeholder="ما التعديل المطلوب على النص؟"></textarea>
              <button class="btn btn-primary" data-act="caption-send"><i class="fa-solid fa-paper-plane"></i></button></div>
            <button class="btn btn-success" data-act="caption-approve" style="width:100%;margin-top:10px;"><i class="fa-solid fa-check"></i> اعتمد هذا النص وانتقل إلى الموعد</button>
          </div>
        </div>` : ''}
        <div class="mk-actions">${backBtn()}<button class="btn btn-secondary btn-sm" data-act="regen" data-step="captions"><i class="fa-solid fa-rotate"></i> اكتب نصوصاً أخرى</button></div>`;
      const clog = $('mk-caption-log'); if (clog) clog.scrollTop = clog.scrollHeight;
      $('mk-caption-msg')?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); body.querySelector('[data-act="caption-send"]').click(); } });
      if (captionDraft) $('mk-caption-studio')?.scrollIntoView({ block: 'nearest' });
    } else if (s === 'time') {
      body.innerHTML = `${summary()}
        <h4 class="mk-q">4. اختر موعد النشر</h4>
        <div class="mk-options mk-times">${(plan.times || []).map((t, i) => `
          <button class="mk-option" data-act="time" data-i="${i}">
            <span class="mk-letter">${'ABC'[i]}</span>
            <div><div class="mk-opt-title"><i class="fa-regular fa-clock"></i> ${esc(t.label)}</div>
            <div class="mk-opt-text">${esc(t.reason)}</div></div>
          </button>`).join('') || '<p class="form-hint">لا توجد أوقات مقترحة.</p>'}
        </div>
        <div class="mk-custom-topic"><input type="datetime-local" id="mk-custom-time" class="form-control"><button class="btn btn-secondary" data-act="time-custom">وقت آخر</button>
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
      ${v.ok ? (v.url ? `<a href="${esc(v.url)}" target="_blank" rel="noopener">فتح البوست</a>` : 'تم') : `<span>${esc(v.error || 'فشل')}</span>`}</div>`);
    return rows.join('');
  }

  function renderFinal() {
    const s = plan.status;
    const [label, cls] = STATUS[s] || [s, 'info'];
    const head = s === 'scheduled'
      ? `<div class="mk-big-status warning"><i class="fa-solid fa-calendar-check"></i><div><b>المنشور مجدول: ${esc(plan.scheduled_label || '')}</b><small>سيُنشر تلقائياً في هذا الموعد على: ${enabledChannels()}. وسيصلك تأكيد على تليجرام.</small></div></div>`
      : `<div class="mk-big-status ${cls}"><i class="fa-solid ${s === 'published' ? 'fa-rocket' : s === 'publishing' ? 'fa-spinner fa-spin' : 'fa-triangle-exclamation'}"></i><div><b>${label}</b>${plan.error ? `<small>${esc(plan.error)}</small>` : ''}</div></div>`;
    return `${head}
      <div class="mk-results">${resultsHtml(plan)}</div>
      <div class="mk-preview-wrap">${preview()}</div>
      <div class="mk-actions">
        ${s === 'scheduled' || s === 'failed' ? backBtn().replace('رجوع', 'تغيير الوقت') : ''}
        ${s === 'scheduled' ? '<button class="btn btn-success btn-sm" data-act="now-final"><i class="fa-solid fa-bolt"></i> انشر الآن</button><button class="btn btn-danger btn-sm" data-act="cancel">إلغاء الجدولة</button>' : ''}
        ${s === 'failed' || s === 'partial' ? '<button class="btn btn-primary btn-sm" data-act="retry"><i class="fa-solid fa-rotate-right"></i> أعد محاولة النشر</button>' : ''}
        <button class="btn btn-secondary btn-sm" data-act="new"><i class="fa-solid fa-plus"></i> منشور جديد</button>
      </div>`;
  }

  function enabledChannels() {
    const ch = overview?.channels || {};
    const on = Object.values(ch).filter(c => c.enabled).map(c => c.label + (c.ready ? '' : ' (غير جاهز)'));
    return esc(on.join('، ') || 'لا توجد منصة مفعّلة.');
  }

  // ---------- actions ----------
  $('mk-wizard-body').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || busy) return;
    const act = b.dataset.act;
    const i = Number(b.dataset.i);
    const P = plan ? `/api/marketing/plans/${plan.id}` : '';
    if (act === 'focus') { focusFile = plan.images[i]?.file || null; render(); $('mk-image-msg')?.focus(); return; }
    if (act === 'focus-file') { e.preventDefault(); focusFile = b.dataset.file; render(); return; }
    if (act === 'close-studio') { focusFile = null; render(); return; }
    if (act === 'image-chip') { const t = $('mk-image-msg'); t.value = b.dataset.text; t.focus(); return; }
    if (act === 'image-send') {
      const msg = $('mk-image-msg').value.trim();
      if (!msg) return showToast('اكتب التعديل المطلوب', 'error');
      return chatCall('mk-image-log', msg, 'جاري تعديل الصورة… (قد يستغرق حتى دقيقة)', async () => {
        const d = await api(`${P}/image-chat`, { file: focusFile, message: msg });
        plan = d.plan; focusFile = d.plan.images[0]?.file || focusFile; render();
      });
    }
    if (act === 'chat-caption') { const c = plan.captions[i]; captionDraft = `${c.text}\n\n${(c.hashtags || []).join(' ')}`.trim(); render(); $('mk-caption-msg')?.focus(); return; }
    if (act === 'close-caption-chat') { captionDraft = ''; render(); return; }
    if (act === 'caption-chip') { const t = $('mk-caption-msg'); t.value = b.dataset.text; t.focus(); return; }
    if (act === 'caption-send') {
      const msg = $('mk-caption-msg').value.trim();
      if (!msg) return showToast('اكتب التعديل المطلوب', 'error');
      const current = $('mk-caption-draft').value;
      return chatCall('mk-caption-log', msg, 'جاري تعديل الكابشن…', async () => {
        const d = await api(`${P}/caption-chat`, { text: current, message: msg });
        plan = d.plan; captionDraft = d.plan.caption_draft || current; render();
      });
    }
    if (act === 'caption-approve') {
      const t = $('mk-caption-draft').value.trim();
      if (!t) return showToast('النص فارغ', 'error');
      captionDraft = '';
      return run('جاري حساب أفضل أوقات النشر...', () => api(`${P}/caption`, { text: t }));
    }
    if (act === 'topic') run('جاري تصميم 3 صور مختلفة للموضوع...', () => api(`${P}/topic`, { index: i }));
    else if (act === 'custom' || act === 'custom-new') {
      const v = $(act === 'custom' ? 'mk-custom-topic' : 'mk-custom-new').value.trim();
      if (!v) return showToast('اكتب الموضوع أولاً', 'error');
      if (act === 'custom') run('جاري تصميم الصور لموضوعك...', () => api(`${P}/topic`, { custom: v }));
      else run('جاري تصميم الصور لموضوعك...', () => api('/api/marketing/plans', { topic: v }));
    } else if (act === 'image') run('جاري كتابة 3 نصوص...', () => api(`${P}/image`, { index: i }));
    else if (act === 'caption') run('جاري حساب أفضل أوقات النشر...', () => api(`${P}/caption`, { index: i }));
    else if (act === 'edit-caption') {
      const c = plan.captions[i];
      $('mk-caption-editor').style.display = 'block';
      $('mk-caption-edit').value = `${c.text}\n\n${(c.hashtags || []).join(' ')}`;
      $('mk-caption-edit').focus();
    } else if (act === 'caption-custom') {
      const t = $('mk-caption-edit').value.trim();
      if (!t) return showToast('النص فارغ', 'error');
      run('جاري حساب أفضل أوقات النشر...', () => api(`${P}/caption`, { text: t }));
    } else if (act === 'time') run('جاري الجدولة...', () => api(`${P}/schedule`, { index: i }));
    else if (act === 'time-custom') {
      const v = $('mk-custom-time').value;
      if (!v) return showToast('اختر التاريخ والساعة', 'error');
      run('جاري الجدولة...', () => api(`${P}/schedule`, { iso: new Date(v).toISOString() }));
    } else if (act === 'now' || act === 'now-final') {
      if (!confirm(`سيُنشر المنشور الآن على: ${enabledChannels().replace(/&[a-z]+;/g, '')}. متأكد؟`)) return;
      run('جاري النشر على المنصات...', () => api(`${P}/schedule`, { now: true }));
    } else if (act === 'regen') {
      const msgs = { topics: 'جاري دراسة السوق واقتراح مواضيع جديدة...', images: 'جاري توليد صور جديدة...', captions: 'جاري كتابة نصوص جديدة...' };
      run(msgs[b.dataset.step], () => api(`${P}/regenerate`, { step: b.dataset.step }));
    } else if (act === 'back') run('...', () => api(`${P}/back`, {}));
    else if (act === 'retry') run('جاري إعادة النشر...', () => api(`${P}/retry`, {}));
    else if (act === 'cancel') {
      if (!confirm('إلغاء هذا المنشور؟')) return;
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
    if (name === 'kit') loadKit();
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
      overview.telegram.configured ? ['success', 'fa-brands fa-telegram', 'تليجرام مربوط'] : ['danger', 'fa-brands fa-telegram', 'تليجرام غير مربوط'],
      overview.ai_ready ? ['success', 'fa-solid fa-brain', 'AI جاهز'] : ['warning', 'fa-solid fa-brain', 'لا يوجد مفتاح AI'],
      ...Object.values(ch).filter(c => c.enabled).map(c => [c.ready ? 'success' : 'warning', 'fa-solid fa-share-nodes', `${c.label}: ${c.ready ? 'جاهز للنشر' : 'يحتاج إلى ربط'}`])
    ];
    const next = (overview.plans || []).filter(p => p.status === 'scheduled').sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0];
    $('mk-status-strip').innerHTML = pills.map(([c, i, t]) => `<span class="badge-pill ${c}"><i class="${i}"></i> ${esc(t)}</span>`).join('') +
      (next ? `<span class="badge-pill info"><i class="fa-solid fa-calendar"></i> المنشور القادم: ${esc(next.scheduled_label)}</span>` : '') +
      (overview.telegram.configured ? '' : ' <a href="#" class="mk-link" id="mk-go-setup">اربطه من هنا ←</a>');
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
    if (!list.length) { $('mk-history-body').innerHTML = '<div class="mk-empty"><p>لا توجد منشورات بعد.</p></div>'; return; }
    $('mk-history-body').innerHTML = `<div class="mk-history">${list.map(p => {
      const [label, cls] = STATUS[p.status] || [p.status, 'info'];
      return `<div class="mk-history-item" data-id="${esc(p.id)}">
        ${p.image ? `<img src="${esc(p.image.url)}" alt="">` : '<div class="mk-noimg"><i class="fa-regular fa-image"></i></div>'}
        <div class="mk-history-info">
          <div class="mk-opt-title">${esc(p.topic?.title || (p.topics || []).map(t => t.title).join(' / ') || 'منشور')}</div>
          <div class="form-hint">${esc(p.date)} · ${p.source === 'morning' ? 'رسالة الصباح' : p.source === 'competitor' ? 'مستوحى من منافس' : 'يدوي'}${p.scheduled_label ? ` · ${esc(p.scheduled_label)}` : ''}</div>
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

  // ---------- identity test (brand on every medium) ----------
  let kitTimer = null;
  async function loadKit() {
    let d;
    try { d = await api('/api/marketing/brand-kit', undefined, 'GET'); } catch (e) { $('mk-kit-body').innerHTML = `<div class="mk-alert">${esc(e.message)}</div>`; return; }
    renderKit(d.kit, d.media);
    clearTimeout(kitTimer);
    // Keep refreshing while designs are being made (only while the tab is open).
    if (d.kit?.status === 'running' && document.querySelector('.mk-subtab.active')?.dataset.mk === 'kit') kitTimer = setTimeout(loadKit, 5000);
  }

  function renderKit(kit, media) {
    const running = kit?.status === 'running';
    const p = kit?.progress || { done: 0, failed: 0, total: media.length };
    $('mk-kit-start').disabled = running;
    $('mk-kit-start').querySelector('span').textContent = running ? 'جاري التصميم…' : kit ? 'أكمل الناقص' : 'صمّم كل الوسائط';
    $('mk-kit-progress').innerHTML = kit ? `
      <div class="mk-kit-bar"><i style="width:${Math.round((p.done / p.total) * 100)}%"></i></div>
      <div class="form-hint" style="margin:6px 0 16px;">${p.done} من ${p.total} جاهزة${p.failed ? ` · ${p.failed} لم تنجح (اضغط «أعد التصميم» عليها)` : ''}${running ? ' · تظهر التصاميم تباعاً، وقد يستغرق ذلك بضع دقائق' : ''}</div>` : '';
    const items = media.map(md => ({ ...md, ...(kit?.items?.find(i => i.key === md.key) || { status: 'idle' }) }));
    const groups = [...new Set(items.map(i => i.group))];
    $('mk-kit-body').innerHTML = groups.map(g => `
      <h4 class="mk-kit-group">${esc(g)}</h4>
      <div class="mk-kit-grid">${items.filter(i => i.group === g).map(i => `
        <div class="mk-kit-card">
          <div class="mk-kit-frame" style="aspect-ratio:${i.aspect.replace(':', ' / ')}">
            ${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener"><img src="${esc(i.url)}" alt="${esc(i.title)}" loading="lazy"></a>` : ''}
            ${i.status === 'running' || (i.status === 'pending' && running) ? `<div class="mk-kit-wait"><div class="mk-spinner"></div><span>${i.status === 'running' ? 'جاري التصميم…' : 'بالدور'}</span></div>` : ''}
            ${i.status === 'failed' ? `<div class="mk-kit-wait err"><i class="fa-solid fa-triangle-exclamation"></i><span>${esc(i.error || 'لم ينجح')}</span></div>` : ''}
            ${!i.url && (i.status === 'idle' || (i.status === 'pending' && !running)) ? `<div class="mk-kit-wait idle"><span>${esc(i.aspect)}</span></div>` : ''}
          </div>
          <div class="mk-kit-meta">
            <b>${esc(i.title)}</b><span class="form-hint">${esc(i.aspect)}${i.engine ? ` · ${esc(i.engine)}` : ''}</span>
          </div>
          ${i.url || i.status === 'failed' ? `<div class="mk-kit-actions">
            <input class="form-control" data-kit-note="${esc(i.key)}" placeholder="ملاحظة للتعديل (اختياري)">
            <button class="btn btn-secondary btn-sm" data-kit-redo="${esc(i.key)}" ${running ? 'disabled' : ''}><i class="fa-solid fa-rotate"></i> أعد التصميم</button>
            ${i.url ? `<a class="btn btn-secondary btn-sm" href="${esc(i.url)}" download="atlead-${esc(i.key)}.jpg" title="تنزيل"><i class="fa-solid fa-download"></i></a>` : ''}
          </div>` : ''}
        </div>`).join('')}</div>`).join('');
  }

  $('mk-kit-start')?.addEventListener('click', async () => {
    if (!confirm('سيتم تصميم جميع الوسائط بأفضل نموذج (Nano Banana Pro). تستغرق العملية بضع دقائق وتستهلك من رصيد OpenRouter (نحو 10–15 سنتاً للتصميم الواحد). هل تريد البدء؟')) return;
    try { const d = await api('/api/marketing/brand-kit/start', {}); showToast(d.message, 'success'); loadKit(); } catch (e) { showToast(e.message, 'error'); }
  });
  $('mk-pane-kit')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-kit-redo]');
    if (!b) return;
    const key = b.dataset.kitRedo;
    const note = document.querySelector(`[data-kit-note="${key}"]`)?.value.trim() || '';
    try { const d = await api('/api/marketing/brand-kit/redo', { key, note }); showToast(d.message, 'success'); loadKit(); } catch (err) { showToast(err.message, 'error'); }
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
        <h4 class="mk-card-title"><i class="fa-brands fa-instagram" style="color:#e1306c;"></i> المنافسون — أكثر منشوراتهم تفاعلاً</h4>
        ${!comps.length ? '<p class="form-hint">لا يوجد منافسون مضافون. أضفهم من تبويب <b>الإعدادات والربط</b>.</p>' : comps.map(c => c.error
          ? `<div class="mk-comp"><b>@${esc(c.username)}</b> <span class="mk-alert inline">${esc(c.error)}</span></div>`
          : `<div class="mk-comp"><div class="mk-comp-head"><b>@${esc(c.username)}</b> <span class="form-hint">${c.followers.toLocaleString()} متابع · متوسط تفاعل ${c.avg_engagement}</span></div>
            ${(c.posts || []).map(p => `<div class="mk-comp-post">
              <div class="mk-comp-stats"><span><i class="fa-regular fa-heart"></i> ${p.likes}</span><span><i class="fa-regular fa-comment"></i> ${p.comments}</span></div>
              <div class="mk-comp-cap">${esc(p.caption.slice(0, 220)) || '<i>بدون نص</i>'}</div>
              <div class="mk-comp-actions">
                ${p.permalink ? `<a href="${esc(p.permalink)}" target="_blank" rel="noopener" class="mk-link">فتح</a>` : ''}
                <button class="btn btn-secondary btn-sm" data-inspire="${esc(p.caption.slice(0, 400))}"><i class="fa-solid fa-wand-magic-sparkles"></i> أنشئ منشوراً أفضل عن الموضوع نفسه</button>
              </div></div>`).join('')}</div>`).join('')}
      </div>
      <div class="grid-2">
        <div class="glass-card">
          <h4 class="mk-card-title"><i class="fa-solid fa-comments" style="color:#34d399;"></i> ماذا يسأل عملاؤك (من البوت والتعليقات)</h4>
          ${[['مجالاتهم', cs.business_types], ['مشاكلهم', cs.problems], ['طلباتهم', cs.requests], ['اعتراضاتهم', cs.objections], ['تعليقات مهتمة', cs.comments]]
            .filter(([, v]) => v && v.length).map(([k, v]) => `<div class="mk-signal"><b>${k}</b><ul>${v.slice(0, 6).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('') || '<p class="form-hint">لا توجد محادثات كافية بعد.</p>'}
        </div>
        <div class="glass-card">
          <h4 class="mk-card-title"><i class="fa-solid fa-clock" style="color:#f59e0b;"></i> أفضل أوقات النشر القادمة</h4>
          ${(r.best_times || []).map(t => `<div class="mk-signal"><b>${esc(t.label)}</b><div class="form-hint">${esc(t.reason)}</div></div>`).join('')}
          <p class="form-hint">${r.own_count >= 8 ? `محسوبة من تفاعل ${r.own_count} منشوراً سابقاً لكم + أوقات الذروة في المنطقة.` : 'محسوبة من أوقات الذروة في الأردن والمنطقة، وتزداد دقتها مع زيادة النشر.'}</p>
          <h4 class="mk-card-title" style="margin-top:16px;"><i class="fa-solid fa-trophy" style="color:#fbbf24;"></i> أنجح منشوراتكم</h4>
          ${(r.own_top || []).map(p => `<div class="mk-signal"><span class="form-hint">تفاعل ${p.engagement} · ${p.platform === 'instagram' ? 'إنستغرام' : 'فيسبوك'}</span><div>${esc(p.text.slice(0, 140)) || '<i>بدون نص</i>'}</div></div>`).join('') || '<p class="form-hint">تعذّرت قراءة منشوراتكم (تحقّق من ربط Meta).</p>'}
        </div>
      </div>
      <div class="glass-card">
        <h4 class="mk-card-title"><i class="fa-solid fa-newspaper" style="color:#60a5fa;"></i> أخبار المجال هذا الأسبوع</h4>
        ${(r.news || []).map(n => `<div class="mk-news"><span class="mk-tag">${esc(n.keyword)}</span> ${esc(n.title)} <button class="btn btn-secondary btn-sm" data-news="${esc(n.title)}">منشور عن هذا الخبر</button></div>`).join('') || '<p class="form-hint">لا توجد أخبار حالياً.</p>'}
      </div>`;
  }
  $('mk-research-body').addEventListener('click', (e) => {
    const ins = e.target.closest('[data-inspire]');
    const news = e.target.closest('[data-news]');
    if (ins) {
      const topic = prompt('ما عنوان منشورك؟ (سنكتبه بأسلوبنا دون نسخ)', ins.dataset.inspire.split('\n')[0].slice(0, 80));
      if (topic) run('جاري تصميم الصور...', () => api('/api/marketing/plans', { topic, inspired_by: ins.dataset.inspire }));
    } else if (news) {
      run('جاري تصميم الصور...', () => api('/api/marketing/plans', { topic: `رأينا في خبر: ${news.dataset.news}`.slice(0, 140), inspired_by: news.dataset.news }));
    }
  });
  $('mk-btn-refresh-research').addEventListener('click', () => loadResearch(true));

  // ---------- setup ----------
  function renderBrand(b) {
    const box = $('mk-brand-box');
    if (!box) return;
    const g = b?.guide;
    box.innerHTML = `
      ${g ? `<p class="mk-brand-summary">${esc(g.summary_ar || '')}</p>
        <div class="mk-swatches">${(g.palette || []).map(c => `<span class="mk-swatch" title="${esc(c.role)}"><i style="background:${esc(c.hex)}"></i>${esc(c.hex)}</span>`).join('')}</div>
        <div class="form-hint" style="margin:6px 0 10px;">${esc([g.typography, g.mood].filter(Boolean).join(' — '))}</div>`
        : '<p class="form-hint" style="margin-bottom:10px;">لم تُحلَّل هوية تصميمك بعد. اضغط «تعلّم من صفحتي» لقراءة منشوراتك على إنستغرام واستخراج الألوان والخطوط وأسلوب التصميم، لتخرج كل صورة جديدة بالأسلوب نفسه.</p>'}
      <div class="mk-brand-files">
        <div class="mk-brand-file logo">${b?.logo_url ? `<img src="${esc(b.logo_url)}" alt=""><button data-brand-remove="${esc(b.logo)}" title="حذف">×</button>` : '<span>اللوغو</span>'}</div>
        ${(b?.ref_urls || []).map(r => `<div class="mk-brand-file"><img src="${esc(r.url)}" alt=""><button data-brand-remove="${esc(r.file)}" title="حذف">×</button></div>`).join('')}
      </div>
      <div class="mk-actions">
        <button type="button" class="btn btn-primary btn-sm" id="mk-brand-learn"><i class="fa-brands fa-instagram"></i> ${g ? 'أعد التعلّم من صفحتي' : 'تعلّم من صفحتي'}</button>
        <label class="btn btn-secondary btn-sm" style="cursor:pointer;"><i class="fa-solid fa-upload"></i> ارفع اللوغو<input type="file" accept="image/*" hidden data-brand-upload="logo"></label>
        <label class="btn btn-secondary btn-sm" style="cursor:pointer;"><i class="fa-solid fa-images"></i> أضف تصميماً كمرجع<input type="file" accept="image/*" hidden data-brand-upload="ref"></label>
        ${(b?.refs || []).length ? '<button type="button" class="btn btn-secondary btn-sm" id="mk-brand-reanalyze"><i class="fa-solid fa-rotate"></i> حلّل من جديد</button>' : ''}
      </div>
      ${b?.learned_at ? `<div class="form-hint" style="margin-top:6px;">من ${esc(b.source || 'الصفحة')} — ${esc(String(b.posts_analyzed || (b.refs || []).length))} تصاميم، ${new Date(b.learned_at).toLocaleDateString('en-GB')}${overview?.image_engine ? ` · المولّد: ${esc(overview.image_engine)}` : ''}</div>` : ''}`;
  }

  async function brandCall(waiting, fn) {
    const box = $('mk-brand-box');
    const old = box.innerHTML;
    box.innerHTML = `<div class="mk-loading" style="padding:20px;"><div class="mk-spinner"></div><p>${esc(waiting)}</p></div>`;
    try {
      const d = await fn();
      showToast(d.message || 'تم', 'success');
      if (overview) overview.brand = d.brand;
      renderBrand(d.brand);
    } catch (e) { showToast(e.message, 'error'); box.innerHTML = old; }
  }

  $('mk-pane-setup')?.addEventListener('click', (e) => {
    if (e.target.closest('#mk-brand-learn')) brandCall('جاري قراءة منشورات صفحتك وتحليل التصميم… (نحو دقيقة)', () => api('/api/marketing/brand/learn', {}));
    else if (e.target.closest('#mk-brand-reanalyze')) brandCall('جاري التحليل…', () => api('/api/marketing/brand/reanalyze', {}));
    const rm = e.target.closest('[data-brand-remove]');
    if (rm) brandCall('…', () => api('/api/marketing/brand/remove', { file: rm.dataset.brandRemove }));
  });
  $('mk-pane-setup')?.addEventListener('change', (e) => {
    const inp = e.target.closest('[data-brand-upload]');
    if (!inp || !inp.files[0]) return;
    const fd = new FormData();
    fd.append('image', inp.files[0]);
    fd.append('kind', inp.dataset.brandUpload);
    brandCall('جاري الرفع…', () => api('/api/marketing/brand/upload', fd));
  });

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
    $('mk-language').value = m.language || 'en';
    $('mk-brand-style').value = m.brand_style || '';
    $('mk-image-model').value = m.image_model || '';
    $('mk-enabled').checked = m.enabled !== false;
    $('mk-free-images').checked = m.free_image_fallback !== false;
    $('mk-pub-fb').checked = m.publish_facebook !== false;
    $('mk-pub-ig').checked = m.publish_instagram !== false;
    $('mk-pub-tg').checked = m.publish_telegram_channel === true;
    $('mk-public-url').value = m.public_url || '';
    if (!m.public_url && overview?.public_url) $('mk-public-url').placeholder = `${overview.public_url} (تلقائي)`;
    renderBrand(overview?.brand);
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
      showToast('تم حفظ إعدادات التسويق', 'success');
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
      out.innerHTML = r.chats.map(c => `<button type="button" class="btn btn-secondary btn-sm" data-chat="${esc(c.id)}" style="margin:4px 0 0 4px;">${esc(c.name)} (${esc(c.type)}) — ${esc(c.id)}</button>`).join('') + '<div>اضغط على محادثتك لإضافتها، ثم احفظ.</div>';
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
