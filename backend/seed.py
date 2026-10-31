import asyncio
import os
import sys
from datetime import datetime

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from app.core.config import settings
from app.core.database import Base, AsyncSessionLocal, engine as default_engine
from app.core.security import get_password_hash
from app.models.organization_user import Organization, User
from app.models.lead_pipeline import Lead, Pipeline, PipelineStage
from app.models.deal import Deal
from app.models.activity import Activity, MessageLog
from app.models.invoice import Invoice
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

async def run_seed():
    engine = default_engine
    session_factory = AsyncSessionLocal

    print("🚀 Initializing Zigmaa CRM Production Schema...")
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    except Exception as e:
        print(f"⚠️ PostgreSQL connection failed ({e}). Switching to local SQLite DB engine...")
        engine = create_async_engine("sqlite+aiosqlite:///./zigmaa_crm.db", connect_args={"check_same_thread": False})
        session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    # Check if data already exists to prevent wiping user data on restarts
    from sqlalchemy import select
    async with session_factory() as check_session:
        existing_org = await check_session.execute(select(Organization))
        if existing_org.scalars().first():
            print("✨ Existing database records preserved. Skipping re-seed.")
            return

    print("🌱 Populating seed data for Organization 'Zigmaa Global'...")
    async with session_factory() as session:
        # 1. Organization
        org = Organization(name="Zigmaa Global", slug="zigmaa-global", plan="ENTERPRISE")
        session.add(org)
        await session.flush()

        # 2. Users
        admin_user = User(
            organization_id=org.id,
            email="admin@zigmaa.com",
            hashed_password=get_password_hash("admin123"),
            full_name="Alexander Vance (Admin)",
            role="ADMIN"
        )
        sales_rep = User(
            organization_id=org.id,
            email="sales@zigmaa.com",
            hashed_password=get_password_hash("sales123"),
            full_name="Sarah Jenkins (Senior Sales Rep)",
            role="SALES_REP"
        )
        session.add_all([admin_user, sales_rep])
        await session.flush()

        # 3. Pipeline & Stages
        pipeline = Pipeline(organization_id=org.id, name="Enterprise Direct Sales", is_default=True)
        session.add(pipeline)
        await session.flush()

        stages_config = [
            ("Lead In", 0, 10, "#6366F1"),
            ("Contact Made", 1, 30, "#3B82F6"),
            ("Proposal Sent", 2, 60, "#8B5CF6"),
            ("Negotiation", 3, 85, "#F59E0B"),
            ("Won", 4, 100, "#10B981")
        ]
        created_stages = []
        for title, order, prob, color in stages_config:
            stage = PipelineStage(
                pipeline_id=pipeline.id,
                title=title,
                stage_order=order,
                probability=prob,
                color_code=color
            )
            session.add(stage)
            created_stages.append(stage)
        await session.flush()

        stage_lead_in = created_stages[0]
        stage_contact = created_stages[1]
        stage_proposal = created_stages[2]
        stage_negotiation = created_stages[3]
        stage_won = created_stages[4]

        # 4. 30 Realistic Leads
        leads_raw = [
            ("Rajesh Sharma", "+91 98765 43210", "rajesh.sharma@techcorp.in", "TechCorp India", "META_ADS", "NEW", 120000.0),
            ("Priya Patel", "+91 98123 45678", "priya.p@nexus.co", "Nexus Solutions", "GOOGLE_ADS", "NEW", 85000.0),
            ("Ananya Iyer", "+91 97654 32109", "ananya@iyerconsulting.com", "Iyer Consulting", "META_ADS", "NEW", 45000.0),
            ("Vikram Rao", "+91 99887 76655", "vikram.rao@apex.org", "Apex Healthcare", "WEBSITE_FORM", "NEW", 210000.0),
            ("Suresh Kumar", "+91 94433 22110", "suresh.k@logistics.in", "Express Logistics", "CSV_IMPORT", "NEW", 95000.0),
            ("Meena Sundaram", "+91 98401 23456", "meena@sundaram.io", "Sundaram Tech", "META_ADS", "NEW", 65000.0),
            ("Karthik Rajan", "+91 97102 34567", "karthik.r@fintech.com", "Fintech Global", "GOOGLE_ADS", "NEW", 180000.0),
            ("Lakshmi Narayanan", "+91 98840 11223", "lakshmi@narayanan.org", "Narayanan Group", "META_ADS", "CONTACTED", 150000.0),
            ("Arun Prakash", "+91 99401 55667", "arun@prakashmed.in", "Prakash Medicals", "GOOGLE_ADS", "CONTACTED", 110000.0),
            ("Deepa Venkatesh", "+91 98412 88990", "deepa@venkatesh.com", "Venkatesh Labs", "WEBSITE_FORM", "CONTACTED", 75000.0),
            ("Ganesh Murthy", "+91 97900 44332", "ganesh@murthy.co", "Murthy Enterprise", "META_ADS", "CONTACTED", 195000.0),
            ("Kavitha Reddy", "+91 98711 22334", "kavitha@reddy.in", "Reddy Infra", "CSV_IMPORT", "CONTACTED", 240000.0),
            ("Manoj Deshmukh", "+91 96543 88776", "manoj@deshmukh.org", "Deshmukh Tech", "GOOGLE_ADS", "CONTACTED", 130000.0),
            ("Siddharth Verma", "+91 98112 33445", "siddharth@verma.com", "Verma Retail", "META_ADS", "QUALIFIED", 320000.0),
            ("Divya Menon", "+91 99456 77889", "divya@menon.co", "Menon Biotech", "GOOGLE_ADS", "QUALIFIED", 175000.0),
            ("Rohan Gupta", "+91 98760 11223", "rohan@gupta.org", "Gupta Exports", "WEBSITE_FORM", "QUALIFIED", 290000.0),
            ("Shalini Nair", "+91 97890 12345", "shalini@nair.in", "Nair Logistics", "META_ADS", "QUALIFIED", 160000.0),
            ("Harish Krishnan", "+91 98403 99887", "harish@krishnan.com", "Krishnan & Co", "CSV_IMPORT", "QUALIFIED", 220000.0),
            ("Nandini Swaminathan", "+91 99620 44556", "nandini@swaminathan.org", "Swaminathan Care", "GOOGLE_ADS", "QUALIFIED", 380000.0),
            ("Dr. Balaji Subramanian", "+91 98400 12345", "balaji@amutham.com", "Amutham Clinic", "CSV_IMPORT", "CONVERTED", 500000.0),
            ("Gayathri Raghuram", "+91 98410 56789", "gayathri@raghuram.in", "Raghuram Auto", "META_ADS", "CONVERTED", 270000.0),
            ("Venkatesh Prasad", "+91 99400 67890", "venkatesh@prasad.co", "Prasad Energy", "WEBSITE_FORM", "CONVERTED", 420000.0),
            ("Sneha Mukhopadhyay", "+91 98190 23456", "sneha@mukhopadhyay.org", "Sneha Pharma", "GOOGLE_ADS", "CONVERTED", 310000.0),
            ("Ashok Singhania", "+91 98200 34567", "ashok@singhania.com", "Singhania Steel", "META_ADS", "CONVERTED", 650000.0),
            ("Revathi Baskar", "+91 98408 87654", "revathi@baskar.in", "Baskar Textile", "CSV_IMPORT", "CONVERTED", 190000.0),
            ("Alok Nath", "+91 98300 11223", "alok@nath.org", "Nath Infrastructure", "GOOGLE_ADS", "NEW", 140000.0),
            ("Bhavna Shah", "+91 98211 44556", "bhavna@shah.com", "Shah Diamond", "META_ADS", "CONTACTED", 280000.0),
            ("Chaitanya Joshi", "+91 98722 55667", "chaitanya@joshi.co", "Joshi Software", "WEBSITE_FORM", "QUALIFIED", 210000.0),
            ("Dinesh Agarwal", "+91 98144 77889", "dinesh@agarwal.in", "Agarwal Mills", "CSV_IMPORT", "NEW", 175000.0),
            ("Esha Kapur", "+91 98990 88990", "esha@kapur.org", "Kapur Media", "META_ADS", "CONTACTED", 115000.0)
        ]

        created_leads = []
        for name, phone, email, company, source, status, val in leads_raw:
            lead = Lead(
                organization_id=org.id,
                full_name=name,
                phone=phone,
                email=email,
                company_name=company,
                source=source,
                status=status,
                custom_fields={"annual_revenue": f"₹{val * 5:,.0f}", "headcount": "50-200"},
                tags=["b2b", "enterprise", source.lower()],
                assigned_user_id=sales_rep.id
            )
            session.add(lead)
            created_leads.append((lead, val))
        await session.flush()

        # 5. Populate Deals across stages
        stage_mapping = [
            (stage_lead_in, created_leads[0:5]),
            (stage_contact, created_leads[7:13]),
            (stage_proposal, created_leads[13:16]),
            (stage_negotiation, created_leads[16:19]),
            (stage_won, created_leads[19:25])
        ]

        for stg, lead_tuples in stage_mapping:
            for lead_obj, val in lead_tuples:
                deal = Deal(
                    organization_id=org.id,
                    pipeline_id=pipeline.id,
                    stage_id=stg.id,
                    lead_id=lead_obj.id,
                    title=f"{lead_obj.company_name} - Enterprise License",
                    deal_value=val,
                    currency="INR",
                    expected_close_date="2026-11-30",
                    assigned_user_id=sales_rep.id,
                    status="WON" if stg.id == stage_won.id else "OPEN"
                )
                session.add(deal)
        await session.flush()

        # 6. Invoices
        invoice = Invoice(
            organization_id=org.id,
            invoice_number="ZIG-INV-2026-001",
            client_name="Aditi Rao",
            client_company="Apex Global Logistics",
            client_email="aditi@apexlogistics.in",
            client_phone="+91 98765 43210",
            type="INVOICE",
            status="PAID",
            items=[
                {"description": "Zigmaa CRM Enterprise Annual License", "qty": 1, "unit_price": 450000.0, "amount": 450000.0},
                {"description": "Omnichannel WhatsApp API Integration Module", "qty": 1, "unit_price": 50000.0, "amount": 50000.0}
            ],
            subtotal=500000.0,
            tax_amount=25000.0,
            total_amount=525000.0
        )
        session.add(invoice)

        await session.commit()
    print("✅ Zigmaa CRM database seed completed successfully! 30 Leads & Enterprise Pipeline ready.")

if __name__ == "__main__":
    asyncio.run(run_seed())
