from __future__ import annotations
import csv
import io
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

DATA_DIR = Path(__file__).resolve().parent / 'data'
FIXTURE_PATH = DATA_DIR / 'fixture.json'
STEPS = ['visit', 'cart', 'checkout', 'paid']
DEVICES = ['mobile', 'desktop']


def clean(value: Any) -> str:
    """Normalize a value to a stripped string, handling None safely."""
    if value is None:
        return ''
    return str(value).strip()


def parse_time(value: Any) -> Optional[datetime]:
    """Parse timestamp strings in ISO or common date/time formats."""
    if value is None or str(value).strip() == '':
        return None
    s = str(value).strip().replace('Z', '+00:00')
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d'):
            try:
                return datetime.strptime(s, fmt)
            except ValueError:
                pass
        return None


def safe_parse_float(value: Any) -> Optional[float]:
    """Safely convert strings with currency symbols or numbers into floats."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip().lstrip('$£€')
    if not s:
        return None
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def normalize_event(row: Dict[str, Any]) -> Dict[str, Any]:
    """
    Map raw event record fields to canonical schema names.
    Supports step/event_name aliases and various timestamp headers.
    """
    step_val = row.get('step')
    if step_val is None or clean(step_val) == '':
        step_val = row.get('event_name') or row.get('event')

    time_val = (
        row.get('time')
        or row.get('timestamp')
        or row.get('event_time')
        or row.get('datetime')
    )
    if not time_val and row.get('event_date'):
        time_val = row.get('event_date')

    return {
        'event_id': clean(row.get('event_id')),
        'session_id': clean(row.get('session_id')),
        'step': clean(step_val).lower(),
        'device': clean(row.get('device')).lower(),
        'time': clean(time_val),
        'period': clean(row.get('period')).lower(),
        'event_date': clean(row.get('event_date')),
        'payment_method': clean(row.get('payment_method')).lower(),
        'payment_status': clean(row.get('payment_status')),
        'payment_error': clean(row.get('payment_error')),
        'delivery_fee': clean(row.get('delivery_fee')),
        'checkout_error': clean(row.get('checkout_error')),
        'page_load_time': clean(row.get('page_load_time')),
        'checkout_steps': clean(
            row.get('checkout_steps')
            or row.get('form_steps')
            or row.get('step_count')
        ),
        'checkout_time': clean(
            row.get('checkout_time')
            or row.get('checkout_duration')
            or row.get('time_in_checkout')
        ),
        'intent': clean(
            row.get('intent')
            or row.get('browse_only')
            or row.get('user_intent')
        ),
        'discount_code': clean(
            row.get('discount_code')
            or row.get('coupon_code')
            or row.get('promo_code')
            or row.get('coupon')
        ),
        'discount_amount': clean(
            row.get('discount_amount')
            or row.get('discount')
            or row.get('discount_value')
        ),
        'coupon_error': clean(row.get('coupon_error')),
        'dwell_time': clean(row.get('dwell_time')),
        'page_views': clean(row.get('page_views')),
        'product_views': clean(row.get('product_views')),
        'browse_only': clean(row.get('browse_only')),
    }


def load_fixture(fixture_file: Optional[Path] = None) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Load the baseline fixture dataset from disk."""
    target_path = fixture_file or FIXTURE_PATH
    if not target_path.exists():
        raise FileNotFoundError(f"Fixture dataset not found at {target_path}")
    with target_path.open(encoding='utf-8') as f:
        data = json.load(f)
    return data['records']['events'], data


def parse_upload(file) -> Tuple[List[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """
    Parse an uploaded CSV or JSON file into normalized events.
    Validates required columns and checks for malformed data.
    """
    name = (file.filename or '').lower()
    raw = file.read()
    if not raw:
        raise ValueError('The uploaded file is empty.')
    try:
        text = raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        raise ValueError('Please upload a UTF-8 CSV or JSON file.')

    data = None
    if name.endswith('.json') or text.lstrip().startswith('{') or text.lstrip().startswith('['):
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError(f'Invalid JSON: {exc.msg}.')
        if isinstance(data, dict):
            if isinstance(data.get('records'), dict) and isinstance(data['records'].get('events'), list):
                events = data['records']['events']
            elif isinstance(data.get('events'), list):
                events = data['events']
            elif isinstance(data.get('records'), list):
                events = data['records']
            else:
                raise ValueError('Unsupported JSON structure. Expected records.events or events array.')
        elif isinstance(data, list):
            events = data
        else:
            raise ValueError('JSON must be an event array or contain records.events.')
        if not isinstance(events, list):
            raise ValueError('JSON must be an event array or contain records.events.')
    elif name.endswith('.csv') or ',' in text.splitlines()[0]:
        try:
            events = list(csv.DictReader(io.StringIO(text)))
        except Exception as exc:
            raise ValueError(f'Could not read CSV: {exc}')
    else:
        raise ValueError('Unsupported file type. Upload a .csv or .json file.')

    if not events:
        raise ValueError('No event rows were found in the uploaded file.')

    cleaned_events = []
    for row in events:
        if not isinstance(row, dict):
            raise ValueError('Each record in the dataset must be an object/dictionary.')
        cleaned_row = {str(k).strip().lower(): v for k, v in row.items() if k is not None}

        # Step and time aliases
        if 'step' not in cleaned_row or not str(cleaned_row['step']).strip():
            if 'event_name' in cleaned_row and str(cleaned_row['event_name']).strip():
                cleaned_row['step'] = cleaned_row['event_name']
            elif 'event' in cleaned_row and str(cleaned_row['event']).strip():
                cleaned_row['step'] = cleaned_row['event']

        if 'time' not in cleaned_row or not str(cleaned_row['time']).strip():
            if 'timestamp' in cleaned_row and str(cleaned_row['timestamp']).strip():
                cleaned_row['time'] = cleaned_row['timestamp']
            elif 'event_time' in cleaned_row and str(cleaned_row['event_time']).strip():
                cleaned_row['time'] = cleaned_row['event_time']
            elif 'datetime' in cleaned_row and str(cleaned_row['datetime']).strip():
                cleaned_row['time'] = cleaned_row['datetime']

        cleaned_events.append(cleaned_row)
    events = cleaned_events

    required = {'event_id', 'session_id', 'step', 'device'}
    keys = set(events[0].keys())
    missing = sorted(required - keys)
    if missing:
        raise ValueError('Missing required columns: ' + ', '.join(missing) + '.')

    normalized = [normalize_event(row) for row in events]
    invalid_steps = sorted({e['step'] for e in normalized if e['step'] and e['step'] not in STEPS})
    if invalid_steps:
        raise ValueError('Unknown funnel step(s): ' + ', '.join(invalid_steps) + '. Allowed: visit, cart, checkout, paid.')

    missing_id_count = sum(not e['event_id'] for e in normalized)
    missing_sess_count = sum(not e['session_id'] for e in normalized)
    missing_step_count = sum(not e['step'] for e in normalized)
    if missing_id_count > 0 or missing_sess_count > 0 or missing_step_count > 0:
        details = []
        if missing_id_count:
            details.append(f'{missing_id_count} row(s) missing event_id')
        if missing_sess_count:
            details.append(f'{missing_sess_count} row(s) missing session_id')
        if missing_step_count:
            details.append(f'{missing_step_count} row(s) missing step')
        raise ValueError('Invalid records: ' + ', '.join(details) + '.')

    fixture_out = data if isinstance(data, dict) else None
    return normalized, fixture_out


import threading
import uuid


class DatasetRepository:
    """
    Manages active dataset state and in-memory live event store.
    Supports real-time streaming event ingestion alongside dataset upload fallback.
    """

    def __init__(self, default_fixture_path: Optional[Path] = None):
        self.default_fixture_path = default_fixture_path or FIXTURE_PATH
        self._current_dataset: Optional[Tuple[List[Dict[str, Any]], Optional[Dict[str, Any]]]] = None
        self._live_lock = threading.Lock()
        self._live_events: List[Dict[str, Any]] = []
        self._live_fixture_meta: Optional[Dict[str, Any]] = None
        self._init_live_seed()

    def _init_live_seed(self):
        """Seed initial baseline events from dataset file."""
        seed_path = DATA_DIR / 'c18_checkout_test_dataset.json'
        if not seed_path.exists():
            seed_path = self.default_fixture_path
        try:
            evs, meta = load_fixture(seed_path)
            with self._live_lock:
                self._live_events = [normalize_event(e) for e in evs]
                self._live_fixture_meta = meta
        except Exception:
            with self._live_lock:
                self._live_events = []
                self._live_fixture_meta = {'case_id': 'LIVE-DEMO', 'synthetic': True}

    def add_event(self, raw_event: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize and append a live event to the in-memory store."""
        norm = normalize_event(raw_event)
        if not norm.get('event_id'):
            norm['event_id'] = f"evt_{uuid.uuid4().hex[:8]}"
        if not norm.get('time'):
            norm['time'] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        if not norm.get('period'):
            norm['period'] = 'after'
        if not norm.get('device'):
            norm['device'] = 'desktop'
        with self._live_lock:
            self._live_events.append(norm)
        return norm

    def add_events(self, raw_events_list: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Append multiple live events to the in-memory store."""
        added = []
        for e in raw_events_list:
            if isinstance(e, dict):
                norm = normalize_event(e)
                if not norm.get('event_id'):
                    norm['event_id'] = f"evt_{uuid.uuid4().hex[:8]}"
                if not norm.get('time'):
                    norm['time'] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                if not norm.get('period'):
                    norm['period'] = 'after'
                if not norm.get('device'):
                    norm['device'] = 'desktop'
                added.append(norm)
        with self._live_lock:
            self._live_events.extend(added)
        return added

    def get_live_events(self, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        """
        Return live events from the in-memory store.
        If limit is None or <= 0, returns the COMPLETE current dataset in chronological order.
        If limit is positive, returns the most recent 'limit' events in reverse chronological order.
        """
        with self._live_lock:
            if limit is not None and limit > 0:
                return list(reversed(self._live_events[-limit:]))
            return list(self._live_events)

    def get_all_live_events(self) -> List[Dict[str, Any]]:
        """Return the complete current live dataset in chronological order."""
        with self._live_lock:
            return list(self._live_events)

    def get_latest_event_timestamp(self) -> str:
        """Return the latest timestamp among live events or current time."""
        with self._live_lock:
            for ev in reversed(self._live_events):
                t = ev.get('time')
                if t:
                    return str(t)
        return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def get_live_count(self) -> int:
        """Return total number of events currently in memory."""
        with self._live_lock:
            return len(self._live_events)

    def get_dataset(self) -> Tuple[List[Dict[str, Any]], Optional[Dict[str, Any]], bool]:
        """
        Returns (events, fixture_metadata, is_builtin).
        If an uploaded dataset is active (fallback), returns that.
        Otherwise analyzes the current live in-memory event store.
        """
        if self._current_dataset is not None:
            events, fixture = self._current_dataset
            return events, fixture, False
        with self._live_lock:
            return list(self._live_events), self._live_fixture_meta, False

    def set_dataset(self, events: List[Dict[str, Any]], fixture_metadata: Optional[Dict[str, Any]] = None):
        """Set uploaded dataset as active fallback."""
        self._current_dataset = (events, fixture_metadata)

    def reset_to_default(self) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """Reset custom upload and restore the live baseline store."""
        self._current_dataset = None
        self._init_live_seed()
        with self._live_lock:
            return list(self._live_events), self._live_fixture_meta

    def is_custom(self) -> bool:
        """Returns True if a custom uploaded dataset is active."""
        return self._current_dataset is not None


# Global singleton repository
repository = DatasetRepository()

