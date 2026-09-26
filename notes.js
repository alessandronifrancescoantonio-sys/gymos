// Persistent session/exercise notes in the existing Notion session-note field.
// Plain legacy text remains readable; no database schema migration is needed.
const Notes = {
  prefix: "GYMOS_NOTES_V1\n",
  decode(raw) {
    if (String(raw).startsWith(this.prefix)) {
      try {
        const value = JSON.parse(raw.slice(this.prefix.length));
        if (value && typeof value.note === "string" && value.exercises && typeof value.exercises === "object" && !Array.isArray(value.exercises))
          return { note: value.note, exercises: Object.fromEntries(Object.entries(value.exercises).filter(([, v]) => typeof v === "string")) };
      } catch (_) {}
    }
    return { note: String(raw || ""), exercises: {} };
  },
  encode(note, exercises) {
    return Object.keys(exercises || {}).length ? this.prefix + JSON.stringify({ note: note || "", exercises }) : note || "";
  },
  key(id) { return "gymos_notes_pending_" + id; },
  pending(id) { try { return JSON.parse(localStorage.getItem(this.key(id)) || "null"); } catch (_) { return null; } },
  stage(id, patch) {
    const old = this.pending(id) || {};
    const next = { ...old, ...patch, exercises: { ...old.exercises, ...patch.exercises } };
    // A failed local write is surfaced, never silently described as saved.
    localStorage.setItem(this.key(id), JSON.stringify(next));
  },
  queues: new Map(),
  flush(id) {
    const previous = this.queues.get(id) || Promise.resolve();
    const job = previous.catch(() => {}).then(async () => {
      const patch = this.pending(id);
      if (!patch) return;
      const page = await API.call("/pages/" + id);
      const remote = this.decode(API.read.rich_text(page, CONFIG.PROPS.WL_NOTE));
      const exercises = { ...remote.exercises, ...patch.exercises };
      for (const key of Object.keys(exercises)) if (!exercises[key]) delete exercises[key];
      await API.update(id, { [CONFIG.PROPS.WL_NOTE]: API.prop.rich_text(this.encode(patch.note ?? remote.note, exercises)) });
      if (JSON.stringify(this.pending(id)) === JSON.stringify(patch)) localStorage.removeItem(this.key(id));
    });
    this.queues.set(id, job);
    job.finally(() => { if (this.queues.get(id) === job) this.queues.delete(id); }).catch(() => {});
    return job;
  },
  async retry() {
    const ids = Object.keys(localStorage).filter(k => k.startsWith("gymos_notes_pending_")).map(k => k.slice(20));
    for (const id of ids) await this.flush(id);
  },
};
