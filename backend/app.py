from __future__ import annotations
import os
from pathlib import Path
from flask import Flask

from connectivity import api_bp, setup_cors

# Project Root Directory
ROOT_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = ROOT_DIR / 'frontend'
TEMPLATE_DIR = FRONTEND_DIR / 'templates'
STATIC_DIR = FRONTEND_DIR / 'static'


def create_app(config_override: dict = None) -> Flask:
    """Application factory for Checkout Drop-Off Investigator."""
    app = Flask(
        __name__,
        template_folder=str(TEMPLATE_DIR),
        static_folder=str(STATIC_DIR),
        static_url_path='/static'
    )

    # Configure application
    app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # 10 MB upload limit
    if config_override:
        app.config.update(config_override)

    # Setup connectivity and API routes
    setup_cors(app)
    app.register_blueprint(api_bp)

    # Start realistic live checkout event generator daemon
    from .live_generator import start_live_generator, ensure_generator_running
    start_live_generator(interval_seconds=3.0)

    @app.before_request
    def _ensure_live_generator():
        """Ensure live generator daemon is active in the worker process handling the request."""
        ensure_generator_running(interval_seconds=3.0)

    # Initialize Gemini API key environment
    try:
        from .ai_engine import _get_gemini_api_key
        _get_gemini_api_key()
    except Exception:
        pass

    return app


# Default app instance
app = create_app()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"Starting server on http://127.0.0.1:{port}")
    app.run(host='0.0.0.0', port=port, debug=False)
