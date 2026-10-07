// Normalises free text (customer name / shop name) so that
// "Sri  Lakshmi Stores", "sri lakshmi stores." and "SRI LAKSHMI STORES"
// all produce the same comparison key. Unicode-aware (Tamil etc. kept).
const normKey = (s) =>
  String(s == null ? "" : s)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();

module.exports = { normKey };