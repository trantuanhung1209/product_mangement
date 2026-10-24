from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_csrf
from app.db.database import get_db
from app.models import User
from app.schemas.cart import CartItemCreate, CartItemUpdate, CartResponse
from app.services import cart as cart_service


router = APIRouter(prefix="/cart", tags=["cart"])


@router.get("", response_model=CartResponse)
def get_cart(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> CartResponse:
    return cart_service.get_cart(db, current_user)


@router.post("/items", response_model=CartResponse, status_code=status.HTTP_201_CREATED)
def add_item(
    payload: CartItemCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db),
    _: None = Depends(require_csrf),
) -> CartResponse:
    return cart_service.add_item(db, current_user, payload)


@router.patch("/items/{product_id}", response_model=CartResponse)
def update_item(
    product_id: int, payload: CartItemUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db),
    _: None = Depends(require_csrf),
) -> CartResponse:
    return cart_service.update_item(db, current_user, product_id, payload)


@router.delete("/items/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_item(
    product_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db),
    _: None = Depends(require_csrf),
) -> Response:
    cart_service.remove_item(db, current_user, product_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def clear_cart(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db), _: None = Depends(require_csrf),
) -> Response:
    cart_service.clear_cart(db, current_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
