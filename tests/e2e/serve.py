"""Servidor de teste para a verificação da interface (banco temporário)."""
import os
import sys
import tempfile

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from jarvis import create_app  # noqa: E402

db = os.path.join(tempfile.mkdtemp(), "e2e.db")
app = create_app({"DATABASE_URL": f"sqlite:///{db}", "SECRET_KEY": "e2e"})
app.run(port=int(sys.argv[1]) if len(sys.argv) > 1 else 5055, threaded=True)
