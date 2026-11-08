/**
 * Daily automatic backup of the local data (conversations, leads, comments,
 * settings, WhatsApp session...) into ./backups/<date>/. Old backups are pruned.
 * Runs once a day at 03:00 (business timezone) + on demand from the dashboard.
 */
const fs = require('fs');
const path = require('path');
const storageService = require('./storageService');
const businessHours = require('./businessHours');

// With DATA_DIR (persistent volume) backups live inside it, so they survive redeploys too.
const BACKUP_DIR = process.env.DATA_DIR ? path.join(path.resolve(process.env.DATA_DIR), 'backups') : path.join(__dirname, '../../backups');
const BACKUP_HOUR_MINUTES = 3 * 60;

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name.endsWith('.tmp') || entry.name.includes('.corrupted-') || entry.name === 'backups') continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

class BackupService {
  getConfig() {
    const b = storageService.getSettings().backup || {};
    const keep = Number(b.keep_days);
    return { enabled: b.enabled !== false, keepDays: Number.isFinite(keep) && keep >= 1 ? Math.min(90, keep) : 14 };
  }

  runBackup(reason = 'daily') {
    const now = businessHours.localParts();
    const stamp = `${now.dateKey}_${String(now.hour).padStart(2, '0')}${String(now.minute).padStart(2, '0')}`;
    const dest = path.join(BACKUP_DIR, stamp);
    copyDir(storageService.getDataDir(), dest);
    fs.writeFileSync(path.join(dest, 'backup-info.json'), JSON.stringify({ created_at: new Date().toISOString(), reason }, null, 2));
    storageService.setState('last_backup', { at: new Date().toISOString(), folder: stamp, reason });
    const removed = this.prune();
    console.log(`[Backup] Saved backups/${stamp} (${reason})${removed ? `, removed ${removed} old backup(s)` : ''}.`);
    return { folder: stamp, size: dirSize(dest), removed };
  }

  prune() {
    if (!fs.existsSync(BACKUP_DIR)) return 0;
    const { keepDays } = this.getConfig();
    const cutoff = Date.now() - keepDays * 24 * 3600 * 1000;
    let removed = 0;
    for (const name of fs.readdirSync(BACKUP_DIR)) {
      const full = path.join(BACKUP_DIR, name);
      try {
        if (fs.statSync(full).isDirectory() && fs.statSync(full).mtimeMs < cutoff) {
          fs.rmSync(full, { recursive: true, force: true });
          removed++;
        }
      } catch { /* ignore */ }
    }
    return removed;
  }

  list() {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR)
      .filter(n => fs.statSync(path.join(BACKUP_DIR, n)).isDirectory())
      .sort().reverse()
      .map(n => ({ folder: n, size: dirSize(path.join(BACKUP_DIR, n)) }));
  }

  // Called every minute: once a day after 03:00 (or right away if a day was missed).
  maybeRun() {
    if (!this.getConfig().enabled) return null;
    const now = businessHours.localParts();
    const last = storageService.getState('last_backup');
    const lastDay = last?.at ? businessHours.localParts(new Date(last.at)).dateKey : null;
    if (lastDay === now.dateKey) return null;
    const missedMoreThanADay = last?.at && Date.now() - new Date(last.at).getTime() > 26 * 3600 * 1000;
    if (now.minutes < BACKUP_HOUR_MINUTES && last?.at && !missedMoreThanADay) return null;
    return this.runBackup('daily');
  }
}

module.exports = new BackupService();
