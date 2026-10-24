from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db.base import Base
from app.models import Category, ImageCleanupTask, Product
from app.services import image


def session_with_models() -> Session:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    session = Session(engine)
    category = Category(name="Cleanup")
    session.add(category)
    session.flush()
    session.add(Product(name="Referenced", price=1, stock=0, category_id=category.id, image_object_key="products/used.webp"))
    session.add_all([ImageCleanupTask(object_key="products/used.webp"), ImageCleanupTask(object_key="products/orphan.webp")])
    session.commit()
    return session


def test_cleanup_removes_only_unreferenced_objects(monkeypatch) -> None:
    session = session_with_models()
    deleted: list[str] = []
    monkeypatch.setattr(image, "delete_image", lambda key: deleted.append(key) or True)

    removed, retained = image.run_image_cleanup(session)

    assert (removed, retained) == (1, 1)
    assert deleted == ["products/orphan.webp"]
    assert session.query(ImageCleanupTask).count() == 0


def test_cleanup_dry_run_and_storage_failure_keep_tasks(monkeypatch) -> None:
    session = session_with_models()
    monkeypatch.setattr(image, "delete_image", lambda _: False)

    assert image.run_image_cleanup(session, dry_run=True) == (1, 1)
    assert session.query(ImageCleanupTask).count() == 2
    assert image.run_image_cleanup(session) == (0, 2)
    assert session.query(ImageCleanupTask).count() == 1
