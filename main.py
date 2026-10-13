# Azure App Service root entrypoint
import sys
from pathlib import Path

# Ensure backend directory is in python path
backend_path = Path(__file__).resolve().parent / "backend"
if str(backend_path) not in sys.path:
    sys.path.insert(0, str(backend_path))

from backend.app.main import app  # noqa: F401
