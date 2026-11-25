/**
 * Reels & Keywords tab: the account's reels (Instagram + Facebook) and the keyword rules
 * that answer comments with a fixed reply and a DM (text, link, file, consultation form).
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const tr = (en, ar) => (window.atleadI18n?.lang === 'ar' ? ar : en);
  const toast = (m, t) => (window.showToast ? window.showToast(m, t) : alert(m));

  let rules = [];
  let media = [];
  let formUrl = '/consult';
  let platform = 'all';
  let editing = null; // rule being edited
  let loadedOnce = false;

  async function api(url, opts = {}) {
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(data.message || `HTTP ${res.status}`);
    return data;
  }

  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString(window.atleadI18n?.lang === 'ar' ? 'ar-JO' : 'en-GB', { day: 'numeric', month: 'short' });
  };
  const platformIcon = (p) => `<i class="fa-brands fa-${p === 'facebook' ? 'facebook' : 'instagram'}"></i>`;
  const rulesFor = (item) => rules.filter(r => r.media_ids?.some(m => m === item.id || String(m).endsWith(`_${item.id}`)));
  const generalRules = () => rules.filter(r => !r.media_ids?.length);

  // ---------- Rules list ----------
  function sends(r) {
    const out = [];
    if (r.send_form) out.push(`<span class="rl-tag form"><i class="fa-solid fa-file-signature"></i> ${esc(tr('Consultation form', 'نموذج الاستشارة'))}</span>`);
    if (r.link_url) out.push(`<span class="rl-tag"><i class="fa-solid fa-link"></i> ${esc(r.link_label || tr('Link', 'رابط'))}</span>`);
    if (r.file_url) out.push(`<span class="rl-tag"><i class="fa-solid fa-paperclip"></i> <span class="no-i18n">${esc(r.file_name || tr('File', 'ملف'))}</span></span>`);
    if (r.dm_text && !out.length) out.push(`<span class="rl-tag"><i class="fa-solid fa-message"></i> ${esc(tr('Message', 'رسالة'))}</span>`);
    return out.join('');
  }

  function scope(r) {
    if (!r.media_ids?.length) return tr('All reels and posts', 'كل الريلز والمنشورات');
    const known = r.media_ids.map(id => media.find(m => m.id === id)).filter(Boolean);
    if (known.length === 1) return `${tr('Reel', 'ريل')}: ${(known[0].caption || '').slice(0, 40) || known[0].id}`;
    if (r.media_ids.length === 1) return tr('One reel', 'ريل واحد');
    return tr(`${r.media_ids.length} reels`, `${r.media_ids.length} ريلز`);
  }

  function renderRules() {
    const box = $('rl-rules');
    if (!rules.length) {
      box.innerHTML = `<div class="rl-empty">${esc(tr('No rules yet. Add a keyword so commenters get your link, file or the consultation form.', 'لا توجد قواعد بعد. أضف كلمة مفتاحية ليصل المعلّقين رابطك أو ملفك أو نموذج الاستشارة.'))}</div>`;
      return;
    }
    box.innerHTML = rules.map(r => `
      <div class="rl-rule ${r.enabled === false ? 'off' : ''}" data-id="${esc(r.id)}">
        <div class="rl-rule-main">
          <div class="rl-rule-title"><strong class="no-i18n">${esc(r.name)}</strong>
            <span class="rl-platforms">${(r.platforms || []).map(platformIcon).join(' ')}</span>
          </div>
          <div class="rl-words no-i18n">${(r.keywords || []).map(k => `<span class="rl-word">${esc(k)}</span>`).join('')}</div>
          <div class="rl-meta"><span class="rl-scope">${esc(scope(r))}</span>${sends(r)}</div>
        </div>
        <div class="rl-rule-side">
          <span class="rl-count" title="${esc(tr('Comments answered by this rule', 'تعليقات ردّت عليها هذه القاعدة'))}"><b>${Number(r.stats?.triggered || 0)}</b> ${esc(tr('sent', 'أُرسلت'))}</span>
          <label class="rl-switch" title="${esc(tr('Turn on or off', 'تشغيل أو إيقاف'))}"><input type="checkbox" data-rl-toggle="${esc(r.id)}" ${r.enabled === false ? '' : 'checked'}><span></span></label>
          <button class="btn btn-secondary btn-sm" type="button" data-rl-edit="${esc(r.id)}"><i class="fa-solid fa-pen"></i> ${esc(tr('Edit', 'تعديل'))}</button>
          <button class="btn btn-secondary btn-sm btn-danger-ghost" type="button" data-rl-del="${esc(r.id)}" title="${esc(tr('Delete rule', 'حذف القاعدة'))}"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>`).join('');
  }

  // ---------- Reels grid ----------
  function renderMedia(errors = [], connected = true) {
    const notice = $('rl-notice');
    const msgs = connected ? [...errors] : [];
    if (!connected) msgs.unshift(tr('Connect Facebook / Instagram in Integrations to see your reels. Keyword rules for "all reels" still work once connected.', 'اربط فيسبوك/إنستغرام من الإعدادات لتظهر الريلز. القواعد العامة لكل الريلز تعمل مباشرة بعد الربط.'));
    notice.hidden = !msgs.length;
    notice.innerHTML = msgs.map(m => `<div>${esc(m)}</div>`).join('');

    const list = media.filter(m => platform === 'all' || m.platform === platform);
    const grid = $('rl-grid');
    if (!list.length) {
      grid.innerHTML = connected ? `<div class="rl-empty">${esc(tr('No reels found on this account yet.', 'لا توجد ريلز على هذا الحساب بعد.'))}</div>` : '';
      return;
    }
    const general = generalRules().filter(r => r.enabled !== false);
    grid.innerHTML = list.map(m => {
      const own = rulesFor(m);
      const words = [...own, ...general.filter(r => r.platforms?.includes(m.platform))].flatMap(r => r.keywords || []).slice(0, 4);
      return `
      <article class="rl-card">
        <a class="rl-thumb" href="${esc(m.permalink || '#')}" target="_blank" rel="noopener" title="${esc(tr('Open on', 'افتح على'))} ${m.platform}">
          ${m.thumbnail ? `<img src="${esc(m.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="rl-thumb-empty"><i class="fa-solid fa-film"></i></span>`}
          <span class="rl-badge">${platformIcon(m.platform)} ${m.kind === 'reel' ? 'Reel' : 'Post'}</span>
        </a>
        <div class="rl-card-body">
          <p class="rl-caption no-i18n" dir="auto">${esc((m.caption || '').slice(0, 140)) || `<span class="rl-muted">${esc(tr('No caption', 'بدون وصف'))}</span>`}</p>
          <div class="rl-stats">
            <span>${esc(fmtDate(m.created_at))}</span>
            ${m.comments != null ? `<span><i class="fa-regular fa-comment"></i> ${m.comments}</span>` : ''}
            ${m.rule_hits ? `<span class="rl-hit"><i class="fa-solid fa-paper-plane"></i> ${m.rule_hits} ${esc(tr('DMs', 'رسائل'))}</span>` : ''}
          </div>
          <div class="rl-card-words no-i18n">${words.length ? words.map(w => `<span class="rl-word sm">${esc(w)}</span>`).join('') : ''}</div>
          <div class="rl-card-actions">
            ${own.map(r => `<button type="button" class="btn btn-secondary btn-sm" data-rl-edit="${esc(r.id)}"><i class="fa-solid fa-pen"></i> <span class="no-i18n">${esc(r.name)}</span></button>`).join('')}
            <button type="button" class="btn btn-primary btn-sm" data-rl-add="${esc(m.id)}" data-rl-add-platform="${esc(m.platform)}"><i class="fa-solid fa-plus"></i> ${esc(tr('Keyword for this reel', 'كلمة لهذا الريل'))}</button>
          </div>
        </div>
      </article>`;
    }).join('');
  }

  // ---------- Load ----------
  async function load() {
    $('rl-grid').innerHTML = `<div class="rl-empty">${esc(tr('Loading your reels...', 'جاري تحميل الريلز...'))}</div>`;
    try {
      const data = await api(`/api/reels?all=${$('rl-allposts').checked ? 1 : 0}`);
      rules = data.rules || [];
      media = data.items || [];
      formUrl = data.form_url || formUrl;
      $('rl-form-url').textContent = formUrl;
      $('rl-form-url').href = formUrl;
      renderRules();
      renderMedia(data.errors || [], data.connected !== false);
    } catch (e) {
      try { const r = await api('/api/comment-rules'); rules = r.rules || []; renderRules(); } catch { /* ignore */ }
      renderMedia([e.message], true);
    }
    loadedOnce = true;
  }

  // ---------- Editor ----------
  function previewDm() {
    const lines = [];
    const dm = $('rl-dm').value.trim();
    if (dm) lines.push(esc(dm));
    if ($('rl-sendform').checked) lines.push(`<a>${esc(formUrl)}?ref=…</a>`);
    const link = $('rl-link').value.trim();
    if (link) lines.push(`${$('rl-link-label').value.trim() ? `${esc($('rl-link-label').value.trim())}: ` : ''}<a>${esc(link)}</a>`);
    if (editing?.file_url) lines.push(`${esc(editing.file_name || 'File')}: <a>${esc(editing.file_url)}</a>`);
    const reply = $('rl-public').value.split('\n').map(s => s.trim()).filter(Boolean)[0];
    $('rl-preview').innerHTML = `
      ${reply ? `<div class="rl-bubble pub" dir="auto"><small>${esc(tr('Reply under the comment', 'الرد تحت التعليق'))}</small>${esc(reply)}</div>` : ''}
      <div class="rl-bubble dm" dir="auto"><small>DM</small>${lines.join('<br><br>') || `<span class="rl-muted">${esc(tr('Nothing to send yet', 'لا يوجد شيء للإرسال بعد'))}</span>`}</div>`;
  }

  function openEditor(rule, target) {
    editing = rule ? { ...rule } : {
      name: '', keywords: [], match: 'contains', platforms: target ? [target.platform] : ['instagram', 'facebook'],
      media_ids: target ? [target.id] : [], public_replies: [tr('Sent you the details in DM.', 'أرسلنا لك التفاصيل على الخاص.')],
      dm_text: '', link_url: '', link_label: '', file_url: '', file_name: '', send_form: true, enabled: true
    };
    $('rl-modal-title').textContent = rule ? tr('Edit keyword rule', 'تعديل قاعدة الكلمة المفتاحية') : tr('New keyword rule', 'قاعدة كلمة مفتاحية جديدة');
    const m = editing.media_ids?.length ? media.find(x => x.id === editing.media_ids[0]) : null;
    $('rl-target').innerHTML = editing.media_ids?.length
      ? `${m?.thumbnail ? `<img src="${esc(m.thumbnail)}" alt="" referrerpolicy="no-referrer">` : ''}<div><b>${esc(tr('Only on this reel', 'على هذا الريل فقط'))}</b><span class="no-i18n">${esc((m?.caption || editing.media_ids.join(', ')).slice(0, 90))}</span>
         <button type="button" class="rl-linkbtn" id="rl-make-general">${esc(tr('Apply to all reels instead', 'طبّقها على كل الريلز بدلاً من ذلك'))}</button></div>`
      : `<div><b>${esc(tr('All reels and posts', 'كل الريلز والمنشورات'))}</b><span>${esc(tr('Any comment with the keyword, on any reel or post.', 'أي تعليق فيه الكلمة على أي ريل أو منشور.'))}</span></div>`;
    $('rl-target').classList.toggle('specific', !!editing.media_ids?.length);
    $('rl-name').value = editing.name || '';
    $('rl-keywords').value = (editing.keywords || []).join(', ');
    $('rl-match').value = editing.match || 'contains';
    $('rl-ig').checked = (editing.platforms || []).includes('instagram');
    $('rl-fb').checked = (editing.platforms || []).includes('facebook');
    $('rl-public').value = (editing.public_replies || []).join('\n');
    $('rl-dm').value = editing.dm_text || '';
    $('rl-sendform').checked = !!editing.send_form;
    $('rl-link').value = editing.link_url || '';
    $('rl-link-label').value = editing.link_label || '';
    $('rl-enabled').checked = editing.enabled !== false;
    showFile();
    previewDm();
    $('modal-rule').style.display = 'flex';
    setTimeout(() => $('rl-keywords').focus(), 30);
  }

  function showFile() {
    $('rl-file-name').textContent = editing?.file_url ? (editing.file_name || editing.file_url) : tr('No file', 'لا يوجد ملف');
    $('rl-file-clear').hidden = !editing?.file_url;
  }

  const closeEditor = () => { $('modal-rule').style.display = 'none'; editing = null; };

  async function saveEditor(e) {
    e.preventDefault();
    const platforms = [$('rl-ig').checked && 'instagram', $('rl-fb').checked && 'facebook'].filter(Boolean);
    if (!platforms.length) return toast(tr('Choose Instagram, Facebook or both.', 'اختر إنستغرام أو فيسبوك أو الاثنين.'), 'error');
    const body = {
      ...(editing.id ? { id: editing.id } : {}),
      name: $('rl-name').value.trim(),
      keywords: $('rl-keywords').value,
      match: $('rl-match').value,
      platforms,
      media_ids: editing.media_ids || [],
      public_replies: $('rl-public').value,
      dm_text: $('rl-dm').value.trim(),
      send_form: $('rl-sendform').checked,
      link_url: $('rl-link').value.trim(),
      link_label: $('rl-link-label').value.trim(),
      file_url: editing.file_url || '',
      file_name: editing.file_name || '',
      enabled: $('rl-enabled').checked
    };
    const btn = $('rl-save');
    btn.disabled = true;
    try {
      await api('/api/comment-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      toast(tr('Rule saved', 'تم حفظ القاعدة'), 'success');
      closeEditor();
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally { btn.disabled = false; }
  }

  async function uploadFile(file) {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    $('rl-file-name').textContent = tr('Uploading...', 'جاري الرفع...');
    try {
      const data = await api('/api/comment-rules/file', { method: 'POST', body: fd });
      editing.file_url = data.file_url;
      editing.file_name = data.file_name;
      toast(tr('File uploaded', 'تم رفع الملف'), 'success');
    } catch (err) { toast(err.message, 'error'); }
    showFile();
    previewDm();
  }

  async function toggleRule(id, on) {
    const r = rules.find(x => x.id === id);
    if (!r) return;
    try {
      await api('/api/comment-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...r, enabled: on }) });
      r.enabled = on;
      renderRules();
      toast(on ? tr('Rule turned on', 'تم تشغيل القاعدة') : tr('Rule turned off', 'تم إيقاف القاعدة'), 'success');
    } catch (err) { toast(err.message, 'error'); load(); }
  }

  async function deleteRule(id) {
    const r = rules.find(x => x.id === id);
    if (!confirm(tr(`Delete the rule "${r?.name || ''}"? Comments will no longer get its reply and DM.`, `حذف القاعدة "${r?.name || ''}"؟ لن تصل ردودها ورسائلها للمعلّقين بعد الآن.`))) return;
    try {
      await api(`/api/comment-rules/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast(tr('Rule deleted', 'تم حذف القاعدة'), 'success');
      load();
    } catch (err) { toast(err.message, 'error'); }
  }

  async function runTest() {
    const text = $('rl-test-text').value.trim();
    if (!text) return;
    const out = $('rl-test-out');
    try {
      const r = await api('/api/comment-rules/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform: $('rl-test-platform').value, text }) });
      out.hidden = false;
      out.innerHTML = r.matched
        ? `<div class="rl-test-hit"><i class="fa-solid fa-circle-check"></i> ${esc(tr('Matches', 'تطابق'))} <b class="no-i18n">${esc(r.rule_name)}</b> (${esc(tr('keyword', 'الكلمة'))}: <span class="no-i18n">${esc(r.keyword)}</span>)${r.reel_only ? ' — ' + esc(tr('only on its reel', 'على الريل المحدد فقط')) : ''}</div>
           <div class="rl-bubble pub no-i18n"><small>${esc(tr('Reply under the comment', 'الرد تحت التعليق'))}</small>${esc(r.public_reply || '-')}</div>
           <div class="rl-bubble dm no-i18n"><small>DM</small>${esc(r.dm).replace(/\n/g, '<br>')}</div>`
        : `<div class="rl-test-miss"><i class="fa-solid fa-circle-info"></i> ${esc(tr('No rule matches. The AI will handle this comment as usual.', 'لا تطابق أي قاعدة. سيتعامل الذكاء الاصطناعي مع التعليق كالمعتاد.'))}</div>`;
    } catch (err) { toast(err.message, 'error'); }
  }

  // ---------- Events ----------
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-rl-edit],[data-rl-del],[data-rl-add],[data-rl-platform],[data-rl-close],#rl-make-general');
    if (!el) return;
    if (el.dataset.rlEdit) openEditor(rules.find(r => r.id === el.dataset.rlEdit));
    else if (el.dataset.rlDel) deleteRule(el.dataset.rlDel);
    else if (el.dataset.rlAdd) openEditor(null, { id: el.dataset.rlAdd, platform: el.dataset.rlAddPlatform });
    else if (el.dataset.rlPlatform) {
      platform = el.dataset.rlPlatform;
      document.querySelectorAll('[data-rl-platform]').forEach(b => b.classList.toggle('active', b === el));
      renderMedia([], true);
    } else if (el.hasAttribute('data-rl-close')) closeEditor();
    else if (el.id === 'rl-make-general' && editing) { editing.media_ids = []; openEditor(editing.id ? editing : null); }
  });
  document.addEventListener('change', (e) => {
    if (e.target.matches('[data-rl-toggle]')) toggleRule(e.target.dataset.rlToggle, e.target.checked);
  });
  $('rl-new')?.addEventListener('click', () => openEditor(null));
  $('rl-refresh')?.addEventListener('click', load);
  $('rl-allposts')?.addEventListener('change', load);
  $('rl-form')?.addEventListener('submit', saveEditor);
  $('rl-form')?.addEventListener('input', previewDm);
  $('rl-file')?.addEventListener('change', (e) => { uploadFile(e.target.files[0]); e.target.value = ''; });
  $('rl-file-clear')?.addEventListener('click', () => { editing.file_url = ''; editing.file_name = ''; showFile(); previewDm(); });
  $('rl-test-btn')?.addEventListener('click', runTest);
  $('rl-test-text')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runTest(); } });
  $('modal-rule')?.addEventListener('click', (e) => { if (e.target.id === 'modal-rule') closeEditor(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('modal-rule')?.style.display === 'flex') closeEditor(); });
  window.addEventListener('atlead:langchange', () => { if (loadedOnce) { renderRules(); renderMedia([], true); } });

  window.rlOpen = load;
})();
