from sqlalchemy.orm import Session

from app.models.user import User, UserRole
from app.models.instructor import Instructor


class AuthRepository:
    """Database access layer for authentication operations."""

    def __init__(self, db: Session):
        self.db = db

    def get_user_by_email(self, email: str) -> User | None:
        return self.db.query(User).filter(User.email == email).first()

    def get_user_by_id(self, user_id: int) -> User | None:
        return self.db.query(User).filter(User.id == user_id).first()

    def create_user(self, email: str, password_hash: str) -> User:
        user = User(
            email=email,
            password_hash=password_hash,
            role=UserRole.INSTRUCTOR,
            is_active=True,
        )
        self.db.add(user)
        self.db.flush()
        return user

    def create_instructor(self, user_id: int, full_name: str) -> Instructor:
        instructor = Instructor(user_id=user_id, full_name=full_name)
        self.db.add(instructor)
        self.db.flush()
        return instructor

    def get_instructor_by_user_id(self, user_id: int) -> Instructor | None:
        return (
            self.db.query(Instructor)
            .filter(Instructor.user_id == user_id)
            .first()
        )

    def commit(self) -> None:
        self.db.commit()

    def rollback(self) -> None:
        self.db.rollback()
