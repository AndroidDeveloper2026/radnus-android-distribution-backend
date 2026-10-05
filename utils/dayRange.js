// utils/dayRange.js
// "Today" for field staff = the Indian calendar day, independent of the
// server's time zone (cloud servers usually run in UTC).
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istDayRange(date = new Date()) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  const startUtcMs =
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) -
    IST_OFFSET_MS;
  return { start: new Date(startUtcMs), end: new Date(startUtcMs + 24 * 60 * 60 * 1000) };
}

module.exports = { istDayRange, IST_OFFSET_MS };
