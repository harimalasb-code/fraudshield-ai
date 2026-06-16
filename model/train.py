"""Train the FraudShield AI fraud-detection model.

Pipeline = preprocessing (impute + scale + one-hot encode) + RandomForest.
The entire fitted Pipeline is serialized to backend/model.pkl so the API can
call model.predict() / model.predict_proba() on raw input with no duplicated
preprocessing logic.

Usage:
    python model/train.py
"""
import json
import os

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_PATH = os.path.join(ROOT, "data", "dataset.csv")
MODEL_PATH = os.path.join(ROOT, "backend", "model.pkl")
META_PATH = os.path.join(ROOT, "backend", "model_meta.json")

NUMERIC_FEATURES = ["amount", "time"]
CATEGORICAL_FEATURES = ["location", "device"]
FEATURES = NUMERIC_FEATURES + CATEGORICAL_FEATURES
TARGET = "is_fraud"


def build_pipeline() -> Pipeline:
    numeric = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
        ]
    )
    categorical = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("onehot", OneHotEncoder(handle_unknown="ignore")),
        ]
    )
    preprocess = ColumnTransformer(
        transformers=[
            ("num", numeric, NUMERIC_FEATURES),
            ("cat", categorical, CATEGORICAL_FEATURES),
        ]
    )
    model = RandomForestClassifier(
        n_estimators=300,
        max_depth=14,
        min_samples_leaf=2,
        class_weight="balanced",
        n_jobs=-1,
        random_state=42,
    )
    return Pipeline(steps=[("preprocess", preprocess), ("model", model)])


def main() -> None:
    if not os.path.exists(DATA_PATH):
        raise SystemExit(
            f"Dataset not found at {DATA_PATH}. "
            f"Run: python data/generate_dataset.py"
        )

    df = pd.read_csv(DATA_PATH)
    missing = [c for c in FEATURES + [TARGET] if c not in df.columns]
    if missing:
        raise SystemExit(f"Dataset missing required columns: {missing}")

    X = df[FEATURES]
    y = df[TARGET].astype(int)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=42
    )

    pipe = build_pipeline()
    pipe.fit(X_train, y_train)

    preds = pipe.predict(X_test)
    proba = pipe.predict_proba(X_test)[:, 1]
    acc = accuracy_score(y_test, preds)
    auc = roc_auc_score(y_test, proba)

    print(f"Accuracy: {acc:.4f}")
    print(f"ROC-AUC : {auc:.4f}")
    print(classification_report(y_test, preds, digits=3))

    os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
    joblib.dump(pipe, MODEL_PATH)

    meta = {
        "features": FEATURES,
        "numeric_features": NUMERIC_FEATURES,
        "categorical_features": CATEGORICAL_FEATURES,
        "target": TARGET,
        "accuracy": round(float(acc), 4),
        "roc_auc": round(float(auc), 4),
        "n_train": int(len(X_train)),
        "n_test": int(len(X_test)),
        "fraud_rate": round(float(y.mean()), 4),
        "locations": sorted(df["location"].dropna().unique().tolist()),
        "devices": sorted(df["device"].dropna().unique().tolist()),
    }
    with open(META_PATH, "w") as f:
        json.dump(meta, f, indent=2)

    print(f"\nSaved model -> {MODEL_PATH}")
    print(f"Saved meta  -> {META_PATH}")


if __name__ == "__main__":
    main()
