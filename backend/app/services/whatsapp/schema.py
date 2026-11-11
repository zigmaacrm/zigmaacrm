"""
Runs schema.sql (shared verbatim with the Node bridge) against PostgreSQL.

The whole file executes in one transaction behind an advisory lock, so the
bridge and every API worker may boot concurrently and in any order.
Mirror of applySchema() in whatsapp-bridge/src/db.js.
"""
import hashlib
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

from sqlalchemy.ext.asyncio import AsyncEngine

logger = logging.getLogger("zigmaa.whatsapp.schema")

SCHEMA_PATH = Path(__file__).with_name("schema.sql")
SCHEMA_LOCK_KEY = 815_001_771
_DIRECTIVE_RE = re.compile(r"^--\s*@(requires|once)\s+(.+?)\s*$", re.IGNORECASE)


@dataclass
class Statement:
    sql: str
    requires: List[str] = field(default_factory=list)
    once: Optional[str] = None


def parse_schema(sql_text: str) -> List[Statement]:
    statements: List[Statement] = []
    buffer: List[str] = []
    requires: List[str] = []
    once: Optional[str] = None
    for line in sql_text.splitlines():
        trimmed = line.strip()
        if not buffer:
            if not trimmed:
                continue
            if trimmed.startswith("--"):
                match = _DIRECTIVE_RE.match(trimmed)
                if match:
                    if match.group(1).lower() == "requires":
                        requires.extend(part.strip() for part in match.group(2).split(",") if part.strip())
                    else:
                        once = match.group(2).strip()
                continue
        buffer.append(line)
        if trimmed.endswith(";"):
            sql = "\n".join(buffer).strip()
            statements.append(Statement(sql=sql[:-1] if sql.endswith(";") else sql, requires=requires, once=once))
            buffer, requires, once = [], [], None
    if "".join(buffer).strip():
        raise ValueError("schema.sql ends with an unterminated statement")
    return statements


def schema_fingerprint(sql_text: str) -> str:
    normalized = sql_text.replace("\r\n", "\n")
    return "schema:" + hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:32]


def read_schema() -> str:
    # newline="" keeps the bytes as they are on disk; the fingerprint normalises CRLF itself.
    with open(SCHEMA_PATH, "r", encoding="utf-8", newline="") as handle:
        return handle.read()


async def apply_schema(engine: AsyncEngine, sql_text: Optional[str] = None) -> bool:
    """Returns True when statements were executed, False when already up to date."""
    if engine.dialect.name != "postgresql":
        logger.warning("WhatsApp module requires PostgreSQL; schema not applied on %s", engine.dialect.name)
        return False

    text_ = sql_text if sql_text is not None else read_schema()
    statements = parse_schema(text_)
    fingerprint = schema_fingerprint(text_)

    async with engine.begin() as conn:
        await conn.exec_driver_sql(f"SELECT pg_advisory_xact_lock({SCHEMA_LOCK_KEY})")

        meta = await conn.exec_driver_sql("SELECT to_regclass('whatsapp_schema_meta') IS NOT NULL")
        if meta.scalar():
            current = await conn.exec_driver_sql("SELECT 1 FROM whatsapp_schema_meta WHERE name = $1", (fingerprint,))
            if current.first() is not None:
                return False

        all_prerequisites_met = True
        for statement in statements:
            if statement.requires:
                missing = False
                for table in statement.requires:
                    exists = await conn.exec_driver_sql("SELECT to_regclass($1) IS NOT NULL", (table,))
                    if not exists.scalar():
                        missing = True
                if missing:
                    all_prerequisites_met = False
                    continue
            if statement.once:
                done = await conn.exec_driver_sql("SELECT 1 FROM whatsapp_schema_meta WHERE name = $1", (statement.once,))
                if done.first() is not None:
                    continue
            await conn.exec_driver_sql(statement.sql)
            if statement.once:
                await conn.exec_driver_sql(
                    "INSERT INTO whatsapp_schema_meta (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", (statement.once,)
                )
        if all_prerequisites_met:
            await conn.exec_driver_sql(
                "INSERT INTO whatsapp_schema_meta (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", (fingerprint,)
            )
    logger.info("WhatsApp schema applied")
    return True
