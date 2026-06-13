import asyncio

from fastapi import APIRouter, Depends, HTTPException, Response

from app.auth.dependencies import CurrentUser, get_current_user
from app.schemas import TemplateCreate, TemplateUpdate
from app.services import template_service

router = APIRouter(prefix="/api/v1/templates", tags=["templates"])


@router.get("")
async def list_templates(user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(template_service.list_templates, user.user_id)


@router.post("", status_code=201)
async def create_template(body: TemplateCreate, user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(
        template_service.create_template, user.user_id, body.model_dump()
    )


@router.get("/{template_id}")
async def get_template(template_id: str, user: CurrentUser = Depends(get_current_user)):
    doc = await asyncio.to_thread(template_service.get_template, template_id, user.user_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return doc


@router.put("/{template_id}")
async def update_template(template_id: str, body: TemplateUpdate,
                          user: CurrentUser = Depends(get_current_user)):
    doc = await asyncio.to_thread(
        template_service.update_template, template_id, user.user_id, body.model_dump()
    )
    if doc is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return doc


@router.delete("/{template_id}", status_code=204)
async def delete_template(template_id: str, user: CurrentUser = Depends(get_current_user)):
    ok = await asyncio.to_thread(template_service.delete_template, template_id, user.user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Template not found")
    return Response(status_code=204)
