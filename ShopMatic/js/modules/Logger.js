/**
 * Logger — minimal logging port (hardened).
 * @author Calista Verner
 */
export class Logger {
  constructor({ foxEngine = null, debug = false, prefix = '' } = {}) {
    this.foxEngine = foxEngine;
    this.debug = !!debug;
    this.prefix = prefix ? String(prefix) : '';
  }

  _fmt(msg) {
    const p = this.prefix ? `[${this.prefix}] ` : '';
    return `${p}${String(msg ?? '')}`;
  }

  _errToString(err) {
    if (!err) return '';
    if (typeof err === 'string') return err;
    if (err instanceof Error) return `${err.name}: ${err.message}`;
    try { return JSON.stringify(err); } catch { return String(err); }
  }

  info(msg, meta = null) {
    const out = this._fmt(msg);
    try {
      this.foxEngine?.log?.(out, 'INFO');
    } catch {
      try { console.log(out, meta ?? ''); } catch {}
    }
  }

  warn(msg, meta = null) {
    const out = this._fmt(msg);
    try {
      this.foxEngine?.log?.(out, 'WARN');
    } catch {
      try { console.warn(out, meta ?? ''); } catch {}
    }
  }

  error(msg, err = null, meta = null) {
    const out = this._fmt(msg);
    const errStr = this._errToString(err);
    try {
      this.foxEngine?.log?.(`${out}${errStr ? ` | ${errStr}` : ''}`, 'ERROR');
    } catch {}

    try { console.error(out, err ?? '', meta ?? ''); } catch {}
  }

  debugLog(msg, meta = null) {
    if (!this.debug) return;
    this.info(msg, meta);
  }
}
