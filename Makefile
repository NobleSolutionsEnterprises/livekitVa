.PHONY: dev test lint build migrate clean

# Local dev
dev-api:
	uvicorn api.main:app --reload --port 8000

dev-agent:
	python -m agent.main dev

# Docker
build:
	docker build -f Dockerfile.api -t va-platform-api .
	docker build -f Dockerfile.agent -t va-platform-agent .

up:
	docker compose up -d

down:
	docker compose down

# Database
migrate:
	alembic upgrade head

migrate-create:
	alembic revision --autogenerate -m "$(name)"

schema:
	psql $(DATABASE_URL) -f db/schema.sql

# Testing
test:
	pytest tests/ -v

test-unit:
	pytest tests/unit/ -v

test-integration:
	pytest tests/integration/ -v

test-security:
	pytest tests/security/ -v

test-load:
	locust -f tests/load/locustfile.py --headless -u 50 -r 5 --run-time 60s

# Linting
lint:
	ruff check .
	mypy agent/ api/ db/ --ignore-missing-imports

fmt:
	ruff format .

# Maintenance
reindex-hnsw:
	psql $(DATABASE_URL) -c "REINDEX INDEX CONCURRENTLY document_chunks_embedding_idx; VACUUM ANALYZE document_chunks;"

clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null; true
	find . -name "*.pyc" -delete 2>/dev/null; true
