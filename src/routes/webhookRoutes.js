const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const storageService = require('../services/storageService');
const metaService = require('../services/metaService');
const whatsappService = require('../services/whatsappService');

// Webhook POSTs are trusted only when the App Secret is configured and the raw body matches its signature.
function isValidSignature(req, appSecret) {
  if (!appSecret) return false;
  const signature = req.get('x-hub-signature-256');
  if (!signature || !req.rawBody) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

function verifyHandler(getExpectedToken, label) {
  return (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode && token) {
      if (mode === 'subscribe' && token === getExpectedToken()) {
        console.log(`[${label} Webhook] Verified successfully!`);
        return res.status(200).send(challenge);
      }
      console.warn(`[${label} Webhook] Verification token mismatch`);
      return res.sendStatus(403);
    }
    res.sendStatus(400);
  };
}

// ==============================================================================
// 1. META WEBHOOK (Facebook Messenger, Instagram DM & Comments)
// ==============================================================================
router.get('/meta', verifyHandler(() => storageService.getSettings().meta?.verify_token || 'attlead_meta_verify_token_2026', 'Meta'));

router.post('/meta', async (req, res) => {
  const appSecret = metaService.config().app_secret;
  if (!isValidSignature(req, appSecret)) {
    console.warn('[Meta Webhook] Invalid signature — ignored');
    metaService.logWebhookEvent({ object: req.body?.object || '?', kind: 'rejected', detail: 'توقيع غير صحيح (App Secret غير مطابق)' });
    return res.sendStatus(401);
  }

  try {
    const body = req.body;
    for (const entry of body.entry || []) {
      for (const ev of entry.messaging || []) {
        metaService.logWebhookEvent({
          object: body.object,
          kind: ev.message?.is_echo ? 'echo' : ev.message ? 'message' : ev.postback ? 'postback' : Object.keys(ev).filter(k => !['sender', 'recipient', 'timestamp'].includes(k)).join(',') || 'other',
          detail: ev.message?.text ? String(ev.message.text).slice(0, 60) : (ev.message?.attachments?.[0]?.type || '')
        });
      }
      for (const ch of entry.changes || []) {
        metaService.logWebhookEvent({ object: body.object, kind: `change:${ch.field}`, detail: String(ch.value?.message || ch.value?.text || ch.value?.item || '').slice(0, 60) });
      }
    }
    console.log(`[Meta Webhook] ${body.object}: ${(body.entry || []).map(e => `${(e.messaging || []).length} msg / ${(e.changes || []).map(c => c.field).join(',') || '0 changes'}`).join(' | ')}`);
    if (body.object !== 'page' && body.object !== 'instagram') return res.status(200).send('EVENT_RECEIVED');
    const cfg = metaService.config();
    const igAccountId = cfg.instagram_account_id;

    for (const entry of body.entry || []) {
      const entryIsIg = body.object === 'instagram' || (igAccountId && entry.id === igAccountId);

      // Support both entry.messaging and entry.standby (Handover protocol / Meta Business Suite / Instagram inbox)
      const messagingEvents = [...(entry.messaging || []), ...(entry.standby || [])];

      // A. Direct messages (Messenger / Instagram DM)
      for (const event of messagingEvents) {
        const isIgEvent = entryIsIg || (igAccountId && (event.recipient?.id === igAccountId || event.sender?.id === igAccountId));
        const channel = isIgEvent ? 'instagram_dm' : 'facebook_messenger';
        const senderId = event.sender?.id;

        if (event.message?.is_echo) {
          // Sent by the Page: either the bot, or a staff member replying from the Meta inbox / IG app.
          await metaService.handleEcho(channel, event.recipient?.id, event.message);
        } else if (event.message && senderId && !event.message.is_deleted && !event.message.is_unsupported) {
          const result = await metaService.handleIncomingMessage(channel, senderId, event.message);
          if (result?.success === false) throw new Error(result.error || result.message || 'Meta message processing failed');
        } else if (event.postback && senderId) {
          // Button / Ice-breaker / "Get Started" clicks → treat the button title as the customer's message
          const result = await metaService.handleIncomingMessage(channel, senderId, {
            mid: event.postback.mid || `pb_${event.timestamp || Date.now()}_${senderId}`,
            text: event.postback.title || event.postback.payload || 'مرحبا'
          });
          if (result?.success === false) throw new Error(result.error || result.message || 'Meta postback processing failed');
        }
      }

      // B. Comments
      for (const change of entry.changes || []) {
        const val = change.value || {};
        const isIgChange = entryIsIg || change.field === 'comments' || change.field === 'live_comments' || change.field === 'mention';

        // Facebook page feed comments
        if (!isIgChange && change.field === 'feed' && val.item === 'comment' && val.verb === 'add') {
          const result = await metaService.handleIncomingComment('facebook', {
            comment_id: val.comment_id,
            post_id: val.post_id,
            from: val.from,
            message: val.message
          });
          if (result?.success === false) throw new Error(result.error || result.message || 'Facebook comment processing failed');
        }

        // Instagram comments: { id, text, from: {id, username}, media: {id} }
        if (isIgChange && (change.field === 'comments' || change.field === 'live_comments')) {
          const result = await metaService.handleIncomingComment('instagram', {
            comment_id: val.id,
            post_id: val.media?.id,
            from: { id: val.from?.id, name: val.from?.username, username: val.from?.username },
            message: val.text
          });
          if (result?.success === false) throw new Error(result.error || result.message || 'Instagram comment processing failed');
        }
      }
    }
    return res.status(200).send('EVENT_RECEIVED');
  } catch (err) {
    console.error('[Meta Webhook] Processing error:', err.message);
    return res.sendStatus(500);
  }
});

// ==============================================================================
// 2. WHATSAPP CLOUD API WEBHOOK (only used when WhatsApp mode = cloud_api)
// ==============================================================================
router.get('/whatsapp', verifyHandler(() => storageService.getSettings().whatsapp?.verify_token || 'attlead_whatsapp_verify_token_2026', 'WhatsApp'));

router.post('/whatsapp', async (req, res) => {
  const appSecret = metaService.config().app_secret;
  if (!isValidSignature(req, appSecret)) {
    return res.sendStatus(401);
  }

  try {
    const body = req.body;
    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry || []) {
        const result = await whatsappService.handleIncomingMessage(entry);
        if (result?.success === false) throw new Error(result.error || result.message || 'WhatsApp message processing failed');
      }
    }
    return res.status(200).send('EVENT_RECEIVED');
  } catch (err) {
    console.error('[WhatsApp Webhook] Processing error:', err.message);
    return res.sendStatus(500);
  }
});

module.exports = router;
