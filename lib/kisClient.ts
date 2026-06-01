// KIS Open API 공통 설정·헤더·유틸 — 여러 Route에서 공유
export const BASE_URL   = process.env.KIS_BASE_URL!;
export const APP_KEY    = process.env.KIS_APP_KEY!;
export const APP_SECRET = process.env.KIS_APP_SECRET!;

export const CODE_RE = /^[A-Z0-9]{6}$/i;

export const kisHeaders = (token: string): Record<string, string> => ({
  'content-type': 'application/json',
  authorization: `Bearer ${token}`,
  appkey: APP_KEY,
  appsecret: APP_SECRET,
  custtype: 'P',
});

export function assertOk(data: Record<string, unknown>, label: string): void {
  if (data?.rt_cd !== '0') {
    const msg = (data?.msg1 as string | undefined)?.trim();
    throw new Error(`[${label}] ${msg || `KIS API 오류 (rt_cd: ${data?.rt_cd})`}`);
  }
}
