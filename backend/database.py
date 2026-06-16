"""SQLite persistence layer for FraudShield AI."""
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fraudshield.db")


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS transactions (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                amount      REAL,
                location    TEXT,
                device      TEXT,
                time        INTEGER,
                prediction  TEXT,
                risk_score  REAL,
                risk_level  TEXT,
                source      TEXT,
                timestamp   TEXT
            )
            """
        )


def insert_transaction(
    amount: float,
    location: str,
    device: str,
    time_hour: int,
    prediction: str,
    risk_score: float,
    risk_level: str,
    source: str = "single",
) -> int:
    ts = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO transactions
                (amount, location, device, time, prediction, risk_score,
                 risk_level, source, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                amount,
                location,
                device,
                time_hour,
                prediction,
                risk_score,
                risk_level,
                source,
                ts,
            ),
        )
        return int(cur.lastrowid)


def insert_many(rows: list[dict]) -> None:
    ts = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        conn.executemany(
            """
            INSERT INTO transactions
                (amount, location, device, time, prediction, risk_score,
                 risk_level, source, timestamp)
            VALUES (:amount, :location, :device, :time, :prediction,
                    :risk_score, :risk_level, :source, :timestamp)
            """,
            [{**r, "timestamp": ts} for r in rows],
        )


def get_stats() -> dict:
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT
                COUNT(*) AS total_processed,
                COALESCE(SUM(CASE WHEN prediction = 'Fraud' THEN 1 ELSE 0 END), 0)
                    AS fraud_detected,
                COALESCE(SUM(CASE WHEN prediction = 'Normal' THEN 1 ELSE 0 END), 0)
                    AS normal_count,
                COALESCE(AVG(risk_score), 0) AS avg_risk_score
            FROM transactions
            """
        ).fetchone()
        return {
            "total_processed": int(row["total_processed"]),
            "fraud_detected": int(row["fraud_detected"]),
            "normal_count": int(row["normal_count"]),
            "avg_risk_score": round(float(row["avg_risk_score"]), 2),
        }


def get_hourly_traffic() -> list[dict]:
    """Aggregate total vs fraud counts by transaction hour (0-23)."""
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT time AS hour,
                   COUNT(*) AS total,
                   SUM(CASE WHEN prediction = 'Fraud' THEN 1 ELSE 0 END) AS fraud
            FROM transactions
            WHERE time IS NOT NULL
            GROUP BY time
            ORDER BY time
            """
        ).fetchall()
        by_hour = {int(r["hour"]): r for r in rows}
        out = []
        for h in range(24):
            r = by_hour.get(h)
            out.append(
                {
                    "hour": h,
                    "total": int(r["total"]) if r else 0,
                    "fraud": int(r["fraud"]) if r else 0,
                }
            )
        return out


def get_transactions(limit: int | None = None) -> list[dict]:
    sql = "SELECT * FROM transactions ORDER BY id DESC"
    if limit:
        sql += f" LIMIT {int(limit)}"
    with get_conn() as conn:
        rows = conn.execute(sql).fetchall()
        return [dict(r) for r in rows]
