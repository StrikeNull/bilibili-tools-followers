"""
B站关注管理工具 - FastAPI 后端
"""
import os
import json
import asyncio
import time
import signal
import threading
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from bilibili_api import BilibiliAPI, BilibiliLogin

app = FastAPI(title="B站关注管理工具", version="1.0.0")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局状态 (简单实现，生产环境建议用session)
_api_instance: Optional[BilibiliAPI] = None
_user_info: Optional[dict] = None
_cached_followings: Optional[list] = None

# 数据增强状态
_enrich_status = {"status": "idle", "current": 0, "total": 0}
_enriched_followings: Optional[list] = None
_enrich_task_ref = None

# 持久化路径
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")


def _get_cache_path(uid: int = None) -> str:
    """获取缓存文件路径（按UID区分）"""
    if uid is None and _user_info:
        uid = _user_info.get("mid")
    if uid:
        return os.path.join(DATA_DIR, f"enriched_{uid}.json")
    return os.path.join(DATA_DIR, "enriched_cache.json")


def _save_enriched_cache(data: list):
    """保存增强数据到磁盘"""
    os.makedirs(DATA_DIR, exist_ok=True)
    path = _get_cache_path()
    with open(path, "w", encoding="utf-8") as fp:
        json.dump({"data": {"list": data, "total": len(data)}}, fp, ensure_ascii=False)
    print(f"已保存增强缓存: {len(data)}人 -> {os.path.basename(path)}")


def _load_enriched_cache() -> Optional[list]:
    """从磁盘加载增强数据"""
    path = _get_cache_path()
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as fp:
            cache = json.load(fp)
        data = cache.get("data", {}).get("list", [])
        if data:
            print(f"已加载增强缓存: {len(data)}人 <- {os.path.basename(path)}")
            return data
    except Exception as e:
        print(f"加载缓存失败: {e}")
    return None


# ==================== 请求/响应模型 ====================

class LoginRequest(BaseModel):
    sessdata: str
    bili_jct: str


class UnfollowRequest(BaseModel):
    fid: int


class BatchUnfollowRequest(BaseModel):
    fids: List[int]


# ==================== API 路由 ====================

@app.post("/api/login")
async def login(req: LoginRequest):
    """登录（设置凭证）"""
    global _api_instance, _user_info, _cached_followings
    _cached_followings = None

    try:
        api = BilibiliAPI(sessdata=req.sessdata, bili_jct=req.bili_jct)
        info = await api.get_my_info()
        _api_instance = api
        _user_info = info
        return {"code": 0, "message": "登录成功", "data": info}
    except Exception as e:
        _api_instance = None
        _user_info = None
        raise HTTPException(status_code=401, detail=f"登录失败: {str(e)}")


@app.get("/api/login/qrcode")
async def get_login_qrcode():
    """获取登录二维码"""
    try:
        data = await BilibiliLogin.generate_qrcode()
        return {"code": 0, "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/login/qrcode/poll")
async def poll_login_qrcode(qrcode_key: str):
    """轮询二维码状态，成功则自动登录"""
    global _api_instance, _user_info, _cached_followings
    try:
        result = await BilibiliLogin.poll_qrcode(qrcode_key)
        if result["status"] == "success":
            # 自动登录
            cookies = result["cookies"]
            sessdata = cookies.get("SESSDATA")
            bili_jct = cookies.get("bili_jct")
            
            if sessdata and bili_jct:
                api = BilibiliAPI(sessdata=sessdata, bili_jct=bili_jct)
                info = await api.get_my_info()
                _api_instance = api
                _user_info = info
                _cached_followings = None
                
                # 将用户信息附加到返回结果中
                result["user_info"] = info
                
        return {"code": 0, "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/logout")
async def logout():
    """登出"""
    global _api_instance, _user_info, _cached_followings
    global _enriched_followings, _enrich_status, _enrich_task_ref
    _api_instance = None
    _user_info = None
    _cached_followings = None
    _enriched_followings = None
    _enrich_status = {"status": "idle", "current": 0, "total": 0}
    if _enrich_task_ref and not _enrich_task_ref.done():
        _enrich_task_ref.cancel()
    _enrich_task_ref = None
    return {"code": 0, "message": "已登出"}


@app.get("/api/user/info")
async def get_user_info():
    """获取当前用户信息"""
    if not _api_instance or not _user_info:
        raise HTTPException(status_code=401, detail="未登录")
    return {"code": 0, "data": _user_info}


@app.get("/api/followings")
async def get_followings(
    pn: int = Query(1, ge=1, description="页码"),
    ps: int = Query(50, ge=1, le=50, description="每页数量"),
    order_type: str = Query("", description="排序 空=最近关注 attention=最常访问"),
):
    """获取关注列表（分页）"""
    if not _api_instance or not _user_info:
        raise HTTPException(status_code=401, detail="未登录")

    try:
        data = await _api_instance.get_followings_page(
            vmid=_user_info["mid"], pn=pn, ps=ps, order_type=order_type
        )
        return {"code": 0, "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/followings/all")
async def get_all_followings(use_cache: bool = Query(True)):
    """获取所有关注（用于分析）"""
    global _cached_followings
    if not _api_instance or not _user_info:
        raise HTTPException(status_code=401, detail="未登录")

    try:
        if use_cache and _cached_followings is not None:
            return {"code": 0, "data": _cached_followings}

        followings = await _api_instance.get_all_followings(
            vmid=_user_info["mid"]
        )
        _cached_followings = followings
        return {"code": 0, "data": followings}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/followings/tags")
async def get_follow_tags():
    """获取关注分组"""
    if not _api_instance:
        raise HTTPException(status_code=401, detail="未登录")

    try:
        data = await _api_instance.get_follow_tags()
        return {"code": 0, "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/followings/analyze")
async def analyze_followings():
    """分析关注数据"""
    global _cached_followings
    if not _api_instance or not _user_info:
        raise HTTPException(status_code=401, detail="未登录")

    try:
        # 优先使用增强数据（含粉丝数和分区）
        source = _enriched_followings
        if source is None:
            if _cached_followings is None:
                _cached_followings = await _api_instance.get_all_followings(
                    vmid=_user_info["mid"]
                )
            source = _cached_followings
        analysis = _api_instance.analyze_followings(source)
        return {"code": 0, "data": analysis}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/unfollow")
async def unfollow(req: UnfollowRequest):
    """取消关注单个用户"""
    global _cached_followings, _enriched_followings
    if not _api_instance:
        raise HTTPException(status_code=401, detail="未登录")

    try:
        await _api_instance.unfollow(req.fid)
        # 清除缓存
        if _cached_followings:
            _cached_followings = [
                f for f in _cached_followings if f.get("mid") != req.fid
            ]
        # 清除增强数据
        if _enriched_followings:
            _enriched_followings = [
                f for f in _enriched_followings if f.get("mid") != req.fid
            ]
            _save_enriched_cache(_enriched_followings)
        return {"code": 0, "message": f"已取消关注 {req.fid}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/unfollow/batch")
async def batch_unfollow(req: BatchUnfollowRequest):
    """批量取消关注"""
    global _cached_followings, _enriched_followings
    if not _api_instance:
        raise HTTPException(status_code=401, detail="未登录")

    if len(req.fids) > 100:
        raise HTTPException(
            status_code=400, detail="单次批量操作最多100个"
        )

    try:
        results = await _api_instance.batch_unfollow(req.fids)
        # 清除成功取关的缓存
        success_mids = {r["mid"] for r in results if r["success"]}
        if _cached_followings:
            _cached_followings = [
                f
                for f in _cached_followings
                if f.get("mid") not in success_mids
            ]
        # 清除增强数据
        if _enriched_followings and success_mids:
            _enriched_followings = [
                f
                for f in _enriched_followings
                if f.get("mid") not in success_mids
            ]
            _save_enriched_cache(_enriched_followings)
        return {"code": 0, "data": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/user/card/{mid}")
async def get_user_card(mid: int):
    """获取用户名片"""
    if not _api_instance:
        raise HTTPException(status_code=401, detail="未登录")
    try:
        data = await _api_instance.get_user_card(mid)
        return {"code": 0, "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 数据增强 ====================

async def _run_enrichment():
    """后台任务：为所有关注用户获取粉丝数和分区信息（支持断点续传）"""
    global _enrich_status, _enriched_followings, _cached_followings

    if not _api_instance or not _user_info:
        _enrich_status = {"status": "error", "current": 0, "total": 0}
        return

    # 确保有全量数据
    if not _cached_followings:
        _cached_followings = await _api_instance.get_all_followings(
            _user_info["mid"]
        )

    followings = _cached_followings
    total = len(followings)
    _enrich_status = {"status": "running", "current": 0, "total": total}

    # 加载已有缓存，建立 mid -> enriched_data 的映射（断点续传）
    existing_cache = {}
    if _enriched_followings:
        for f in _enriched_followings:
            mid = f.get("mid")
            if mid and f.get("fans", -1) >= 0 and f.get("main_partition") not in ("\u672a\u77e5", "\u83b7\u53d6\u5931\u8d25", None):
                existing_cache[mid] = f
    # 也从磁盘缓存加载
    disk_cache = _load_enriched_cache()
    if disk_cache:
        for f in disk_cache:
            mid = f.get("mid")
            if mid and mid not in existing_cache:
                if f.get("fans", -1) >= 0 and f.get("main_partition") not in ("\u672a\u77e5", "\u83b7\u53d6\u5931\u8d25", None):
                    existing_cache[mid] = f

    skipped = 0
    enriched = []
    for i, f in enumerate(followings):
        mid = f.get("mid")

        # 断点续传：已有有效数据且包含新字段则跳过
        if mid in existing_cache:
            cached_item = existing_cache[mid]
            # 检查是否有 last_pub_time 字段（兼容旧缓存）
            if "last_pub_time" in cached_item:
                enriched.append(cached_item)
                skipped += 1
                _enrich_status["current"] = i + 1
                continue

        try:
            result = await _api_instance.enrich_single(f)
            enriched.append(result)
        except asyncio.CancelledError:
            # 取消前保存已有数据
            _enriched_followings = enriched
            _save_enriched_cache(enriched)
            _enrich_status = {"status": "cancelled", "current": i, "total": total}
            return
        except Exception as e:
            print(f"\u589e\u5f3a\u7528\u6237 {f.get('uname', f.get('mid'))} \u5931\u8d25: {e}")
            enriched.append({**f, "fans": -1, "main_partition": "\u83b7\u53d6\u5931\u8d25", "total_videos": 0})

        _enrich_status["current"] = i + 1
        # 实时更新内存数据，前端可随时获取部分结果
        _enriched_followings = enriched

        # 每50人自动保存一次
        if (i + 1) % 50 == 0:
            _save_enriched_cache(enriched)

    _enriched_followings = enriched
    _cached_followings = enriched  # 更新缓存
    _enrich_status = {"status": "done", "current": total, "total": total}

    # 最终保存
    _save_enriched_cache(enriched)
    print(f"\u589e\u5f3a\u5b8c\u6210: 跳\u8fc7 {skipped}/{total}, \u65b0\u83b7\u53d6 {total - skipped}")


@app.post("/api/followings/enrich")
async def start_enrichment():
    """启动数据增强任务"""
    global _enrich_task_ref, _enriched_followings
    if not _api_instance:
        raise HTTPException(status_code=401, detail="未登录")

    if _enrich_task_ref and not _enrich_task_ref.done():
        return {"code": 0, "message": "增强任务已在运行", "data": _enrich_status}

    # 如果内存没有，先从磁盘加载
    if not _enriched_followings:
        disk_cache = _load_enriched_cache()
        if disk_cache:
            _enriched_followings = disk_cache

    _enrich_task_ref = asyncio.create_task(_run_enrichment())
    return {"code": 0, "message": "增强任务已启动", "data": _enrich_status}


@app.post("/api/followings/enrich/stop")
async def stop_enrichment():
    """停止数据增强任务"""
    global _enrich_task_ref
    if _enrich_task_ref and not _enrich_task_ref.done():
        _enrich_task_ref.cancel()
        return {"code": 0, "message": "已发送停止信号"}
    return {"code": 0, "message": "没有正在运行的任务"}


class BatchRefreshRequest(BaseModel):
    mids: List[int]


async def _run_batch_refresh(target_mids: List[int]):
    """后台任务：批量刷新指定用户的数据"""
    global _enrich_status, _enriched_followings, _cached_followings
    
    if not _api_instance or not _user_info:
        _enrich_status = {"status": "error", "current": 0, "total": 0}
        return

    # 确保当前有增强数据的基础
    if not _enriched_followings:
        disk_cache = _load_enriched_cache()
        if disk_cache:
            _enriched_followings = disk_cache
        else:
            # 如果完全没有，就用基础关注列表
            _enriched_followings = list(_cached_followings) if _cached_followings else []

    # 建立 mid -> index 索引，方便快速更新
    mid_to_index = {f.get("mid"): i for i, f in enumerate(_enriched_followings)}
    
    # 找出实际需要更新的对象
    targets = []
    # 即使 _cached_followings 还是 None (未全量获取过？)，也能从 _enriched_followings 找到？
    # 通常进入批量管理前肯定已经获取了列表。
    
    # 这里我们直接从 _enriched_followings 里找基础信息（mid, uname 等）
    # 如果找不到（比如是新增关注但还没刷出来），可能需要从 _cached_followings 找。
    # 假设前端传来的 mids 肯定在当前的列表中。
    
    for mid in target_mids:
        idx = mid_to_index.get(mid)
        if idx is not None:
             targets.append(_enriched_followings[idx])
             
    total = len(targets)
    _enrich_status = {"status": "running", "current": 0, "total": total}
    
    for i, user in enumerate(targets):
        try:
            # 强制刷新，不走缓存判断
            result = await _api_instance.enrich_single(user)
            
            # 更新全局列表
            idx = mid_to_index.get(user.get("mid"))
            if idx is not None:
                _enriched_followings[idx] = result
                
        except asyncio.CancelledError:
            _enrich_status = {"status": "cancelled", "current": i, "total": total}
            return
        except Exception as e:
            print(f"刷新用户 {user.get('uname')} 失败: {e}")
            
        _enrich_status["current"] = i + 1
        
        # 每10个保存一次
        if (i + 1) % 10 == 0:
            _save_enriched_cache(_enriched_followings)
            
    _enrich_status = {"status": "done", "current": total, "total": total}
    _save_enriched_cache(_enriched_followings)


@app.post("/api/followings/enrich/batch_refresh")
async def batch_refresh_enrichment(req: BatchRefreshRequest):
    """启动批量刷新任务"""
    global _enrich_task_ref
    
    if not _api_instance:
        raise HTTPException(status_code=401, detail="未登录")

    if _enrich_task_ref and not _enrich_task_ref.done():
        return {"code": 0, "message": "已有任务在运行", "data": _enrich_status}

    _enrich_task_ref = asyncio.create_task(_run_batch_refresh(req.mids))
    return {"code": 0, "message": "批量刷新已启动", "data": _enrich_status}


@app.get("/api/followings/enrich/status")
async def get_enrichment_status():
    """查询增强任务进度"""
    return {"code": 0, "data": _enrich_status}


@app.get("/api/followings/enriched")
async def get_enriched_followings():
    """获取增强后的关注数据"""
    global _enriched_followings

    # 内存没有则尝试从磁盘加载
    if _enriched_followings is None:
        disk_cache = _load_enriched_cache()
        if disk_cache:
            _enriched_followings = disk_cache

    if _enriched_followings is None:
        raise HTTPException(status_code=404, detail="尚未加载详细数据")

    # 收集去重分区列表
    partitions = set()
    for f in _enriched_followings:
        p = f.get("main_partition")
        if p and p not in ("未知", "获取失败"):
            partitions.add(p)

    return {
        "code": 0,
        "data": {
            "list": _enriched_followings,
            "partitions": sorted(list(partitions)),
            "total": len(_enriched_followings),
        },
    }


@app.post("/api/system/shutdown")
async def shutdown_system():
    """关闭服务器"""
    def _shutdown():
        try:
            time.sleep(1)
            os.kill(os.getpid(), signal.SIGINT)
        except Exception:
            os._exit(0)
    threading.Thread(target=_shutdown).start()
    return {"code": 0, "message": "服务正在关闭"}


# ==================== 静态文件服务 ====================

# ==================== 静态文件 ====================

import sys

# 确定前端目录路径（兼容 PyInstaller 打包）
if getattr(sys, "frozen", False):
    # 打包环境: frontend 被解压到 sys._MEIPASS/frontend
    base_dir = sys._MEIPASS
    frontend_dir = os.path.join(base_dir, "frontend")
else:
    # 开发环境: backend/main.py -> ../frontend
    base_dir = os.path.dirname(os.path.abspath(__file__))
    frontend_dir = os.path.join(os.path.dirname(base_dir), "frontend")

if not os.path.exists(frontend_dir):
    print(f"Warning: Frontend directory not found at {frontend_dir}")


@app.get("/")
async def serve_index():
    """服务首页"""
    return FileResponse(os.path.join(frontend_dir, "index.html"))


# 挂载静态资源（统一挂载根路径，覆盖上面的 /css 和 /js）
app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    import threading
    import webbrowser
    import multiprocessing
    multiprocessing.freeze_support()  # Windows 打包必需

    def _open_browser():
        import time
        time.sleep(1.5)  # 等待服务启动
        webbrowser.open("http://localhost:8000")

    # 仅在打包模式下自动打开浏览器（开发时用 start.sh/start.bat）
    if getattr(sys, "frozen", False):
        threading.Thread(target=_open_browser, daemon=True).start()

    uvicorn.run(app, host="0.0.0.0", port=8000)
