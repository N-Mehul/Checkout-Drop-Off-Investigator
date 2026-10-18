from __future__ import annotations
from typing import Any, Dict, Tuple
from flask import jsonify, Response


def format_response(data: Any, status: int = 200, headers: Dict[str, str] = None) -> Tuple[Response, int]:
    """Format standard JSON response with optional headers."""
    resp = jsonify(data)
    if headers:
        for k, v in headers.items():
            resp.headers[k] = v
    return resp, status


def format_error(message: str, status: int = 400, details: Any = None) -> Tuple[Response, int]:
    """Format standardized error payload."""
    payload = {'error': message}
    if details is not None:
        payload['details'] = details
    return jsonify(payload), status


def get_connectivity_info() -> Dict[str, Any]:
    """Return system connectivity endpoints and capabilities."""
    return {
        'status': 'online',
        'service': 'Checkout Drop-Off Investigator',
        'version': '2.0.0',
        'endpoints': {
            'dashboard': 'GET /',
            'analysis': 'GET /api/analysis',
            'events': 'POST /api/events',
            'live_events': 'GET /api/live-events',
            'ai_analysis': 'POST /api/ai-analysis',
            'upload': 'POST /api/upload',
            'reset': 'POST /api/reset',
            'reasons': 'GET /api/reasons',
            'health': 'GET /api/health',
            'export': 'GET /api/export'
        },
        'supported_upload_formats': ['csv', 'json'],
        'max_upload_size_mb': 10
    }


def setup_cors(app):
    """Enable CORS headers for API routes across cross-origin clients."""
    @app.after_request
    def add_cors_headers(response):
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS, PUT, DELETE'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, Accept'
        return response
