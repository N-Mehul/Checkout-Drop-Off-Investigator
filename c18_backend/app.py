from __future__ import annotations
import csv, io, json, os
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from flask import Flask, jsonify, request, send_file, render_template

BASE_DIR = Path(__file__).resolve().parent
FIXTURE_PATH = BASE_DIR / 'fixture.json'
STEPS = ['visit', 'cart', 'checkout', 'paid']
DEVICES = ['mobile', 'desktop']
app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024


def parse_time(value):
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


def normalize_event(row):
    # Support both step and event_name / event aliases
    step_val = row.get('step')
    if step_val is None or clean(step_val) == '':
        step_val = row.get('event_name') or row.get('event')

    # Support time aliases: time, timestamp, event_time, datetime, event_date
    time_val = row.get('time') or row.get('timestamp') or row.get('event_time') or row.get('datetime')
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
    }


def clean(value):
    if value is None:
        return ''
    return str(value).strip()


def safe_parse_float(value):
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


def load_fixture():
    with FIXTURE_PATH.open(encoding='utf-8') as f:
        data = json.load(f)
    return data['records']['events'], data


def parse_upload(file):
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
            # Support records.events, events, or records (if it's a list)
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

        # Support both 'step' and 'event_name' / 'event' as aliases for the funnel step.
        # If 'step' is missing but 'event_name' exists, map 'event_name' to 'step' internally.
        if 'step' not in cleaned_row or not str(cleaned_row['step']).strip():
            if 'event_name' in cleaned_row and str(cleaned_row['event_name']).strip():
                cleaned_row['step'] = cleaned_row['event_name']
            elif 'event' in cleaned_row and str(cleaned_row['event']).strip():
                cleaned_row['step'] = cleaned_row['event']

        # Support time / timestamp / event_time / datetime
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


def pct(n, d):
    return round(100 * n / d, 2) if d else None


def rate(n, d):
    return round(n / d, 6) if d else None


def analyze(raw_events, fixture_data=None, is_builtin=False):
    normalized = [normalize_event(e) for e in raw_events]
    raw_count = len(normalized)
    # Keep the first occurrence of each non-empty event_id; rows without IDs are reported as invalid.
    seen = set()
    deduped = []
    duplicate_count = 0
    for e in normalized:
        if not e['event_id']:
            continue
        if e['event_id'] in seen:
            duplicate_count += 1
            continue
        seen.add(e['event_id'])
        deduped.append(e)

    sessions = defaultdict(list)
    for e in deduped:
        if e['session_id']:
            sessions[e['session_id']].append(e)

    period_dates = {}
    if fixture_data and isinstance(fixture_data, dict):
        period_dates = fixture_data.get('records', {}).get('periods', {}) if isinstance(fixture_data.get('records'), dict) else {}
        if not period_dates and 'periods' in fixture_data and isinstance(fixture_data['periods'], dict):
            period_dates = fixture_data['periods']
    date_values = sorted({(parse_time(e['time']).date().isoformat()) for e in deduped if parse_time(e['time'])})
    if not period_dates and len(date_values) >= 2:
        period_dates = {'before': date_values[0], 'after': date_values[-1]}
    before_date = period_dates.get('before')
    after_date = period_dates.get('after')

    session_rows = []
    no_visit_sessions = []
    for sid, events in sessions.items():
        visits = [e for e in events if e['step'] == 'visit']
        if not visits:
            no_visit_sessions.append(sid)
            continue
        visit_times = [(parse_time(e['time']), e) for e in visits]
        valid_times = [(dt, e) for dt, e in visit_times if dt is not None]
        first_visit = min(valid_times, key=lambda x: x[0])[1] if valid_times else visits[0]
        dt = parse_time(first_visit['time'])
        session_date = dt.date().isoformat() if dt else None

        explicit_period = (first_visit.get('period') or '').lower()
        if explicit_period in ('before', 'after'):
            period = explicit_period
        elif session_date == before_date:
            period = 'before'
        elif session_date == after_date:
            period = 'after'
        else:
            period = 'unassigned'

        device = first_visit['device'] or 'unknown'
        payment_method = next((e['payment_method'] for e in events if e.get('payment_method')), '')

        # Treat a step as reached only if all prior steps exist; timestamps are not used for funnel order.
        present = {e['step'] for e in events}
        reached = set()
        for step in STEPS:
            if step in present and all(prev in present for prev in STEPS[:STEPS.index(step)]):
                reached.add(step)
            else:
                break
        session_rows.append({'session_id': sid, 'date': session_date, 'period': period,
                             'device': device, 'payment_method': payment_method, 'reached': reached})

    # Build a mapping of session_id to its events for later evidence analysis
    session_events = defaultdict(list)
    for e in normalized:
        if e['session_id']:
            session_events[e['session_id']].append(e)

    # Reason Investigation logic
    from statistics import median
    reasons = []
    # Helper to get session row by id
    session_row_by_id = {s['session_id']: s for s in session_rows}

    # Payment failures
    payment_evidence = any(bool(e.get('payment_status') or e.get('payment_error')) for e in normalized)
    payment_affected = sum(
        1 for sid, evs in session_events.items()
        if any((e.get('payment_status') and e['payment_status'].lower() not in ('paid', 'success', 'succeeded')) or e.get('payment_error') for e in evs)
        and sid in session_row_by_id and 'paid' not in session_row_by_id[sid]['reached']
    )
    reasons.append({
        'reason': 'Payment failures',
        'affected_sessions': payment_affected,
        'evidence_present': payment_evidence,
        'funnel_stage': 'checkout to paid',
        'status': 'Evidence found' if payment_evidence else 'Insufficient data',
        'observation': f'{payment_affected} session(s) recorded payment failures or errors prior to abandonment.' if payment_evidence else 'payment_status and payment_error fields are absent in the dataset.',
        'next_steps': 'Audit payment gateway decline codes (e.g., 3DS failures, processor timeouts) and error handling.' if payment_evidence else 'Collect payment_status and payment_error telemetry to evaluate gateway failure rates.'
    })

    # Delivery charges
    delivery_evidence = any(e.get('delivery_fee') is not None and str(e.get('delivery_fee')).strip() != '' and safe_parse_float(e.get('delivery_fee')) is not None for e in normalized)
    delivery_affected = sum(
        1 for sid, evs in session_events.items()
        if any(safe_parse_float(e.get('delivery_fee')) is not None and safe_parse_float(e.get('delivery_fee')) > 0 for e in evs)
        and sid in session_row_by_id and 'paid' not in session_row_by_id[sid]['reached']
    )
    reasons.append({
        'reason': 'Delivery charges',
        'affected_sessions': delivery_affected,
        'evidence_present': delivery_evidence,
        'funnel_stage': 'checkout to paid',
        'status': 'Evidence found' if delivery_evidence else 'Insufficient data',
        'observation': f'{delivery_affected} session(s) observed with a delivery fee (> $0) before drop-off (correlation, not proven causation).' if delivery_evidence else 'delivery_fee field is absent in the dataset.',
        'next_steps': 'Evaluate whether unexpected shipping fees deter checkout; test free shipping thresholds or upfront fee estimates.' if delivery_evidence else 'Capture delivery_fee amount to determine whether unexpected shipping fees drive abandonment.'
    })

    # Checkout or website errors
    error_evidence = any(bool(e.get('checkout_error')) for e in normalized)
    error_affected = sum(
        1 for sid, evs in session_events.items()
        if any(e.get('checkout_error') for e in evs)
        and sid in session_row_by_id and 'paid' not in session_row_by_id[sid]['reached']
    )
    reasons.append({
        'reason': 'Checkout or website errors',
        'affected_sessions': error_affected,
        'evidence_present': error_evidence,
        'funnel_stage': 'checkout',
        'status': 'Evidence found' if error_evidence else 'Insufficient data',
        'observation': f'{error_affected} session(s) encountered checkout error events before payment.' if error_evidence else 'checkout_error field is absent in the dataset.',
        'next_steps': 'Audit client-side console errors, validation bugs, and server error response codes.' if error_evidence else 'Instrument client-side checkout error logging and API failure telemetry.'
    })

    # Slow page loading
    load_times = [safe_parse_float(e.get('page_load_time')) for e in normalized if safe_parse_float(e.get('page_load_time')) is not None]
    slow_threshold = None
    if load_times:
        slow_threshold = median(load_times) * 1.5  # define slow as 1.5× median
    load_evidence = bool(load_times)
    load_affected = 0
    if slow_threshold is not None:
        load_affected = sum(
            1 for sid, evs in session_events.items()
            if any(safe_parse_float(e.get('page_load_time')) is not None and safe_parse_float(e.get('page_load_time')) > slow_threshold for e in evs)
            and sid in session_row_by_id and 'paid' not in session_row_by_id[sid]['reached']
        )
    reasons.append({
        'reason': 'Slow page loading',
        'affected_sessions': load_affected,
        'evidence_present': load_evidence,
        'funnel_stage': 'visit to checkout',
        'status': 'Evidence found' if load_evidence else 'Insufficient data',
        'observation': f'{load_affected} session(s) exceeded the slow threshold of {slow_threshold:.2f}s (1.5x median {median(load_times):.2f}s).' if load_evidence else 'page_load_time field is absent in the dataset.',
        'next_steps': f'Optimize asset sizes and checkout page performance to stay below {slow_threshold:.2f}s.' if slow_threshold else 'Collect page_load_time (in seconds) via Navigation Timing API.'
    })

    # Add reason investigation to result later
    # periods_out will be defined after this block
    periods_out = {}

    for period in ['before', 'after']:
        rows = [s for s in session_rows if s['period'] == period]
        counts = {step: sum(step in s['reached'] for s in rows) for step in STEPS}
        denominators = {
            'visit_to_cart': counts['visit'],
            'visit_to_checkout': counts['visit'],
            'visit_to_paid': counts['visit'],
            'cart_to_paid': counts['cart'],
            'checkout_to_paid': counts['checkout'],
        }
        numerators = {
            'visit_to_cart': counts['cart'],
            'visit_to_checkout': counts['checkout'],
            'visit_to_paid': counts['paid'],
            'cart_to_paid': counts['paid'],
            'checkout_to_paid': counts['paid'],
        }
        conversions = {k: {'numerator': numerators[k], 'denominator': denominators[k],
                           'rate': rate(numerators[k], denominators[k]),
                           'percent': pct(numerators[k], denominators[k])}
                       for k in denominators}
        device_results = {}
        for device in sorted(set(DEVICES + [s['device'] for s in rows])):
            drows = [s for s in rows if s['device'] == device]
            dcounts = {step: sum(step in s['reached'] for s in drows) for step in STEPS}
            stopped = {
                'stopped_at_visit': sum(s['reached'] == {'visit'} for s in drows),
                'stopped_at_cart': sum(s['reached'] == {'visit', 'cart'} for s in drows),
                'stopped_at_checkout': sum(s['reached'] == {'visit', 'cart', 'checkout'} for s in drows),
                'completed_paid': sum('paid' in s['reached'] for s in drows)
            }
            device_results[device] = {
                'sessions': len(drows),
                'counts': dcounts,
                'stopped_breakdown': stopped,
                'visit_to_cart': {'numerator': dcounts['cart'], 'denominator': dcounts['visit'], 'rate': rate(dcounts['cart'], dcounts['visit']), 'percent': pct(dcounts['cart'], dcounts['visit'])},
                'visit_to_checkout': {'numerator': dcounts['checkout'], 'denominator': dcounts['visit'], 'rate': rate(dcounts['checkout'], dcounts['visit']), 'percent': pct(dcounts['checkout'], dcounts['visit'])},
                'visit_to_paid': {'numerator': dcounts['paid'], 'denominator': dcounts['visit'], 'rate': rate(dcounts['paid'], dcounts['visit']), 'percent': pct(dcounts['paid'], dcounts['visit'])},
                'cart_to_paid': {'numerator': dcounts['paid'], 'denominator': dcounts['cart'], 'rate': rate(dcounts['paid'], dcounts['cart']), 'percent': pct(dcounts['paid'], dcounts['cart'])},
                'checkout_to_paid': {'numerator': dcounts['paid'], 'denominator': dcounts['checkout'], 'rate': rate(dcounts['paid'], dcounts['checkout']), 'percent': pct(dcounts['paid'], dcounts['checkout'])},
                'low_volume': len(drows) < 30,
            }
        # Payment method breakdown if payment methods present
        pm_results = {}
        distinct_pms = sorted({s['payment_method'] for s in rows if s.get('payment_method')})
        for pm in distinct_pms:
            prows = [s for s in rows if s.get('payment_method') == pm]
            pcounts = {step: sum(step in s['reached'] for s in prows) for step in STEPS}
            pm_results[pm] = {
                'sessions': len(prows),
                'counts': pcounts,
                'visit_to_paid': {
                    'numerator': pcounts['paid'],
                    'denominator': pcounts['visit'],
                    'rate': rate(pcounts['paid'], pcounts['visit']),
                    'percent': pct(pcounts['paid'], pcounts['visit'])
                }
            }
        periods_out[period] = {'session_count': len(rows), 'counts': counts, 'conversions': conversions, 'devices': device_results, 'payment_methods': pm_results}

    # Timestamp interval analysis across sessions
    total_interval_pairs = 0
    zero_interval_pairs = 0
    intervals_by_stage = defaultdict(list)

    for sid, evs in sessions.items():
        step_times = {}
        for e in evs:
            t = parse_time(e.get('time'))
            if t is not None and e['step'] not in step_times:
                step_times[e['step']] = t

        for pair_key, (s1, s2) in [('visit_to_cart', ('visit', 'cart')),
                                   ('cart_to_checkout', ('cart', 'checkout')),
                                   ('checkout_to_paid', ('checkout', 'paid'))]:
            if s1 in step_times and s2 in step_times:
                diff_sec = (step_times[s2] - step_times[s1]).total_seconds()
                total_interval_pairs += 1
                if diff_sec == 0:
                    zero_interval_pairs += 1
                intervals_by_stage[pair_key].append(diff_sec)

    has_timing_variation = any(any(d != 0 for d in diffs) for diffs in intervals_by_stage.values())
    medians = {}
    if has_timing_variation:
        for k, diffs in intervals_by_stage.items():
            if diffs:
                from statistics import median
                medians[k] = round(median(diffs), 1)
        median_summary = ", ".join(f"{k.replace('_', ' ')}: {v}s" for k, v in medians.items())
        timing_summary = f"Timing intervals measured across session transitions (median elapsed: {median_summary})."
    else:
        timing_summary = (
            'Step events within sessions have identical timestamps (0.0s elapsed between steps). '
            'Timestamp evidence cannot measure page duration or step latency in this dataset. '
            'Funnel drop-off represents step abandonment, not recorded delays.'
        )

    timing_analysis = {
        'total_pairs_checked': total_interval_pairs,
        'zero_interval_pairs': zero_interval_pairs,
        'has_timing_variation': has_timing_variation,
        'intervals_median_seconds': medians,
        'summary': timing_summary
    }

    comparisons = {}
    for device in sorted(set(DEVICES + [s['device'] for s in session_rows])):
        b = periods_out['before']['devices'].get(device, {}).get('visit_to_paid', {}).get('percent')
        a = periods_out['after']['devices'].get(device, {}).get('visit_to_paid', {}).get('percent')
        change = round(a - b, 2) if a is not None and b is not None else None
        comparisons[device] = {'before_percent': b, 'after_percent': a, 'change_percentage_points': change,
                               'before_counts': periods_out['before']['devices'].get(device, {}).get('counts', {}),
                               'after_counts': periods_out['after']['devices'].get(device, {}).get('counts', {}),
                               'low_volume': (periods_out['before']['devices'].get(device, {}).get('sessions', 0) < 30 or periods_out['after']['devices'].get(device, {}).get('sessions', 0) < 30)}
    overall_b = periods_out['before']['conversions']['visit_to_paid']['percent']
    overall_a = periods_out['after']['conversions']['visit_to_paid']['percent']
    overall_change = round(overall_a - overall_b, 2) if overall_a is not None and overall_b is not None else None
    declines = [(v['change_percentage_points'], k) for k, v in comparisons.items() if v['change_percentage_points'] is not None]
    largest = min(declines) if declines else None
    timing_desc = ", ".join(f"{k.replace('_', ' ')}: {v}s median" for k, v in medians.items()) if medians else "timing variations detected"
    affected = None
    if largest and largest[0] < 0:
        dev = largest[1]
        b_dev = periods_out['before']['devices'][dev]
        a_dev = periods_out['after']['devices'][dev]
        affected = {
            'device': dev,
            'before_percent': comparisons[dev]['before_percent'],
            'after_percent': comparisons[dev]['after_percent'],
            'change_percentage_points': comparisons[dev]['change_percentage_points'],
            'before_counts': comparisons[dev]['before_counts'],
            'after_counts': comparisons[dev]['after_counts'],
            'before_numerators_denominators': {
                'paid_sessions': b_dev['counts']['paid'],
                'visit_sessions': b_dev['counts']['visit']
            },
            'after_numerators_denominators': {
                'paid_sessions': a_dev['counts']['paid'],
                'visit_sessions': a_dev['counts']['visit']
            },
            'stopped_breakdown': {
                'before': b_dev.get('stopped_breakdown', {}),
                'after': a_dev.get('stopped_breakdown', {})
            },
            'timing_finding': (
                f'Identical timestamps observed (0.0s elapsed between steps). '
                f'Drop-off occurred as step abandonment ({a_dev.get("stopped_breakdown", {}).get("stopped_at_cart", 0)} stopped at Cart, '
                f'{a_dev.get("stopped_breakdown", {}).get("stopped_at_checkout", 0)} stopped at Checkout), not recorded latency.'
                if not has_timing_variation else
                f'Timing intervals measured across session transitions ({timing_desc}). Drop-off reflects session progression loss ({a_dev.get("stopped_breakdown", {}).get("stopped_at_cart", 0)} stopped at Cart, {a_dev.get("stopped_breakdown", {}).get("stopped_at_checkout", 0)} stopped at Checkout).'
            ),
            'explanation': (
                f'{dev.capitalize()} is the largest verified declining segment ({comparisons[dev]["change_percentage_points"]} percentage points, '
                f'falling from {comparisons[dev]["before_percent"]}% down to {comparisons[dev]["after_percent"]}% paid conversion). '
                f'In the after period, {a_dev.get("stopped_breakdown", {}).get("stopped_at_cart", 0)} sessions stopped at Cart and '
                f'{a_dev.get("stopped_breakdown", {}).get("stopped_at_checkout", 0)} stopped at Checkout. '
                f'Investigation should focus primarily on {dev.capitalize()} checkout step transitions.'
            ),
            'low_volume': comparisons[dev]['low_volume'],
            'interpretation': 'Possible reason (hypothesis, not proven): inspect the funnel steps with lower counts; this dataset alone does not prove causation.'
        }
    methods_present = any(e['payment_method'] for e in normalized)
    result = {
        'case_id': fixture_data.get('case_id', 'C18') if fixture_data else 'uploaded-data',
        'synthetic': bool(fixture_data.get('synthetic', True)) if fixture_data else None,
        'data_version': fixture_data.get('data_version') if fixture_data else None,
        'period_dates': {'before': before_date, 'after': after_date},
        'timing_analysis': timing_analysis,
        'event_quality': {'raw_events': raw_count, 'unique_event_ids': len(seen), 'duplicates_removed': duplicate_count,
                          'events_without_event_id': sum(not e['event_id'] for e in normalized),
                          'sessions_without_visit': len(no_visit_sessions), 'sessions_without_visit_ids': no_visit_sessions,
                          'instrumentation_gaps': ([] if methods_present else ['payment_method field is absent or empty; payment-method segmentation is unavailable']),
                          'unknown_device_sessions': sum(s['device'] == 'unknown' for s in session_rows)},
        'session_count': {'before': periods_out['before']['session_count'], 'after': periods_out['after']['session_count'], 'total_assigned': sum(p['session_count'] for p in periods_out.values())},
        'periods': periods_out,
        'overall_visit_to_paid': {'before_percent': overall_b, 'after_percent': overall_a, 'change_percentage_points': overall_change},
        'device_comparison': comparisons,
        'largest_decline': affected,
        'reason_investigation': reasons,
        'dataset_info': {
            'source': 'Built-in C18 Fixture' if is_builtin else 'Custom Upload',
            'is_custom': not is_builtin,
            'records_read': raw_count,
            'unique_event_ids': len(seen),
            'duplicates_removed': duplicate_count,
            'detected_evidence_fields': [
                f for f, present in [
                    ('payment_status', any(bool(e.get('payment_status') or e.get('payment_error')) for e in normalized)),
                    ('delivery_fee', any(safe_parse_float(e.get('delivery_fee')) is not None for e in normalized)),
                    ('checkout_error', any(bool(e.get('checkout_error')) for e in normalized)),
                    ('page_load_time', any(safe_parse_float(e.get('page_load_time')) is not None for e in normalized)),
                    ('payment_method', any(bool(e.get('payment_method')) for e in normalized)),
                ] if present
            ]
        },
        'notes': ['Conversion rates use distinct sessions and session step progression, not event counts.',
                  'Funnel order is visit → cart → checkout → paid; timestamp ties do not change step order.',
                  'Missing values are unknown, not zero.',
                  'Percentage-point changes are calculated from numerator and denominator counts, not averages of segment rates.']
    }
    if is_builtin and fixture_data and isinstance(fixture_data.get('records', {}).get('expected'), dict):
        expected = fixture_data['records']['expected']
        checks = {}
        actual_map = {
            'after_visit_to_cart': periods_out['after']['conversions']['visit_to_cart']['rate'],
            'after_visit_to_checkout': periods_out['after']['conversions']['visit_to_checkout']['rate'],
            'after_visit_to_paid': periods_out['after']['conversions']['visit_to_paid']['rate'],
            'after_cart_to_paid': periods_out['after']['conversions']['cart_to_paid']['rate'],
            'after_checkout_to_paid': periods_out['after']['conversions']['checkout_to_paid']['rate'],
            'before_mobile_visit_to_paid': periods_out['before']['devices']['mobile']['visit_to_paid']['rate'],
            'after_mobile_visit_to_paid': periods_out['after']['devices']['mobile']['visit_to_paid']['rate'],
            'before_desktop_visit_to_paid': periods_out['before']['devices']['desktop']['visit_to_paid']['rate'],
            'after_desktop_visit_to_paid': periods_out['after']['devices']['desktop']['visit_to_paid']['rate'],
            'affected_segment': affected['device'] if affected else None,
            'desktop_change_percentage_points': comparisons['desktop']['change_percentage_points'],
            'deduplicated_events': len(seen),
        }
        for key, exp in expected.items():
            act = actual_map.get(key)
            ok = (abs(act - exp) < 1e-5) if isinstance(exp, (int, float)) and isinstance(act, (int, float)) else act == exp
            checks[key] = {'expected': exp, 'actual': act, 'match': ok}
        result['fixture_validation'] = {'checks': checks, 'passed': sum(c['match'] for c in checks.values()), 'total': len(checks), 'all_match': all(c['match'] for c in checks.values())}
    return result


current_dataset = None


@app.get('/api/analysis')
def get_analysis():
    global current_dataset
    if current_dataset is not None:
        events, fixture = current_dataset
        return jsonify(analyze(events, fixture_data=fixture, is_builtin=False))
    events, fixture = load_fixture()
    return jsonify(analyze(events, fixture_data=fixture, is_builtin=True))


@app.post('/api/upload')
def upload():
    global current_dataset
    if 'file' not in request.files:
        return jsonify({'error': 'Attach a CSV or JSON file using the form field named file.'}), 400
    try:
        events, fixture = parse_upload(request.files['file'])
        current_dataset = (events, fixture)
        return jsonify(analyze(events, fixture_data=fixture, is_builtin=False))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400


@app.post('/api/reset')
def reset():
    global current_dataset
    current_dataset = None
    events, fixture = load_fixture()
    return jsonify(analyze(events, fixture_data=fixture, is_builtin=True))


@app.get('/')
def index():
    if request.headers.get('Accept') == 'application/json':
        return jsonify({'message': 'C18 Checkout Drop-Off Investigator backend is running.', 'endpoints': ['/api/analysis', '/api/upload', '/api/reset']})
    return render_template('index.html')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', '5000')), debug=False)

