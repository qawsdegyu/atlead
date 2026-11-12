// Public routes for the customer's AI voice call. Access = the private, unguessable link token.
const express = require('express');
const path = require('path');
const callService = require('../services/callService');

const page = express.Router();
const api = express.Router();
const TOKEN = /^[A-Za-z0-9_-]{20,40}$/;

const guard = (req, res, next) => (TOKEN.test(req.params.token) ? next() : res.status(404).json({ ok: false, error: 'not_found' }));

page.get('/:token', (req, res) => {
  if (!TOKEN.test(req.params.token)) return res.status(404).send('Not found');
  res.set('Cache-Control', 'no-store');
  res.set('Permissions-Policy', 'microphone=(self)');
  res.sendFile(path.join(__dirname, '..', 'views', 'call.html'), { dotfiles: 'allow' });
});

api.get('/:token', guard, (req, res) => res.json(callService.publicInfo(req.params.token)));

api.post('/:token/start', guard, async (req, res) => {
  try {
    res.json({ ok: true, ...(await callService.startRealtime(req.params.token)) });
  } catch (e) {
    res.status(e.code === 'openai' ? 502 : 400).json({ ok: false, error: e.code || 'failed' });
  }
});

api.post('/:token/transcript', guard, (req, res) => {
  const s = callService.addTranscript(req.params.token, req.body?.lines);
  res.json({ ok: !!s });
});

api.post('/:token/tool', guard, async (req, res) => {
  try {
    res.json({ ok: true, result: await callService.tool(req.params.token, String(req.body?.name || ''), req.body?.args || {}) });
  } catch (e) {
    res.json({ ok: true, result: { error: e.message } });
  }
});

// sendBeacon posts text/plain, so read the body either way.
api.post('/:token/end', guard, express.text({ type: '*/*', limit: '2mb' }), (req, res) => {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (body?.lines) callService.addTranscript(req.params.token, body.lines);
  callService.finish(req.params.token, { reason: body?.reason || 'ended' }).catch(e => console.error('[Call] finish:', e.message));
  res.json({ ok: true });
});

module.exports = { page, api };
