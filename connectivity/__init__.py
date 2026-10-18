"""
Connectivity package for Checkout Drop-Off Investigator.
Bridges frontend interfaces, external API consumers, and backend/database services.
"""
from .api_routes import api_bp
from .connector import (
    format_response,
    format_error,
    get_connectivity_info,
    setup_cors
)

__all__ = [
    'api_bp',
    'format_response',
    'format_error',
    'get_connectivity_info',
    'setup_cors'
]
