// sessionLock.js
//
// A tracking session's document gets written from more than one place:
//   - locationRoutes.js  (/update, /batch-sync) — every 1-3s while the FSE moves
//   - sessionRoutes.js   (GET /:sessionId)       — recalculates totalDistanceKm
//                                                   on every poll from the app
// If two of those run concurrently for the same sessionId, a plain
// read -> modify -> save() can lose one side's change (whichever save lands
// second wins, silently discarding the other update). That is what produced
// sessions with a real route array but totalDistanceKm stuck at 0.
//
// runExclusive() serializes all work for a given sessionId through a single
// promise chain so only one read-modify-write ever happens at a time for
// that session. This is a single Node process (no clustering — see
// server.js) so an in-memory queue is sufficient; if this backend is ever
// scaled out to multiple instances, swap this for a distributed lock
// (e.g. a Mongo-backed lock document or Redis) instead.

const sessionLocks = new Map();

function runExclusive(sessionId, task) {
  const key = String(sessionId);
  const previous = sessionLocks.get(key) || Promise.resolve();
  const run = previous.then(task, task);

  // Chain a settled marker (never rejects) so the queue keeps moving even if
  // a given task fails. Callers still get the real result/rejection from `run`.
  sessionLocks.set(key, run.then(() => {}, () => {}));

  return run;
}

module.exports = { runExclusive };
