from decimal import Decimal

from pydantic import BaseModel, Field


class CartItemCreate(BaseModel):
    product_id: int = Field(gt=0)
    quantity: int = Field(gt=0)


class CartItemUpdate(BaseModel):
    quantity: int = Field(gt=0)


class CartItemResponse(BaseModel):
    product_id: int
    name: str
    image_url: str | None
    unit_price: Decimal
    quantity: int
    line_total: Decimal
    available_stock: int
    is_available: bool


class CartResponse(BaseModel):
    items: list[CartItemResponse]
    total_quantity: int
    subtotal: Decimal
