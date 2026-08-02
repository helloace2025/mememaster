import base64
import json
import os
import sys
from pathlib import Path

import pytest

# The SDK validates its seller credentials with OKX before issuing a challenge.
# Supply these only in a private CI/Railway smoke-test environment, never in git.
_REQUIRED = ("PAY_TO_ADDRESS", "OKX_API_KEY", "OKX_SECRET_KEY", "OKX_PASSPHRASE")
if not all(os.getenv(key) for key in _REQUIRED):
    pytestmark = pytest.mark.skip(
        reason="requires private OKX x402 seller credentials"
    )

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402


def test_agent_requires_nonempty_x402_challenge() -> None:
    response = TestClient(app).post(
        "/api/agent", json={"message": "test x402 challenge"}
    )

    assert response.status_code == 402
    encoded = response.headers.get("payment-required")
    assert encoded, "Missing PAYMENT-REQUIRED response header"
    challenge = json.loads(base64.b64decode(encoded).decode("utf-8"))
    assert challenge["x402Version"] == 2
    assert challenge["accepts"], "x402 challenge must advertise a payable asset"
    offer = challenge["accepts"][0]
    assert offer["network"] == "eip155:196"
    assert offer["asset"] == "0x779ded0c9e1022225f8e0630b35a9b54be713736"
    assert offer["payTo"].lower() == os.environ["PAY_TO_ADDRESS"].lower()
