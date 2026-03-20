# 06. 개발자용 Git 사용 가이드 (Git Workflow)

**마지막 수정일**: 2026-03-15

본 문서는 `sbe-jira-ui` 프로젝트의 협업 및 효율적인 이력 관리를 위한 Git 사용 규칙을 정의합니다.

---

## 1. 커밋 메시지 규칙 (Conventional Commits)

로그만 보고도 변경 사항의 성격과 이슈를 파악할 수 있도록 접두사를 사용합니다.

| 타입 | 설명 | 예시 |
|:---|:---|:---|
| **feat** | 새로운 기능 추가 | `feat(api): 유사 이슈 자동 검증 기능 추가` |
| **fix** | 버그 수정 | `fix(ui): 검색 결과 링크 오류 수정` |
| **docs** | 문서 수정 | `docs: Git 사용가이드 추가` |
| **refactor** | 기능 변화 없는 코드 구조 개선 | `refactor: 함수 분리 및 중복 코드 제거` |
| **style** | 코드 포맷팅, 세미콜론 누락 등 (비즈니스 로직 수정 없음) | `style: lint 오류 수정` |
| **chore** | 빌드 시스템, 패키지 매니저 설정 변경 등 | `chore: docker compose 설정 업데이트` |

---

## 2. 권장 워킹 플로우 (Work Flow)

협업 환경을 가정한 권장 작업 순서입니다.

### ① 이슈 등록 (Issue Tracking)
- 작업 전 **[03_기능개선요청.md](../01_계획관리/03_기능개선요청.md)** 또는 이슈 트래커(Jira/GitHub)에 작업 내용을 기록합니다.
- 고유한 이슈 번호를 확인합니다 (예: `BUG-1`, `FEAT-3`).

### ② 작업 브랜치 생성 (Branching)
- `main` 브랜치에서 직접 작업하는 대신, 이슈 번호가 포함된 전용 브랜치를 생성하여 작업합니다.
```bash
# 형식: {type}/{issue-key}-{description}
git checkout -b fix/BUG-1-parsing-error
```

### ③ 작업 및 커밋 (Commit)
- 위에서 정의한 규칙에 따라 커밋 메시지를 작성합니다. 커밋 본문에 상세 내용을 적으면 더 좋습니다.
```bash
git add .
git commit -m "fix(ai): [BUG-1] AI 검증 이슈키 파싱 오류 수정"
```

### ④ 병합 및 종료 (Merge & Clean)
- 작업이 완료되면 `main` 브랜치로 합친(Merge) 후 사용한 브랜치는 삭제합니다.
```bash
git checkout main
git merge fix/BUG-1-parsing-error
git branch -d fix/BUG-1-parsing-error
```

---

## 3. 유용한 Git 명령어 팁

- **작업 내용 미리보기**: `git status` (상태 확인), `git diff` (변경 내용 확인)
- **로그 예쁘게 보기**: `git log --oneline --graph --decorate`
- **실수 방지**: 커밋 전 `docker compose up --build`로 로컬 동작을 반드시 확인하세요.

---

## 4. 이슈 키 사용 패턴
커밋 메시지나 문서에 이슈 키를 포함하면 나중에 Jira나 문서와 이력을 연결하기 매우 용이합니다.
- 예: `[BUG-1]`, `[FEAT-10]` 등을 커밋 제목 앞에 붙이는 것을 생활화합니다.
