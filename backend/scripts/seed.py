from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.database import get_session_factory
from app.models import Category, Product


# Keep the stable marker out of product descriptions shown in the UI.
SEED_MARKER = "\u2063product-catalog-seed:phase-07\u2063"
STOCK_LEVELS = (0, 3, 8, 15, 27, 45, 72, 120, 8, 24)


@dataclass(frozen=True)
class SeedCategory:
    name: str
    description: str
    base_price: int
    price_step: int
    products: tuple[str, ...]


CATEGORIES = (
    SeedCategory("Điện tử & Công nghệ", "Thiết bị phục vụ học tập, làm việc và giải trí.", 399_000, 890_000, (
        "Laptop Aurora 14", "Điện thoại Nova X5", "Tai nghe AirBeat Pro", "Bàn phím cơ Flow 75", "Chuột không dây Click Pro",
        "Màn hình View 27", "Ổ cứng SSD Swift 1TB", "Webcam Meet Full HD", "Loa Bluetooth Sound Mini", "Đế sạc Charge Hub",
    )),
    SeedCategory("Gia dụng", "Đồ dùng tiện ích cho không gian sống hiện đại.", 129_000, 210_000, (
        "Nồi chiên không dầu Crisp 5L", "Máy lọc không khí Pure Home", "Bình giữ nhiệt Mộc 750ml", "Đèn bàn Lumi Mini", "Quạt đứng Breeze 5 cánh",
        "Máy xay sinh tố Fresh Mix", "Bộ hộp thực phẩm Glass Lock", "Cân nhà bếp Smart Scale", "Chăn mỏng Cotton Cloud", "Kệ để gia vị Gỗ Tre",
    )),
    SeedCategory("Văn phòng phẩm", "Dụng cụ học tập và làm việc gọn gàng mỗi ngày.", 12_000, 28_000, (
        "Sổ tay bìa da Nâu", "Bút gel Mực Xanh", "Kẹp tài liệu kim loại", "Giấy ghi chú Pastel", "Bìa hồ sơ trong suốt",
        "Thước nhôm 30cm", "Bút dạ quang Neon", "Hộp đựng bút để bàn", "Máy tính bỏ túi Mini", "Tập giấy in A4 80gsm",
    )),
    SeedCategory("Thời trang", "Trang phục và phụ kiện cơ bản, dễ phối hàng ngày.", 89_000, 115_000, (
        "Áo thun Cotton Basic", "Sơ mi Linen Trắng", "Quần jeans Slim Fit", "Áo khoác gió Urban", "Váy midi Hoa Nhí",
        "Túi tote Canvas", "Mũ lưỡi trai Classic", "Dây nịt da Nâu", "Khăn choàng Soft Knit", "Ví cầm tay Minimal",
    )),
    SeedCategory("Chăm sóc cá nhân", "Sản phẩm chăm sóc cơ thể cho nếp sống lành mạnh.", 59_000, 76_000, (
        "Sữa rửa mặt Dịu Nhẹ", "Kem chống nắng Daily SPF50", "Dầu gội Bưởi Mềm Tóc", "Bàn chải điện Clean Smile", "Nước hoa hồng Hoa Cúc",
        "Son dưỡng Môi Mềm", "Kem dưỡng tay Shea", "Khăn tắm Cotton Lớn", "Máy cạo râu Pocket", "Bộ chăm sóc móng Mini",
    )),
    SeedCategory("Thể thao & Dã ngoại", "Dụng cụ vận động và đồng hành trong các chuyến đi.", 75_000, 145_000, (
        "Bình nước thể thao 1L", "Thảm yoga Balance", "Dây kháng lực Flex Set", "Balo leo núi Trail 25L", "Đèn pin cầm tay Beam",
        "Vợt cầu lông Active", "Găng tay tập Gym Grip", "Túi ngủ Camping Lite", "Kính bơi Aqua Clear", "Áo mưa bộ Outdoor",
    )),
    SeedCategory("Nhà cửa & Nội thất", "Vật dụng nhỏ giúp căn nhà ngăn nắp và ấm cúng hơn.", 95_000, 175_000, (
        "Gối tựa lưng Linen", "Rèm cửa sổ Màu Kem", "Thảm chùi chân Sợi Dừa", "Khung ảnh gỗ 20x30", "Đồng hồ treo tường Bắc Âu",
        "Giỏ đựng đồ Mây", "Kệ sách mini 3 tầng", "Bộ ga giường Cotton", "Bàn gấp làm việc Compact", "Đèn ngủ Moon Light",
    )),
    SeedCategory("Đồ chơi & Sở thích", "Sản phẩm thư giãn, sáng tạo và phù hợp làm quà tặng.", 49_000, 98_000, (
        "Bộ xếp hình Thành Phố", "Tranh tô màu Hoa Lá", "Mô hình xe cổ Mini", "Bộ bài Uno Việt", "Đất nặn Sắc Màu",
        "Nhật ký sáng tạo Doodle", "Bộ cờ vua gỗ", "Máy ảnh lấy liền Kids", "Đèn ngủ hình Mây", "Bộ dụng cụ vẽ Sketch",
    )),
    SeedCategory("Thực phẩm & Đồ uống", "Thực phẩm tiện lợi và nguyên liệu cho căn bếp hằng ngày.", 35_000, 42_000, (
        "Cà phê rang xay Đà Lạt", "Trà sen túi lọc", "Mật ong hoa nhãn", "Hạt điều rang muối", "Yến mạch nguyên hạt",
        "Nước ép cam tươi", "Bánh quy bơ Pháp", "Mì gạo lứt khô", "Dầu ô liu Extra Virgin", "Socola đen 70% cacao",
    )),
    SeedCategory("Sách & Học tập", "Sách và tài liệu hỗ trợ việc học, phát triển kỹ năng.", 68_000, 54_000, (
        "Sách Kỹ năng thuyết trình", "Từ điển Anh Việt bỏ túi", "Vở bài tập Toán lớp 5", "Sách nấu ăn cuối tuần", "Truyện thiếu nhi Khu Vườn",
        "Sổ luyện chữ đẹp", "Sách nhập môn Python", "Atlas thế giới màu", "Sách quản lý thời gian", "Bộ flashcard tiếng Anh",
    )),
)


def marker(category_index: int, product_index: int) -> str:
    return f"{SEED_MARKER}:{category_index}:{product_index}"


def seed_catalog(session: Session) -> tuple[int, int, int]:
    existing_markers = set(session.scalars(select(Product.description).where(Product.description.like(f"%{SEED_MARKER}%"))).all())
    created_categories = 0
    created_products = 0

    try:
        for category_index, spec in enumerate(CATEGORIES):
            category = session.scalar(select(Category).where(Category.name == spec.name))
            if category is None:
                category = Category(name=spec.name, description=spec.description)
                session.add(category)
                session.flush()
                created_categories += 1

            for product_index, name in enumerate(spec.products):
                product_marker = marker(category_index, product_index)
                if any(description and product_marker in description for description in existing_markers):
                    continue
                session.add(Product(
                    name=name,
                    description=f"{name} phù hợp cho nhu cầu {spec.name.lower()}. {product_marker}",
                    price=Decimal(spec.base_price + spec.price_step * product_index),
                    stock=STOCK_LEVELS[product_index],
                    category_id=category.id,
                ))
                created_products += 1
        session.commit()
    except Exception:
        session.rollback()
        raise

    total_seed_products = session.scalar(
        select(func.count()).select_from(Product).where(Product.description.like(f"%{SEED_MARKER}%"))
    )
    return created_categories, created_products, total_seed_products or 0


def main() -> None:
    session_factory = get_session_factory()
    with session_factory() as session:
        categories, products, total = seed_catalog(session)
    print(f"Seed hoàn tất: thêm {categories} danh mục, {products} sản phẩm; tổng seed products: {total}.")


if __name__ == "__main__":
    main()
