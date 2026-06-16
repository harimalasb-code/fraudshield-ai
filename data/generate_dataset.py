"""Generate a realistic synthetic transaction dataset for FraudShield AI.

The dataset is synthetic but the fraud label is produced from a latent
risk function with correlated signal + noise, so a RandomForest can learn
genuine patterns. The trained model -- not this script -- produces every
prediction served by the app.

Columns: amount, location, device, time (hour 0-23), is_fraud
"""
import argparse
import os

import numpy as np
import pandas as pd

LOCATIONS = [
    "New York", "London", "Mumbai", "Singapore", "Dubai",
    "Lagos", "Moscow", "Sao Paulo", "Tokyo", "Sydney",
]
# Locations that are statistically riskier in this synthetic world.
RISKY_LOCATIONS = {"Lagos", "Moscow", "Sao Paulo"}

DEVICES = ["Mobile", "Desktop", "Tablet", "POS", "ATM"]
RISKY_DEVICES = {"ATM", "POS"}


def generate(n: int, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)

    # Amount: log-normal so most transactions are small, a few are large.
    amount = np.round(rng.lognormal(mean=4.2, sigma=1.1, size=n), 2)
    amount = np.clip(amount, 1.0, 50000.0)

    location = rng.choice(LOCATIONS, size=n)
    device = rng.choice(DEVICES, size=n, p=[0.35, 0.25, 0.12, 0.13, 0.15])
    hour = rng.integers(0, 24, size=n)

    # Latent risk score -> probability of fraud (correlated signal).
    log_amt = np.log10(np.clip(amount, 1.0, None))
    z = -4.0
    z = z + 1.5 * (log_amt - 2.0)                  # amount: 100->0, 10k->+3
    z = z + np.where(amount > 2000, 1.0, 0.0)      # threshold effect
    z = z + np.isin(location, list(RISKY_LOCATIONS)) * 1.8
    z = z + np.isin(device, list(RISKY_DEVICES)) * 1.4
    z = z + ((hour < 5) | (hour >= 23)) * 1.6      # late-night risk
    # interaction: large amount in a risky location is especially suspicious
    z = z + (np.isin(location, list(RISKY_LOCATIONS)) & (amount > 2000)) * 1.2
    z = z + rng.normal(0, 0.1, size=n)            # small noise

    prob = 1.0 / (1.0 + np.exp(-z))
    is_fraud = (rng.random(n) < prob).astype(int)

    df = pd.DataFrame(
        {
            "amount": amount,
            "location": location,
            "device": device,
            "time": hour,
            "is_fraud": is_fraud,
        }
    )

    # Inject some missing values so preprocessing has real work to do.
    miss_idx = rng.choice(n, size=int(n * 0.02), replace=False)
    df.loc[miss_idx, "location"] = np.nan
    miss_idx2 = rng.choice(n, size=int(n * 0.02), replace=False)
    df.loc[miss_idx2, "amount"] = np.nan

    return df


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rows", type=int, default=12000)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--out",
        default=os.path.join(os.path.dirname(__file__), "dataset.csv"),
    )
    args = parser.parse_args()

    df = generate(args.rows, args.seed)
    df.to_csv(args.out, index=False)
    fraud_rate = df["is_fraud"].mean() * 100
    print(f"Wrote {len(df)} rows to {args.out} (fraud rate {fraud_rate:.2f}%)")


if __name__ == "__main__":
    main()
