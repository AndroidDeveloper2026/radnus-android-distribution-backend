// utils/teamSocket.js
// Socket.IO: authenticated connections + "send to my superiors" fan-out.
//   room 'admin'        -> all Admin sockets
//   room 'user:<id>'    -> every socket of that user
const jwt = require('jsonwebtoken');
const { getAncestorIds } = require('./hierarchyScope');

function attachSocketAuth(io) {
  io.use((socket, next) => {
    try {
      const raw =
        (socket.handshake.auth && socket.handshake.auth.token) ||
        (socket.handshake.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!raw) return next(new Error('unauthorized'));
      socket.user = jwt.verify(raw, process.env.ACCESS_SECRET);
      next();
    } catch (e) {
      next(new Error('unauthorized'));
    }
  });
}

function joinPersonalRooms(socket) {
  if (!socket.user) return;
  if (socket.user.role === 'Admin') socket.join('admin');
  else if (socket.user.id) socket.join(`user:${socket.user.id}`);
}

// ancestors rarely change -> small TTL cache so a point doesn't cost DB hits
const ancestorCache = new Map(); // userId -> { ids, exp }
const ANCESTOR_TTL_MS = 5 * 60 * 1000;

async function cachedAncestors(userId) {
  const key = String(userId);
  const hit = ancestorCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.ids;
  const ids = await getAncestorIds(key);
  ancestorCache.set(key, { ids, exp: Date.now() + ANCESTOR_TTL_MS });
  return ids;
}

function clearAncestorCache() {
  ancestorCache.clear();
}

// Emit `team-location` to Admin + every superior of `userId`.
async function broadcastToSuperiors(io, userId, payload) {
  if (!io) return false;
  io.to('admin').emit('team-location', payload);
  const ancestors = await cachedAncestors(userId);
  for (const id of ancestors) io.to(`user:${id}`).emit('team-location', payload);
  return true;
}

module.exports = {
  attachSocketAuth,
  joinPersonalRooms,
  broadcastToSuperiors,
  clearAncestorCache,
};
