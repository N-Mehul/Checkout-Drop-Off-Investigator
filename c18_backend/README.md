# C18 Checkout Drop-Off Investigator — Backend

This is a backend-only Flask starter for the engineering part of C18. It uses the original supplied synthetic `fixture.json` and computes funnel metrics from the event records. It does not include a frontend or database.

## Files
- `app.py` — Flask API and funnel calculations
- `fixture.json` — the original C18 fixture supplied in the conversation (not recreated or fabricated)
- `requirements.txt` — Python dependency

## Run locally
```bash
python -m venv .venv
# Windows PowerShell: .venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open `http://127.0.0.1:5000/api/analysis` to see the computed analysis. The server binds to `0.0.0.0` and uses the `PORT` environment variable when provided.

## API
- `GET /api/analysis` — analyze the built-in fixture and compare computed metrics with `records.expected`.
- `POST /api/upload` — upload a `.csv` or `.json` file as multipart form field `file`. JSON may be an array of events, an object with `events`, or the supplied fixture shape with `records.events`. Required event fields: `event_id`, `session_id`, `step`, `device`, and `time` or `event_time`.

## Important methodology
- De-duplicates by `event_id`.
- Funnel progression is `visit → cart → checkout → paid`; timestamp ties do not determine order.
- Assigns sessions to the date of their first visit event.
- A session counts as reaching a step only if all earlier steps are present.
- Reports absent `payment_method` instrumentation rather than inventing payment segments.
- Labels the fixture synthetic and any possible explanation as a hypothesis, not a proven cause.

## Scope / limitations
This is the backend phase only. The dashboard/frontend is intentionally not included. The fixture is a small teaching dataset, not evidence of real-world market demand or production performance.
