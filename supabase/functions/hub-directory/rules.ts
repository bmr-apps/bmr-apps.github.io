// 학교 그룹·명부 규칙 (순수 함수 — hub-directory 가 쓰고, scripts/test-selfservice-rules.mjs 가 시험한다).
// 여기서는 DB·네트워크를 만지지 않는다: 입력 검사와 응답 모양만 정한다.

/** 그룹 종류 — 마이그레이션 20261115120000_hub_groups_files 의 check 와 같아야 한다 */
export const GROUP_KINDS = ['grade', 'class', 'club', 'staff', 'custom'] as const;
export type GroupKind = (typeof GROUP_KINDS)[number];
export const GROUP_KIND_LABEL: Record<GroupKind, string> = {
  grade: '학년',
  class: '반',
  club: '동아리',
  staff: '교직원',
  custom: '기타',
};

/** 그룹 slug: 폴더 이름(bmr-files/<slug>/)으로도 쓰므로 영문 소문자·숫자·하이픈만 */
export const GROUP_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}$/;
/** 주소처럼 쓰면 안 되는 이름 (앱 주소·허브 화면과 겹치지 않게) */
export const RESERVED_GROUP_SLUGS = ['hub', 'login', 'assets', 'admin', 'api', 'www', 'static', 'files'] as const;
export const GROUP_NAME_MAX = 60;
export const GROUP_DESC_MAX = 300;
/** 한 번에 추가·삭제할 수 있는 메일 수 */
export const MEMBERS_MAX_SET = 200;
/** 한 번에 돌려주는 구성원 수 (앱이 명부를 통째로 가져가지 않게) */
export const MEMBER_LIST_MAX = 1000;
export const EMAIL_MAX = 254;
/** 공용 파일 버킷 이름 (마이그레이션과 같아야 한다) */
export const FILES_BUCKET = 'bmr-files';

const EMAIL_RE = /^[^@\s'"<>]{1,64}@[^@\s'"<>]{1,190}$/;

/** 그룹 폴더 이름 → 공용 버킷 안 경로 (예: staff → 'staff/') */
export const groupFolderOf = (slug: string) => `${slug}/`;

export function groupSlugProblem(slug: unknown): string | null {
  if (typeof slug !== 'string' || !slug) return '그룹 주소 이름(slug)을 적어 주세요.';
  if (!GROUP_SLUG_RE.test(slug)) return '그룹 주소 이름은 영문 소문자·숫자·하이픈 2~39자입니다 (예: staff, grade-10).';
  if ((RESERVED_GROUP_SLUGS as readonly string[]).includes(slug)) return `${slug} 는 쓸 수 없는 이름입니다.`;
  return null;
}

export function groupNameProblem(name: unknown): string | null {
  if (typeof name !== 'string') return '그룹 이름을 적어 주세요.';
  const t = name.trim();
  if (!t) return '그룹 이름을 적어 주세요.';
  if (t.length > GROUP_NAME_MAX) return `그룹 이름은 ${GROUP_NAME_MAX}자까지입니다.`;
  if (/[<>]/.test(t)) return '그룹 이름에 < > 는 쓸 수 없습니다.';
  if (/[\u0000-\u001f\u007f]/.test(t)) return '그룹 이름에 쓸 수 없는 문자가 있습니다.';
  return null;
}

export function groupDescProblem(desc: unknown): string | null {
  if (desc == null || desc === '') return null;
  if (typeof desc !== 'string') return '설명은 글자로 적어 주세요.';
  if (desc.length > GROUP_DESC_MAX) return `설명은 ${GROUP_DESC_MAX}자까지입니다.`;
  if (/[\u0000-\u001f\u007f]/.test(desc.replace(/[\n\t]/g, ''))) return '설명에 쓸 수 없는 문자가 있습니다.';
  return null;
}

export function groupKindProblem(kind: unknown): string | null {
  if (kind == null || kind === '') return null;
  if (typeof kind !== 'string' || !(GROUP_KINDS as readonly string[]).includes(kind)) {
    return `그룹 종류는 ${GROUP_KINDS.join(' · ')} 중 하나입니다.`;
  }
  return null;
}

/** 메일 하나를 정리한다 (앞뒤 공백 제거·소문자). 형식이 틀리면 null */
export function normalizeEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  if (!e || e.length > EMAIL_MAX || !EMAIL_RE.test(e)) return null;
  return e;
}

/** 메일 여러 개(배열·쉼표·줄바꿈·공백)를 정리한다. 형식이 틀린 것은 bad 에 담는다 */
export function normalizeEmails(input: unknown, max = MEMBERS_MAX_SET): { list: string[]; bad: string[] } {
  const parts: string[] = [];
  const push = (x: unknown) => {
    if (typeof x !== 'string') return;
    for (const p of x.split(/[\s,;]+/)) if (p) parts.push(p);
  };
  if (Array.isArray(input)) for (const x of input) push(x);
  else push(input);
  const list: string[] = [];
  const bad: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const e = normalizeEmail(p);
    if (!e) { if (bad.length < 10 && !bad.includes(p.slice(0, EMAIL_MAX))) bad.push(p.slice(0, EMAIL_MAX)); continue; }
    if (seen.has(e)) continue;
    seen.add(e);
    if (list.length >= max) { continue; }
    list.push(e);
  }
  return { list, bad };
}

/** 그룹 하나의 소속 정보 (DB 한 줄) */
export type MembershipRow = { slug: string; name: string; kind: string; role: string };

/** 소속 줄을 앱이 쓰기 좋은 모양으로: 그룹 목록 · 소속/운영 이름 · 이름→역할 */
export function membershipsOf(rows: MembershipRow[]): {
  groups: MembershipRow[];
  member_of: string[];
  leader_of: string[];
  roles: Record<string, 'leader' | 'member'>;
} {
  const roles: Record<string, 'leader' | 'member'> = {};
  const member_of: string[] = [];
  const leader_of: string[] = [];
  const groups: MembershipRow[] = [];
  for (const r of rows) {
    if (!r || typeof r.slug !== 'string' || !r.slug) continue;
    const role = r.role === 'leader' ? 'leader' : 'member';
    groups.push({ slug: r.slug, name: String(r.name ?? ''), kind: String(r.kind ?? 'custom'), role });
    member_of.push(r.slug);
    if (role === 'leader') leader_of.push(r.slug);
    roles[r.slug] = role;
  }
  return { groups, member_of, leader_of, roles };
}

/** 앱이 물어본 그룹(slug 또는 이름)에 그 사람이 들어 있는지. 없는 그룹은 member=false 로 돌려준다 */
export function checkAsked(
  asked: string[],
  rows: MembershipRow[],
): { group: string; slug: string | null; member: boolean; role: 'leader' | 'member' | null }[] {
  const bySlug = new Map(rows.map((r) => [r.slug.toLowerCase(), r]));
  const byName = new Map(rows.map((r) => [String(r.name ?? '').toLowerCase(), r]));
  const out: { group: string; slug: string | null; member: boolean; role: 'leader' | 'member' | null }[] = [];
  const seen = new Set<string>();
  for (const raw of asked) {
    const q = String(raw ?? '').trim();
    if (!q) continue;
    const k = q.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    const hit = bySlug.get(k) ?? byName.get(k);
    out.push(hit
      ? { group: q, slug: hit.slug, member: true, role: hit.role === 'leader' ? 'leader' : 'member' }
      : { group: q, slug: null, member: false, role: null });
  }
  return out;
}

/** 물어본 그룹 이름 목록을 정리한다 (최대 20개) */
export function normalizeGroupList(input: unknown): string[] {
  const parts: string[] = [];
  const push = (x: unknown) => { if (typeof x === 'string') for (const p of x.split(/[\s,]+/)) if (p) parts.push(p); };
  if (Array.isArray(input)) for (const x of input) push(x);
  else push(input);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const k = p.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    if (out.length >= 20) break;
    out.push(k);
  }
  return out;
}
