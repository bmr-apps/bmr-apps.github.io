// Auth 리디렉트 허용 목록에 허브 주소를 더한다. 기존 항목·site_url은 그대로 둔다.
const REF = process.env.SUPABASE_PROJECT_REF || 'vzrfjqazgufhiucdsjga';
const H = { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
const cur = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, { headers: H })).json();
const list = String(cur.uri_allow_list || '').split(',').map((s) => s.trim()).filter(Boolean);
for (const u of ['https://apps.bmrschool.net', 'https://apps.bmrschool.net/**']) if (!list.includes(u)) list.push(u);
const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, { method: 'PATCH', headers: H, body: JSON.stringify({ uri_allow_list: list.join(',') }) });
const d = await r.json();
console.log(r.ok ? `site_url = ${d.site_url}\nuri_allow_list = ${d.uri_allow_list}` : 'ERR ' + r.status);
