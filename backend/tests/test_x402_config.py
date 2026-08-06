import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings


def test_zero_price_disables_x402_payment() -> None:
    settings = Settings(
        _env_file=None,
        pay_to_address="0x0000000000000000000000000000000000000001",
        okx_api_key="test-key",
        okx_secret_key="test-secret",
        okx_passphrase="test-passphrase",
        x402_price_usd="0",
        x402_payment_required=True,
    )

    assert settings.x402_enabled is False


def test_non_finite_price_disables_x402_payment() -> None:
    settings = Settings(
        _env_file=None,
        pay_to_address="0x0000000000000000000000000000000000000001",
        okx_api_key="test-key",
        okx_secret_key="test-secret",
        okx_passphrase="test-passphrase",
        x402_price_usd="Infinity",
        x402_payment_required=True,
    )

    assert settings.x402_enabled is False
