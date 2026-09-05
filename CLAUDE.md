# 협업 Git 동기화 규칙

이 프로젝트는 사용자가 Claude Code와 Cursor를 함께 사용해 작업합니다. 두 에이전트가
같은 원격 저장소(`origin/main`)를 건드리므로, 사용자가 "동기화해줘" 또는 "sync"라고
요청하면 다음 순서를 자동으로 진행합니다.

## 표준 루틴 (풀 → 커밋 → 풀 → 푸쉬)

1. `git fetch origin` 후 `git log HEAD..origin/main`으로 **원격에만 있는 커밋** 확인
2. 로컬에 **미커밋 수정**이 있으면 `git stash push -u`로 임시 보관
3. `git pull origin main` — Cursor(또는 다른 세션)가 push한 변경을 먼저 받음
4. stash가 있었으면 `git stash pop` — 내 수정을 pull 결과 위에 다시 적용
   - 충돌(conflict)이 나면 자동으로 풀지 말고, 충돌 파일/내용을 보여주고 사용자에게 물어봄
5. 변경 파일을 지정해서 `git add` (예: `index.html assets/`, `-A` 금지)
6. 의미 있는 메시지로 `git commit`
7. **다시 한번 `git pull origin main`** — 커밋하는 동안 Cursor가 새로 push했을 수 있으니 push 직전에 최신 상태인지 재확인 (fast-forward면 그대로, 충돌 나면 3-4단계처럼 사용자에게 물어봄)
8. `git push origin main`

## 동작 원칙

- push 직전에 **커밋 요약 + 커밋 메시지**를 보여주고, 사용자가 push까지 명시했을 때만 push
- `git status`만 단독 요청이면 순수 상태 조회만 (동기화 절차 실행 안 함)
- 동기화를 원하면 "동기화해줘" / "sync" / "pull 후 push" 등으로 명시
- `.claude/` 디렉터리(로컬 미리보기 설정 등)는 별도 요청이 없으면 커밋에서 제외한다
