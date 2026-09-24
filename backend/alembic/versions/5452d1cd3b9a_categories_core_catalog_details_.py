"""categories, core catalog details, category mappings, per-type ratings

Hand-written (autogenerate can't backfill data): existing free-text
categories become product_categories rows, existing ratings become the
'item' rating (other types are created lazily), and existing mappings stay
as item-level mappings.

Revision ID: 5452d1cd3b9a
Revises: df68aeabdc05
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '5452d1cd3b9a'
down_revision: Union[str, None] = 'df68aeabdc05'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# The enum type already exists (created with product_master); reuse it.
ptype = postgresql.ENUM('ITEM', 'ASSET', 'SERVICE', name='procurementtype', create_type=False)


def upgrade() -> None:
    # --- categories ---
    op.create_table(
        'product_categories',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('procurement_type', ptype, nullable=False),
        sa.Column('min_mapping_rating', sa.Float(), nullable=True),
        sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.UniqueConstraint('name', 'procurement_type', name='uq_category_name_type'),
    )
    op.execute("""
        INSERT INTO product_categories (name, procurement_type)
        SELECT DISTINCT category, procurement_type FROM product_master
    """)

    # --- product_master ---
    op.add_column('product_master', sa.Column('category_id', sa.Integer(), nullable=True))
    op.execute("""
        UPDATE product_master p SET category_id = c.id
        FROM product_categories c
        WHERE c.name = p.category AND c.procurement_type = p.procurement_type
    """)
    op.alter_column('product_master', 'category_id', nullable=False)
    op.create_foreign_key('fk_product_category', 'product_master', 'product_categories', ['category_id'], ['id'])
    op.drop_column('product_master', 'category')
    op.add_column('product_master', sa.Column('unit_of_measure', sa.String(), nullable=True))
    op.add_column('product_master', sa.Column('regulatory_class', sa.String(), nullable=True))
    op.add_column('product_master', sa.Column('approved_brands', sa.JSON(), nullable=False, server_default='[]'))
    op.add_column('product_master', sa.Column('reorder_level', sa.Float(), nullable=True))
    op.add_column('product_master', sa.Column('price_band_min', sa.Float(), nullable=True))
    op.add_column('product_master', sa.Column('price_band_max', sa.Float(), nullable=True))
    op.add_column('product_master', sa.Column('min_mapping_rating', sa.Float(), nullable=True))

    # --- vendor_mappings: item XOR category ---
    op.add_column('vendor_mappings', sa.Column('category_id', sa.Integer(), nullable=True))
    op.alter_column('vendor_mappings', 'product_master_id', nullable=True)
    op.create_foreign_key('fk_mapping_category', 'vendor_mappings', 'product_categories', ['category_id'], ['id'])
    op.create_unique_constraint('uq_vendor_category', 'vendor_mappings', ['vendor_id', 'category_id'])
    op.create_check_constraint(
        'ck_mapping_item_xor_category',
        'vendor_mappings',
        '(product_master_id IS NOT NULL AND category_id IS NULL) OR (product_master_id IS NULL AND category_id IS NOT NULL)',
    )

    # --- vendor_ratings: one per (vendor, procurement type) ---
    op.add_column('vendor_ratings', sa.Column('procurement_type', ptype, nullable=True))
    op.execute("UPDATE vendor_ratings SET procurement_type = 'ITEM'")
    op.alter_column('vendor_ratings', 'procurement_type', nullable=False)
    op.drop_constraint('vendor_ratings_vendor_id_key', 'vendor_ratings', type_='unique')
    op.create_unique_constraint('uq_vendor_rating_type', 'vendor_ratings', ['vendor_id', 'procurement_type'])
    # The old single score applied to everything, so seed the other two types
    # with the same values (history stays with the 'item' row) -- otherwise
    # every existing vendor would silently drop to the provisional default
    # for Assets/Services.
    for t in ('ASSET', 'SERVICE'):
        op.execute(f"""
            INSERT INTO vendor_ratings (vendor_id, procurement_type, price_competitiveness, on_time_pct, quality_pct,
                compliance_pct, responsiveness, overall_score, is_provisional, last_manual_update_at)
            SELECT vendor_id, '{t}', price_competitiveness, on_time_pct, quality_pct, compliance_pct, responsiveness,
                overall_score, is_provisional, last_manual_update_at
            FROM vendor_ratings WHERE procurement_type = 'ITEM'
        """)


def downgrade() -> None:
    op.execute("DELETE FROM vendor_ratings WHERE procurement_type <> 'ITEM'")
    op.drop_constraint('uq_vendor_rating_type', 'vendor_ratings', type_='unique')
    op.create_unique_constraint('vendor_ratings_vendor_id_key', 'vendor_ratings', ['vendor_id'])
    op.drop_column('vendor_ratings', 'procurement_type')

    op.drop_constraint('ck_mapping_item_xor_category', 'vendor_mappings', type_='check')
    op.drop_constraint('uq_vendor_category', 'vendor_mappings', type_='unique')
    op.drop_constraint('fk_mapping_category', 'vendor_mappings', type_='foreignkey')
    op.execute("DELETE FROM vendor_mapping_history WHERE mapping_id IN (SELECT id FROM vendor_mappings WHERE category_id IS NOT NULL)")
    op.execute("DELETE FROM vendor_mappings WHERE category_id IS NOT NULL")
    op.alter_column('vendor_mappings', 'product_master_id', nullable=False)
    op.drop_column('vendor_mappings', 'category_id')

    op.add_column('product_master', sa.Column('category', sa.String(), nullable=True))
    op.execute("UPDATE product_master p SET category = c.name FROM product_categories c WHERE c.id = p.category_id")
    op.alter_column('product_master', 'category', nullable=False)
    for col in ('min_mapping_rating', 'price_band_max', 'price_band_min', 'reorder_level', 'approved_brands', 'regulatory_class', 'unit_of_measure'):
        op.drop_column('product_master', col)
    op.drop_constraint('fk_product_category', 'product_master', type_='foreignkey')
    op.drop_column('product_master', 'category_id')
    op.drop_table('product_categories')
