// Prompt logging for house-party games — collection only, no logic reads it.
//
// The host's phone writes one row per prompt shown (or skipped) to the
// Supabase table diary_prompt_log (supabase/migrations/011_diary_prompt_log.sql).
// If the insert fails — offline, or the migration not applied yet — the row
// is kept in a local queue on that phone and retried on the next successful
// write, so nothing collected is lost while the table doesn't exist.
//
// Rows never contain user ids, handles or answer text.
import { sb } from "./backend.js";

const QUEUE_KEY = "rando-prompt-log-queue-v1";
const QUEUE_MAX = 500;
const TABLE = "diary_prompt_log";

function readQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); } catch { return []; }
}
function writeQueue(q) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-QUEUE_MAX))); } catch { /* storage full or blocked: drop */ }
}

let flushing = false;
async function insert(rows) {
  const { error } = await sb.from(TABLE).insert(rows);
  if (error) throw error;
}

export const promptLog = {
  // every row also lands here, for the test harness and for debugging
  recent: [],
  async log(row) {
    const r = { ...row, logged_at: new Date().toISOString() };
    this.recent.push(r); if (this.recent.length > 100) this.recent.shift();
    const { logged_at, ...dbRow } = r;
    try {
      await insert([dbRow]);
      this.flush();
    } catch (e) {
      const q = readQueue(); q.push(dbRow); writeQueue(q);
      if (!this._warned) { this._warned = true; console.info(`[promptLog] queued locally (${e?.message ?? e}); will retry`); }
    }
  },
  // retry anything queued from earlier failures
  async flush() {
    if (flushing) return;
    const q = readQueue();
    if (!q.length) return;
    flushing = true;
    try { await insert(q); writeQueue([]); }
    catch { /* still failing: keep the queue */ }
    finally { flushing = false; }
  },
  queued() { return readQueue().length; },
};
