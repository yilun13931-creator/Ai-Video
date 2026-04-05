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
DEFAPI_BASE_URL = "https://api.defapi.org"

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
    prompt: str = Form(...),
    api_key: str = Form(...),
    duration: int = Form(10)
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

        # 3. 發送請求給 Defapi
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json"
        }
        
        payload = {
            "model": "grok-imagine-video",
            "prompt": prompt,
            "image_urls": [public_image_url],
            "duration": str(duration),
            "aspect_ratio": "9:16"
        }

        response = requests.post(f"{DEFAPI_BASE_URL}/api/grok-imagine-video/gen", headers=headers, json=payload)
        
        if response.status_code != 200:
            raise HTTPException(status_code=response.status_code, detail=f"Defapi 拒絕請求: {response.text}")
            
        res_data = response.json()
        task_id = res_data.get("data", {}).get("task_id") or res_data.get("task_id")
        
        if task_id:
            return {"status": "processing", "task_id": task_id}
        else:
            raise HTTPException(status_code=500, detail=f"API 任務建立失敗: {res_data}")

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 🔍 核心 API：輪詢查詢任務狀態
# ==========================================
@app.get("/api/status/{task_id}")
async def check_status(task_id: str, api_key: str):
    try:
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json"
        }
        
        status_url = f"{DEFAPI_BASE_URL}/api/task/query?task_id={task_id}" 
        response = requests.get(status_url, headers=headers)
        res_data = response.json()
        
        # 提取資料區塊
        data_block = res_data.get("data", res_data)
        raw_state = data_block.get("state", data_block.get("status", ""))
        state = str(raw_state).lower()
        
        # 💡 關鍵修復：針對您截圖中的結構進行多層次網址提取
        if state in ["success", "completed", "done", "200", "1"]:
            video_url = None
            
            # 1. 優先檢查巢狀結構 result -> video (這就是您截圖中的格式)
            result_obj = data_block.get("result")
            if isinstance(result_obj, dict):
                video_url = result_obj.get("video") or result_obj.get("url")
            
            # 2. 備案：檢查最外層
            if not video_url:
                video_url = data_block.get("video_url") or data_block.get("video") or data_block.get("url")
            
            # 3. 備案：檢查 result 是否為字串或列表
            if not video_url and result_obj:
                if isinstance(result_obj, str): video_url = result_obj
                elif isinstance(result_obj, list) and len(result_obj) > 0:
                    video_url = result_obj[0] if isinstance(result_obj[0], str) else result_obj[0].get("video")

            if video_url:
                return {"status": "completed", "video_url": video_url}
            else:
                return {"status": "failed", "detail": f"影片已生成，但解析邏輯未抓到網址。內容：{data_block}"}
                
        elif state in ["fail", "failed", "error", "2", "3", "-1"]:
            fail_msg = data_block.get("failMsg", data_block.get("error", "AI 生成失敗"))
            return {"status": "failed", "detail": fail_msg}
        else:
            return {"status": "processing"}

    except Exception as e:
        return {"status": "failed", "detail": f"伺服器解析進度時發生錯誤: {str(e)}"}

# ==========================================
# 💾 核心 API：影片下載與路由 (維持不變)
# ==========================================
@app.get("/api/download_video")
async def download_video(url: str):
    try:
        req = requests.get(url, stream=True)
        if req.status_code == 200:
            return StreamingResponse(
                req.iter_content(chunk_size=1024 * 1024),
                media_type="video/mp4",
                headers={"Content-Disposition": "attachment; filename=AI_Video.mp4"}
            )
        else:
            raise HTTPException(status_code=400, detail="無法取得影片檔案")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/style.css")
async def serve_css(): return FileResponse("style.css")
@app.get("/app.js")
async def serve_js(): return FileResponse("app.js")
@app.get("/")
async def serve_frontend(): return FileResponse("index.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=10000)