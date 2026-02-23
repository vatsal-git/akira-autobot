"""Shared paths for backend (theme config, etc.)."""
import os

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEME_CONFIG_FILE = os.path.join(_BACKEND_DIR, "theme_config.json")
