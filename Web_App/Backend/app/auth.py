from __future__ import annotations
from typing import Any

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import get_settings

settings = get_settings()
security = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception:
        return False


def create_token(master_node_id: int, node_code: str, role: str = 'customer') -> str:
    payload = {
        'sub': node_code,
        'master_node_id': master_node_id,
        'node_code': node_code,
        'role': role,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def verify_token(credentials: HTTPAuthorizationCredentials | None = Depends(security)) -> dict[str, Any]:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Missing token')

    try:
        payload = jwt.decode(credentials.credentials, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        master_node_id = payload.get('master_node_id')
        node_code = payload.get('node_code') or payload.get('sub')
        if master_node_id is None or not node_code:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid token payload')
        return {
            'master_node_id': int(master_node_id),
            'node_code': str(node_code),
            'role': str(payload.get('role', 'customer')),
        }
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid or expired token') from exc


def require_super_admin(claims: dict[str, Any] = Depends(verify_token)) -> dict[str, Any]:
    if claims.get('role') != 'super_admin':
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Super administrator privilege required',
        )
    return claims

