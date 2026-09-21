// Small dotted-version comparison helper ("1.10.0" > "1.9.3").
// Ignores a leading "v" and any pre-release/build suffix ("1.2.0-beta" -> "1.2.0").

const isValidVersion = (v) => /^v?\d+(\.\d+)*/.test(String(v || "").trim());

const toParts = (v) =>
  String(v)
    .trim()
    .replace(/^v/i, "")
    .split(/[-+]/)[0]
    .split(".")
    .map((p) => {
      const n = parseInt(p, 10);
      return Number.isNaN(n) ? 0 : n;
    });

// returns -1 if a < b, 0 if equal, 1 if a > b
const compareVersions = (a, b) => {
  const pa = toParts(a);
  const pb = toParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
};

module.exports = { compareVersions, isValidVersion };
