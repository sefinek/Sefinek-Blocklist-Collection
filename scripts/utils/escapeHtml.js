const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };

module.exports = str => String(str).replace(/[&<>"']/g, ch => ENTITIES[ch]);
