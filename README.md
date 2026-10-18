# Checkout Drop-Off Investigator

An enterprise-grade, evidence-driven analytics dashboard for investigating e-commerce checkout funnel drop-offs, identifying declining user segments, and evaluating telemetry-backed drop-off causes.

---

## 📁 Architecture & Folder Organization

The application is modularized into four clean layers: `frontend`, `backend`, `connectivity`, and `database`.

```
Checkout-Drop-Off-Investigator/
├── frontend/               # User interface, styles, charts, and presentation layer
│   ├── static/
│   │   ├── css/style.css           # Premium responsive dashboard styles
│   │   ├── js/dashboard.js         # Interactive filtering, metrics & reason logic
│   │   └── vendor/chart.umd.min.js # Chart.js rendering engine
│   └── templates/
│       └── index.html              # HTML5 dashboard template
│
├── backend/                # Core calculation engine & Flask application factory
│   ├── __init__.py
│   ├── analytics_engine.py # Funnel metrics, segmentation & 6-reason analysis
│   └── app.py              # Application factory with static & template binding
│
├── connectivity/           # API routes, connectors, CORS, and request handlers
│   ├── __init__.py
│   ├── api_routes.py       # REST API endpoints (/api/analysis, /api/upload, etc.)
│   └── connector.py        # CORS setup, standard responses & system info
│
├── database/               # Data access layer, event normalization & datasets
│   ├── __init__.py
│   ├── repository.py       # DatasetRepository, upload parsing & schema mapping
│   └── data/
│       ├── fixture.json                   # Default benchmark event dataset
│       ├── c18_checkout_test_dataset.json # Rich telemetry dataset with reasons
│       ├── analysis.json                  # Pre-computed reference analysis
│       └── analysis_output.json           # Sample analysis export
│
├── run.py                  # Root application entry point
├── requirements.txt        # Python package dependencies
├── .gitignore              # Git ignore rules for virtualenv and cache files
└── README.md               # Project documentation
```

---

## 🚀 Quick Start

### 1. Set Up Environment
```bash
# Using existing or newly created virtual environment
python -m venv .venv

# Activate on Windows
.venv\Scripts\activate

# Install requirements
pip install -r requirements.txt
```

### 2. Run the Application
```bash
python run.py
```
Open your browser and navigate to:
👉 **`http://127.0.0.1:5000`**

---

## 🔍 Features & Capabilities

- **Interactive Stage Focus:** Filter by **Visit**, **Cart**, **Checkout**, or **Paid** to recalculate all KPIs and step conversion rates dynamically.
- **Device Segmentation:** Compare Desktop vs. Mobile funnel progression and isolate declining segments.
- **Period Comparison:** Switch between **Before**, **After**, or **Comparison** time horizons.
- **Possible Reasons & Supporting Evidence:** 6 distinct, independent cards:
  1. *Payment Failures* (Gateway errors, decline codes)
  2. *Delivery Charges* (Drop-offs correlated with shipping fees)
  3. *Complicated / Lengthy Checkout* (Step count & duration thresholds)
  4. *Slow Page Loading* (Latency exceeding 3.48s baseline threshold)
  5. *Window Shopping* (Browsing/comparison intent without cart addition)
  6. *No Discounts / Offers* (Promotional/coupon abandonment)
- **Dataset Upload & Reset:** Drag and drop custom CSV or JSON datasets directly via the web UI.

---

## 📡 API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/` | Web dashboard user interface |
| `GET` | `/api/analysis` | Full funnel & reason analysis for active dataset |
| `POST` | `/api/upload` | Upload custom CSV or JSON dataset |
| `POST` | `/api/reset` | Reset to default benchmark fixture |
| `GET` | `/api/reasons` | Summary of the 6 drop-off reason evaluations |
| `GET` | `/api/health` | Service connectivity status and metadata |
| `GET` | `/api/export` | Download analysis results as JSON |