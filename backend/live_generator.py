from __future__ import annotations
import random
import threading
import time
import uuid
from datetime import datetime, timedelta
from database.repository import repository

_generator_thread = None
_generator_running = False
_thread_lock = threading.Lock()


def generate_single_session_events() -> list:
    """
    Generate a realistic sequence of events for a single checkout session.
    Simulates real-world customer behavior with realistic drop-offs:
      - Some drop off at visit (Window Shopping)
      - Some drop off at cart
      - Some drop off at checkout (delivery charges, slow loading, lengthy steps)
      - Some fail payment (gateway decline / errors)
      - Some successfully complete (paid)
    """
    events = []
    sid = f"s_live_{int(time.time() * 1000) % 1000000}_{random.randint(10, 99)}"
    device = random.choices(['desktop', 'mobile'], weights=[0.55, 0.45])[0]
    period = 'after'  # Live incoming traffic streams into the After period
    now = datetime.now()

    # 1. Visit Event
    # Realistic page load time: mostly normal (1.4s - 2.8s), ~20% slow (> 3.48s threshold)
    is_slow = random.random() < 0.20
    load_time = round(random.uniform(3.55, 5.25), 2) if is_slow else round(random.uniform(1.20, 2.90), 2)
    t_visit = now.strftime("%Y-%m-%d %H:%M:%S")

    ev_visit = {
        'event_id': f"evt_{uuid.uuid4().hex[:8]}",
        'session_id': sid,
        'step': 'visit',
        'event_name': 'visit',
        'device': device,
        'time': t_visit,
        'period': period,
        'page_load_time': str(load_time)
    }
    events.append(ev_visit)

    # Progression Check: Visit -> Cart
    # ~18% drop off at Visit (Window Shopping: visit only, never reaches cart)
    proceeds_to_cart = random.random() < 0.82
    if not proceeds_to_cart:
        return events

    # 2. Cart Event
    t_cart = (now + timedelta(seconds=random.randint(12, 35))).strftime("%Y-%m-%d %H:%M:%S")
    ev_cart = {
        'event_id': f"evt_{uuid.uuid4().hex[:8]}",
        'session_id': sid,
        'step': 'cart',
        'event_name': 'cart',
        'device': device,
        'time': t_cart,
        'period': period
    }
    events.append(ev_cart)

    # Progression Check: Cart -> Checkout
    # ~22% drop off at Cart (abandoned cart, comparison browsing)
    proceeds_to_checkout = random.random() < 0.78
    if not proceeds_to_checkout:
        return events

    # 3. Checkout Event
    t_chk = (now + timedelta(seconds=random.randint(40, 85))).strftime("%Y-%m-%d %H:%M:%S")
    delivery_fee = random.choices([0.0, 4.99, 9.99, 14.99], weights=[0.40, 0.35, 0.15, 0.10])[0]
    checkout_steps = random.choices([2, 3, 4, 5], weights=[0.45, 0.35, 0.12, 0.08])[0]
    checkout_time = random.choices([22.0, 36.0, 52.0, 78.0], weights=[0.45, 0.35, 0.12, 0.08])[0]

    ev_checkout = {
        'event_id': f"evt_{uuid.uuid4().hex[:8]}",
        'session_id': sid,
        'step': 'checkout',
        'event_name': 'checkout',
        'device': device,
        'time': t_chk,
        'period': period,
        'delivery_fee': str(delivery_fee),
        'checkout_steps': str(checkout_steps),
        'checkout_time': str(checkout_time)
    }
    events.append(ev_checkout)

    # Progression Check: Checkout -> Paid
    # Outcomes:
    #   62%: Successful payment
    #   26%: Payment failure / decline
    #   12%: Abandoned at checkout without payment
    outcome = random.choices(['success', 'payment_fail', 'abandon_checkout'], weights=[0.62, 0.26, 0.12])[0]

    if outcome == 'success':
        t_paid = (now + timedelta(seconds=random.randint(90, 130))).strftime("%Y-%m-%d %H:%M:%S")
        pm = random.choice(['credit_card', 'paypal', 'apple_pay'])
        ev_paid = {
            'event_id': f"evt_{uuid.uuid4().hex[:8]}",
            'session_id': sid,
            'step': 'paid',
            'event_name': 'paid',
            'device': device,
            'time': t_paid,
            'period': period,
            'payment_method': pm,
            'payment_status': 'paid'
        }
        events.append(ev_paid)
    elif outcome == 'payment_fail':
        # Customer entered payment details but gateway returned a decline/error
        pm = random.choice(['credit_card', 'paypal'])
        error_code = random.choice(['CARD_DECLINED', 'GATEWAY_TIMEOUT', 'INSUFFICIENT_FUNDS', '3DS_AUTH_FAILED'])
        ev_checkout['payment_method'] = pm
        ev_checkout['payment_status'] = 'failed'
        ev_checkout['payment_error'] = error_code
    else:
        # Abandoned checkout before payment
        if checkout_steps >= 4 or checkout_time > 60:
            ev_checkout['checkout_error'] = 'LENGTHY_STEP_ABANDON'

    return events


def _generator_worker(interval_seconds: float = 3.0):
    """Background daemon loop generating live checkout traffic."""
    global _generator_running
    while _generator_running:
        try:
            session_events = generate_single_session_events()
            repository.add_events(session_events)
        except Exception as e:
            print(f"[LiveGenerator] Error generating session: {e}")
        time.sleep(interval_seconds)


def start_live_generator(interval_seconds: float = 3.0):
    """Start background live event generator daemon thread."""
    global _generator_thread, _generator_running
    with _thread_lock:
        if _generator_running and _generator_thread and _generator_thread.is_alive():
            return
        _generator_running = True
        _generator_thread = threading.Thread(
            target=_generator_worker,
            args=(interval_seconds,),
            daemon=True,
            name="LiveEventGenerator"
        )
        _generator_thread.start()
        print("[LiveGenerator] Started background live event stream (interval: 3s).")


def stop_live_generator():
    """Stop the background live event generator."""
    global _generator_running
    with _thread_lock:
        _generator_running = False


def is_generator_running() -> bool:
    """Return whether the live generator thread is currently active."""
    return _generator_running and _generator_thread is not None and _generator_thread.is_alive()
