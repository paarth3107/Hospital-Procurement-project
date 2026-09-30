"""product subcategories

Revision ID: e2b7c4a9f168
Revises: d4e6a9c1f207
Create Date: 2026-10-01 02:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "e2b7c4a9f168"
down_revision = "d4e6a9c1f207"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "product_sub_categories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("category_id", sa.Integer(), sa.ForeignKey("product_categories.id"), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("name", "category_id", name="uq_subcategory_name_category"),
    )
    op.add_column("product_master", sa.Column("sub_category_id", sa.Integer(), sa.ForeignKey("product_sub_categories.id"), nullable=True))

    conn = op.get_bind()
    sub_categories = sa.table(
        "product_sub_categories",
        sa.column("id", sa.Integer()),
        sa.column("name", sa.String()),
        sa.column("category_id", sa.Integer()),
    )
    product_master = sa.table(
        "product_master",
        sa.column("id", sa.Integer()),
        sa.column("category_id", sa.Integer()),
        sa.column("sub_category", sa.String()),
        sa.column("sub_category_id", sa.Integer()),
    )
    # Promote each distinct (category, free-text sub_category) pair still on
    # disk into a real row, then point every matching product at it.
    rows = conn.execute(
        sa.text("SELECT DISTINCT category_id, sub_category FROM product_master WHERE sub_category IS NOT NULL AND sub_category <> ''")
    ).fetchall()
    for category_id, name in rows:
        new_id = conn.execute(sub_categories.insert().values(category_id=category_id, name=name.strip()).returning(sub_categories.c.id)).scalar()
        conn.execute(
            product_master.update()
            .where(product_master.c.category_id == category_id, product_master.c.sub_category == name)
            .values(sub_category_id=new_id)
        )

    op.drop_column("product_master", "sub_category")


def downgrade() -> None:
    op.add_column("product_master", sa.Column("sub_category", sa.String(), nullable=True))
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "UPDATE product_master SET sub_category = product_sub_categories.name "
            "FROM product_sub_categories WHERE product_master.sub_category_id = product_sub_categories.id"
        )
    )
    op.drop_column("product_master", "sub_category_id")
    op.drop_table("product_sub_categories")
