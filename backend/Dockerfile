FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr tesseract-ocr-eng default-jre-headless curl unzip ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://github.com/w3c/epubcheck/releases/download/v5.3.0/epubcheck-5.3.0.zip -o /tmp/epubcheck.zip \
    && echo '6c07e68584b2e2ce2f89fe06e1246dfead3eb36b46b340e7d93524f29dcff6c5  /tmp/epubcheck.zip' | sha256sum -c - \
    && unzip -q /tmp/epubcheck.zip -d /opt \
    && rm /tmp/epubcheck.zip \
    && printf '#!/bin/sh\nexec java -jar /opt/epubcheck-5.3.0/epubcheck.jar "$@"\n' > /usr/local/bin/epubcheck \
    && chmod +x /usr/local/bin/epubcheck
WORKDIR /app
COPY pyproject.toml constraints.txt ./
COPY src ./src
RUN pip install --no-cache-dir -c constraints.txt . \
    && useradd --create-home reader && mkdir /data && chown reader:reader /data
USER reader
ENV BOOK_ENVIRONMENT=production BOOK_FIXTURE_MODE=false BOOK_ARTIFACT_DATABASE=/data/deliveries.sqlite
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn book_backend.app:app --no-access-log --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
