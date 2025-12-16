// Paste URL 代理：为浏览器侧资源拉取提供短期票据（Query Ticket）
// - 票据只用于“允许 useProxy 在无 Authorization Header 的场景工作”
// - 票据本身不携带权限含义：签发时必须走权限校验（见 protected routes）

export const PASTE_URL_PROXY_TICKET_PATH = "/paste/url/proxy";
export const PASTE_URL_PROXY_TICKET_EXPIRES_IN_SECONDS = 5 * 60;

