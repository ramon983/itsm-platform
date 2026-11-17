"""Versioned knowledge base."""

from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import NotFound, PolicyViolation
from app.models import KBArticle, KBArticleVersion


async def next_key(session: AsyncSession) -> str:
    max_id = (await session.execute(select(func.max(KBArticle.id)))).scalar() or 0
    return f"KB-{400 + max_id + 1}"


async def create_article(
    session: AsyncSession, title: str, body: str, tags: list[str], author: str, key: str | None = None
) -> KBArticle:
    key = key or await next_key(session)
    if (await session.execute(select(KBArticle.id).where(KBArticle.key == key))).first():
        raise PolicyViolation(f"{key} already exists")
    article = KBArticle(key=key, title=title, tags=tags, current_version=1)
    article.versions = [KBArticleVersion(version=1, body=body, author=author, change_note="Initial version")]
    session.add(article)
    await session.flush()
    return article


async def get_article(session: AsyncSession, key: str) -> KBArticle:
    stmt = select(KBArticle).where(KBArticle.key == key).options(selectinload(KBArticle.versions))
    article = (await session.execute(stmt)).scalar_one_or_none()
    if article is None:
        raise NotFound(f"{key} not found")
    return article


async def revise_article(
    session: AsyncSession, key: str, body: str, author: str, change_note: str
) -> KBArticle:
    article = await get_article(session, key)
    article.current_version += 1
    article.versions.append(
        KBArticleVersion(version=article.current_version, body=body, author=author, change_note=change_note)
    )
    await session.flush()
    return article


def current_body(article: KBArticle) -> str:
    return next(v.body for v in article.versions if v.version == article.current_version)


async def search(session: AsyncSession, query: str, limit: int = 5) -> list[KBArticle]:
    """Keyword search over title + current body. Swap for pgvector/full-text in production scale-out."""
    terms = [t for t in query.lower().split() if len(t) > 2][:8]
    if not terms:
        return []
    conds = []
    for t in terms:
        like = f"%{t}%"
        conds.append(func.lower(KBArticle.title).like(like))
        conds.append(func.lower(KBArticleVersion.body).like(like))
    stmt = (
        select(KBArticle)
        .join(
            KBArticleVersion,
            (KBArticleVersion.article_id == KBArticle.id)
            & (KBArticleVersion.version == KBArticle.current_version),
        )
        .where(KBArticle.published.is_(True), or_(*conds))
        .options(selectinload(KBArticle.versions))
        .limit(50)
    )
    articles = list((await session.execute(stmt)).scalars().unique())

    def score(a: KBArticle) -> int:
        text = (a.title + " " + current_body(a)).lower()
        return sum(text.count(t) for t in terms)

    return sorted(articles, key=score, reverse=True)[:limit]
