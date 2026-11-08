const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const storageService = require('../services/storageService');
const metaService = require('../services/metaService');
const whatsappService = require('../services/whatsappService');

// Verifies X-Hub-Signature-256 when an App Secret is configured.
function isValidSignature(req, appSecret) {
  if (!appSecret) return true;
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
  const appSecret = storageService.getSettings().meta?.app_secret;
  if (!isValidSignature(req, appSecret)) {
    console.warn('[Meta Webhook] Invalid signature — ignored');
    return res.sendStatus(401);
  }
  res.status(200).send('EVENT_RECEIVED');

  try {
    const body = req.body;
    if (body.object !== 'page' && body.object !== 'instagram') return;
    const isInstagram = body.object === 'instagram';
    const channel = isInstagram ? 'instagram_dm' : 'facebook_messenger';

    for (const entry of body.entry || []) {
      // A. Direct messages (Messenger / Instagram DM)
      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;
        if (event.message?.is_echo) {
          // Sent by the Page: either the bot, or a staff member replying from the Meta inbox / IG app.
          metaService.handleEcho(channel, event.recipient?.id, event.message).catch(err => console.error('[Meta] echo error:', err.message));
        } else if (event.message && senderId && !event.message.is_deleted && !event.message.is_unsupported) {
          await metaService.handleIncomingMessage(channel, senderId, event.message);
        } else if (event.postback && senderId) {
          // Button / Ice-breaker / "Get Started" clicks → treat the button title as the customer's message
          await metaService.handleIncomingMessage(channel, senderId, {
            mid: event.postback.mid || `pb_${event.timestamp || Date.now()}_${senderId}`,
            text: event.postback.title || event.postback.payload || 'مرحبا'
          });
        }
      }

      // B. Comments
      for (const change of entry.changes || []) {
        const val = change.value || {};

        // Facebook page feed comments
        if (!isInstagram && change.field === 'feed' && val.item === 'comment' && val.verb === 'add') {
          await metaService.handleIncomingComment('facebook', {
            comment_id: val.comment_id,
            post_id: val.post_id,
            from: val.from,
            message: val.message
          });
        }

        // Instagram comments: { id, text, from: {id, username}, media: {id} }
        if (isInstagram && (change.field === 'comments' || change.field === 'live_comments')) {
          await metaService.handleIncomingComment('instagram', {
            comment_id: val.id,
            post_id: val.media?.id,
            from: { id: val.from?.id, name: val.from?.username, username: val.from?.username },
            message: val.text
          });
        }
      }
    }
  } catch (err) {
    console.error('[Meta Webhook] Processing error:', err.message);
  }
});

// ==============================================================================
// 2. WHATSAPP CLOUD API WEBHOOK (only used when WhatsApp mode = cloud_api)
// ==============================================================================
router.get('/whatsapp', verifyHandler(() => storageService.getSettings().whatsapp?.verify_token || 'attlead_whatsapp_verify_token_2026', 'WhatsApp'));

router.post('/whatsapp', async (req, res) => {
  const appSecret = storageService.getSettings().meta?.app_secret;
  if (!isValidSignature(req, appSecret)) {
    return res.sendStatus(401);
  }
  res.status(200).send('EVENT_RECEIVED');

  try {
    const body = req.body;
    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry || []) {
        await whatsappService.handleIncomingMessage(entry);
      }
    }
  } catch (err) {
    console.error('[WhatsApp Webhook] Processing error:', err.message);
  }
});

module.exports = router;
