FROM python:3.11-slim

WORKDIR /app

# 전체 소스 복사
COPY . .

# data 디렉토리 생성 (임베딩 캐시용)
RUN mkdir -p data

# 8765 포트 노출
EXPOSE 8765

# 서버 실행
CMD ["python", "config_ui.py"]
