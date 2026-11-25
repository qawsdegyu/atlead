/**
 * Smart marketing tab: post wizard (topic → image → caption → time),
 * market research view, scheduled/published posts, Telegram setup.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const tr = (en, ar) => (window.atleadI18n?.lang === 'ar' ? ar : en);

  const getSteps = () => [
    { key: 'topic', label: tr('Topic', 'الموضوع'), icon: 'fa-lightbulb' },
    { key: 'image', label: tr('Image', 'الصورة'), icon: 'fa-image' },
    { key: 'caption', label: tr('Caption', 'النص'), icon: 'fa-pen-nib' },
    { key: 'time', label: tr('Publish time', 'وقت النشر'), icon: 'fa-clock' },
    { key: 'done', label: tr('Publish', 'النشر'), icon: 'fa-rocket' }
  ];
  const getStatus = (s) => ({
    topic: [tr('Choosing topic', 'اختيار الموضوع'), 'info'],
    image: [tr('Choosing image', 'اختيار الصورة'), 'info'],
    caption: [tr('Choosing caption', 'اختيار النص'), 'info'],
    time: [tr('Choosing time', 'اختيار الوقت'), 'info'],
    scheduled: [tr('Scheduled', 'مجدول'), 'warning'],
    publishing: [tr('Publishing', 'جاري النشر'), 'warning'],
    published: [tr('Published', 'نُشر'), 'success'],
    partial: [tr('Partially published', 'نُشر جزئياً'), 'warning'],
    failed: [tr('Failed', 'فشل'), 'danger'],
    cancelled: [tr('Cancelled', 'ملغي'), 'danger']
  }[s] || [s, 'info']);
  const getChLabel = (k) => ({
    facebook: tr('Facebook', 'فيسبوك'),
    instagram: tr('Instagram', 'إنستغرام'),
    telegram: tr('Telegram channel', 'قناة تليجرام'),
    _error: tr('Error', 'خطأ')
  }[k] || k);

  let overview = null;
  let plan = null;
  let busy = false;
  let focusFile = null;   // image open in the studio (image step)
  let captionDraft = '';  // caption being refined in the caption chat
  let lastResearch = null;
  let lastKit = null;

  async function api(url, body, method = 'POST') {
    const opts = { method, headers: {} };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(url, method === 'GET' ? undefined : opts);
    let data;
    try { data = await res.json(); } catch { data = { success: false, message: tr(`Server error (${res.status})`, `خطأ من السيرفر (${res.status})`) }; }
    if (!data.success) throw new Error(data.message || tr('An error occurred', 'حصل خطأ'));
    return data;
  }

  // ---------- loading overlay for slow AI steps ----------
  function loading(msg) {
    $('mk-wizard-body').innerHTML = `<div class="mk-loading"><div class="mk-spinner"></div><p>${esc(msg)}</p><small>${esc(tr('This may take up to a minute — do not close this page', 'قد يستغرق ذلك حتى دقيقة — لا تغلق الصفحة'))}</small></div>`;
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
      log.insertAdjacentHTML('beforeend', `<div class="mk-msg me no-i18n bidi-text">${esc(msg)}</div><div class="mk-msg ai typing"><i class="fa-solid fa-spinner fa-spin"></i> ${esc(waiting)}</div>`);
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
    return Math.max(0, getSteps().findIndex(s => s.key === status));
  }

  function renderSteps() {
    const steps = getSteps();
    const cur = plan ? stepIndex(plan.status) : -1;
    $('mk-steps').innerHTML = steps.map((s, i) => `
      <div class="mk-step ${i < cur ? 'done' : i === cur ? 'current' : ''}">
        <span class="mk-step-dot">${i < cur ? '<i class="fa-solid fa-check"></i>' : `<i class="fa-solid ${s.icon}"></i>`}</span>
        <span>${esc(s.label)}</span>
      </div>`).join('<div class="mk-step-line"></div>');
  }

  const backBtn = (label) => `<button class="btn btn-secondary btn-sm" data-act="back"><i class="fa-solid fa-arrow-left dir-arrow"></i> ${esc(label || tr('Back', 'رجوع'))}</button>`;
  const summary = () => {
    if (!plan) return '';
    const bits = [];
    if (plan.topic && stepIndex(plan.status) > 0) bits.push(`<span class="no-i18n bidi-text"><i class="fa-solid fa-lightbulb"></i> ${esc(plan.topic.title)}</span>`);
    if (plan.image && stepIndex(plan.status) > 1) bits.push(`<img src="${esc(plan.image.url)}" alt="">`);
    return bits.length ? `<div class="mk-summary">${bits.join('')}</div>` : '';
  };

  // ---------- wizard body ----------
  function render() {
    renderSteps();
    const body = $('mk-wizard-body');
    if (!plan || plan.status === 'cancelled') {
      body.innerHTML = `<div class="mk-empty"><i class="fa-solid fa-wand-magic-sparkles"></i>
        <p>${esc(plan ? tr('This post was cancelled.', 'تم إلغاء هذا المنشور.') : tr('No post in progress.', 'لا يوجد منشور قيد التحضير.'))} ${esc(tr('Press', 'اضغط'))} <b>${esc(tr('New post', 'منشور جديد'))}</b> ${esc(tr('and we will study the market and suggest 3 topics.', 'وسندرس السوق ونقترح عليك 3 مواضيع.'))}</p>
        <div class="mk-custom-topic"><input id="mk-custom-new" class="form-control" placeholder="${esc(tr('Or write your own topic and start right away...', 'أو اكتب موضوعاً من عندك وابدأ به مباشرة...'))}"><button class="btn btn-secondary" data-act="custom-new">${esc(tr('Start with my topic', 'ابدأ بموضوعي'))}</button></div></div>`;
      return;
    }
    const s = plan.status;
    if (s === 'topic') {
      body.innerHTML = `
        ${plan.market_summary ? `<div class="mk-insight"><i class="fa-solid fa-chart-line"></i> <div><b>${esc(tr('Market today:', 'السوق اليوم:'))}</b> <span class="no-i18n bidi-text">${esc(plan.market_summary)}</span></div></div>` : ''}
        <h4 class="mk-q">${esc(tr('1. Choose the post topic', '1. اختر موضوع المنشور'))}</h4>
        <div class="mk-options">${(plan.topics || []).map((t, i) => `
          <button class="mk-option" data-act="topic" data-i="${i}">
            <span class="mk-letter">${'ABC'[i] || i + 1}</span>
            <div><div class="mk-opt-title no-i18n bidi-text">${esc(t.title)} ${t.format ? `<span class="mk-tag">${esc(t.format)}</span>` : ''}</div>
            <div class="mk-opt-text no-i18n bidi-text">${esc(t.angle)}</div>
            ${t.why ? `<div class="mk-opt-why no-i18n bidi-text"><i class="fa-regular fa-lightbulb"></i> ${esc(t.why)}</div>` : ''}</div>
          </button>`).join('')}
        </div>
        <div class="mk-custom-topic"><input id="mk-custom-topic" class="form-control" placeholder="${esc(tr('None of these? Write your own topic...', 'لم يعجبك أي منها؟ اكتب موضوعك...'))}"><button class="btn btn-secondary" data-act="custom">${esc(tr('Use my topic', 'استخدم موضوعي'))}</button></div>
        <div class="mk-actions"><button class="btn btn-secondary btn-sm" data-act="regen" data-step="topics"><i class="fa-solid fa-rotate"></i> ${esc(tr('Suggest 3 other topics', 'اقترح 3 مواضيع أخرى'))}</button>
        <button class="btn btn-danger btn-sm" data-act="cancel">${esc(tr('Cancel', 'إلغاء'))}</button></div>`;
    } else if (s === 'image') {
      const imgs = plan.images || [];
      if (focusFile && !imgs.some(im => im.file === focusFile)) focusFile = null;
      const fi = imgs.findIndex(im => im.file === focusFile);
      const f = fi >= 0 ? imgs[fi] : null;
      const chat = f ? (plan.image_chat || []).filter(c => c.target === f.file || c.result === f.file || (f.root && (c.target === f.root))) : [];
      const chips = tr(
        ['Make headline larger & clearer', 'Match brand colors closely', 'Simplify layout, fewer elements', 'Make image more photorealistic'],
        ['كبّر العنوان واجعله أوضح', 'اجعل الألوان أقرب للهوية', 'بسّط التصميم وقلّل العناصر', 'اجعل الصورة أكثر واقعية']
      );
      body.innerHTML = `${summary()}
        <h4 class="mk-q">${esc(tr('2. Choose the image', '2. اختر الصورة'))}</h4>
        <p class="form-hint" style="margin:-8px 0 12px;">${esc(tr('Click any image to zoom and edit via chat, or approve it directly.', 'اضغط على أي صورة لتكبيرها وتعديلها بالمحادثة، أو اعتمدها مباشرة.'))}</p>
        ${plan.image_error ? `<div class="mk-alert"><span class="no-i18n">${esc(plan.image_error)}</span><br><small>${esc(tr('You can upload an image from your device, or try again.', 'يمكنك رفع صورة من جهازك، أو المحاولة مرة أخرى.'))}</small></div>` : ''}
        ${f ? `
        <div class="mk-studio">
          <div class="mk-studio-img"><img src="${esc(f.url)}" alt="">
            <span class="mk-image-meta no-i18n">${esc(f.style || '')}${f.engine && f.engine !== 'upload' ? ` · ${esc(f.engine)}` : ''}</span></div>
          <div class="mk-chat">
            <div class="mk-chat-head"><b><i class="fa-solid fa-wand-magic-sparkles"></i> ${esc(tr('Edit this image', 'عدّل هذه الصورة'))}</b>
              <button class="btn btn-secondary btn-sm" data-act="close-studio" title="${esc(tr('Back to images', 'رجوع للصور'))}"><i class="fa-solid fa-xmark"></i></button></div>
            <div class="mk-chat-log" id="mk-image-log">${chat.length ? chat.map(c => c.role === 'user'
              ? `<div class="mk-msg me no-i18n bidi-text">${esc(c.text)}</div>`
              : `<div class="mk-msg ai"><span class="no-i18n bidi-text">${esc(c.text)}</span>${c.result && c.result !== f.file ? ` <a href="#" data-act="focus-file" data-file="${esc(c.result)}">${esc(tr('Open version', 'افتح النسخة'))}</a>` : ''}</div>`).join('')
              : `<div class="mk-chat-empty">${esc(tr('Describe any edit naturally — e.g. "make the headline larger", "navy background", "change text to...", "add a smiling team member".', 'اكتب أي تعديل بلغتك — مثلاً: «كبّر العنوان»، «اجعل الخلفية كحلية»، «غيّر الجملة إلى…»، «أضف صورة موظف مبتسم».'))}</div>`}</div>
            <div class="mk-chips">${chips.map(t => `<button class="mk-chip" data-act="image-chip" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div>
            <div class="mk-chat-input"><textarea id="mk-image-msg" class="form-control" rows="2" placeholder="${esc(tr('What edit do you want?', 'ما التعديل المطلوب؟'))}"></textarea>
              <button class="btn btn-primary" data-act="image-send"><i class="fa-solid fa-paper-plane"></i></button></div>
            <button class="btn btn-success" data-act="image" data-i="${fi}" style="width:100%;margin-top:10px;"><i class="fa-solid fa-check"></i> ${esc(tr('Use this image and go to caption', 'اعتمد هذه الصورة وانتقل إلى النص'))}</button>
          </div>
        </div>` : ''}
        <div class="mk-images">${imgs.map((im, i) => `
          <button class="mk-image${im.file === focusFile ? ' focused' : ''}" data-act="focus" data-i="${i}" title="${esc(tr('Click to zoom & edit', 'اضغط للتكبير والتعديل'))}">
            <img src="${esc(im.url)}" alt="" loading="lazy">
            <span class="mk-letter">${i + 1}</span>
            <span class="mk-image-meta no-i18n">${esc(im.style || '')}${im.engine && im.engine !== 'upload' ? ` · ${esc(im.engine)}` : ''}</span>
          </button>`).join('')}
          <label class="mk-image mk-upload"><input type="file" accept="image/*" id="mk-upload" hidden>
            <i class="fa-solid fa-cloud-arrow-up"></i><span>${esc(tr('Upload image', 'ارفع صورة'))}</span></label>
        </div>
        <div class="mk-actions">${backBtn()}<button class="btn btn-secondary btn-sm" data-act="regen" data-step="images"><i class="fa-solid fa-rotate"></i> ${esc(tr('Generate new images', 'ولّد صور جديدة'))}</button></div>`;
      const ilog = $('mk-image-log'); if (ilog) ilog.scrollTop = ilog.scrollHeight;
      $('mk-image-msg')?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); body.querySelector('[data-act="image-send"]').click(); } });
      $('mk-upload').addEventListener('change', (e) => {
        const fUp = e.target.files[0];
        if (!fUp) return;
        const fd = new FormData();
        fd.append('image', fUp);
        run(tr('Uploading image...', 'جاري رفع الصورة...'), () => api(`/api/marketing/plans/${plan.id}/image-upload`, fd));
      });
    } else if (s === 'caption') {
      const capChips = tr(
        ['Make it shorter', 'Stronger hook', 'More formal tone', 'Add subtle emojis', 'More hashtags'],
        ['اجعله أقصر', 'افتتاحية أقوى', 'نبرة أكثر رسمية', 'أضف رموزاً تعبيرية خفيفة', 'هاشتاغات أكثر']
      );
      body.innerHTML = `${summary()}
        <h4 class="mk-q">${esc(tr('3. Choose the caption', '3. اختر النص'))}</h4>
        <div class="mk-options">${(plan.captions || []).map((c, i) => `
          <div class="mk-option mk-caption" data-i="${i}">
            <span class="mk-letter">${'ABC'[i]}</span>
            <div style="flex:1;min-width:0;"><div class="mk-opt-title no-i18n">${esc(c.style)}</div>
              <div class="mk-caption-text no-i18n bidi-text">${esc(c.text)}</div>
              <div class="mk-hashtags no-i18n">${esc((c.hashtags || []).join(' '))}</div>
              <div class="mk-actions" style="margin-top:10px;">
                <button class="btn btn-primary btn-sm" data-act="caption" data-i="${i}"><i class="fa-solid fa-check"></i> ${esc(tr('Choose this', 'اختر هذا'))}</button>
                <button class="btn btn-secondary btn-sm" data-act="chat-caption" data-i="${i}"><i class="fa-solid fa-wand-magic-sparkles"></i> ${esc(tr('Edit with AI', 'عدّله بالذكاء الاصطناعي'))}</button>
                <button class="btn btn-secondary btn-sm" data-act="edit-caption" data-i="${i}"><i class="fa-solid fa-pen"></i> ${esc(tr('Edit by hand', 'عدّل يدوياً'))}</button>
              </div></div>
          </div>`).join('')}
        </div>
        <div id="mk-caption-editor" style="display:none;margin-top:14px;">
          <textarea id="mk-caption-edit" class="form-control no-i18n" rows="9"></textarea>
          <div class="mk-actions"><button class="btn btn-primary btn-sm" data-act="caption-custom"><i class="fa-solid fa-check"></i> ${esc(tr('Use edited caption', 'اعتمد النص المعدّل'))}</button></div>
        </div>
        ${captionDraft ? `
        <div class="mk-studio mk-studio-caption" id="mk-caption-studio">
          <div class="mk-chat" style="flex:1;">
            <div class="mk-chat-head"><b><i class="fa-solid fa-wand-magic-sparkles"></i> ${esc(tr('Edit the caption by chat', 'عدّل النص بالمحادثة'))}</b>
              <button class="btn btn-secondary btn-sm" data-act="close-caption-chat" title="${esc(tr('Close', 'إغلاق'))}"><i class="fa-solid fa-xmark"></i></button></div>
            <textarea id="mk-caption-draft" class="form-control mk-draft no-i18n" rows="8">${esc(captionDraft)}</textarea>
            <div class="mk-chat-log" id="mk-caption-log">${(plan.caption_chat || []).slice(-10).map(c => `<div class="mk-msg ${c.role === 'user' ? 'me' : 'ai'} no-i18n bidi-text">${esc(c.text)}</div>`).join('') || `<div class="mk-chat-empty">${esc(tr('Ask for any edit — "shorter", "more formal", "start with a question", "in Arabic/English".', 'اطلب أي تعديل — «أقصر»، «أكثر رسمية»، «أضف سؤالاً في البداية»، «بالإنجليزية».'))}</div>`}</div>
            <div class="mk-chips">${capChips.map(t => `<button class="mk-chip" data-act="caption-chip" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div>
            <div class="mk-chat-input"><textarea id="mk-caption-msg" class="form-control" rows="2" placeholder="${esc(tr('What edit do you want for the caption?', 'ما التعديل المطلوب على النص؟'))}"></textarea>
              <button class="btn btn-primary" data-act="caption-send"><i class="fa-solid fa-paper-plane"></i></button></div>
            <button class="btn btn-success" data-act="caption-approve" style="width:100%;margin-top:10px;"><i class="fa-solid fa-check"></i> ${esc(tr('Use this caption and pick a time', 'اعتمد هذا النص وانتقل إلى الموعد'))}</button>
          </div>
        </div>` : ''}
        <div class="mk-actions">${backBtn()}<button class="btn btn-secondary btn-sm" data-act="regen" data-step="captions"><i class="fa-solid fa-rotate"></i> ${esc(tr('Write other captions', 'اكتب نصوصاً أخرى'))}</button></div>`;
      const clog = $('mk-caption-log'); if (clog) clog.scrollTop = clog.scrollHeight;
      $('mk-caption-msg')?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); body.querySelector('[data-act="caption-send"]').click(); } });
      if (captionDraft) $('mk-caption-studio')?.scrollIntoView({ block: 'nearest' });
    } else if (s === 'time') {
      body.innerHTML = `${summary()}
        <h4 class="mk-q">${esc(tr('4. Choose publish time', '4. اختر موعد النشر'))}</h4>
        <div class="mk-options mk-times">${(plan.times || []).map((t, i) => `
          <button class="mk-option" data-act="time" data-i="${i}">
            <span class="mk-letter">${'ABC'[i]}</span>
            <div><div class="mk-opt-title no-i18n"><i class="fa-regular fa-clock"></i> ${esc(t.label)}</div>
            <div class="mk-opt-text no-i18n bidi-text">${esc(t.reason)}</div></div>
          </button>`).join('') || `<p class="form-hint">${esc(tr('No suggested times.', 'لا توجد أوقات مقترحة.'))}</p>`}
        </div>
        <div class="mk-custom-topic"><input type="datetime-local" id="mk-custom-time" class="form-control"><button class="btn btn-secondary" data-act="time-custom">${esc(tr('Custom time', 'وقت آخر'))}</button>
          <button class="btn btn-success" data-act="now"><i class="fa-solid fa-bolt"></i> ${esc(tr('Publish now', 'انشر الآن'))}</button></div>
        <div class="mk-preview-wrap">${preview()}</div>
        <div class="mk-actions">${backBtn()}</div>`;
    } else {
      body.innerHTML = renderFinal();
    }
  }

  function preview() {
    if (!plan.image) return '';
    return `<div class="mk-preview"><div class="mk-preview-head"><span class="logo-badge" style="width:26px;height:26px;font-size:11px;">at</span> <b class="no-i18n">atlead</b></div>
      <img src="${esc(plan.image.url)}" alt=""><div class="mk-preview-caption no-i18n bidi-text">${esc(plan.caption || '')}</div></div>`;
  }

  function resultsHtml(p) {
    const r = p.results || {};
    const rows = Object.entries(r).map(([k, v]) => `<div class="mk-result ${v.ok ? 'ok' : 'bad'}">
      <i class="fa-solid ${v.ok ? 'fa-circle-check' : 'fa-circle-xmark'}"></i> <b>${esc(getChLabel(k))}</b>
      ${v.ok ? (v.url ? `<a href="${esc(v.url)}" target="_blank" rel="noopener">${esc(tr('Open post', 'فتح البوست'))}</a>` : esc(tr('Done', 'تم'))) : `<span class="no-i18n">${esc(v.error || tr('Failed', 'فشل'))}</span>`}</div>`);
    return rows.join('');
  }

  function renderFinal() {
    const s = plan.status;
    const [label, cls] = getStatus(s);
    const head = s === 'scheduled'
      ? `<div class="mk-big-status warning"><i class="fa-solid fa-calendar-check"></i><div><b>${esc(tr('Post scheduled:', 'المنشور مجدول:'))} <span class="no-i18n">${esc(plan.scheduled_label || '')}</span></b><small>${esc(tr('It will publish automatically at this time on:', 'سيُنشر تلقائياً في هذا الموعد على:'))} ${enabledChannels()}. ${esc(tr('You will receive a confirmation on Telegram.', 'وسيصلك تأكيد على تليجرام.'))}</small></div></div>`
      : `<div class="mk-big-status ${cls}"><i class="fa-solid ${s === 'published' ? 'fa-rocket' : s === 'publishing' ? 'fa-spinner fa-spin' : 'fa-triangle-exclamation'}"></i><div><b>${esc(label)}</b>${plan.error ? `<small class="no-i18n">${esc(plan.error)}</small>` : ''}</div></div>`;
    return `${head}
      <div class="mk-results">${resultsHtml(plan)}</div>
      <div class="mk-preview-wrap">${preview()}</div>
      <div class="mk-actions">
        ${s === 'scheduled' || s === 'failed' ? backBtn(tr('Change time', 'تغيير الوقت')) : ''}
        ${s === 'scheduled' ? `<button class="btn btn-success btn-sm" data-act="now-final"><i class="fa-solid fa-bolt"></i> ${esc(tr('Publish now', 'انشر الآن'))}</button><button class="btn btn-danger btn-sm" data-act="cancel">${esc(tr('Cancel schedule', 'إلغاء الجدولة'))}</button>` : ''}
        ${s === 'failed' || s === 'partial' ? `<button class="btn btn-primary btn-sm" data-act="retry"><i class="fa-solid fa-rotate-right"></i> ${esc(tr('Retry publishing', 'أعد محاولة النشر'))}</button>` : ''}
        <button class="btn btn-secondary btn-sm" data-act="new"><i class="fa-solid fa-plus"></i> ${esc(tr('New post', 'منشور جديد'))}</button>
      </div>`;
  }

  function enabledChannels() {
    const ch = overview?.channels || {};
    const on = Object.values(ch).filter(c => c.enabled).map(c => c.label + (c.ready ? '' : ` (${tr('not ready', 'غير جاهز')})`));
    return esc(on.join(', ') || tr('No channel enabled.', 'لا توجد منصة مفعّلة.'));
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
      if (!msg) return showToast(tr('Describe the edit you want', 'اكتب التعديل المطلوب'), 'error');
      return chatCall('mk-image-log', msg, tr('Editing image… (may take up to a minute)', 'جاري تعديل الصورة… (قد يستغرق حتى دقيقة)'), async () => {
        const d = await api(`${P}/image-chat`, { file: focusFile, message: msg });
        plan = d.plan; focusFile = d.plan.images[0]?.file || focusFile; render();
      });
    }
    if (act === 'chat-caption') { const c = plan.captions[i]; captionDraft = `${c.text}\n\n${(c.hashtags || []).join(' ')}`.trim(); render(); $('mk-caption-msg')?.focus(); return; }
    if (act === 'close-caption-chat') { captionDraft = ''; render(); return; }
    if (act === 'caption-chip') { const t = $('mk-caption-msg'); t.value = b.dataset.text; t.focus(); return; }
    if (act === 'caption-send') {
      const msg = $('mk-caption-msg').value.trim();
      if (!msg) return showToast(tr('Describe the edit you want', 'اكتب التعديل المطلوب'), 'error');
      const current = $('mk-caption-draft').value;
      return chatCall('mk-caption-log', msg, tr('Updating caption…', 'جاري تعديل الكابشن…'), async () => {
        const d = await api(`${P}/caption-chat`, { text: current, message: msg });
        plan = d.plan; captionDraft = d.plan.caption_draft || current; render();
      });
    }
    if (act === 'caption-approve') {
      const t = $('mk-caption-draft').value.trim();
      if (!t) return showToast(tr('Caption is empty', 'النص فارغ'), 'error');
      captionDraft = '';
      return run(tr('Calculating best publish times...', 'جاري حساب أفضل أوقات النشر...'), () => api(`${P}/caption`, { text: t }));
    }
    if (act === 'topic') run(tr('Designing 3 image options for this topic...', 'جاري تصميم 3 صور مختلفة للموضوع...'), () => api(`${P}/topic`, { index: i }));
    else if (act === 'custom' || act === 'custom-new') {
      const v = $(act === 'custom' ? 'mk-custom-topic' : 'mk-custom-new').value.trim();
      if (!v) return showToast(tr('Enter a topic first', 'اكتب الموضوع أولاً'), 'error');
      if (act === 'custom') run(tr('Designing images for your topic...', 'جاري تصميم الصور لموضوعك...'), () => api(`${P}/topic`, { custom: v }));
      else run(tr('Designing images for your topic...', 'جاري تصميم الصور لموضوعك...'), () => api('/api/marketing/plans', { topic: v }));
    } else if (act === 'image') run(tr('Writing 3 caption options...', 'جاري كتابة 3 نصوص...'), () => api(`${P}/image`, { index: i }));
    else if (act === 'caption') run(tr('Calculating best publish times...', 'جاري حساب أفضل أوقات النشر...'), () => api(`${P}/caption`, { index: i }));
    else if (act === 'edit-caption') {
      const c = plan.captions[i];
      $('mk-caption-editor').style.display = 'block';
      $('mk-caption-edit').value = `${c.text}\n\n${(c.hashtags || []).join(' ')}`;
      $('mk-caption-edit').focus();
    } else if (act === 'caption-custom') {
      const t = $('mk-caption-edit').value.trim();
      if (!t) return showToast(tr('Caption is empty', 'النص فارغ'), 'error');
      run(tr('Calculating best publish times...', 'جاري حساب أفضل أوقات النشر...'), () => api(`${P}/caption`, { text: t }));
    } else if (act === 'time') run(tr('Scheduling...', 'جاري الجدولة...'), () => api(`${P}/schedule`, { index: i }));
    else if (act === 'time-custom') {
      const v = $('mk-custom-time').value;
      if (!v) return showToast(tr('Pick a date and time', 'اختر التاريخ والساعة'), 'error');
      run(tr('Scheduling...', 'جاري الجدولة...'), () => api(`${P}/schedule`, { iso: new Date(v).toISOString() }));
    } else if (act === 'now' || act === 'now-final') {
      if (!confirm(tr(`Publish this post now to: ${enabledChannels().replace(/&[a-z]+;/g, '')}?`, `سيُنشر المنشور الآن على: ${enabledChannels().replace(/&[a-z]+;/g, '')}. متأكد؟`))) return;
      run(tr('Publishing to channels...', 'جاري النشر على المنصات...'), () => api(`${P}/schedule`, { now: true }));
    } else if (act === 'regen') {
      const msgs = {
        topics: tr('Studying the market and suggesting new topics...', 'جاري دراسة السوق واقتراح مواضيع جديدة...'),
        images: tr('Generating new images...', 'جاري توليد صور جديدة...'),
        captions: tr('Writing new captions...', 'جاري كتابة نصوص جديدة...')
      };
      run(msgs[b.dataset.step], () => api(`${P}/regenerate`, { step: b.dataset.step }));
    } else if (act === 'back') run('...', () => api(`${P}/back`, {}));
    else if (act === 'retry') run(tr('Retrying publish...', 'جاري إعادة النشر...'), () => api(`${P}/retry`, {}));
    else if (act === 'cancel') {
      if (!confirm(tr('Cancel this post?', 'إلغاء هذا المنشور؟'))) return;
      run('...', () => api(`${P}/cancel`, {}));
    } else if (act === 'new') newPlan();
  });

  function newPlan(extra = {}) {
    run(tr('Studying the market & competitors and suggesting 3 topics...', 'جاري دراسة السوق والمنافسين واقتراح 3 مواضيع...'), () => api('/api/marketing/plans', extra));
  }

  $('mk-btn-new-plan').addEventListener('click', () => newPlan());
  $('mk-btn-send-brief').addEventListener('click', () => run(tr('Studying the market and sending ideas on Telegram...', 'جاري دراسة السوق وإرسال الاقتراحات على تليجرام...'), () => api('/api/marketing/brief/send', {})));

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
  function renderStatusStrip() {
    if (!overview) return;
    const ch = overview.channels || {};
    const pills = [
      overview.telegram.configured ? ['success', 'fa-brands fa-telegram', tr('Telegram connected', 'تليجرام مربوط')] : ['danger', 'fa-brands fa-telegram', tr('Telegram not connected', 'تليجرام غير مربوط')],
      overview.ai_ready ? ['success', 'fa-solid fa-brain', tr('AI ready', 'AI جاهز')] : ['warning', 'fa-solid fa-brain', tr('No AI key', 'لا يوجد مفتاح AI')],
      ...Object.values(ch).filter(c => c.enabled).map(c => [c.ready ? 'success' : 'warning', 'fa-solid fa-share-nodes', `${c.label}: ${c.ready ? tr('ready to publish', 'جاهز للنشر') : tr('needs connecting', 'يحتاج إلى ربط')}`])
    ];
    const next = (overview.plans || []).filter(p => p.status === 'scheduled').sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0];
    $('mk-status-strip').innerHTML = pills.map(([c, i, t]) => `<span class="status-chip ${c}"><span class="status-indicator"></span><i class="${i}"></i> <span class="no-i18n">${esc(t)}</span></span>`).join('') +
      (next ? `<span class="status-chip info"><span class="status-indicator"></span><i class="fa-solid fa-calendar"></i> <span>${esc(tr('Next post:', 'المنشور القادم:'))} <span class="no-i18n">${esc(next.scheduled_label)}</span></span></span>` : '') +
      (overview.telegram.configured ? '' : ` <a href="#" class="mk-link" id="mk-go-setup">${esc(tr('Connect here →', 'اربطه من هنا ←'))}</a>`);
    $('mk-go-setup')?.addEventListener('click', (e) => { e.preventDefault(); switchPane('setup'); });
  }

  async function refreshList() {
    try {
      overview = await api('/api/marketing/overview', undefined, 'GET');
    } catch (e) { return; }
    renderStatusStrip();
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
    if (!list.length) { $('mk-history-body').innerHTML = `<div class="mk-empty"><p>${esc(tr('No posts yet.', 'لا توجد منشورات بعد.'))}</p></div>`; return; }
    $('mk-history-body').innerHTML = `<div class="mk-history">${list.map(p => {
      const [label, cls] = getStatus(p.status);
      const srcLabel = p.source === 'morning' ? tr('Morning brief', 'رسالة الصباح') : p.source === 'competitor' ? tr('Inspired by competitor', 'مستوحى من منافس') : tr('Manual', 'يدوي');
      return `<div class="mk-history-item" data-id="${esc(p.id)}">
        ${p.image ? `<img src="${esc(p.image.url)}" alt="">` : '<div class="mk-noimg"><i class="fa-regular fa-image"></i></div>'}
        <div class="mk-history-info">
          <div class="mk-opt-title no-i18n bidi-text">${esc(p.topic?.title || (p.topics || []).map(t => t.title).join(' / ') || tr('Post', 'منشور'))}</div>
          <div class="form-hint no-i18n">${esc(p.date)} · ${esc(srcLabel)}${p.scheduled_label ? ` · ${esc(p.scheduled_label)}` : ''}</div>
          <div class="mk-results compact">${resultsHtml(p)}</div>
        </div>
        <span class="badge-pill ${cls}">${esc(label)}</span>
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
    try { d = await api('/api/marketing/brand-kit', undefined, 'GET'); } catch (e) { $('mk-kit-body').innerHTML = `<div class="mk-alert no-i18n">${esc(e.message)}</div>`; return; }
    lastKit = d;
    renderKit(d.kit, d.media);
    clearTimeout(kitTimer);
    // Keep refreshing while designs are being made (only while the tab is open).
    if (d.kit?.status === 'running' && document.querySelector('.mk-subtab.active')?.dataset.mk === 'kit') kitTimer = setTimeout(loadKit, 5000);
  }

  function renderKit(kit, media) {
    const running = kit?.status === 'running';
    const p = kit?.progress || { done: 0, failed: 0, total: media.length };
    $('mk-kit-start').disabled = running;
    $('mk-kit-start').querySelector('span').textContent = running
      ? tr('Designing…', 'جاري التصميم…')
      : kit
        ? tr('Finish the rest', 'أكمل الناقص')
        : tr('Design every medium', 'صمّم كل الوسائط');
    $('mk-kit-progress').innerHTML = kit ? `
      <div class="mk-kit-bar"><i style="width:${Math.round((p.done / p.total) * 100)}%"></i></div>
      <div class="form-hint no-i18n" style="margin:6px 0 16px;">${tr(
        `${p.done} of ${p.total} ready${p.failed ? ` · ${p.failed} failed (click "Redesign")` : ''}${running ? ' · designs appear as they finish; this may take a few minutes' : ''}`,
        `${p.done} من ${p.total} جاهزة${p.failed ? ` · ${p.failed} لم تنجح (اضغط «أعد التصميم» عليها)` : ''}${running ? ' · تظهر التصاميم تباعاً، وقد يستغرق ذلك بضع دقائق' : ''}`
      )}</div>` : '';
    const items = media.map(md => ({ ...md, ...(kit?.items?.find(i => i.key === md.key) || { status: 'idle' }) }));
    const groups = [...new Set(items.map(i => i.group))];
    $('mk-kit-body').innerHTML = groups.map(g => `
      <h4 class="mk-kit-group">${esc(g)}</h4>
      <div class="mk-kit-grid">${items.filter(i => i.group === g).map(i => `
        <div class="mk-kit-card">
          <div class="mk-kit-frame" style="aspect-ratio:${i.aspect.replace(':', ' / ')}">
            ${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener"><img src="${esc(i.url)}" alt="${esc(i.title)}" loading="lazy"></a>` : ''}
            ${i.status === 'running' || (i.status === 'pending' && running) ? `<div class="mk-kit-wait"><div class="mk-spinner"></div><span>${esc(i.status === 'running' ? tr('Designing…', 'جاري التصميم…') : tr('Queued', 'بالدور'))}</span></div>` : ''}
            ${i.status === 'failed' ? `<div class="mk-kit-wait err"><i class="fa-solid fa-triangle-exclamation"></i><span class="no-i18n">${esc(i.error || tr('Failed', 'لم ينجح'))}</span></div>` : ''}
            ${!i.url && (i.status === 'idle' || (i.status === 'pending' && !running)) ? `<div class="mk-kit-wait idle"><span>${esc(i.aspect)}</span></div>` : ''}
          </div>
          <div class="mk-kit-meta">
            <b>${esc(i.title)}</b><span class="form-hint no-i18n">${esc(i.aspect)}${i.engine ? ` · ${esc(i.engine)}` : ''}</span>
          </div>
          ${i.url || i.status === 'failed' ? `<div class="mk-kit-actions">
            <input class="form-control" data-kit-note="${esc(i.key)}" placeholder="${esc(tr('Feedback (optional)', 'ملاحظة للتعديل (اختياري)'))}">
            <button class="btn btn-secondary btn-sm" data-kit-redo="${esc(i.key)}" ${running ? 'disabled' : ''}><i class="fa-solid fa-rotate"></i> ${esc(tr('Redesign', 'أعد التصميم'))}</button>
            ${i.url ? `<a class="btn btn-secondary btn-sm" href="${esc(i.url)}" download="atlead-${esc(i.key)}.jpg" title="${esc(tr('Download', 'تنزيل'))}"><i class="fa-solid fa-download"></i></a>` : ''}
          </div>` : ''}
        </div>`).join('')}</div>`).join('');
  }

  $('mk-kit-start')?.addEventListener('click', async () => {
    if (!confirm(tr('All media designs will be generated with Nano Banana Pro. This takes a few minutes and uses OpenRouter credits (~10–15 cents per design). Start?', 'سيتم تصميم جميع الوسائط بأفضل نموذج (Nano Banana Pro). تستغرق العملية بضع دقائق وتستهلك من رصيد OpenRouter (نحو 10–15 سنتاً للتصميم الواحد). هل تريد البدء؟'))) return;
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
  function renderResearch(r) {
    const box = $('mk-research-body');
    const comps = r.competitors || [];
    const cs = r.customers || {};
    box.innerHTML = `
      <div class="form-hint no-i18n" style="margin-bottom:12px;">${esc(tr('Last updated:', 'آخر تحديث:'))} ${new Date(r.fetched_at).toLocaleString('en-GB')}</div>
      <div class="glass-card">
        <h4 class="mk-card-title"><i class="fa-brands fa-instagram" style="color:var(--brand-instagram);"></i> ${esc(tr('Competitors — their most engaging posts', 'المنافسون — أكثر منشوراتهم تفاعلاً'))}</h4>
        ${!comps.length ? `<p class="form-hint">${esc(tr('No competitors added. Add them from the', 'لا يوجد منافسون مضافون. أضفهم من تبويب'))} <b>${esc(tr('Setup', 'الإعدادات والربط'))}</b>.</p>` : comps.map(c => c.error
          ? `<div class="mk-comp"><b class="no-i18n">@${esc(c.username)}</b> <span class="mk-alert inline no-i18n">${esc(c.error)}</span></div>`
          : `<div class="mk-comp"><div class="mk-comp-head"><b class="no-i18n">@${esc(c.username)}</b> <span class="form-hint no-i18n">${c.followers.toLocaleString()} ${esc(tr('followers', 'متابع'))} · ${esc(tr('avg engagement', 'متوسط تفاعل'))} ${c.avg_engagement}</span></div>
            ${(c.posts || []).map(p => `<div class="mk-comp-post">
              <div class="mk-comp-stats"><span><i class="fa-regular fa-heart"></i> ${p.likes}</span><span><i class="fa-regular fa-comment"></i> ${p.comments}</span></div>
              <div class="mk-comp-cap no-i18n bidi-text">${esc(p.caption.slice(0, 220)) || `<i>${esc(tr('No caption', 'بدون نص'))}</i>`}</div>
              <div class="mk-comp-actions">
                ${p.permalink ? `<a href="${esc(p.permalink)}" target="_blank" rel="noopener" class="mk-link">${esc(tr('Open', 'فتح'))}</a>` : ''}
                <button class="btn btn-secondary btn-sm" data-inspire="${esc(p.caption.slice(0, 400))}"><i class="fa-solid fa-wand-magic-sparkles"></i> ${esc(tr('Create a better post on this topic', 'أنشئ منشوراً أفضل عن الموضوع نفسه'))}</button>
              </div></div>`).join('')}</div>`).join('')}
      </div>
      <div class="grid-2">
        <div class="glass-card">
          <h4 class="mk-card-title"><i class="fa-solid fa-comments" style="color:var(--status-success-ink);"></i> ${esc(tr('What your customers ask (from the bot and comments)', 'ماذا يسأل عملاؤك (من البوت والتعليقات)'))}</h4>
          ${[[tr('Industries', 'مجالاتهم'), cs.business_types], [tr('Problems', 'مشاكلهم'), cs.problems], [tr('Requests', 'طلباتهم'), cs.requests], [tr('Objections', 'اعتراضاتهم'), cs.objections], [tr('Interested comments', 'تعليقات مهتمة'), cs.comments]]
            .filter(([, v]) => v && v.length).map(([k, v]) => `<div class="mk-signal"><b>${esc(k)}</b><ul class="no-i18n bidi-text">${v.slice(0, 6).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('') || `<p class="form-hint">${esc(tr('Not enough conversations yet.', 'لا توجد محادثات كافية بعد.'))}</p>`}
        </div>
        <div class="glass-card">
          <h4 class="mk-card-title"><i class="fa-solid fa-clock" style="color:var(--status-warning-ink);"></i> ${esc(tr('Best upcoming posting times', 'أفضل أوقات النشر القادمة'))}</h4>
          ${(r.best_times || []).map(t => `<div class="mk-signal"><b class="no-i18n">${esc(t.label)}</b><div class="form-hint no-i18n">${esc(t.reason)}</div></div>`).join('')}
          <p class="form-hint">${r.own_count >= 8
            ? esc(tr(`Calculated from engagement on your ${r.own_count} past posts + regional peak hours.`, `محسوبة من تفاعل ${r.own_count} منشوراً سابقاً لكم + أوقات الذروة في المنطقة.`))
            : esc(tr('Based on peak times in Jordan and the region; it gets more accurate the more you post.', 'محسوبة من أوقات الذروة في الأردن والمنطقة، وتزداد دقتها مع زيادة النشر.'))}</p>
          <h4 class="mk-card-title" style="margin-top:16px;"><i class="fa-solid fa-trophy" style="color:var(--status-warning-ink);"></i> ${esc(tr('Your best-performing posts', 'أنجح منشوراتكم'))}</h4>
          ${(r.own_top || []).map(p => `<div class="mk-signal"><span class="form-hint no-i18n">${esc(tr('Engagement', 'تفاعل'))} ${p.engagement} · ${p.platform === 'instagram' ? tr('Instagram', 'إنستغرام') : tr('Facebook', 'فيسبوك')}</span><div class="no-i18n bidi-text">${esc(p.text.slice(0, 140)) || `<i>${esc(tr('No caption', 'بدون نص'))}</i>`}</div></div>`).join('') || `<p class="form-hint">${esc(tr('Could not read your posts (check the Meta connection).', 'تعذّرت قراءة منشوراتكم (تحقّق من ربط Meta).'))}</p>`}
        </div>
      </div>
      <div class="glass-card">
        <h4 class="mk-card-title"><i class="fa-solid fa-newspaper" style="color:var(--status-info-ink);"></i> ${esc(tr('Industry news this week', 'أخبار المجال هذا الأسبوع'))}</h4>
        ${(r.news || []).map(n => `<div class="mk-news"><span class="mk-tag no-i18n">${esc(n.keyword)}</span> <span class="no-i18n bidi-text">${esc(n.title)}</span> <button class="btn btn-secondary btn-sm" data-news="${esc(n.title)}">${esc(tr('Post about this news', 'منشور عن هذا الخبر'))}</button></div>`).join('') || `<p class="form-hint">${esc(tr('No news available right now.', 'لا توجد أخبار حالياً.'))}</p>`}
      </div>`;
  }

  async function loadResearch(refresh = false) {
    const box = $('mk-research-body');
    box.innerHTML = `<div class="mk-loading"><div class="mk-spinner"></div><p>${esc(tr('Reading the market & competitors...', 'جاري قراءة السوق والمنافسين...'))}</p></div>`;
    let r;
    try { r = await api(`/api/marketing/research${refresh ? '?refresh=1' : ''}`, undefined, 'GET'); } catch (e) {
      box.innerHTML = `<div class="mk-alert no-i18n">${esc(e.message)}</div>`; return;
    }
    lastResearch = r;
    renderResearch(r);
  }
  $('mk-research-body').addEventListener('click', (e) => {
    const ins = e.target.closest('[data-inspire]');
    const news = e.target.closest('[data-news]');
    if (ins) {
      const topic = prompt(tr('What is your post title? (We will write it in our style without copying)', 'ما عنوان منشورك؟ (سنكتبه بأسلوبنا دون نسخ)'), ins.dataset.inspire.split('\n')[0].slice(0, 80));
      if (topic) run(tr('Designing images...', 'جاري تصميم الصور...'), () => api('/api/marketing/plans', { topic, inspired_by: ins.dataset.inspire }));
    } else if (news) {
      run(tr('Designing images...', 'جاري تصميم الصور...'), () => api('/api/marketing/plans', { topic: `${tr('Our take on:', 'رأينا في خبر:')} ${news.dataset.news}`.slice(0, 140), inspired_by: news.dataset.news }));
    }
  });
  $('mk-btn-refresh-research').addEventListener('click', () => loadResearch(true));

  // ---------- setup ----------
  function renderBrand(b) {
    const box = $('mk-brand-box');
    if (!box) return;
    const g = b?.guide;
    box.innerHTML = `
      ${g ? `<p class="mk-brand-summary no-i18n bidi-text">${esc(g.summary_ar || '')}</p>
        <div class="mk-swatches">${(g.palette || []).map(c => `<span class="mk-swatch no-i18n" title="${esc(c.role)}"><i style="background:${esc(c.hex)}"></i>${esc(c.hex)}</span>`).join('')}</div>
        <div class="form-hint no-i18n" style="margin:6px 0 10px;">${esc([g.typography, g.mood].filter(Boolean).join(' — '))}</div>`
        : `<p class="form-hint" style="margin-bottom:10px;">${esc(tr('Your design identity has not been analyzed yet. Press "Learn from my page" to read your Instagram posts and extract colors, fonts and design style, so every new image follows the same look.', 'لم تُحلَّل هوية تصميمك بعد. اضغط «تعلّم من صفحتي» لقراءة منشوراتك على إنستغرام واستخراج الألوان والخطوط وأسلوب التصميم، لتخرج كل صورة جديدة بالأسلوب نفسه.'))}</p>`}
      <div class="mk-brand-files">
        <div class="mk-brand-file logo">${b?.logo_url ? `<img src="${esc(b.logo_url)}" alt=""><button data-brand-remove="${esc(b.logo)}" title="${esc(tr('Delete', 'حذف'))}">×</button>` : `<span>${esc(tr('Logo', 'اللوغو'))}</span>`}</div>
        ${(b?.ref_urls || []).map(r => `<div class="mk-brand-file"><img src="${esc(r.url)}" alt=""><button data-brand-remove="${esc(r.file)}" title="${esc(tr('Delete', 'حذف'))}">×</button></div>`).join('')}
      </div>
      <div class="mk-actions">
        <button type="button" class="btn btn-primary btn-sm" id="mk-brand-learn"><i class="fa-brands fa-instagram"></i> ${esc(g ? tr('Re-learn from my page', 'أعد التعلّم من صفحتي') : tr('Learn from my page', 'تعلّم من صفحتي'))}</button>
        <label class="btn btn-secondary btn-sm" style="cursor:pointer;"><i class="fa-solid fa-upload"></i> ${esc(tr('Upload logo', 'ارفع اللوغو'))}<input type="file" accept="image/*" hidden data-brand-upload="logo"></label>
        <label class="btn btn-secondary btn-sm" style="cursor:pointer;"><i class="fa-solid fa-images"></i> ${esc(tr('Add a reference design', 'أضف تصميماً كمرجع'))}<input type="file" accept="image/*" hidden data-brand-upload="ref"></label>
        ${(b?.refs || []).length ? `<button type="button" class="btn btn-secondary btn-sm" id="mk-brand-reanalyze"><i class="fa-solid fa-rotate"></i> ${esc(tr('Re-analyse', 'حلّل من جديد'))}</button>` : ''}
      </div>
      ${b?.learned_at ? `<div class="form-hint no-i18n" style="margin-top:6px;">${esc(tr('From', 'من'))} ${esc(b.source || tr('Page', 'الصفحة'))} — ${esc(String(b.posts_analyzed || (b.refs || []).length))} ${esc(tr('designs', 'تصاميم'))}, ${new Date(b.learned_at).toLocaleDateString('en-GB')}${overview?.image_engine ? ` · ${esc(tr('Generator:', 'المولّد:'))} ${esc(overview.image_engine)}` : ''}</div>` : ''}`;
  }

  async function brandCall(waiting, fn) {
    const box = $('mk-brand-box');
    const old = box.innerHTML;
    box.innerHTML = `<div class="mk-loading" style="padding:20px;"><div class="mk-spinner"></div><p>${esc(waiting)}</p></div>`;
    try {
      const d = await fn();
      showToast(d.message || tr('Done', 'تم'), 'success');
      if (overview) overview.brand = d.brand;
      renderBrand(d.brand);
    } catch (e) { showToast(e.message, 'error'); box.innerHTML = old; }
  }

  $('mk-pane-setup')?.addEventListener('click', (e) => {
    if (e.target.closest('#mk-brand-learn')) brandCall(tr('Reading your page posts and analyzing design style… (~1 minute)', 'جاري قراءة منشورات صفحتك وتحليل التصميم… (نحو دقيقة)'), () => api('/api/marketing/brand/learn', {}));
    else if (e.target.closest('#mk-brand-reanalyze')) brandCall(tr('Analyzing…', 'جاري التحليل…'), () => api('/api/marketing/brand/reanalyze', {}));
    const rm = e.target.closest('[data-brand-remove]');
    if (rm) brandCall('…', () => api('/api/marketing/brand/remove', { file: rm.dataset.brandRemove }));
  });
  $('mk-pane-setup')?.addEventListener('change', (e) => {
    const inp = e.target.closest('[data-brand-upload]');
    if (!inp || !inp.files[0]) return;
    const fd = new FormData();
    fd.append('image', inp.files[0]);
    fd.append('kind', inp.dataset.brandUpload);
    brandCall(tr('Uploading…', 'جاري الرفع…'), () => api('/api/marketing/brand/upload', fd));
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
    $('mk-keywords').value = (m.keywords || []).join(', ');
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
    if (!m.public_url && overview?.public_url) $('mk-public-url').placeholder = `${overview.public_url} (${tr('auto', 'تلقائي')})`;
    renderBrand(overview?.brand);
    const ch = overview?.channels || {};
    $('mk-channels-status').innerHTML = Object.values(ch).map(c => `<div class="mk-result ${c.ready ? 'ok' : 'bad'}"><i class="fa-solid ${c.ready ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i> <b class="no-i18n">${esc(c.label)}</b> <span class="no-i18n">${c.ready ? esc(tr('Ready', 'جاهز')) : esc(c.note)}</span></div>`).join('');
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
      showToast(tr('Marketing settings saved', 'تم حفظ إعدادات التسويق'), 'success');
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
    out.textContent = tr('Searching...', 'جاري البحث...');
    try {
      const r = await api('/api/marketing/telegram/detect', { bot_token: $('mk-tg-token').value.trim() });
      out.innerHTML = r.chats.map(c => `<button type="button" class="btn btn-secondary btn-sm no-i18n" data-chat="${esc(c.id)}" style="margin-top:4px; margin-inline-end:4px;">${esc(c.name)} (${esc(c.type)}) — ${esc(c.id)}</button>`).join('') + `<div>${esc(tr('Click your chat to add it, then save.', 'اضغط على محادثتك لإضافتها، ثم احفظ.'))}</div>`;
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
      run(tr('Designing 3 image options for this topic...', 'جاري تصميم 3 صور مختلفة للموضوع...'), () => api(`/api/marketing/plans/${p.id}/topic`, { index: Number(topic) }));
    }
  };

  window.addEventListener('DOMContentLoaded', () => {
    if (new URLSearchParams(location.search).get('tab') === 'marketing') switchTab('marketing');
  });
  window.addEventListener('atlead:langchange', () => {
    if (!opened && currentTab !== 'marketing') return;
    renderStatusStrip();
    render();
    const activeSub = document.querySelector('.mk-subtab.active')?.dataset.mk;
    if (activeSub === 'history') renderHistory();
    if (activeSub === 'kit' && lastKit) renderKit(lastKit.kit, lastKit.media);
    if (activeSub === 'research' && lastResearch) renderResearch(lastResearch);
    if (activeSub === 'setup') renderBrand(overview?.brand);
  });
  // Keep the status of scheduled posts fresh while the tab is open.
  setInterval(() => { if (currentTab === 'marketing' && !busy) refreshList(); }, 60000);
})();
