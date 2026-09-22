from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class Facility(Base):
    """A hospital facility / legal entity (spec §2.3). Every tender, vendor
    mapping, and PO data file is scoped to exactly one of these."""

    __tablename__ = "facilities"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    legal_entity_code = Column(String, nullable=False, unique=True)

    users = relationship("UserAccount", back_populates="facility")
