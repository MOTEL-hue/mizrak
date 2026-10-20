// קוד חיבור מהאתר: MZ1. ואחריו JSON מקודד (כתובת האתר u, מפתח k)
export function parseConnectionCode(code: string): { siteUrl: string; token: string } | null {
  const text = code.trim();
  if (!text.startsWith('MZ1.')) return null;
  try {
    const body = text.slice(4).replace(/-/g, '+').replace(/_/g, '/');
    const padded = body + '='.repeat((4 - (body.length % 4)) % 4);
    const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)))) as {
      u?: string;
      k?: string;
    };
    if (!data.u || !data.k || !/^https:\/\//i.test(data.u) || !/^mz_[A-Za-z0-9_-]{32,80}$/.test(data.k)) return null;
    return { siteUrl: data.u.replace(/\/+$/, ''), token: data.k };
  } catch {
    return null;
  }
}
