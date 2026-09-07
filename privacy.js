// The same masking policy applies to command-line and browser Excel imports.
(function (root) {
  const COMPANY_MASKS = [['中保', '中O'], ['立偉', '立O'], ['多瑪', '多O'], ['立保', '立O']];
  function maskText(value) {
    if (typeof value !== 'string') return value;
    return COMPANY_MASKS.reduce((out, [from, to]) => out.split(from).join(to), value);
  }
  function maskName(name) { return typeof name === 'string' && name ? [...name][0] : name; }
  function maskData(data) {
    const stats = { values: 0, keys: 0, names: 0, sheets: new Set() };
    function walk(node) {
      if (typeof node === 'string') {
        const masked = maskText(node);
        if (masked !== node) stats.values++;
        return masked;
      }
      if (Array.isArray(node)) return node.map(walk);
      if (node && typeof node === 'object') {
        const out = {};
        for (const [key, value] of Object.entries(node)) {
          const maskedKey = maskText(key);
          if (maskedKey !== key) { stats.keys++; stats.sheets.add(maskedKey); }
          Object.defineProperty(out, maskedKey, { value: walk(value), enumerable: true, writable: true, configurable: true });
        }
        return out;
      }
      return node;
    }
    const masked = walk(data);
    for (const user of Object.values(masked.users || {})) {
      if (!user || typeof user.name !== 'string') continue;
      const surname = maskName(user.name);
      if (surname !== user.name) { user.name = surname; stats.names++; }
    }
    return { masked, stats };
  }
  function findLeaks(text) {
    return COMPANY_MASKS.map(([term]) => ({ term, count: text.split(term).length - 1 })).filter(x => x.count);
  }
  const api = { COMPANY_MASKS, maskText, maskName, maskData, findLeaks };
  root.RepairPrivacy = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
