from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, selectinload

from app.models import Cart, CartItem, Product, User
from app.schemas.cart import CartItemCreate, CartItemResponse, CartItemUpdate, CartResponse


def _cart_response(cart: Cart | None) -> CartResponse:
    if cart is None:
        return CartResponse(items=[], total_quantity=0, subtotal=Decimal("0"))
    items = [
        CartItemResponse(
            product_id=item.product_id, name=item.product.name, image_url=item.product.image_url,
            unit_price=item.product.price, quantity=item.quantity,
            line_total=item.product.price * item.quantity, available_stock=item.product.stock,
            is_available=item.product.stock >= item.quantity and item.product.stock > 0,
        )
        for item in cart.items
    ]
    return CartResponse(items=items, total_quantity=sum(item.quantity for item in items), subtotal=sum((item.line_total for item in items), Decimal("0")))


def get_cart(db: Session, user: User) -> CartResponse:
    cart = db.scalar(select(Cart).where(Cart.user_id == user.id).options(selectinload(Cart.items).selectinload(CartItem.product)))
    return _cart_response(cart)


def _locked_cart(db: Session, user_id: int) -> Cart:
    db.execute(insert(Cart).values(user_id=user_id).on_conflict_do_nothing(index_elements=[Cart.user_id]))
    cart = db.scalar(select(Cart).where(Cart.user_id == user_id).with_for_update())
    if cart is None:
        raise RuntimeError("Cart could not be created.")
    return cart


def _locked_product(db: Session, product_id: int) -> Product:
    product = db.scalar(select(Product).where(Product.id == product_id).with_for_update())
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found.")
    return product


def _assert_stock(product: Product, quantity: int) -> None:
    if product.stock < quantity:
        raise HTTPException(status_code=409, detail="Requested quantity exceeds available stock.")


def add_item(db: Session, user: User, payload: CartItemCreate) -> CartResponse:
    try:
        cart = _locked_cart(db, user.id)
        product = _locked_product(db, payload.product_id)
        item = db.scalar(select(CartItem).where(CartItem.cart_id == cart.id, CartItem.product_id == product.id).with_for_update())
        quantity = payload.quantity + (item.quantity if item else 0)
        _assert_stock(product, quantity)
        if item is None:
            db.add(CartItem(cart_id=cart.id, product_id=product.id, quantity=payload.quantity))
        else:
            item.quantity = quantity
        db.commit()
    except Exception:
        db.rollback()
        raise
    return get_cart(db, user)


def update_item(db: Session, user: User, product_id: int, payload: CartItemUpdate) -> CartResponse:
    try:
        cart = db.scalar(select(Cart).where(Cart.user_id == user.id).with_for_update())
        if cart is None:
            raise HTTPException(status_code=404, detail="Cart item not found.")
        product = _locked_product(db, product_id)
        item = db.scalar(select(CartItem).where(CartItem.cart_id == cart.id, CartItem.product_id == product_id).with_for_update())
        if item is None:
            raise HTTPException(status_code=404, detail="Cart item not found.")
        _assert_stock(product, payload.quantity)
        item.quantity = payload.quantity
        db.commit()
    except Exception:
        db.rollback()
        raise
    return get_cart(db, user)


def remove_item(db: Session, user: User, product_id: int) -> None:
    cart = db.scalar(select(Cart).where(Cart.user_id == user.id).with_for_update())
    if cart is None or db.execute(delete(CartItem).where(CartItem.cart_id == cart.id, CartItem.product_id == product_id)).rowcount == 0:
        db.rollback()
        raise HTTPException(status_code=404, detail="Cart item not found.")
    db.commit()


def clear_cart(db: Session, user: User) -> None:
    cart = db.scalar(select(Cart).where(Cart.user_id == user.id).with_for_update())
    if cart is not None:
        db.execute(delete(CartItem).where(CartItem.cart_id == cart.id))
        db.commit()
