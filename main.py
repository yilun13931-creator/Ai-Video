import os
import time
import shutil
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
        # 1. 儲存圖片至伺服器端 (強制純英文命名，避開中文檔名 500 報錯地雷)
        unique_filename = f"img_{int(time.time())}.jpg"
        file_path = os.path.join(UPLOAD_DIR, unique_filename)
        
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(image.file, buffer)
            
        # 2. 自動合成 Render 上的公開網址 (強制抓取 https 協議)
        scheme = request.headers.get("x-forwarded-proto", "https")
        host = request.url.netloc
        public_image_url = f"{scheme}://{host}/uploads/{unique_filename}"

        # 3. 發送請求給 Kie.ai
        headers = {
            "Authorization": f"Bearer {KIE_API_KEY}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": "grok-imagine/image-to-video",
            "input": {
                "image_urls": [public_image_url], 
                "prompt": prompt,
                "mode": "normal",
                "duration": "15",
                "resolution": "720p"
            }
        }

        response = requests.post(f"{KIE_BASE_URL}/api/v1/jobs/createTask", headers=headers, json=payload)
        
        if response.status_code != 200:
            raise HTTPException(status_code=response.status_code, detail=f"Kie API 拒絕請求: {response.text}")
            
        res_data = response.json()

        if res_data.get("code") == 200:
            task_id = res_data.get("data", {}).get("taskId")
            return {"status": "processing", "task_id": task_id}
        else:
            raise HTTPException(status_code=500, detail=f"API 任務建立失敗: {res_data}")

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 🔍 核心 API：輪詢查詢任務狀態
# ==========================================
@app.get("/api/status/{task_id}")
async def check_status(task_id: str):
    try:
        headers = {"Authorization": f"Bearer {KIE_API_KEY}"}
        status_url = f"{KIE_BASE_URL}/api/status?task_id={task_id}" 
        
        response = requests.get(status_url, headers=headers)
        
        if response.status_code != 200:
            return {"status": "processing", "detail": f"Waiting for API... {response.status_code}"}
            
        res_data = response.json()
        
        if res_data.get("code") == 200:
            data_block = res_data.get("data", {})
            status = str(data_block.get("status", "")).lower()
            
            if status in ["completed", "success", "done", "200"]:
                video_url = None
                
                # --- 💡 萬能解析引擎 (精準捕捉 MP4 陣列) ---
                video_url = data_block.get("video_url") or data_block.get("video")
                if not video_url and "result" in data_block:
                    result_data = data_block["result"]
                    if isinstance(result_data, list) and len(result_data) > 0:
                        first_item = result_data[0]
                        if isinstance(first_item, str):
                            video_url = first_item
                        elif isinstance(first_item, dict):
                            video_url = first_item.get("video") or first_item.get("image") or first_item.get("url")
                    elif isinstance(result_data, str):
                        video_url = result_data
                # ----------------------
                
                if video_url:
                    return {"status": "completed", "video_url": video_url}
                else:
                    return {"status": "failed", "detail": f"已完成但解析不到網址，API 回傳內容: {data_block}"}
                    
            elif status in ["failed", "error"]:
                return {"status": "failed", "detail": "AI 生成失敗"}
            else:
                return {"status": "processing"}
        else:
            return {"status": "processing"}

    except Exception as e:
        return {"status": "failed", "detail": f"伺服器解析進度時發生錯誤: {str(e)}"}

# ==========================================
# 💾 核心 API：影片跨域下載代理 (解決影片開新分頁不下載的問題)
# ==========================================
@app.get("/api/download_video")
async def download_video(url: str):
    try:
        # 使用 stream=True 進行串流下載，保護伺服器記憶體不爆炸
        req = requests.get(url, stream=True)
        if req.status_code == 200:
            return StreamingResponse(
                req.iter_content(chunk_size=1024 * 1024), # 每次處理 1MB
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
async def serve_css():
    return FileResponse("style.css")

@app.get("/app.js")
async def serve_js():
    return FileResponse("app.js")

@app.get("/")
async def serve_frontend():
    return FileResponse("index.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=10000)