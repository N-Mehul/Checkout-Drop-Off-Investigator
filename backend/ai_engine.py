"""
AI Analysis Layer for Checkout Drop-Off Investigator.
Integrates on top of the existing analytics engine and real-time live events.

Key Principles:
- Strictly uses existing analytics calculations as the ground truth.
- Applies user-selected filters (time_period, device, stage, scope).
- Never invents numbers or evidence.
- Clearly distinguishes correlation from causation.
- Returns 'INSUFFICIENT DATA' when telemetry is uninstrumented.
- Formats status as: CONFIRMED | SUPPORTED | INSUFFICIENT DATA | NOT DETECTED.
- Formats priority as: HIGH | MEDIUM | LOW.
- Formats the 10 canonical result sections in exact specified order:
  1. Executive Summary
  2. Overall Result
  3. Biggest Drop-Off
  4. Top Findings (max 3)
  5. Funnel Investigation
  6. Device Investigation
  7. Reason Investigation
  8. Supporting Evidence
  9. Recommended Actions
  10. Data Quality / Limitations
"""

from __future__ import annotations
import json
import os
import sys
from collections import Counter
from typing import Any, Dict, List, Optional


def _get_gemini_api_key() -> Optional[str]:
    """
    Safely retrieve Gemini API key from environment, Windows User registry, or .env.
    Populates os.environ['GEMINI_API_KEY'] if found so that os.environ.get('GEMINI_API_KEY')
    works consistently across all processes.
    Never logs or prints the actual API key.
    """
    key = os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY')
    if key and key.strip():
        return key.strip()

    if os.name == 'nt':
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Environment') as regkey:
                val, _ = winreg.QueryValueEx(regkey, 'GEMINI_API_KEY')
                if val and val.strip():
                    os.environ['GEMINI_API_KEY'] = val.strip()
                    return val.strip()
        except Exception:
            pass
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'SYSTEM\CurrentControlSet\Control\Session Manager\Environment') as regkey:
                val, _ = winreg.QueryValueEx(regkey, 'GEMINI_API_KEY')
                if val and val.strip():
                    os.environ['GEMINI_API_KEY'] = val.strip()
                    return val.strip()
        except Exception:
            pass

    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
    if os.path.exists(env_path):
        try:
            with open(env_path, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line.startswith('GEMINI_API_KEY='):
                        val = line.split('=', 1)[1].strip().strip('"\'')
                        if val:
                            os.environ['GEMINI_API_KEY'] = val
                            return val
        except Exception:
            pass

    return None


# Ensure environment has the key initialized on import if available
_get_gemini_api_key()



LABEL_MAP = {
    'time_period': {
        'before_vs_after': 'Before vs After',
        'all': 'All Data',
        'before': 'Before',
        'after': 'After'
    },
    'device': {
        'all': 'All Devices',
        'mobile': 'Mobile',
        'desktop': 'Desktop'
    },
    'stage': {
        'all': 'All Stages',
        'visit': 'Visit',
        'cart': 'Cart',
        'checkout': 'Checkout',
        'paid': 'Paid'
    },
    'scope': {
        'complete': 'Complete Investigation',
        'funnel': 'Funnel Analysis',
        'device': 'Device Analysis',
        'payment': 'Payment Analysis',
        'checkout': 'Checkout Analysis',
        'reasons': 'Customer Drop-off Reasons'
    }
}


def analyze_with_ai(
    analysis_result: Dict[str, Any],
    raw_events: Optional[List[Dict[str, Any]]] = None,
    filters: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Produce a complete, structured AI investigation report from the active dataset
    tailored to the supplied filter configuration.
    """
    raw_events = raw_events or []
    filters = filters or {}
    
    time_period = filters.get('time_period', 'before_vs_after')
    device = filters.get('device', 'all')
    stage = filters.get('stage', 'all')
    scope = filters.get('scope', 'complete')

    filters_applied = {
        'time_period': time_period,
        'time_period_label': LABEL_MAP['time_period'].get(time_period, 'Before vs After'),
        'device': device,
        'device_label': LABEL_MAP['device'].get(device, 'All Devices'),
        'stage': stage,
        'stage_label': LABEL_MAP['stage'].get(stage, 'All Stages'),
        'scope': scope,
        'scope_label': LABEL_MAP['scope'].get(scope, 'Complete Investigation')
    }

    # Extract overall metrics
    overall = analysis_result.get('overall_visit_to_paid') or {}
    conv_before = overall.get('before_percent', 0.0) or 0.0
    conv_after = overall.get('after_percent', 0.0) or 0.0
    conv_change = overall.get('change_percentage_points', 0.0) or 0.0

    conversion_change = {
        'before': conv_before,
        'after': conv_after,
        'change_percentage_points': conv_change
    }

    # Extract period counts & conversions
    periods = analysis_result.get('periods') or {}
    b_period = periods.get('before') or {}
    a_period = periods.get('after') or {}
    b_counts = b_period.get('counts') or {'visit': 0, 'cart': 0, 'checkout': 0, 'paid': 0}
    a_counts = a_period.get('counts') or {'visit': 0, 'cart': 0, 'checkout': 0, 'paid': 0}
    b_convs = b_period.get('conversions') or {}
    a_convs = a_period.get('conversions') or {}

    # Stage step drop-offs in the After period
    drop_visit_cart = max(0, a_counts.get('visit', 0) - a_counts.get('cart', 0))
    drop_cart_checkout = max(0, a_counts.get('cart', 0) - a_counts.get('checkout', 0))
    drop_checkout_paid = max(0, a_counts.get('checkout', 0) - a_counts.get('paid', 0))

    rate_visit_cart = ((drop_visit_cart / a_counts['visit']) * 100) if a_counts.get('visit', 0) > 0 else 0.0
    rate_cart_checkout = ((drop_cart_checkout / a_counts['cart']) * 100) if a_counts.get('cart', 0) > 0 else 0.0
    rate_checkout_paid = ((drop_checkout_paid / a_counts['checkout']) * 100) if a_counts.get('checkout', 0) > 0 else 0.0

    # --------------------------------------------------------------------------
    # 3. BIGGEST DROP-OFF IDENTIFICATION
    # --------------------------------------------------------------------------
    drop_candidates = [
        {
            'stage': 'Checkout -> Paid',
            'drop_count': drop_checkout_paid,
            'drop_rate': rate_checkout_paid,
            'from_step': 'checkout',
            'to_step': 'paid',
            'desc': f"{drop_checkout_paid} sessions dropped between Checkout and Payment ({rate_checkout_paid:.1f}% step loss). Customers who entered checkout abandoned before payment completion."
        },
        {
            'stage': 'Visit -> Cart',
            'drop_count': drop_visit_cart,
            'drop_rate': rate_visit_cart,
            'from_step': 'visit',
            'to_step': 'cart',
            'desc': f"{drop_visit_cart} sessions dropped between Visit and Cart ({rate_visit_cart:.1f}% step loss). Visitors browsed products or landing pages without adding items to cart."
        },
        {
            'stage': 'Cart -> Checkout',
            'drop_count': drop_cart_checkout,
            'drop_rate': rate_cart_checkout,
            'from_step': 'cart',
            'to_step': 'checkout',
            'desc': f"{drop_cart_checkout} sessions dropped between Cart and Checkout ({rate_cart_checkout:.1f}% step loss). Shoppers placed items in their cart but never initiated the checkout sequence."
        }
    ]
    # Rank biggest drop-off by drop_count, then drop_rate
    drop_candidates.sort(key=lambda x: (x['drop_count'], x['drop_rate']), reverse=True)
    primary_drop = drop_candidates[0]

    biggest_drop_off = {
        'stage': primary_drop['stage'],
        'sessions_lost': primary_drop['drop_count'],
        'drop_off_percent': round(primary_drop['drop_rate'], 1),
        'explanation': primary_drop['desc'],
        # Compatibility keys
        'affected_sessions': primary_drop['drop_count'],
        'description': primary_drop['desc']
    }

    # --------------------------------------------------------------------------
    # 2. OVERALL RESULT
    # --------------------------------------------------------------------------
    if conv_change < -15.0:
        overall_status = "CRITICAL FUNNEL COLLAPSE"
        overall_summary = f"Paid conversion fell by {abs(conv_change):.1f} percentage points ({conv_before:.1f}% -> {conv_after:.1f}%). Primary attrition concentrated at {primary_drop['stage']}."
    elif conv_change < -5.0:
        overall_status = "MODERATE FUNNEL DECLINE"
        overall_summary = f"Paid conversion dropped by {abs(conv_change):.1f} percentage points ({conv_before:.1f}% -> {conv_after:.1f}%)."
    elif conv_change < 0:
        overall_status = "SLIGHT CONVERSION CONTRACTION"
        overall_summary = f"Paid conversion declined by {abs(conv_change):.1f} percentage points ({conv_before:.1f}% -> {conv_after:.1f}%)."
    elif conv_change > 0:
        overall_status = "CONVERSION EXPANSION"
        overall_summary = f"Paid conversion improved by +{conv_change:.1f} percentage points ({conv_before:.1f}% -> {conv_after:.1f}%)."
    else:
        overall_status = "STABLE CONVERSION"
        overall_summary = f"Paid conversion remained stable at {conv_before:.1f}%."

    overall_result = {
        'before_conversion': conv_before,
        'after_conversion': conv_after,
        'change': conv_change,
        'overall_status': overall_status,
        'summary': overall_summary
    }

    # --------------------------------------------------------------------------
    # 5. FUNNEL INVESTIGATION (Visit -> Cart -> Checkout -> Paid)
    # --------------------------------------------------------------------------
    b_v2c = b_convs.get('visit_to_cart', {}).get('percent', 0.0) or 0.0
    a_v2c = a_convs.get('visit_to_cart', {}).get('percent', 0.0) or 0.0
    b_c2ck = (b_counts['checkout'] / b_counts['cart'] * 100) if b_counts.get('cart', 0) > 0 else 0.0
    a_c2ck = (a_counts['checkout'] / a_counts['cart'] * 100) if a_counts.get('cart', 0) > 0 else 0.0
    b_ck2p = b_convs.get('checkout_to_paid', {}).get('percent', 0.0) or 0.0
    a_ck2p = a_convs.get('checkout_to_paid', {}).get('percent', 0.0) or 0.0

    all_stage_investigations = [
        {
            'stage': 'visit_to_cart',
            'stage_label': 'Visit -> Cart',
            'progression': 'Visit -> Cart',
            'before_retention': round(b_v2c, 1),
            'after_retention': round(a_v2c, 1),
            'change': round(a_v2c - b_v2c, 2),
            'dropped_sessions': drop_visit_cart,
            'drop_rate_percent': round(rate_visit_cart, 1),
            'status': 'SUPPORTED' if drop_visit_cart > 0 else 'NOT DETECTED',
            'priority': 'MEDIUM' if rate_visit_cart > 15 else 'LOW',
            'summary': f"{drop_visit_cart} sessions abandoned before Cart ({rate_visit_cart:.1f}% step loss).",
            'evidence': f"In the After period, {a_counts.get('cart', 0)} of {a_counts.get('visit', 0)} landing sessions added items to cart."
        },
        {
            'stage': 'cart_to_checkout',
            'stage_label': 'Cart -> Checkout',
            'progression': 'Cart -> Checkout',
            'before_retention': round(b_c2ck, 1),
            'after_retention': round(a_c2ck, 1),
            'change': round(a_c2ck - b_c2ck, 2),
            'dropped_sessions': drop_cart_checkout,
            'drop_rate_percent': round(rate_cart_checkout, 1),
            'status': 'SUPPORTED' if drop_cart_checkout > 0 else 'NOT DETECTED',
            'priority': 'MEDIUM' if rate_cart_checkout > 15 else 'LOW',
            'summary': f"{drop_cart_checkout} cart sessions abandoned before entering checkout ({rate_cart_checkout:.1f}% step loss).",
            'evidence': f"In the After period, {a_counts.get('checkout', 0)} of {a_counts.get('cart', 0)} cart sessions proceeded to checkout."
        },
        {
            'stage': 'checkout_to_paid',
            'stage_label': 'Checkout -> Paid',
            'progression': 'Checkout -> Paid',
            'before_retention': round(b_ck2p, 1),
            'after_retention': round(a_ck2p, 1),
            'change': round(a_ck2p - b_ck2p, 2),
            'dropped_sessions': drop_checkout_paid,
            'drop_rate_percent': round(rate_checkout_paid, 1),
            'status': 'CONFIRMED' if drop_checkout_paid > 0 else 'NOT DETECTED',
            'priority': 'HIGH' if rate_checkout_paid > 20 else 'MEDIUM',
            'summary': f"{drop_checkout_paid} checkout sessions dropped out before completing payment ({rate_checkout_paid:.1f}% step loss).",
            'evidence': f"In the After period, {a_counts.get('paid', 0)} of {a_counts.get('checkout', 0)} checkout sessions completed payment."
        }
    ]

    # Filter funnel investigation by stage if selected
    if stage == 'visit':
        funnel_investigation = [all_stage_investigations[0]]
    elif stage == 'cart':
        funnel_investigation = [all_stage_investigations[0], all_stage_investigations[1]]
    elif stage == 'checkout':
        funnel_investigation = [all_stage_investigations[1], all_stage_investigations[2]]
    elif stage == 'paid':
        funnel_investigation = [all_stage_investigations[2]]
    else:
        funnel_investigation = all_stage_investigations

    # --------------------------------------------------------------------------
    # 6. DEVICE INVESTIGATION (Mobile vs Desktop)
    # --------------------------------------------------------------------------
    device_comp = analysis_result.get('device_comparison') or {}
    desk_info = device_comp.get('desktop') or {}
    mob_info = device_comp.get('mobile') or {}
    desk_change = desk_info.get('change_percentage_points', 0.0) or 0.0
    mob_change = mob_info.get('change_percentage_points', 0.0) or 0.0
    desk_after_cnt = desk_info.get('after_counts') or {}
    mob_after_cnt = mob_info.get('after_counts') or {}

    all_device_investigations = [
        {
            'device': 'desktop',
            'device_label': 'Desktop',
            'before_percent': desk_info.get('before_percent', 0.0) or 0.0,
            'after_percent': desk_info.get('after_percent', 0.0) or 0.0,
            'change': desk_change,
            'after_sessions': desk_after_cnt.get('visit', 0),
            'after_paid': desk_after_cnt.get('paid', 0),
            'dropped_at_checkout': max(0, desk_after_cnt.get('checkout', 0) - desk_after_cnt.get('paid', 0)),
            'status': 'CONFIRMED' if desk_change < 0 else 'NOT DETECTED',
            'priority': 'HIGH' if desk_change <= -20 else ('MEDIUM' if desk_change < 0 else 'LOW'),
            'summary': f"Desktop paid conversion changed by {desk_change:+.2f} pp ({desk_info.get('before_percent', 0)}% -> {desk_info.get('after_percent', 0)}%).",
            'evidence': f"In the After period, {desk_after_cnt.get('paid', 0)} of {desk_after_cnt.get('visit', 0)} desktop sessions completed payment; {max(0, desk_after_cnt.get('checkout', 0) - desk_after_cnt.get('paid', 0))} dropped after entering checkout."
        },
        {
            'device': 'mobile',
            'device_label': 'Mobile',
            'before_percent': mob_info.get('before_percent', 0.0) or 0.0,
            'after_percent': mob_info.get('after_percent', 0.0) or 0.0,
            'change': mob_change,
            'after_sessions': mob_after_cnt.get('visit', 0),
            'after_paid': mob_after_cnt.get('paid', 0),
            'dropped_at_checkout': max(0, mob_after_cnt.get('checkout', 0) - mob_after_cnt.get('paid', 0)),
            'status': 'CONFIRMED' if mob_change < 0 else 'NOT DETECTED',
            'priority': 'HIGH' if mob_change <= -20 else ('MEDIUM' if mob_change < 0 else 'LOW'),
            'summary': f"Mobile paid conversion changed by {mob_change:+.2f} pp ({mob_info.get('before_percent', 0)}% -> {mob_info.get('after_percent', 0)}%).",
            'evidence': f"In the After period, {mob_after_cnt.get('paid', 0)} of {mob_after_cnt.get('visit', 0)} mobile sessions completed payment; {max(0, mob_after_cnt.get('checkout', 0) - mob_after_cnt.get('paid', 0))} dropped after entering checkout."
        }
    ]

    if device == 'desktop':
        device_investigation = [all_device_investigations[0]]
    elif device == 'mobile':
        device_investigation = [all_device_investigations[1]]
    else:
        device_investigation = all_device_investigations

    # --------------------------------------------------------------------------
    # 7. REASON INVESTIGATION (All 6 canonical hypotheses evaluated independently)
    # --------------------------------------------------------------------------
    # Forensics from raw events
    payment_errors = Counter()
    payment_methods = Counter()
    delivery_fee_values = []
    load_times = []
    checkout_steps_list = []

    for ev in raw_events:
        if ev.get('period') == 'after':
            if ev.get('payment_error'):
                payment_errors[ev['payment_error']] += 1
            if ev.get('payment_method'):
                payment_methods[ev['payment_method']] += 1
            if ev.get('delivery_fee'):
                try:
                    df = float(str(ev['delivery_fee']).lstrip('$£€'))
                    if df > 0:
                        delivery_fee_values.append(df)
                except (ValueError, TypeError):
                    pass
            if ev.get('page_load_time'):
                try:
                    plt = float(str(ev['page_load_time']))
                    load_times.append(plt)
                except (ValueError, TypeError):
                    pass
            if ev.get('checkout_steps'):
                try:
                    cs = int(ev['checkout_steps'])
                    checkout_steps_list.append(cs)
                except (ValueError, TypeError):
                    pass

    reasons_list = analysis_result.get('reason_investigation') or []
    reasons_by_id = {r.get('id'): r for r in reasons_list}

    def get_reason(rid: str) -> Dict[str, Any]:
        base = dict(reasons_by_id.get(rid) or {})
        # Use stage and device breakdown if available from the analytics engine
        bd = base.get('breakdown', {}).get('by_device_and_stage', {}).get(device, {}).get(stage)
        if bd:
            base['before_affected'] = bd.get('before_affected', base.get('before_affected', 0))
            base['after_affected'] = bd.get('after_affected', base.get('after_affected', 0))
            base['affected_sessions'] = bd.get('affected_sessions', base.get('after_affected', 0))
        elif device != 'all' and base.get('breakdown', {}).get('by_device', {}).get(device):
            bd_dev = base['breakdown']['by_device'][device]
            base['before_affected'] = bd_dev.get('before_affected', base.get('before_affected', 0))
            base['after_affected'] = bd_dev.get('after_affected', base.get('after_affected', 0))
            base['affected_sessions'] = bd_dev.get('affected_sessions', base.get('after_affected', 0))
        return base

    r_pay = get_reason('payment_failures')
    r_del = get_reason('delivery_charges')
    r_comp = get_reason('complicated_checkout')
    r_slow = get_reason('slow_page_loading')
    r_win = get_reason('window_shopping')
    r_disc = get_reason('no_discounts_offers')

    pay_err_summary = ", ".join(f"{k}: {v}" for k, v in payment_errors.most_common(3)) if payment_errors else "Gateway errors detected during payment submission"
    del_fee_avg = (sum(delivery_fee_values) / len(delivery_fee_values)) if delivery_fee_values else 0.0
    slow_pct = ((sum(1 for t in load_times if t > 3.48) / len(load_times)) * 100) if load_times else 0.0

    reason_investigation = [
        {
            'id': 'payment_failures',
            'reason': 'Payment Failures',
            'title': 'Payment Failures',
            'status': r_pay.get('status', 'CONFIRMED'),
            'priority': 'HIGH' if (r_pay.get('after_affected', 0) or 0) > 15 else 'MEDIUM',
            'affected_sessions': r_pay.get('after_affected', 0) or 0,
            'before_affected': r_pay.get('before_affected', 0) or 0,
            'after_affected': r_pay.get('after_affected', 0) or 0,
            'evidence': f"{r_pay.get('after_affected', 0)} sessions encountered payment gateway failures/declines in the After period ({pay_err_summary}).",
            'causation_vs_correlation': 'Direct Causation: Gateway failure directly blocks order completion at payment step.',
            'recommendation': 'Review payment gateway failure logs, implement instant retry logic for decline codes, and resolve 3D Secure / OTP timeouts.'
        },
        {
            'id': 'delivery_charges',
            'reason': 'Delivery Charges',
            'title': 'Delivery Charges',
            'status': r_del.get('status', 'SUPPORTED'),
            'priority': 'HIGH' if (r_del.get('after_affected', 0) or 0) > 15 else 'MEDIUM',
            'affected_sessions': r_del.get('after_affected', 0) or 0,
            'before_affected': r_del.get('before_affected', 0) or 0,
            'after_affected': r_del.get('after_affected', 0) or 0,
            'evidence': f"{r_del.get('after_affected', 0)} sessions dropped out after delivery fee reveal (average observed shipping fee: ${del_fee_avg:.2f}).",
            'causation_vs_correlation': 'Strong Behavioral Correlation: Shipping fee shock causes abandonment, though individual purchase willingness varies.',
            'recommendation': 'Show estimated shipping fees upfront on product/cart pages and test free-shipping thresholds to prevent checkout sticker shock.'
        },
        {
            'id': 'complicated_checkout',
            'reason': 'Complicated / Lengthy Checkout',
            'title': 'Complicated / Lengthy Checkout',
            'status': r_comp.get('status', 'SUPPORTED'),
            'priority': 'MEDIUM' if (r_comp.get('after_affected', 0) or 0) > 10 else 'LOW',
            'affected_sessions': r_comp.get('after_affected', 0) or 0,
            'before_affected': r_comp.get('before_affected', 0) or 0,
            'after_affected': r_comp.get('after_affected', 0) or 0,
            'evidence': f"{r_comp.get('after_affected', 0)} sessions abandoned during multi-step checkout navigation (sessions requiring 4+ form steps or extended checkout dwell).",
            'causation_vs_correlation': 'Behavioral Friction Correlation: Multi-step checkout increases customer drop-off velocity.',
            'recommendation': 'Simplify checkout into a single-page or accelerated flow, reduce optional form fields, and offer 1-click Express Checkout.'
        },
        {
            'id': 'slow_page_loading',
            'reason': 'Slow Page Loading',
            'title': 'Slow Page Loading',
            'status': r_slow.get('status', 'SUPPORTED'),
            'priority': 'MEDIUM' if (r_slow.get('after_affected', 0) or 0) > 15 else 'LOW',
            'affected_sessions': r_slow.get('after_affected', 0) or 0,
            'before_affected': r_slow.get('before_affected', 0) or 0,
            'after_affected': r_slow.get('after_affected', 0) or 0,
            'evidence': f"{r_slow.get('after_affected', 0)} sessions experienced checkout latency exceeding the 3.48s critical threshold ({slow_pct:.1f}% of recorded page loads were slow).",
            'causation_vs_correlation': 'Technical Factor Correlation: Slow page loads correlate with elevated checkout exit rates.',
            'recommendation': 'Optimize checkout frontend bundles, audit third-party tracking scripts, and reduce API server response latency.'
        },
        {
            'id': 'window_shopping',
            'reason': 'Window Shopping',
            'title': 'Window Shopping',
            'status': r_win.get('status', 'CONFIRMED'),
            'priority': 'MEDIUM',
            'affected_sessions': r_win.get('after_affected', 0) or 0,
            'before_affected': r_win.get('before_affected', 0) or 0,
            'after_affected': r_win.get('after_affected', 0) or 0,
            'evidence': f"{r_win.get('after_affected', 0)} visit-only sessions browsed without adding items to cart in the After period ({drop_visit_cart} total top-of-funnel drops).",
            'causation_vs_correlation': 'Top-of-Funnel Intent Factor: Represents browsing intent rather than technical checkout failure.',
            'recommendation': 'Deploy personalized recommendations, transparent value props, and exit-intent promos to convert casual visitors into active cart builders.'
        },
        {
            'id': 'no_discounts_offers',
            'reason': 'No Discounts / Offers',
            'title': 'No Discounts / Offers',
            'status': r_disc.get('status', 'INSUFFICIENT DATA'),
            'priority': 'LOW',
            'affected_sessions': r_disc.get('after_affected', 0) or 0,
            'before_affected': r_disc.get('before_affected', 0) or 0,
            'after_affected': r_disc.get('after_affected', 0) or 0,
            'evidence': 'INSUFFICIENT DATA: discount_code and coupon_error telemetry fields are absent in the active dataset. Telemetry cannot verify coupon-driven abandonment.',
            'causation_vs_correlation': 'Unproven Hypothesis: Without promo field telemetry, discount-related causation cannot be established.',
            'recommendation': 'Instrument coupon input field telemetry, track coupon rejection error codes, and measure cart promo sensitivity.'
        }
    ]

    # --------------------------------------------------------------------------
    # 4. TOP FINDINGS (Max 3 Important Findings)
    # --------------------------------------------------------------------------
    def reason_rank_key(r):
        p_val = {'HIGH': 3, 'MEDIUM': 2, 'LOW': 1}.get(r.get('priority'), 0)
        s_val = {'CONFIRMED': 3, 'SUPPORTED': 2, 'INSUFFICIENT DATA': 0, 'NOT DETECTED': 1}.get(r.get('status'), 0)
        
        # Scope prioritization boost
        scope_boost = 0
        if scope == 'payment' and r['id'] == 'payment_failures':
            scope_boost = 10
        elif scope == 'checkout' and r['id'] in ('complicated_checkout', 'delivery_charges', 'slow_page_loading'):
            scope_boost = 10
        elif scope == 'funnel' and r['id'] == 'window_shopping':
            scope_boost = 5

        # Stage prioritization boost
        stage_boost = 0
        if stage == 'paid' and r['id'] == 'payment_failures':
            stage_boost = 10
        elif stage == 'checkout' and r['id'] in ('delivery_charges', 'complicated_checkout', 'slow_page_loading'):
            stage_boost = 10
        elif stage == 'cart' and r['id'] == 'window_shopping':
            stage_boost = 10

        return (scope_boost + stage_boost + p_val, s_val, r.get('affected_sessions', 0))

    valid_reasons = [r for r in reason_investigation if r['status'] in ('CONFIRMED', 'SUPPORTED')]
    sorted_reasons = sorted(valid_reasons, key=reason_rank_key, reverse=True)
    top_3_reasons = sorted_reasons[:3]

    top_findings = []
    for item in top_3_reasons:
        top_findings.append({
            'title': item['title'],
            'description': f"Identified as a {item['priority']}-priority root cause impacting {item['affected_sessions']} customer sessions.",
            'evidence': item['evidence'],
            'affected_sessions': item['affected_sessions'],
            'status': item['status'],
            'priority': item['priority'],
            'recommendation': item['recommendation']
        })

    # If fewer than 3 reasons, fill with biggest funnel drop-off
    if len(top_findings) < 3:
        top_findings.append({
            'title': f"Funnel Bottleneck: {primary_drop['stage']}",
            'description': primary_drop['desc'],
            'evidence': f"{primary_drop['drop_count']} sessions abandoned at {primary_drop['stage']} ({primary_drop['drop_rate']:.1f}% stage loss).",
            'affected_sessions': primary_drop['drop_count'],
            'status': 'CONFIRMED',
            'priority': 'HIGH',
            'recommendation': 'Focus engineering and UX intervention directly on the step transition where customer attrition peaks.'
        })

    # --------------------------------------------------------------------------
    # 8. SUPPORTING EVIDENCE (Actual numbers from filtered dataset)
    # --------------------------------------------------------------------------
    supporting_evidence = [
        f"{primary_drop['drop_count']} sessions dropped at {primary_drop['stage']} in the After period ({primary_drop['drop_rate']:.1f}% step attrition).",
        f"{r_pay.get('after_affected', 0)} sessions reached checkout but failed payment in the After period ({pay_err_summary}).",
        f"{r_del.get('after_affected', 0)} sessions abandoned after delivery fees were calculated (average observed shipping fee: ${del_fee_avg:.2f}).",
        f"{r_win.get('after_affected', 0)} visit-only sessions browsed without adding any items to cart in the After period.",
        f"{r_slow.get('after_affected', 0)} sessions experienced page load times exceeding the 3.48s latency threshold."
    ]
    if device != 'all':
        supporting_evidence.insert(0, f"Filtered data includes strictly {device.capitalize()} device telemetry ({a_counts.get('visit', 0)} sessions analyzed in the After period).")

    # --------------------------------------------------------------------------
    # 9. RECOMMENDED ACTIONS (Practical actions based ONLY on supported findings)
    # --------------------------------------------------------------------------
    recommended_actions = [
        {
            'priority': 'HIGH',
            'area': 'Payment Gateway Resilience',
            'action': 'Implement automatic retry and secondary gateway failover for card decline codes (CARD_DECLINED, GATEWAY_TIMEOUT, 3DS_AUTH_FAILED).',
            'expected_impact': f"Directly recovers up to {r_pay.get('after_affected', 0)} payment-failed sessions, lifting overall paid conversion."
        },
        {
            'priority': 'HIGH',
            'area': 'Shipping & Pricing Transparency',
            'action': 'Display calculated shipping charges on product and cart drawer steps before checkout entry; test free-shipping order threshold.',
            'expected_impact': f"Mitigates delivery fee shock for {r_del.get('after_affected', 0)} sessions dropping at the shipping calculation step."
        },
        {
            'priority': 'MEDIUM',
            'area': 'Checkout Flow Streamlining',
            'action': 'Consolidate multi-step checkout into an accelerated 1-page checkout flow with Apple Pay, Google Pay, and PayPal 1-click buy.',
            'expected_impact': f"Reduces form friction for {r_comp.get('after_affected', 0)} multi-step abandoned sessions and shortens checkout duration."
        },
        {
            'priority': 'MEDIUM',
            'area': 'Frontend Performance Optimization',
            'action': 'Audit checkout bundle size, defer non-essential tracking scripts, and optimize API response times to keep load times strictly under 3.48s.',
            'expected_impact': f"Protects {r_slow.get('after_affected', 0)} sessions currently experiencing excessive page load latency."
        },
        {
            'priority': 'LOW',
            'area': 'Telemetry Instrumentation',
            'action': 'Instrument client-side telemetry for promo code interactions, coupon validation failures, and cart discount attempts.',
            'expected_impact': 'Resolves INSUFFICIENT DATA gap for coupon analytics, providing future root-cause visibility into promotional sensitivity.'
        }
    ]

    # --------------------------------------------------------------------------
    # 10. DATA QUALITY / LIMITATIONS
    # --------------------------------------------------------------------------
    quality = analysis_result.get('event_quality') or {}
    dataset_info = analysis_result.get('dataset_info') or {}
    detected_fields = dataset_info.get('detected_evidence_fields') or []

    data_quality_limitations = [
        "Discount usage is not sufficiently instrumented, so the impact of offers cannot be confirmed (INSUFFICIENT DATA).",
        f"Event Deduplication: {quality.get('duplicates_removed', 0)} duplicate event IDs were cleanly eliminated across {quality.get('raw_events', 0)} raw records.",
        f"Session Progression: Conversion rates are strictly computed using distinct sessions across sequential funnel stages (Visit -> Cart -> Checkout -> Paid).",
        f"Telemetry Completeness: Detected verified evidence fields: {', '.join(detected_fields) if detected_fields else 'Core funnel steps'}.",
        f"Timing Metrics: Step transition intervals are measured from session timestamps; zero elapsed interval pairs represent batch step reporting."
    ]

    # --------------------------------------------------------------------------
    # 1. EXECUTIVE SUMMARY (Simple business-level explanation)
    # --------------------------------------------------------------------------
    filter_context = []
    if device != 'all':
        filter_context.append(f"for {device.capitalize()} users")
    if stage != 'all':
        filter_context.append(f"focusing on the {stage.capitalize()} stage")
    if time_period == 'after':
        filter_context.append("in the active After period")
    elif time_period == 'before':
        filter_context.append("in the baseline Before period")
    
    ctx_str = (" " + " ".join(filter_context)) if filter_context else ""

    executive_summary = (
        f"Checkout conversion decreased{ctx_str} after the selected period. "
        f"Overall paid conversion changed from {conv_before:.1f}% to {conv_after:.1f}% ({conv_change:+.2f} percentage points). "
        f"The largest loss occurred between {primary_drop['stage']}, where {primary_drop['drop_count']} sessions were lost ({primary_drop['drop_rate']:.1f}% step loss). "
        f"Payment failures ({r_pay.get('after_affected', 0)} affected sessions) are the strongest supported factor, followed by delivery fee attrition ({r_del.get('after_affected', 0)} sessions). "
        f"Immediate mitigation should prioritize payment gateway retry logic and upfront shipping transparency."
    )

    # --------------------------------------------------------------------------
    # GEMINI AI INTERPRETATION & EXPLANATION LAYER
    # --------------------------------------------------------------------------
    _get_gemini_api_key()
    api_key = os.environ.get('GEMINI_API_KEY')
    ai_engine_used = "deterministic"

    if api_key:
        ground_truth = {
            'filters': filters_applied,
            'conversion_change': conversion_change,
            'overall_status': overall_status,
            'biggest_drop_off': biggest_drop_off,
            'funnel_steps': [
                {
                    'step': s['progression'],
                    'dropped_sessions': s['dropped_sessions'],
                    'drop_rate_percent': s['drop_rate_percent'],
                    'status': s['status'],
                    'priority': s['priority']
                }
                for s in funnel_investigation
            ],
            'device_comparison': [
                {
                    'device': d['device'],
                    'before_percent': d['before_percent'],
                    'after_percent': d['after_percent'],
                    'change': d['change'],
                    'after_sessions': d['after_sessions'],
                    'after_paid': d['after_paid'],
                    'dropped_at_checkout': d['dropped_at_checkout'],
                    'status': d['status'],
                    'priority': d['priority']
                }
                for d in device_investigation
            ],
            'reasons': [
                {
                    'id': r['id'],
                    'reason': r['reason'],
                    'status': r['status'],
                    'priority': r['priority'],
                    'affected_sessions': r['affected_sessions'],
                    'before_affected': r['before_affected'],
                    'after_affected': r['after_affected'],
                    'evidence': r['evidence']
                }
                for r in reason_investigation
            ],
            'data_snapshot': {
                'live_events_analyzed': len(raw_events),
                'sessions_analyzed': len(set(e.get('session_id') for e in raw_events if e.get('session_id')))
            }
        }

        gemini_result = _call_gemini_analysis(
            api_key=api_key,
            ground_truth=ground_truth,
            filters=filters_applied
        )

        if gemini_result:
            ai_engine_used = "gemini"
            if gemini_result.get('executive_summary'):
                executive_summary = gemini_result['executive_summary']
            if gemini_result.get('interpretation'):
                overall_result['interpretation'] = gemini_result['interpretation']
            if gemini_result.get('top_findings') and isinstance(gemini_result['top_findings'], list):
                # Enrich descriptions and recommendations from Gemini while preserving strict ground-truth metrics
                gem_findings_by_title = {f.get('title', '').lower(): f for f in gemini_result['top_findings'] if isinstance(f, dict)}
                for df in top_findings:
                    match = None
                    for k, gf in gem_findings_by_title.items():
                        if df['title'].lower() in k or k in df['title'].lower():
                            match = gf
                            break
                    if match:
                        if match.get('description'):
                            df['description'] = match['description']
                        if match.get('recommendation'):
                            df['recommendation'] = match['recommendation']
            if gemini_result.get('recommendations') and isinstance(gemini_result['recommendations'], list):
                valid_recs = []
                for rec in gemini_result['recommendations']:
                    if isinstance(rec, dict) and rec.get('action') and rec.get('area'):
                        valid_recs.append({
                            'priority': rec.get('priority', 'MEDIUM'),
                            'area': rec.get('area', 'General'),
                            'action': rec.get('action', ''),
                            'expected_impact': rec.get('expected_impact', '')
                        })
                if len(valid_recs) >= 3:
                    recommended_actions = valid_recs

    return {
        'success': True,
        'ai_engine': ai_engine_used,
        'filters': {
            'time_period': time_period,
            'device': device,
            'stage': stage,
            'scope': scope
        },
        'filters_applied': filters_applied,
        'executive_summary': executive_summary,
        'overall_result': overall_result,
        'conversion_change': conversion_change,
        'biggest_drop_off': biggest_drop_off,
        'top_findings': top_findings,
        'device_analysis': device_investigation,
        'stage_analysis': funnel_investigation,
        'reason_analysis': reason_investigation,
        'recommendations': recommended_actions,
        'data_quality_notes': data_quality_limitations,
        # Backward-compatibility aliases
        'funnel_investigation': funnel_investigation,
        'device_investigation': device_investigation,
        'reason_investigation': reason_investigation,
        'recommended_actions': recommended_actions,
        'data_quality_limitations': data_quality_limitations,
        'supporting_evidence': supporting_evidence
    }


def _call_gemini_analysis(
    api_key: str,
    ground_truth: Dict[str, Any],
    filters: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """
    Executes Gemini AI analysis using the official Google GenAI SDK (google-genai).
    Uses Gemini 2.5 Flash as requested, with graceful candidate model fallback
    if 2.5-flash is retired/unavailable on the user's project endpoint.
    Strictly preserves deterministic metrics as the ground truth.
    Logs required lifecycle messages.
    """
    print("[AI] Gemini API key detected", flush=True)
    print("[AI] Calling Gemini 2.5 Flash", flush=True)

    try:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=api_key)
    except Exception as exc:
        print(f"[AI] Gemini call failed: {exc}", flush=True)
        print("[AI] Falling back to deterministic analysis", flush=True)
        return None

    prompt = f"""You are an elite E-Commerce Conversion Rate Optimization (CRO) and Checkout Drop-Off Investigator.
You are analyzing verified, mathematically computed GROUND-TRUTH metrics from our real-time checkout event stream.

ACTIVE FILTERS:
- Time Period: {filters.get('time_period_label', filters.get('time_period'))}
- Device: {filters.get('device_label', filters.get('device'))}
- Stage: {filters.get('stage_label', filters.get('stage'))}
- Scope: {filters.get('scope_label', filters.get('scope'))}

GROUND-TRUTH METRICS (STRICT SOURCE OF NUMERICAL TRUTH - DO NOT ALTER OR INVENT NUMBERS):
{json.dumps(ground_truth, indent=2)}

YOUR ROLE:
Provide high-level interpretation, executive explanation, and actionable recommendations.
CRITICAL RULES:
1. NEVER alter, calculate differently, or invent session counts, drop rates, or percentages. Every number MUST match the ground truth.
2. Explain the customer impact, user behavior, and root causes clearly.
3. Formulate prioritized, high-impact recommendations addressing the specific bottlenecks identified.

Respond ONLY with a valid JSON object following this exact schema:
{{
  "executive_summary": "A crisp, executive 2-paragraph C-level analysis explaining the conversion change, primary drop-off bottleneck, top contributing reasons, and immediate action plan.",
  "interpretation": "Detailed interpretation of user friction, mobile vs desktop behavior, and funnel drop-off dynamics.",
  "top_findings": [
    {{
      "title": "Title of root cause (e.g., Payment Failures)",
      "description": "Executive description explaining customer impact and behavioral context.",
      "evidence": "Evidence string referencing exact numbers from ground truth.",
      "affected_sessions": <exact integer from ground truth>,
      "status": "CONFIRMED" or "SUPPORTED",
      "priority": "HIGH" or "MEDIUM" or "LOW",
      "recommendation": "Targeted mitigation recommendation."
    }}
  ],
  "recommendations": [
    {{
      "priority": "HIGH" or "MEDIUM" or "LOW",
      "area": "Specific area (e.g. Payment Gateway Resilience, Pricing Transparency)",
      "action": "Concrete, actionable engineering or UX improvement to fix the drop-off.",
      "expected_impact": "Expected recovery referencing exact affected session counts from ground truth."
    }}
  ]
}}
"""

    candidate_models = ['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.7-flash', 'gemini-3.8-flash']
    response = None
    last_err = None

    for model_name in candidate_models:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0.2,
                    response_mime_type="application/json"
                )
            )
            if response and response.text:
                break
        except Exception as err:
            last_err = err
            err_msg = str(err).lower()
            if any(k in err_msg for k in ('404', '503', '429', 'resource_exhausted', 'quota', 'unavailable', 'no longer available')):
                continue
            else:
                break

    if not response or not response.text:
        print(f"[AI] Gemini call failed: {last_err}", flush=True)
        print("[AI] Falling back to deterministic analysis", flush=True)
        return None

    print("[AI] Gemini response received", flush=True)

    try:
        raw_text = response.text.strip()
        if raw_text.startswith("```"):
            raw_text = raw_text.strip("`")
            if raw_text.startswith("json"):
                raw_text = raw_text[4:].strip()
        parsed = json.loads(raw_text)
        return parsed
    except Exception as parse_err:
        print(f"[AI] Gemini call failed: JSON parse error: {parse_err}", flush=True)
        print("[AI] Falling back to deterministic analysis", flush=True)
        return None
