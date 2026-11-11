// 매시 점검용 호출 비밀값을 만들어 Vault(hub_cron_secret, hub_health_url)와 Edge Function 비밀값(HUB_CRON_SECRET)에 넣는다. 값은 출력하지 않는다.
import { randomBytes } from 'node:crypto';
import { sql, api, REF } from './sql.mjs';
const v = randomBytes(32).toString('hex');
const url = `https://${REF}.supabase.co/functions/v1/hub-health`;
await sql(`do $$ declare i uuid; begin
  select id into i from vault.secrets where name = 'hub_cron_secret';
  if i is null then perform vault.create_secret('${v}', 'hub_cron_secret', '허브 운영 점검 cron 호출용'); else perform vault.update_secret(i, '${v}'); end if;
  select id into i from vault.secrets where name = 'hub_health_url';
  if i is null then perform vault.create_secret('${url}', 'hub_health_url', '허브 운영 점검 함수 주소'); else perform vault.update_secret(i, '${url}'); end if;
end $$;`);
const r = await api('/secrets', { method: 'POST', body: JSON.stringify([{ name: 'HUB_CRON_SECRET', value: v }]) });
console.log(r.ok ? 'HUB_CRON_SECRET 설정 완료' : `실패 ${r.status}`);
