from fastapi import Depends, Header, HTTPException, status

from app.core.config import Settings, get_settings


def validate_api_key_value(api_key: str | None, settings: Settings) -> None:
    if not api_key or api_key != settings.app_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key",
        )


def require_api_key(
    x_homeplane_key: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> None:
    validate_api_key_value(x_homeplane_key, settings)
