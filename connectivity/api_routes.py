from __future__ import annotations
import io
import json
from flask import Blueprint, jsonify, render_template, request, send_file
from database.repository import repository, parse_upload
from backend.analytics_engine import analyze
from .connector import format_response, format_error, get_connectivity_info

api_bp = Blueprint('api', __name__)


@api_bp.get('/')
def index():
    """Serve the web dashboard or API metadata."""
    if request.headers.get('Accept') == 'application/json':
        return format_response({
            'message': 'Checkout Drop-Off Investigator API is active.',
            'connectivity': get_connectivity_info()
        })
    return render_template('index.html')


from datetime import datetime
from backend.live_generator import is_generator_running, ensure_generator_running


@api_bp.get('/api/analysis')
def get_analysis():
    """Generate and return drop-off analysis for the active live dataset."""
    ensure_generator_running(interval_seconds=3.0)
    try:
        events, fixture, is_builtin = repository.get_dataset()
        result = analyze(events, fixture_data=fixture, is_builtin=is_builtin)
        # Attach live streaming indicators
        result['live'] = {
            'is_live': True,
            'generator_active': is_generator_running(),
            'total_events': repository.get_live_count(),
            'timestamp': datetime.now().strftime("%H:%M:%S"),
            'is_custom_upload': repository.is_custom()
        }
        return format_response(result)
    except Exception as exc:
        return format_error(f'Failed to compute analysis: {str(exc)}', status=500)


from backend.ai_engine import analyze_with_ai


@api_bp.route('/api/ai-analysis', methods=['GET', 'POST'])
def post_ai_analysis():
    """
    Generate an intelligent AI Investigation report from the latest active live dataset.
    Accepts filter configuration in request body (or query parameters):
    {
      "time_period": "before_vs_after" | "all" | "before" | "after",
      "device": "all" | "mobile" | "desktop",
      "stage": "all" | "visit" | "cart" | "checkout" | "paid",
      "scope": "complete" | "funnel" | "device" | "payment" | "checkout" | "reasons"
    }
    """
    try:
        from collections import defaultdict
        from database.repository import normalize_event

        payload = request.get_json(silent=True) or {}
        if not payload and request.args:
            payload = request.args.to_dict()
        payload = payload or {}

        time_period = payload.get('time_period', 'before_vs_after')
        device = payload.get('device', 'all')
        stage = payload.get('stage', 'all')
        scope = payload.get('scope', 'complete')

        # Normalization & Validation
        if time_period not in ('before_vs_after', 'all', 'before', 'after'):
            time_period = 'before_vs_after'
        if device not in ('all', 'mobile', 'desktop'):
            device = 'all'
        if stage not in ('all', 'visit', 'cart', 'checkout', 'paid'):
            stage = 'all'
        if scope not in ('complete', 'funnel', 'device', 'payment', 'checkout', 'reasons'):
            scope = 'complete'

        filters = {
            'time_period': time_period,
            'device': device,
            'stage': stage,
            'scope': scope
        }

        # 1. STEP 1: Retrieve complete CURRENT live dataset at this exact moment
        if repository.is_custom():
            events, fixture, is_builtin = repository.get_dataset()
        else:
            events = repository.get_live_events()
            fixture = repository._live_fixture_meta
            is_builtin = False

        # 2. STEP 2 & 3: Normalize events and group into sessions
        normalized = [normalize_event(e) for e in events]
        session_map = defaultdict(list)
        for e in normalized:
            sid = e.get('session_id')
            if sid:
                session_map[sid].append(e)

        # 3. STEP 4: Session-Level Filtering (preserves complete session event sequences)
        filtered_sids = []
        for sid, evs in session_map.items():
            # Identify session device from visit or first event with device
            s_dev = 'unknown'
            for ev in evs:
                d = (ev.get('device') or '').lower()
                if d in ('desktop', 'mobile'):
                    s_dev = d
                    break

            # Identify session period
            s_period = 'unassigned'
            for ev in evs:
                p = (ev.get('period') or '').lower()
                if p in ('before', 'after'):
                    s_period = p
                    break

            # Sequential reached steps
            present = {ev.get('step') for ev in evs if ev.get('step')}
            reached = set()
            for stp in ('visit', 'cart', 'checkout', 'paid'):
                if stp in present:
                    reached.add(stp)
                else:
                    break

            # Device filter
            if device in ('desktop', 'mobile') and s_dev != device:
                continue

            # Time Period filter
            if time_period == 'before' and s_period != 'before':
                continue
            elif time_period == 'after' and s_period != 'after':
                continue

            # Stage filter
            if stage == 'visit':
                if 'visit' not in reached:
                    continue
            elif stage == 'cart':
                if 'visit' not in reached:
                    continue
            elif stage == 'checkout':
                if 'cart' not in reached:
                    continue
            elif stage == 'paid':
                if 'checkout' not in reached:
                    continue

            filtered_sids.append(sid)

        # Reconstruct filtered events preserving full unbroken session sequences
        filtered_events = [e for sid in filtered_sids for e in session_map[sid]]
        if not filtered_events and events:
            filtered_events = events
            filtered_sids = list(session_map.keys())

        # 4. Compute data snapshot for verification
        latest_ts = repository.get_latest_event_timestamp()
        data_snapshot = {
            'live_event_count': len(filtered_events),
            'unique_session_count': len(filtered_sids),
            'latest_event_timestamp': latest_ts,
            'analysis_generated_at': datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }

        # 5. STEP 5 & 6: Run existing analytics engine and reason calculations on filtered dataset
        analysis_result = analyze(filtered_events, fixture_data=fixture, is_builtin=is_builtin)

        # 6. STEP 7 & 8: Send calculated metrics to AI engine and generate report
        ai_report = analyze_with_ai(analysis_result, raw_events=filtered_events, filters=filters)
        ai_report['data_snapshot'] = data_snapshot
        ai_report['dataset_meta'] = {
            'is_live': not repository.is_custom(),
            'total_events': len(filtered_events),
            'unfiltered_total_events': len(events),
            'generated_at': data_snapshot['analysis_generated_at']
        }
        return format_response(ai_report)
    except Exception as exc:
        return format_error(f'Failed to generate AI analysis: {str(exc)}', status=500)


@api_bp.post('/api/events')
def post_events():
    """
    Ingest one or more live checkout events into the in-memory store.
    Accepts a single event JSON object or a list of event objects.
    """
    data = request.get_json(silent=True)
    if data is None:
        return format_error('Invalid or missing JSON payload in request body.', status=400)

    # Support {"events": [...]} wrapper
    if isinstance(data, dict) and 'events' in data and isinstance(data['events'], list):
        data = data['events']

    if isinstance(data, list):
        if not data:
            return format_error('Empty event list provided.', status=400)
        added = repository.add_events(data)
        return format_response({
            'status': 'success',
            'added': len(added),
            'total_events': repository.get_live_count()
        }, status=201)
    elif isinstance(data, dict):
        added = repository.add_event(data)
        return format_response({
            'status': 'success',
            'added': 1,
            'event_id': added.get('event_id'),
            'total_events': repository.get_live_count()
        }, status=201)
    else:
        return format_error('Request body must be a JSON object or array of events.', status=400)


@api_bp.get('/api/live-events')
def get_live_events():
    """Return recent live events and streaming status."""
    ensure_generator_running(interval_seconds=3.0)
    try:
        limit = min(int(request.args.get('limit', 30)), 100)
    except (ValueError, TypeError):
        limit = 30

    return format_response({
        'status': 'online',
        'generator_active': is_generator_running(),
        'total_events': repository.get_live_count(),
        'recent_events': repository.get_live_events(limit=limit),
        'timestamp': datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    })


@api_bp.post('/api/upload')
def upload():
    """Upload custom event dataset in CSV or JSON format."""
    if 'file' not in request.files:
        return format_error('Attach a CSV or JSON file using the form field named file.', status=400)
    file = request.files['file']
    if not file or not file.filename:
        return format_error('No file selected.', status=400)

    try:
        events, fixture = parse_upload(file)
        repository.set_dataset(events, fixture)
        result = analyze(events, fixture_data=fixture, is_builtin=False)
        return format_response(result)
    except ValueError as exc:
        return format_error(str(exc), status=400)
    except Exception as exc:
        return format_error(f'Upload processing failed: {str(exc)}', status=500)


@api_bp.post('/api/reset')
def reset():
    """Reset the active dataset to the default built-in benchmark fixture."""
    try:
        events, fixture = repository.reset_to_default()
        result = analyze(events, fixture_data=fixture, is_builtin=True)
        return format_response(result)
    except Exception as exc:
        return format_error(f'Reset failed: {str(exc)}', status=500)


@api_bp.get('/api/reasons')
def get_reasons():
    """Return only the 6 possible drop-off reasons and supporting evidence."""
    try:
        events, fixture, is_builtin = repository.get_dataset()
        result = analyze(events, fixture_data=fixture, is_builtin=is_builtin)
        return format_response({
            'case_id': result.get('case_id'),
            'reasons': result.get('reason_investigation', [])
        })
    except Exception as exc:
        return format_error(f'Failed to retrieve reasons: {str(exc)}', status=500)


@api_bp.get('/api/health')
def health():
    """Health and service connectivity status."""
    return format_response(get_connectivity_info())


@api_bp.get('/api/export')
def export_analysis():
    """Export current analysis results as a downloadable JSON file."""
    try:
        events, fixture, is_builtin = repository.get_dataset()
        result = analyze(events, fixture_data=fixture, is_builtin=is_builtin)
        json_bytes = json.dumps(result, indent=2).encode('utf-8')
        return send_file(
            io.BytesIO(json_bytes),
            mimetype='application/json',
            as_attachment=True,
            download_name='checkout_dropoff_analysis.json'
        )
    except Exception as exc:
        return format_error(f'Export failed: {str(exc)}', status=500)
