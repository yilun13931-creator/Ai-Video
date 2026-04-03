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
        # 1. 儲存圖片至伺服器端 (強制純英文命名)
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
# 🔍 核心 API：輪詢查詢任務狀態 (Kie.ai 專屬修正版)
# ==========================================
@app.get("/api/status/{task_id}")
async def check_status(task_id: str):
    try:
        headers = {"Authorization": f"Bearer {KIE_API_KEY}"}
        
        # 🚨 關鍵修復：Kie.ai 官方的查詢路由是 recordInfo?taskId=
        status_url = f"{KIE_BASE_URL}/api/v1/jobs/recordInfo?taskId={task_id}" 
        
        response = requests.get(status_url, headers=headers)
        res_data = response.json()
        
        if res_data.get("code") == 200:
            data_block = res_data.get("data", {})
            
            # 🚨 關鍵修復：Kie.ai 的狀態欄位叫做 'state'
            state = str(data_block.get("state", data_block.get("status", ""))).lower()
            
            if state in ["success", "completed", "done", "200"]:
                video_url = None
                
                # 🚨 關鍵修復：嘗試從 resultJson 提取真正的網址
                result_json_str = data_block.get("resultJson")
                if result_json_str:
                    try:
                        parsed_result = json.loads(result_json_str)
                        if isinstance(parsed_result, list) and len(parsed_result) > 0:
                            first_item = parsed_result[0]
                            if isinstance(first_item, str):
                                video_url = first_item  # 直接抓取 ["https://...mp4"] 格式
                            elif isinstance(first_item, dict):
                                video_url = first_item.get("video") or first_item.get("url")
                    except:
                        pass
                
                # 備用抓取邏輯 (防護網)
                if not video_url and "result" in data_block:
                    result_data = data_block["result"]
                    if isinstance(result_data, list) and len(result_data) > 0:
                        first_item = result_data[0]
                        if isinstance(first_item, str):
                            video_url = first_item
                        elif isinstance(first_item, dict):
                            video_url = first_item.get("video") or first_item.get("image") or first_item.get("url")
                            
                if not video_url:
                    video_url = data_block.get("video_url") or data_block.get("video")

                # 回傳給前端
                if video_url:
                    return {"status": "completed", "video_url": video_url}
                else:
                    return {"status": "failed", "detail": f"已成功但找不到影片網址，API 回傳內容: {data_block}"}
                    
            elif state in ["fail", "failed", "error"]:
                fail_msg = data_block.get("failMsg", "AI 生成失敗，請確認圖片或提示詞是否符合規範")
                return {"status": "failed", "detail": fail_msg}
            else:
                # 狀態為 waiting, queuing, generating 時，繼續讓前端轉圈圈
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