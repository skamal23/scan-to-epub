PYTHON ?= .venv/bin/python
PNPM ?= pnpm

.PHONY: backend-install backend-run backend-run-live backend-run-phone backend-run-phone-live backend-test doctor mobile-install mobile-test test

backend-install:
	$(PYTHON) -m pip install -c backend/constraints.txt -e './backend[dev]'

backend-run:
	BOOK_ENVIRONMENT=development BOOK_FIXTURE_MODE=true $(PYTHON) -m uvicorn book_backend.app:app --no-access-log --host 127.0.0.1 --port 8000

backend-run-live:
	BOOK_ENVIRONMENT=development BOOK_FIXTURE_MODE=false $(PYTHON) -m uvicorn book_backend.app:app --no-access-log --host 127.0.0.1 --port 8000

backend-run-phone:
	BOOK_ENVIRONMENT=development BOOK_FIXTURE_MODE=true $(PYTHON) -m uvicorn book_backend.app:app --no-access-log --host 0.0.0.0 --port 8000

backend-run-phone-live:
	BOOK_ENVIRONMENT=development BOOK_FIXTURE_MODE=false $(PYTHON) -m uvicorn book_backend.app:app --no-access-log --host 0.0.0.0 --port 8000

backend-test:
	$(PYTHON) -m pytest backend -q
	$(PYTHON) -m ruff check backend
	$(PYTHON) -m ruff format --check backend

mobile-install:
	cd mobile && $(PNPM) install --frozen-lockfile

mobile-test:
	cd mobile && $(PNPM) test
	cd mobile && $(PNPM) typecheck
	cd mobile && $(PNPM) peers check

doctor:
	cd mobile && $(PNPM) dlx expo-doctor@latest

test: backend-test mobile-test

browser-test:
	cd mobile && $(PNPM) test:e2e
