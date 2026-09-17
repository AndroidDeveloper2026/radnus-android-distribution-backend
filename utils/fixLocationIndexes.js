// utils/fixLocationIndexes.js
//
// ROOT CAUSE FIX for "FSE GPS points are not saving to the database":
//
// models/LocationModel/Location.js does NOT declare any `unique: true` index.
// But if the live MongoDB `locations` collection was ever created (or
// migrated) under an older version of that schema that DID have a unique
// index (e.g. a unique index on {sessionId, timestamp} or similar), that
// index still physically exists on the collection. Mongoose never drops
// indexes automatically just because you removed `unique: true` from the
// schema — so every insert that happens to collide with that stale index
// gets rejected with a MongoDB E11000 error.
//
// routes/locationRoutes.js already catches that E11000 and — to avoid
// crashing the sync flow — reports { success: true, skipped: true,
// reason: 'duplicate_key' } back to the app. That keeps the UI/app happy,
// but it means the point was NEVER actually written to the database. This
// is exactly what produces symptoms like:
//   - "Some points couldn't be synced. They will be retried later."
//   - a Points to Sync count that never goes to 0 no matter how many times
//     the app retries
//   - distance/point counts on the phone that don't match what's actually
//     in MongoDB
//
// This module runs once at server startup, inspects the real indexes on
// the `locations` collection, and automatically drops any index that is
// (a) unique and (b) not the intentional `_id_` index — since the current
// schema never wants a unique index on this collection. This removes the
// need to manually run db.locations.getIndexes() / dropIndex() in mongosh
// every time this bites.

async function fixLocationIndexes(Location) {
  try {
    const collection = Location.collection;
    const indexes = await collection.indexes();

    const staleUniqueIndexes = indexes.filter(
      (idx) => idx.unique === true && idx.name !== '_id_'
    );

    if (staleUniqueIndexes.length === 0) {
      console.log('✅ Location index check: no stale unique indexes found.');
      return;
    }

    for (const idx of staleUniqueIndexes) {
      console.warn(
        `🚨 Found stale UNIQUE index "${idx.name}" (${JSON.stringify(idx.key)}) ` +
        `on the "locations" collection. This is not defined in the current ` +
        `schema and silently blocks GPS point inserts (E11000). Dropping it now...`
      );
      try {
        await collection.dropIndex(idx.name);
        console.log(`✅ Dropped stale index "${idx.name}" from locations collection.`);
      } catch (dropErr) {
        console.error(
          `❌ Failed to auto-drop index "${idx.name}" on locations collection: ${dropErr.message}. ` +
          `You may need to drop it manually: db.locations.dropIndex("${idx.name}")`
        );
      }
    }
  } catch (err) {
    console.error('❌ fixLocationIndexes check failed:', err.message);
  }
}

module.exports = fixLocationIndexes;
