// distance.js - COMPLETE PRODUCTION VERSION

function toRad(value) {
  if (value === undefined || value === null || isNaN(value)) {
    return 0;
  }
  return value * Math.PI / 180;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  // ✅ Guard against null/undefined/NaN coordinates
  if (
    lat1 == null || lon1 == null ||
    lat2 == null || lon2 == null ||
    isNaN(lat1) || isNaN(lon1) ||
    isNaN(lat2) || isNaN(lon2)
  ) {
    console.warn('calculateDistance: invalid coordinates', { lat1, lon1, lat2, lon2 });
    return 0;
  }

  const R = 6371; // Earth radius in km

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const distance = R * c;
  
  // ✅ Round to 6 decimal places to avoid floating point issues
  return parseFloat(distance.toFixed(6));
}

module.exports = calculateDistance;

//================ working code of 80 percentage (04.08.26) ==================
// function toRad(value) {
//   return value * Math.PI / 180;
// }

// function calculateDistance(lat1, lon1, lat2, lon2) {
//   // ✅ FIX: guard against null/undefined/NaN coordinates — return 0 instead
//   //         of silently producing NaN which corrupts totalDistanceKm accumulation
//   if (
//     lat1 == null || lon1 == null ||
//     lat2 == null || lon2 == null ||
//     isNaN(lat1) || isNaN(lon1) ||
//     isNaN(lat2) || isNaN(lon2)
//   ) {
//     console.warn('calculateDistance: invalid coordinates', { lat1, lon1, lat2, lon2 });
//     return 0;
//   }

//   const R = 6371; // Earth radius in km

//   const dLat = toRad(lat2 - lat1);
//   const dLon = toRad(lon2 - lon1);

//   const a =
//     Math.sin(dLat / 2) * Math.sin(dLat / 2) +
//     Math.cos(toRad(lat1)) *
//     Math.cos(toRad(lat2)) *
//     Math.sin(dLon / 2) * Math.sin(dLon / 2);

//   const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

//   return R * c;
// }

// module.exports = calculateDistance;