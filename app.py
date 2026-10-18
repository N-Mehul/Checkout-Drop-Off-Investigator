"""
Root entry point to run the Checkout Drop-Off Investigator application.
Supports running directly via `python app.py` or `python run.py`.
"""
import os
import sys

# Ensure project root is in sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.app import app, create_app

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    host = os.environ.get('HOST', '0.0.0.0')
    print("=" * 60)
    print("  Checkout Drop-Off Investigator")
    print(f"  Server URL: http://127.0.0.1:{port}")
    print("  Folders: frontend | backend | connectivity | database")
    print("=" * 60)
    app.run(host=host, port=port, debug=False)
