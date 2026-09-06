from fastapi import FastAPI, APIRouter
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")


class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class StatusCheckCreate(BaseModel):
    client_name: str


@api_router.get("/")
async def root():
    return {"message": "Sasha Band API ready", "version": "1.0"}


DEMO_TELEMETRY = {
    "heart_rate": 72,
    "steps": 6842,
    "step_goal": 10000,
    "activity_minutes": 48,
    "activity_goal": 60,
    "battery": 86,
    "connected": True,
    "device_name": "Sasha Band",
    "rssi": -54,
    "weekly_steps": [7200, 8450, 6120, 9040, 6842, 0, 0],
    "weekly_labels": ["M", "T", "W", "T", "F", "S", "S"],
}


@api_router.get("/telemetry")
async def get_telemetry():
    return {**DEMO_TELEMETRY, "updated_at": datetime.now(timezone.utc).isoformat()}


@api_router.get("/insights")
async def get_insights():
    telemetry = DEMO_TELEMETRY
    return {
        "insights": [
            {"title": "Strong momentum", "body": f"You are at {round(telemetry['steps'] / telemetry['step_goal'] * 100)}% of today's step goal.", "tone": "brand"},
            {"title": "Keep your rhythm", "body": "A 12-minute walk this afternoon would put you on track for your activity goal.", "tone": "success"},
            {"title": "Heart rate steady", "body": f"Your current pulse is {telemetry['heart_rate']} BPM.", "tone": "info"},
        ]
    }


# ---------------- Tracking Sessions ----------------
class TrackingSessionCreate(BaseModel):
    steps: int = 0
    duration: int = 0  # seconds
    distance_km: float = 0.0
    calories_kcal: int = 0
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    source: Optional[str] = "ttp223_gesture"


@api_router.post("/tracking/session")
async def save_tracking_session(session: TrackingSessionCreate):
    """Save a completed tracking session (invoked on DOUBLE_TAP stop or manual stop)."""
    now_iso = datetime.now(timezone.utc).isoformat()
    record = {
        "id": str(uuid.uuid4()),
        "steps": session.steps,
        "duration": session.duration,
        "distance_km": session.distance_km,
        "calories_kcal": session.calories_kcal,
        "start_time": session.start_time or now_iso,
        "end_time": session.end_time or now_iso,
        "source": session.source or "ttp223_gesture",
        "created_at": datetime.now(timezone.utc),
    }
    await db.tracking_sessions.insert_one(record)
    record.pop("_id", None)
    if isinstance(record.get("created_at"), datetime):
        record["created_at"] = record["created_at"].isoformat()
    return {"status": "saved", "session": record}


@api_router.get("/tracking/sessions")
async def get_tracking_sessions(limit: int = 50):
    """Get list of recent saved tracking sessions."""
    docs = await db.tracking_sessions.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    for d in docs:
        if isinstance(d.get("created_at"), datetime):
            d["created_at"] = d["created_at"].isoformat()
    return {"sessions": docs, "count": len(docs)}


@api_router.delete("/tracking/sessions")
async def clear_tracking_sessions():
    """Clear all saved tracking sessions."""
    res = await db.tracking_sessions.delete_many({})
    return {"deleted_count": res.deleted_count}


@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_obj = StatusCheck(**input.dict())
    await db.status_checks.insert_one(status_obj.dict())
    return status_obj


@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find().to_list(1000)
    return [StatusCheck(**status_check) for status_check in status_checks]


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
