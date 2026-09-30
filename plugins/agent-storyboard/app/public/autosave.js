export function createAutosave({ read, write, onState, onSaved, onError, delay = 450 }) {
  let revision = 0, savedRevision = 0, timer, pending;
  const flush = () => {
    clearTimeout(timer);
    if (pending) return pending;
    pending = (async () => {
      while (savedRevision < revision) {
        const version = revision;
        const snapshot = structuredClone(read());
        onState("saving");
        try {
          const saved = await write(snapshot);
          savedRevision = version;
          onSaved(saved);
          if (version === revision) onState("saved");
        } catch (error) {
          onState("error");
          onError(error);
          return false;
        }
      }
      return true;
    })().finally(() => { pending = null; });
    return pending;
  };
  return {
    schedule() { revision++; onState("dirty"); clearTimeout(timer); timer = setTimeout(flush, delay); },
    flush,
    get dirty() { return revision > savedRevision; }
  };
}
