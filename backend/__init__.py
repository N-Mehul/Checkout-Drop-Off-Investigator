"""
Backend package for Checkout Drop-Off Investigator.
Contains core analytics engine and Flask application factory.
"""
from .analytics_engine import analyze, pct, rate
from .app import create_app

__all__ = ['analyze', 'pct', 'rate', 'create_app']
