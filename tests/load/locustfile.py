"""
Load test scenarios for va-platform.
Run: locust -f tests/load/locustfile.py --headless -u 50 -r 5 --run-time 60s

Targets:
- P95 TTFT < 800ms (call.ttft span)
- 1000 webhooks/min (dedupe stress)
- 100 simultaneous booking attempts → exactly 1 winner
- 500 RAG queries/min, cache hit rate > 80%
"""
import json
import time
import random
from locust import HttpUser, task, between


API_BASE = "/v1"
# Set these in environment or locust config
BUSINESS_ID = "your-business-id"
JWT_TOKEN = "your-jwt-token"


class WebhookUser(HttpUser):
    """Simulate Telnyx webhook delivery (1000/min target)."""
    wait_time = between(0.05, 0.1)

    @task
    def send_webhook(self):
        event_id = f"evt_{int(time.time() * 1000)}_{random.randint(0, 9999)}"
        payload = {
            "data": {
                "id": event_id,
                "event_type": "call.initiated",
                "payload": {
                    "call_leg_id": f"call_{event_id}",
                    "from": "+15550001234",
                    "to": "+15550009876",
                }
            }
        }
        self.client.post(
            f"{API_BASE}/webhooks/telnyx",
            json=payload,
            headers={"content-type": "application/json"},
        )


class AdminAPIUser(HttpUser):
    """Simulate admin dashboard API usage."""
    wait_time = between(0.5, 2.0)

    def on_start(self):
        self.headers = {"Authorization": f"Bearer {JWT_TOKEN}"}

    @task(5)
    def list_calls(self):
        self.client.get(
            f"{API_BASE}/businesses/{BUSINESS_ID}/calls?limit=50",
            headers=self.headers,
        )

    @task(2)
    def list_documents(self):
        self.client.get(
            f"{API_BASE}/businesses/{BUSINESS_ID}/documents",
            headers=self.headers,
        )

    @task(1)
    def get_business(self):
        self.client.get(
            f"{API_BASE}/businesses/{BUSINESS_ID}",
            headers=self.headers,
        )

    @task(1)
    def list_voicemails(self):
        self.client.get(
            f"{API_BASE}/businesses/{BUSINESS_ID}/voicemails",
            headers=self.headers,
        )
