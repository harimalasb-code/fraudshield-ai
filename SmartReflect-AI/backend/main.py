from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import random
import time
import math

app = FastAPI(title="SmartReflect AI Backend")

# Allow CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/analyze")
def analyze_visibility():
    """Simulates OpenCV-based road striping visibility analysis."""
    # Simulate processing delay
    time.sleep(random.uniform(0.3, 1.2))
    
    visibility_levels = ["High", "Medium", "Low"]
    weights = [35, 45, 20] # 20% chance of Low visibility for demo purposes
    
    visibility = random.choices(visibility_levels, weights=weights, k=1)[0]
    
    if visibility == "High":
        confidence = round(random.uniform(85.0, 99.9), 2)
    elif visibility == "Medium":
        confidence = round(random.uniform(70.0, 84.9), 2)
    else:
        confidence = round(random.uniform(40.0, 69.9), 2)
        
    # Simulate GPS near a major highway
    base_lat = 28.7041
    base_lon = 77.1025
    lat = round(base_lat + random.uniform(-0.02, 0.02), 6)
    lon = round(base_lon + random.uniform(-0.02, 0.02), 6)
    
    km_marker = random.randint(10, 250)
    
    return {
        "visibility_level": visibility,
        "confidence_score": confidence,
        "gps": {
            "lat": lat,
            "lng": lon
        },
        "km_marker": km_marker
    }
