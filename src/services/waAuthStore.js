/**
 * WhatsApp (Baileys) session storage.
 * Keys are written to local files (fast cache, data/wa_auth/) AND mirrored to the
 * Supabase `whatsapp_auth` table, so the linked session survives redeploys and
 * lives in the database. On startup, missing local keys are restored from the DB.
 */
const fs = require('fs');
const path = require('path');
const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');
const supabaseService = require('./supabaseService');

const AUTH_DIR = path.join(require('./storageService').getDataDir(), 'wa_auth');

const safeName = (id) => id.replace(/\//g, '__').replace(/:/g, '-') + '.json';

function readLocal(id) {
  try {
    const file = path.join(AUTH_DIR, safeName(id));
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
}

function writeLocal(id, serialized) {
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(path.join(AUTH_DIR, safeName(id)), serialized, 'utf-8');
}

function deleteLocal(id) {
  try { fs.unlinkSync(path.join(AUTH_DIR, safeName(id))); } catch { /* ignore */ }
}

async function readKey(id) {
  let serialized = readLocal(id);
  if (serialized == null && supabaseService.isEnabled()) {
    const fromDb = await supabaseService.getAuthKey(id);
    if (fromDb) {
      serialized = typeof fromDb === 'string' ? fromDb : JSON.stringify(fromDb);
      writeLocal(id, serialized);
    }
  }
  if (serialized == null) return null;
  try {
    return JSON.parse(serialized, BufferJSON.reviver);
  } catch {
    return null;
  }
}

async function useDbAuthState() {
  const creds = (await readKey('creds')) || initAuthCreds();

  const writeMany = async (entries) => {
    const toUpsert = [];
    const toDelete = [];
    for (const [id, value] of entries) {
      if (value == null) {
        deleteLocal(id);
        toDelete.push(id);
      } else {
        const serialized = JSON.stringify(value, BufferJSON.replacer);
        writeLocal(id, serialized);
        toUpsert.push({ id, data: serialized });
      }
    }
    if (supabaseService.isEnabled()) {
      await supabaseService.setAuthKeys(toUpsert);
      await supabaseService.deleteAuthKeys(toDelete);
    }
  };

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(ids.map(async (id) => {
            let value = await readKey(`${type}-${id}`);
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }));
          return data;
        },
        set: async (data) => {
          const entries = [];
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              entries.push([`${category}-${id}`, data[category][id]]);
            }
          }
          await writeMany(entries);
        }
      }
    },
    saveCreds: async () => writeMany([['creds', creds]])
  };
}

async function clearAuthState() {
  try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  if (supabaseService.isEnabled()) await supabaseService.clearAuth();
}

async function hasSavedSession() {
  const creds = await readKey('creds');
  return !!creds?.registered || !!creds?.me;
}

module.exports = { useDbAuthState, clearAuthState, hasSavedSession };
