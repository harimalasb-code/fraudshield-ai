"""FraudShield AI - FastAPI backend.

Serves real RandomForest predictions for single transactions and uploaded
datasets, persists everything to SQLite, and exposes live analytics for the
dashboard. No prediction value is hardcoded -- every output comes from the
trained model in model.pkl.
"""
import io
import json
import os

import joblib
import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import database as db

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(BASE_DIR)
MODEL_PATH = os.path.join(BASE_DIR, "model.pkl")
META_PATH = os.path.join(BASE_DIR, "model_meta.json")
FRONTEND_DIR = os.path.join(ROOT_DIR, "frontend")

FEATURES = ["amount", "location", "device", "time"]

app = FastAPI(title="FraudShield AI", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_model = None
_meta = {}


def load_model():
    global _model, _meta
    if not os.path.exists(MODEL_PATH):
        raise RuntimeError(
            "model.pkl not found. Train it first: python model/train.py"
        )
    _model = joblib.load(MODEL_PATH)
    if os.path.exists(META_PATH):
        with open(META_PATH) as f:
            _meta = json.load(f)


@app.on_event("startup")
def _startup():
    db.init_db()
    load_model()


def risk_level_from_score(score: float) -> str:
    if score < 40:
        return "LOW"
    if score < 70:
        return "MEDIUM"
    return "HIGH"


class TransactionIn(BaseModel):
    amount: float = Field(..., ge=0)
    location: str
    device: str
    time: int = Field(..., ge=0, le=23)


@app.get("/")
def root():
    return {"service": "FraudShield AI", "status": "online", "model": bool(_model)}


@app.get("/meta")
def meta():
    """Expose model metadata + known categories for the frontend."""
    return {
        "locations": _meta.get("locations", []),
        "devices": _meta.get("devices", []),
        "accuracy": _meta.get("accuracy"),
        "roc_auc": _meta.get("roc_auc"),
        "fraud_rate": _meta.get("fraud_rate"),
    }


@app.post("/predict")
def predict(tx: TransactionIn):
    if _model is None:
        raise HTTPException(503, "Model not loaded")

    X = pd.DataFrame([{f: getattr(tx, f) for f in FEATURES}])
    proba = float(_model.predict_proba(X)[0, 1])
    pred = int(_model.predict(X)[0])
    risk_score = round(proba * 100, 2)
    label = "Fraud" if pred == 1 else "Normal"
    level = risk_level_from_score(risk_score)

    tx_id = db.insert_transaction(
        amount=tx.amount,
        location=tx.location,
        device=tx.device,
        time_hour=tx.time,
        prediction=label,
        risk_score=risk_score,
        risk_level=level,
        source="single",
    )

    return {
        "id": tx_id,
        "prediction": label,
        "risk_score": risk_score,
        "risk_level": level,
    }


@app.post("/analyze-dataset")
async def analyze_dataset(file: UploadFile = File(...)):
    if _model is None:
        raise HTTPException(503, "Model not loaded")

    raw = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(raw))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"Could not parse CSV: {exc}")

    missing = [c for c in FEATURES if c not in df.columns]
    if missing:
        raise HTTPException(
            400,
            f"CSV missing required columns: {missing}. "
            f"Required: {FEATURES}",
        )

    if df.empty:
        raise HTTPException(400, "CSV contains no rows")

    X = df[FEATURES].copy()
    proba = _model.predict_proba(X)[:, 1]
    preds = _model.predict(X)

    df_out = X.copy()
    df_out["risk_score"] = (proba * 100).round(2)
    df_out["prediction"] = ["Fraud" if p == 1 else "Normal" for p in preds]
    df_out["risk_level"] = df_out["risk_score"].apply(risk_level_from_score)

    total = int(len(df_out))
    fraud_count = int((df_out["prediction"] == "Fraud").sum())
    normal_count = total - fraud_count
    fraud_pct = round(fraud_count / total * 100, 2)
    avg_risk = round(float(df_out["risk_score"].mean()), 2)

    rows = []
    for _, r in df_out.iterrows():
        amt = None if pd.isna(r["amount"]) else float(r["amount"])
        hour = None if pd.isna(r["time"]) else int(r["time"])
        rows.append(
            {
                "amount": amt,
                "location": None if pd.isna(r["location"]) else str(r["location"]),
                "device": None if pd.isna(r["device"]) else str(r["device"]),
                "time": hour,
                "prediction": r["prediction"],
                "risk_score": float(r["risk_score"]),
                "risk_level": r["risk_level"],
                "source": "dataset",
            }
        )
    db.insert_many(rows)

    top5 = (
        df_out.sort_values("risk_score", ascending=False)
        .head(5)
        .to_dict(orient="records")
    )
    for t in top5:
        if pd.isna(t.get("amount")):
            t["amount"] = None

    return {
        "total_records": total,
        "fraud_count": fraud_count,
        "normal_count": normal_count,
        "fraud_percentage": fraud_pct,
        "avg_risk_score": avg_risk,
        "high_risk_transactions": top5,
    }


@app.get("/stats")
def stats():
    return db.get_stats()


@app.get("/hourly")
def hourly():
    return db.get_hourly_traffic()


@app.get("/transactions")
def transactions(limit: int | None = None):
    return db.get_transactions(limit)


@app.get("/report")
def report():
    """Download full transaction history as CSV (bonus feature)."""
    rows = db.get_transactions()
    df = pd.DataFrame(rows)
    if df.empty:
        df = pd.DataFrame(
            columns=[
                "id", "amount", "location", "device", "time",
                "prediction", "risk_score", "risk_level", "source", "timestamp",
            ]
        )
    buf = io.StringIO()
    df.to_csv(buf, index=False)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=fraudshield_report.csv"},
    )


# Serve the frontend (mounted last so API routes take priority).
if os.path.isdir(FRONTEND_DIR):
    app.mount("/app", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

    @app.get("/ui")
    def ui_redirect():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
