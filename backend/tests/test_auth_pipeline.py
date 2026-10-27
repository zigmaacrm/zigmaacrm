"""
Senior QA Automated Test Suite: Authentication & Authorization Engine
Covers:
1. DB Password Hashing Integrity (Bcrypt salting, non-plaintext verification)
2. User Registration / Signup (Valid payload, default role, duplicate 400/409 rejection)
3. User Login / JWT Generation (Valid credentials, claim structure, wrong password 401, non-existent user 401)
4. Protected Endpoints Guard (/api/v1/auth/me & /api/v1/contacts without token, invalid token, expired token, valid Bearer)
5. Account Status & Timing Leak Resilience (Deactivated user 403, unified error messages)
"""

import uuid
import time
import pytest
from datetime import datetime, timedelta, timezone
from jose import jwt
import httpx
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import select, delete

from app.core.config import settings
from app.core.security import verify_password, get_password_hash
from app.models.organization_user import User, Organization
from app.models.organization_setting import OrganizationSetting

# Client initialization: prefers live running backend (http://localhost:8000) for real HTTP pipeline
def get_client() -> httpx.Client:
    try:
        r = httpx.get("http://localhost:8000/health", timeout=1.5)
        if r.status_code == 200:
            return httpx.Client(base_url="http://localhost:8000", timeout=10.0)
    except Exception:
        pass
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app)

client = get_client()

# Test Fixtures & Constants
TEST_PASSWORD = "StrongSecurePassword@2026!"
UNIQUE_ID = uuid.uuid4().hex[:8]
TEST_EMAIL = f"qa_engineer_{UNIQUE_ID}@zigmaa.com"
TEST_NAME = f"QA Automation User {UNIQUE_ID}"
TEST_COMPANY = f"Zigmaa QA Labs {UNIQUE_ID}"

async def get_test_db_session():
    """Helper to provide an isolated async database session with automatic disposal."""
    test_engine = create_async_engine(settings.DATABASE_URL)
    session_factory = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)
    session = session_factory()
    return session, test_engine


# ==============================================================================
# 1. DATABASE PASSWORD HASHING INTEGRITY
# ==============================================================================

def test_password_hashing_not_plaintext():
    """
    Verify that raw passwords are never saved as plaintext and are salted using bcrypt.
    """
    hashed = get_password_hash(TEST_PASSWORD)
    
    # 1. Password must never equal the raw password
    assert hashed != TEST_PASSWORD, "CRITICAL: Password stored as plain text!"
    
    # 2. Must use bcrypt standard hash ($2b$ or $2a$)
    assert hashed.startswith(("$2b$", "$2a$")), f"Invalid hashing algorithm used: {hashed[:4]}"
    
    # 3. Two hashes of the same password must produce different salts
    hashed_2 = get_password_hash(TEST_PASSWORD)
    assert hashed != hashed_2, "CRITICAL: Password hashing is deterministic (salt is missing or static)!"
    
    # 4. Verify password functions correctly
    assert verify_password(TEST_PASSWORD, hashed) is True, "Password verification failed for correct password"
    assert verify_password("WrongPassword123!", hashed) is False, "Password verification succeeded for incorrect password"


@pytest.mark.asyncio
async def test_db_user_row_password_hashing_integrity():
    """
    Directly query PostgreSQL database to confirm user's hashed_password field
    contains a valid non-plaintext hash.
    """
    session, engine = await get_test_db_session()
    try:
        stmt = select(User).limit(5)
        res = await session.execute(stmt)
        users = res.scalars().all()
        
        assert len(users) > 0, "No users found in database to audit"
        for user in users:
            assert user.hashed_password, f"User {user.email} has empty password hash!"
            assert not user.hashed_password.startswith(("admin", "sales", "test", "pass")), (
                f"User {user.email} appears to have a plaintext password!"
            )
            assert user.hashed_password.startswith(("$2b$", "$2a$")), (
                f"User {user.email} has unexpected password format: {user.hashed_password[:4]}"
            )
    finally:
        await session.close()
        await engine.dispose()


# ==============================================================================
# 2. USER REGISTRATION / SIGNUP
# ==============================================================================

def test_user_registration_success():
    """
    Test user signup with valid payload:
    - User row created
    - Default role assigned (ADMIN)
    - Returns HTTP 200 with JWT access token and user payload
    """
    payload = {
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD,
        "full_name": TEST_NAME,
        "company_name": TEST_COMPANY
    }
    
    response = client.post("/api/v1/auth/signup", json=payload)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    
    data = response.json()
    assert "access_token" in data, "Response missing access_token"
    assert data.get("token_type") == "bearer", "Token type must be bearer"
    assert "user" in data, "Response missing user object"
    
    user_info = data["user"]
    assert user_info["email"].lower() == TEST_EMAIL.lower()
    assert user_info["full_name"] == TEST_NAME
    assert user_info["role"].lower() == "admin", f"Expected default role admin, got {user_info.get('role')}"
    assert user_info.get("is_active") is True


def test_user_registration_duplicate_email():
    """
    Test registering the same email again:
    - Must reject with HTTP 400 Bad Request or 409 Conflict
    - Must prevent duplicate accounts in database
    """
    payload = {
        "email": TEST_EMAIL,
        "password": "AnotherPassword@2026",
        "full_name": "Duplicate Tester",
        "company_name": "Duplicate Inc"
    }
    
    response = client.post("/api/v1/auth/signup", json=payload)
    assert response.status_code in [400, 409], f"Expected 400 or 409 for duplicate email, got {response.status_code}"
    error_detail = response.json().get("detail", "").lower()
    assert "already exists" in error_detail or "duplicate" in error_detail or "already registered" in error_detail, (
        f"Unexpected duplicate error message: {error_detail}"
    )


# ==============================================================================
# 3. USER LOGIN & JWT GENERATION
# ==============================================================================

def test_user_login_valid_credentials():
    """
    Test login with valid registered credentials:
    - Returns HTTP 200
    - Generates valid JWT token with expiration and user claims
    """
    login_payload = {
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    }
    
    response = client.post("/api/v1/auth/login", json=login_payload)
    assert response.status_code == 200, f"Login failed: {response.status_code} - {response.text}"
    
    data = response.json()
    token = data["access_token"]
    assert token, "Login did not return access_token"
    
    # Cryptographically decode and audit JWT token claims
    decoded = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    assert "sub" in decoded, "JWT is missing 'sub' claim"
    assert decoded["email"].lower() == TEST_EMAIL.lower(), "JWT email does not match login user"
    assert "exp" in decoded, "JWT is missing 'exp' expiration claim"
    
    # Expiration must be in the future
    exp_timestamp = decoded["exp"]
    current_timestamp = time.time()
    assert exp_timestamp > current_timestamp, "JWT token expiration is in the past!"
    # Verify validity window is approximately 24 hours (within 60 seconds tolerance)
    expected_duration = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    assert (exp_timestamp - current_timestamp) <= expected_duration + 60


def test_user_login_wrong_password():
    """
    Test login with wrong password:
    - Strictly returns HTTP 401 Unauthorized
    - Returns generic error message to prevent enumeration
    """
    response = client.post("/api/v1/auth/login", json={
        "email": TEST_EMAIL,
        "password": "WrongIncorrectPassword999!"
    })
    assert response.status_code == 401, f"Expected 401, got {response.status_code}"
    detail = response.json().get("detail", "")
    assert "incorrect email or password" in detail.lower()


def test_user_login_non_existent_user():
    """
    Test login with non-existent email:
    - Strictly returns HTTP 401 Unauthorized
    - Error message matches wrong-password message to eliminate user enumeration
    """
    response = client.post("/api/v1/auth/login", json={
        "email": f"non_existent_{uuid.uuid4().hex}@zigmaa.com",
        "password": TEST_PASSWORD
    })
    assert response.status_code == 401, f"Expected 401, got {response.status_code}"
    detail = response.json().get("detail", "")
    assert "incorrect email or password" in detail.lower()


# ==============================================================================
# 4. PROTECTED ENDPOINTS GUARD
# ==============================================================================

def test_protected_endpoints_without_token():
    """
    Verify protected endpoints reject requests lacking Authorization header with 401.
    """
    # 1. /api/v1/auth/me
    resp_me = client.get("/api/v1/auth/me")
    assert resp_me.status_code == 401, f"Expected 401 on /auth/me without token, got {resp_me.status_code}"
    
    # 2. /api/v1/contacts
    resp_contacts = client.get("/api/v1/contacts")
    assert resp_contacts.status_code == 401, f"Expected 401 on /contacts without token, got {resp_contacts.status_code}"


def test_protected_endpoints_with_invalid_token():
    """
    Verify protected endpoints reject malformed/forged tokens with 401.
    """
    headers = {"Authorization": "Bearer forged_fake_token_value_abc123"}
    
    resp_me = client.get("/api/v1/auth/me", headers=headers)
    assert resp_me.status_code == 401, f"Expected 401 on /auth/me with fake token, got {resp_me.status_code}"
    
    resp_contacts = client.get("/api/v1/contacts", headers=headers)
    assert resp_contacts.status_code == 401, f"Expected 401 on /contacts with fake token, got {resp_contacts.status_code}"


def test_protected_endpoints_with_expired_token():
    """
    Verify protected endpoints reject expired tokens with 401.
    """
    # Craft an expired token (expired 2 hours ago)
    past_time = datetime.now(timezone.utc) - timedelta(hours=2)
    expired_payload = {
        "sub": "user-expired-id",
        "email": TEST_EMAIL,
        "exp": int(past_time.timestamp())
    }
    expired_token = jwt.encode(expired_payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    headers = {"Authorization": f"Bearer {expired_token}"}
    
    resp_me = client.get("/api/v1/auth/me", headers=headers)
    assert resp_me.status_code == 401, f"Expected 401 on /auth/me with expired token, got {resp_me.status_code}"
    assert "expired" in resp_me.json().get("detail", "").lower()


def test_protected_endpoints_with_valid_token():
    """
    Verify protected endpoints accept valid tokens and return authenticated user profile / data.
    """
    # 1. Login to get fresh token
    login_resp = client.post("/api/v1/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # 2. Test /api/v1/auth/me
    resp_me = client.get("/api/v1/auth/me", headers=headers)
    assert resp_me.status_code == 200, f"Expected 200 on /auth/me, got {resp_me.status_code}"
    user_data = resp_me.json()
    assert user_data["email"].lower() == TEST_EMAIL.lower()
    assert user_data["role"].lower() == "admin"
    
    # 3. Test /api/v1/contacts
    resp_contacts = client.get("/api/v1/contacts", headers=headers)
    assert resp_contacts.status_code == 200, f"Expected 200 on /contacts, got {resp_contacts.status_code}"
    assert isinstance(resp_contacts.json(), list), "Expected list response for contacts"


# ==============================================================================
# 5. ACCOUNT STATUS & SECURITY CONTROLS
# ==============================================================================

@pytest.mark.asyncio
async def test_deactivated_account_access_revocation():
    """
    Verify that deactivating a user immediately blocks login and revokes API access.
    """
    session, engine = await get_test_db_session()
    try:
        # Find test user and deactivate
        stmt = select(User).where(User.email == TEST_EMAIL.lower())
        res = await session.execute(stmt)
        user = res.scalar_one_or_none()
        assert user is not None, "Test user not found in DB"
        
        user.is_active = False
        await session.commit()
    finally:
        await session.close()
        await engine.dispose()
    
    # 1. Login must now be rejected with 403 Forbidden
    login_resp = client.post("/api/v1/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    assert login_resp.status_code == 403, f"Expected 403 for deactivated user, got {login_resp.status_code}"
    assert "deactivated" in login_resp.json().get("detail", "").lower()
    
    # 2. Reactivate user for teardown / cleanliness
    session, engine = await get_test_db_session()
    try:
        stmt = select(User).where(User.email == TEST_EMAIL.lower())
        res = await session.execute(stmt)
        user = res.scalar_one_or_none()
        if user:
            user.is_active = True
            await session.commit()
    finally:
        await session.close()
        await engine.dispose()


def test_auth_timing_leak_resilience():
    """
    Timing leak test:
    Compare latency of non-existent user request vs wrong password request.
    Neither should drastically differ or leak user existence.
    """
    times_non_existent = []
    for _ in range(3):
        t0 = time.perf_counter()
        client.post("/api/v1/auth/login", json={
            "email": f"timing_{uuid.uuid4().hex}@zigmaa.com",
            "password": "DummyPassword123!"
        })
        times_non_existent.append(time.perf_counter() - t0)
        
    times_wrong_pw = []
    for _ in range(3):
        t0 = time.perf_counter()
        client.post("/api/v1/auth/login", json={
            "email": TEST_EMAIL,
            "password": "WrongDummyPassword123!"
        })
        times_wrong_pw.append(time.perf_counter() - t0)
        
    avg_non_existent = sum(times_non_existent) / len(times_non_existent)
    avg_wrong_pw = sum(times_wrong_pw) / len(times_wrong_pw)
    
    # Timing delta should be reasonable (< 0.25 seconds difference)
    delta = abs(avg_non_existent - avg_wrong_pw)
    assert delta < 0.25, f"Potential timing leak detected: delta={delta:.3f}s"


# ==============================================================================
# TEARDOWN: CLEAN UP TEST DATA
# ==============================================================================

@pytest.fixture(scope="session", autouse=True)
def cleanup_test_user():
    """
    Run after all tests in the session complete to keep the database pristine.
    """
    yield
    import asyncio
    async def _clean():
        session, engine = await get_test_db_session()
        try:
            stmt = select(User).where(User.email == TEST_EMAIL.lower())
            res = await session.execute(stmt)
            user = res.scalar_one_or_none()
            if user:
                org_id = user.organization_id
                await session.delete(user)
                if org_id:
                    await session.execute(
                        delete(OrganizationSetting).where(OrganizationSetting.organization_id == org_id)
                    )
                    await session.execute(
                        delete(Organization).where(Organization.id == org_id)
                    )
                await session.commit()
        finally:
            await session.close()
            await engine.dispose()
    
    try:
        asyncio.run(_clean())
    except Exception as e:
        print(f"Teardown cleanup note: {e}")
