import os
import time
import shutil
import json
from fastapi import FastAPI, HTTPException, Request, UploadFile, Form, File
from pydantic import BaseModel
import requests
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="AI 影片生成引擎")

# 解決跨域問題
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# 🔑 系統核心設定區
# ==========================================
KIE_API_KEY = "938b4121855a024f149ecdb79143d4ab" 
KIE_BASE_URL = "https://api.kie.ai"

# ==========================================
# 📂 自動圖床設定
# ==========================================
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# ==========================================
# 🚀 核心 API：提交影片生成任務
# ==========================================
@app.post("/api/generate_video")
async def generate_video(
    request: Request, 
    image: UploadFile = File(...), 
    prompt: str = Form(...)
):
    try:
        # 1. 儲存圖片至伺服器端
        unique_filename = f"img_{int(time.time())}.jpg"
        file_path = os.path.join(UPLOAD_DIR, unique_filename)
        
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(image.file, buffer)
            
        # 2. 自動合成 Render 上的公開網址
        scheme = request.headers.get("x-forwarded-proto", "https")
        host = request.url.netloc
        public_image_url = f"{scheme}://{host}/uploads/{unique_filename}"

        # 3. 發送請求給 Kie.ai
        headers = {
            "Authorization": f"Bearer {KIE_API_KEY}",
            "Content-Type": "application/json"
        }
        
        # 🚨 100% 吻合 Kie.ai 規範：duration 改為純數字
        payload = {
            "model": "grok-imagine/image-to-video",
            "input": {
                "image_urls": [public_image_url], 
                "prompt": prompt,
                "mode": "normal",
                "duration": 15,
                "resolution": "720p"
            }
        }

        response = requests.post(f"{KIE_BASE_URL}/api/v1/jobs/createTask", headers=headers, json=payload)
        
        if response.status_code != 200:
            raise HTTPException(status_code=response.status_code, detail=f"Kie API 拒絕請求: {response.text}")
            
        res_data = response.json()

        # Kie.ai 成功代碼為 200 或 0 或 1
        if res_data.get("code") in [200, 0, 1]:
            task_id = res_data.get("data", {}).get("taskId")
            return {"status": "processing", "task_id": task_id}
        else:
            raise HTTPException(status_code=500, detail=f"API 任務建立失敗: {res_data}")

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 🔍 核心 API：輪詢查詢任務狀態 (精準對焦 resultUrls)
# ==========================================
@app.get("/api/status/{task_id}")
async def check_status(task_id: str):
    try:
        headers = {"Authorization": f"Bearer {KIE_API_KEY}"}
        
        # 🚨 Kie.ai 專屬官方路由
        status_url = f"{KIE_BASE_URL}/api/v1/jobs/recordInfo?taskId={task_id}" 
        
        response = requests.get(status_url, headers=headers)
        res_data = response.json()
        
        if res_data.get("code") in [200, 0, 1]:
            data_block = res_data.get("data", {})
            
            # 狀態解析
            raw_state = data_block.get("state", data_block.get("status", ""))
            state = str(raw_state).lower()
            
            if state in ["success", "completed", "done", "200", "1"]:
                video_url = None
                
                # 🚨 終極解析器：精準抓取您截圖中的 resultUrls 格式
                result_obj = data_block.get("resultJson") or data_block.get("result")
                
                if isinstance(result_obj, str):
                    try:
                        parsed = json.loads(result_obj)
                        if isinstance(parsed, dict):
                            # 🎯 直接瞄準 resultUrls 這個抽屜
                            result_urls = parsed.get("resultUrls")
                            if isinstance(result_urls, list) and len(result_urls) > 0:
                                video_url = result_urls[0]
                            else:
                                video_url = parsed.get("video") or parsed.get("url") or parsed.get("image")
                        elif isinstance(parsed, list) and len(parsed) > 0:
                            item = parsed[0]
                            if isinstance(item, str): video_url = item
                            elif isinstance(item, dict): video_url = item.get("video") or item.get("url")
                    except:
                        video_url = result_obj
                elif isinstance(result_obj, dict):
                    result_urls = result_obj.get("resultUrls")
                    if isinstance(result_urls, list) and len(result_urls) > 0:
                        video_url = result_urls[0]
                    else:
                        video_url = result_obj.get("video") or result_obj.get("url") or result_obj.get("image")
                
                # 防護網
                if not video_url:
                    video_url = data_block.get("video_url") or data_block.get("video")

                if video_url:
                    return {"status": "completed", "video_url": video_url}
                else:
                    return {"status": "failed", "detail": f"影片已生成，但無法提取 Kie.ai 網址。原始回傳：{data_block}"}
                    
            elif state in ["fail", "failed", "error", "2", "3", "-1"]:
                fail_msg = data_block.get("failMsg", "AI 生成失敗，請確認提示詞是否違規")
                return {"status": "failed", "detail": fail_msg}
            else:
                # 處理中狀態
                return {"status": "processing"}
        else:
            return {"status": "failed", "detail": f"伺服器查詢進度失敗: {res_data}"}

    except Exception as e:
        return {"status": "failed", "detail": f"伺服器解析進度時發生錯誤: {str(e)}"}

# ==========================================
# 💾 核心 API：影片跨域下載代理
# ==========================================
@app.get("/api/download_video")
async def download_video(url: str):
    try:
        req = requests.get(url, stream=True)
        if req.status_code == 200:
            return StreamingResponse(
                req.iter_content(chunk_size=1024 * 1024),
                media_type="video/mp4",
                headers={"Content-Disposition": "attachment; filename=AI_Video_720p.mp4"}
            )
        else:
            raise HTTPException(status_code=400, detail="無法取得影片檔案")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 🌐 網頁與靜態檔案路由
# ==========================================
@app.get("/style.css")
async def serve_css(): return FileResponse("style.css")

@app.get("/app.js")
async def serve_js(): return FileResponse("app.js")

@app.get("/")
async def serve_frontend(): return FileResponse("index.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=10000)