from fastapi import APIRouter

from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.password import router as password_router
from app.api.v1.endpoints.registration import router as registration_router
from app.api.v1.endpoints.admin import router as admin_router
from app.api.v1.endpoints.categories import router as categories_router
from app.api.v1.endpoints.cart import router as cart_router
from app.api.v1.endpoints.products import router as products_router


router = APIRouter()
router.include_router(auth_router)
router.include_router(registration_router)
router.include_router(password_router)
router.include_router(admin_router)
router.include_router(categories_router)
router.include_router(cart_router)
router.include_router(products_router)
