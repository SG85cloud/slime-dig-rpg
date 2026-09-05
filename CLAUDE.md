# 협업 Git 동기화 규칙

이 프로젝트는 사용자가 Claude Code와 Cursor를 함께 사용해 작업합니다. 두 에이전트가
같은 원격 저장소(`origin/main`)를 건드리므로, 아래 규칙은 **모든 세션에서 항상** 적용합니다.

## 커밋/푸시 승인 (항상)

- `git commit` / `git push`는 **이번 메시지에서 사용자가 명시적으로 요청했을 때만** 실행한다.
- 이전 대화에서 허용했어도, 이번 턴에 승인이 없으면 커밋/푸시하지 않는다.
- 코드만 고친 뒤에는 커밋 요약과 제안 메시지를 보여주고 승인을 기다린다.
- `git status`만 요청하면 조회만 한다.

## 커밋/푸시 직전 — Claude Code(다른 세션) 원격 커밋 확인 (항상)

1. `git fetch origin`
2. `git log HEAD..origin/main` 으로 **원격에만 있는 커밋**이 있는지 확인한다.
3. 있으면 작성자/메시지/파일을 사용자에게 보여 주고, 덮어쓰지 않는다. 먼저 pull로 받는다.
4. 충돌이 나면 자동으로 풀지 말고 충돌 내용을 보여 주고 사용자에게 묻는다.

## 표준 루틴 (풀 → 커밋 → 풀 → 푸쉬)

사용자가 커밋/푸시 또는 "동기화해줘" / "sync"를 **이번 메시지에서** 요청한 경우에만:

1. `git fetch origin` 후 `git log HEAD..origin/main`으로 **원격에만 있는 커밋** 확인
2. 로컬에 **미커밋 수정**이 있으면 `git stash push -u`로 임시 보관
3. `git pull origin main` — Cursor 또는 Claude Code가 push한 변경을 먼저 받음
4. stash가 있었으면 `git stash pop` — 내 수정을 pull 결과 위에 다시 적용
   - 충돌(conflict)이 나면 자동으로 풀지 말고, 충돌 파일/내용을 보여주고 사용자에게 물어봄
5. 변경 파일을 지정해서 `git add` (예: `index.html assets/`, `-A` 금지)
6. 의미 있는 메시지로 `git commit`
7. **다시 한번 `git pull origin main`** — 커밋하는 동안 다른 에이전트가 새로 push했을 수 있으니 push 직전에 최신 상태인지 재확인 (fast-forward면 그대로, 충돌 나면 3-4단계처럼 사용자에게 물어봄)
8. `git push origin main`

## 동작 원칙

- push 직전에 **커밋 요약 + 커밋 메시지**를 보여주고, 사용자가 push까지 명시했을 때만 push
- `git status`만 단독 요청이면 순수 상태 조회만 (동기화 절차 실행 안 함)
- 동기화를 원하면 "동기화해줘" / "sync" / "pull 후 push" 등으로 명시
- `.claude/` 디렉터리(로컬 미리보기 설정 등)는 별도 요청이 없으면 커밋에서 제외한다
- force push와 `main` 히스토리 재작성은 하지 않는다.
