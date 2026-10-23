import asyncio
import logging

from fastapi import APIRouter, HTTPException

from app.schemas.lab import InventoryInput


logger = logging.getLogger("app.lifecycle")
router = APIRouter(prefix="/lab", tags=["request-lifecycle-lab"])


@router.get("/success")
async def success() -> dict[str, str]:
    logger.info("Endpoint: success")
    return {"status": "ok", "scenario": "success"}


@router.get("/http-error")
async def http_error() -> None:
    logger.info("Endpoint: http-error")
    raise HTTPException(status_code=404, detail="Lab resource not found")


@router.get("/unhandled-error")
async def unhandled_error() -> None:
    logger.info("Endpoint: unhandled-error")
    raise RuntimeError("Lab unhandled exception")


@router.get("/slow")
async def slow() -> dict[str, str]:
    logger.info("Endpoint: slow")
    await asyncio.sleep(2)
    return {"status": "ok", "scenario": "slow"}


@router.post("/validate")
async def validate(payload: InventoryInput) -> InventoryInput:
    logger.info("Endpoint: validate")
    return payload
