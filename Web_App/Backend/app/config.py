from __future__ import annotations

import os
from functools import lru_cache

from pydantic import BaseModel
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = os.getenv(
        'DATABASE_URL',
        'postgresql://aqualora:aqualora123@localhost:5432/aqualora',
    )
    admin_username: str = os.getenv('ADMIN_USERNAME', 'Admin')
    admin_password: str = os.getenv('ADMIN_PASSWORD', 'Admin123')
    jwt_secret: str = os.getenv('JWT_SECRET', 'super-secret-demo-key')
    jwt_algorithm: str = 'HS256'

    class Config:
        env_file = '.env'


@lru_cache
def get_settings() -> Settings:
    return Settings()
