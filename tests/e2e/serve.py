"""Servidor de teste para a verificação da interface: dados externos simulados, banco temporário."""
import os
import sys
import tempfile

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from conftest import FAKE_WEATHER, fake_quotes  # noqa: E402
from jarvis import create_app, services  # noqa: E402

services.weather = lambda city: {**FAKE_WEATHER, "city": city}
services.quotes = fake_quotes
services.news = lambda topic="", limit=15: [{"title": "Notícia de teste", "link": "https://example.com", "source": "Teste", "published": ""}]
services.history = lambda sym, rng="1mo": {"symbol": sym, "range": rng, "source": "teste",
                                            "points": [[1700000000 + i * 86400, 27 + (i % 5) * 0.3] for i in range(30)]}
os.environ.pop("ANTHROPIC_API_KEY", None)
db = os.path.join(tempfile.mkdtemp(), "e2e.db")
app = create_app({"DATABASE_URL": f"sqlite:///{db}", "SECRET_KEY": "e2e"})
app.run(port=int(sys.argv[1]) if len(sys.argv) > 1 else 5055, threaded=True)
