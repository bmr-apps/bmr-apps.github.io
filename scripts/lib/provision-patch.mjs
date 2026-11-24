// 새 앱 저장소 시작 틀에 넣는 'DB 자동 반영' 스텝과, templates.ts 를 만들 때 함께 적용하는 패치.
// bmr-app-templates 의 starter/repo/.github/workflows/deploy.yml 을 고칠 수 없을 때도
// build-provision-templates.mjs 가 이 값을 그대로 끼워 넣어 같은 결과를 만든다.

/** deploy.yml 의 `npm ci` 다음에 들어가는 스텝 (DATABASE_URL Secret 이 있을 때만 마이그레이션) */
export const DEPLOY_DB_STEP = `      - name: DB 자동 반영 (supabase/migrations)
        env:
          DATABASE_URL: \${{ secrets.DATABASE_URL }}
        run: |
          # DATABASE_URL Secret 이 있으면 supabase/migrations 의 새 SQL 파일을 DB 에 반영한다.
          # Secret 이 없는 앱(이전에 만든 앱)은 건너뛰고 안내만 남긴다 — 배포는 그대로 진행된다.
          if [ -z "\$DATABASE_URL" ]; then
            {
              echo '### DB 반영: 건너뜀'
              echo 'DATABASE_URL Secret 이 없어 마이그레이션을 건너뛰었습니다. 배포는 정상입니다.'
              echo '새 앱은 허브가 자동으로 넣어 줍니다. DB 비밀번호를 새로 발급했다면 저장소 Settings → Secrets and variables → Actions 에서 DATABASE_URL 을 새 값으로 바꿔 주세요.'
            } >> "\$GITHUB_STEP_SUMMARY"
            exit 0
          fi
          if ! npm run db:migrate; then
            {
              echo '### DB 반영: 실패'
              echo 'SQL 오류라면 supabase/migrations 의 파일을 고치고 새 파일로 다시 올리세요.'
              echo '연결 오류(비밀번호)라면 Settings → Secrets and variables → Actions 의 DATABASE_URL 이 지금 DB 비밀번호인지 확인하세요.'
            } >> "\$GITHUB_STEP_SUMMARY"
            exit 1
          fi
`;

/** 시작 틀 파일들에 공통 패치 적용 (지금은 deploy.yml 의 DB 자동 반영 한 가지) */
export function patchTemplateFiles(files) {
  const key = '.github/workflows/deploy.yml';
  const yml = files[key];
  if (!yml || yml.includes('DB 자동 반영 (supabase/migrations)')) return files;
  const anchor = '      - run: npm ci\n      - run: npm run build';
  if (!yml.includes(anchor)) throw new Error('deploy.yml 에서 npm ci 다음 줄을 찾지 못했습니다 (시작 틀 형식이 바뀌었는지 확인하세요)');
  files[key] = yml.replace(anchor, `      - run: npm ci\n${DEPLOY_DB_STEP}      - run: npm run build`);
  return files;
}
