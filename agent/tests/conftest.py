from __future__ import annotations

import os
import sys
from pathlib import Path

# Agent modules import flat (`from tools import ...`), so `agent/` must be on
# the path whatever directory pytest starts from.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Clients need a key to be constructed; no offline test sends a request.
os.environ.setdefault("MISTRAL_API_KEY", "offline-test-key")
