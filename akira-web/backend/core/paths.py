"""Shared paths for backend and file-access tools."""
import os

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Project root (parent of backend/). All read/write tools are restricted to this tree.
WORKSPACE_ROOT = os.path.dirname(_BACKEND_DIR)

# File access limits (used by read_file and file_access)
MAX_TEXT_FILE_SIZE = 512 * 1024  # 512 KB — larger files require start_line/end_line
