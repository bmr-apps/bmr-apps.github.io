// 권한 경계 도우미 (의존성 없음 — 화면과 시험(scripts/test-selfservice-rules.mjs)이 함께 쓴다).
// 개발자는 앱 담당자 명부(app_owners)에 자기 메일이 있는 앱, 곧 '내 서비스'의 운영 상태만 본다.

/** 담당자 명부 한 줄 (app_owners) */
export type OwnerRef = { app_id: number; email?: string | null };

/** 메일 비교용 정리: 앞뒤 공백·대소문자 차이를 없앤다. 빈 값은 누구와도 같지 않다 */
export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = String(a ?? '').trim().toLowerCase();
  return !!x && x === String(b ?? '').trim().toLowerCase();
}

/** 담당자 명부에서 이 메일이 담당한 앱 id 집합 */
export function ownedAppIds(owners: OwnerRef[] | null | undefined, email: string | null | undefined): Set<number> {
  const out = new Set<number>();
  for (const o of owners ?? []) {
    if (o && Number.isInteger(o.app_id) && sameEmail(o.email, email)) out.add(o.app_id);
  }
  return out;
}

/** 관리자는 그대로, 그 밖(개발자·일반 사용자)은 담당 앱만 남긴다 */
export function scopeToOwned<T extends { id: number }>(rows: T[] | null | undefined, isAdmin: boolean, owned: Set<number>): T[] {
  const list = rows ?? [];
  return isAdmin ? [...list] : list.filter((r) => owned.has(r.id));
}
