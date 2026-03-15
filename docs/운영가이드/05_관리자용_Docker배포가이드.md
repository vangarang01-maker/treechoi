# 관리자용 Docker 배포 및 운영 가이드

**마지막 수정일**: 2026-03-14  
**작성자**: 서비스 관리자 (Master)  
**대상**: sbe-jira-ui 서비스의 구축, 배포 및 팀 단위 유지보수

---

## 1. 개요

이 가이드는 관리자가 본인의 PC 또는 전용 서버에 `sbe-jira-ui`를 Docker로 구축하고, 팀원들에게 서비스를 안정적으로 제공하기 위한 운영 지침을 담고 있습니다.

---

## 2. 인프라 준비 (관리자 PC/서버)

서비스를 호스팅하기 위해 아래 환경이 필요합니다.

### 2-1. Docker Desktop 설치
- **다운로드**: [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- **설정**: Windows 환경에서는 **WSL 2 Backend** 사용을 권장합니다.
- **확인**: 터미널에서 `docker info` 명령어가 정상 작동해야 합니다.

---

## 3. 서비스 설정 및 보안 (관리자 전용)

Docker 컨테이너가 사용할 핵심 환경 변수를 설정합니다.

### 3-1. .env 파일 관리
`.env` 파일은 서비스의 엔진과 같은 역할을 합니다. 절대 외부에 노출되지 않도록 주의하세요 (`.gitignore` 포함 확인).

```env
# Gemini API 설정 (Master Key)
GEMINI_API_KEY=AIzaSy... (관리자 발급 키)
GEMINI_MODEL=gemini-2.5-flash

# Jira API 설정
JIRA_PAT_TOKEN= (관리자 PAT - 기본값으로 사용됨)
JIRA_USERNAME= (관리자 사번)
```

> [!IMPORTANT]
> **보안 팁**: 팀원들에게 배포할 때는 `.env`의 키 값을 비워두고 배포할 수 있습니다. 이 경우 각 사용자가 UI의 '환경설정' 탭에서 본인의 키를 입력하여 `localStorage` 방식으로 사용하게 됩니다.

---

## 4. 서비스 생명주기 관리 (운영 명령어)

관리자는 아래 명령어를 통해 서비스를 제어합니다. 모든 명령어는 프로젝트 루트에서 실행합니다.

| 작업 | 명령어 | 설명 |
|------|-------|------|
| **최초 구축** | `docker compose up --build -d` | 이미지 빌드 후 백그라운드 실행 |
| **서비스 중지** | `docker compose down` | 컨테이너 제거 (데이터는 보존됨) |
| **재시작** | `docker compose restart` | 컨테이너 재시작 |
| **로그 모니터링** | `docker compose logs -f` | 실시간 오류 및 접속 로그 확인 |
| **코드 업데이트** | `git pull` 후 `docker compose up --build -d` | 최신 소스 반영 및 재빌드 |

---

## 5. 팀 배포 및 네트워크 설정

팀원들이 내 PC에 접속할 수 있도록 네트워크 환경을 구성합니다.

### 5-1. Windows 방화벽 허용
포트(8765)가 막혀 있으면 외부 접속이 불가능합니다. (PowerShell 관리자 권한 실행)

```powershell
New-NetFirewallRule -DisplayName "sbe-jira-ui-admin" `
  -Direction Inbound -Protocol TCP `
  -LocalPort 8765 -Action Allow
```

### 5-2. 접속 주소 배포
- **내부 주소**: `http://localhost:8765`
- **팀원용 주소**: `http://[관리자_IP]:8765` (예: `http://10.105.x.x:8765`)

---

## 6. 유지보수 및 데이터 관리

### 6-1. 임베딩 캐시 보존
`docker-compose.yml`의 `volumes` 설정을 통해 `data/` 디렉토리가 호스트와 동기화됩니다. 컨테이너를 삭제해도 유사 이슈 검색을 위한 임베딩 데이터는 유지됩니다.

### 6-2. 성능 최적화
유사 이슈 검색의 '캐시 구축'은 API 호출이 많으므로 업무 시간이 끝난 후 또는 초기 구축 시 관리자가 미리 수행하는 것을 권장합니다.

---

## 7. 팀 전파용 공지 템플릿

팀원들에게 서비스를 안내할 때 아래 내용을 복사하여 사용하세요.

---
**[공지] sbe-jira-ui 업무 자동화 도구 배포**

안녕하세요, Jira 업무 효율화를 위한 웹 UI를 배포했습니다.

1. **접속 주소**: `http://[관리자_IP]:8765`
2. **주요 기능**:
   - Jira 이슈 자연어 요약 및 채팅
   - JQL 검색 결과 시각화
   - **유사 이슈 검색**: 내가 처리 중인 업무와 가장 비슷한 과거 완료 건 추천
3. **초기 설정**:
   - 처음 접속 시 `⚙ 환경설정` 메뉴에서 본인의 **Jira PAT Token**을 입력해 주세요. (브라우저 로컬 저장소에만 보관되며 서버에 저장되지 않습니다.)
---
