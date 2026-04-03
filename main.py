from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import requests
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

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
# 請將這裡替換為您的 Kie.ai API Key
KIE_API_KEY = "938b4121855a024f149ecdb79143d4ab" 
KIE_BASE_URL = "https://api.kie.ai"

# ==========================================
# 📦 資料模型
# ==========================================
class VideoGenerateRequest(BaseModel):
    image_b64: str
    prompt: str

# ==========================================
# 🚀 核心 API：提交影片生成任務
# ==========================================
@app.post("/api/generate_video")
async def generate_video(req: VideoGenerateRequest):
    try:
        headers = {
            "Authorization": f"Bearer {KIE_API_KEY}",
            "Content-Type": "application/json"
        }
        
        # 依照您的極簡需求，強制鎖定 model 與 normal 模式
        payload = {
            "model": "grok-imagine/image-to-video",
            "input": {
                "image_urls": [req.image_b64], 
                "prompt": req.prompt,
                "mode": "normal", # 強制使用 normal 風格
                "duration": "6",
                "resolution": "480p",
                "aspect_ratio": "16:9"
            }
        }

        response = requests.post(f"{KIE_BASE_URL}/api/v1/jobs/createTask", headers=headers, json=payload)
        res_data = response.json()

        if response.status_code == 200 and res_data.get("code") == 200:
            task_id = res_data.get("data", {}).get("taskId")
            return {"status": "processing", "task_id": task_id}
        else:
            raise HTTPException(status_code=500, detail=f"API 建立失敗: {res_data}")

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 🔍 核心 API：輪詢查詢任務狀態
# ==========================================
@app.get("/api/status/{task_id}")
async def check_status(task_id: str):
    try:
        headers = {"Authorization": f"Bearer {KIE_API_KEY}"}
        # 完美避開路由陷阱，使用 Query Parameter 傳遞
        status_url = f"{KIE_BASE_URL}/api/status?task_id={task_id}" 
        
        response = requests.get(status_url, headers=headers)
        
        # 若 Kie.ai 尚未實現標準的 status API，我們做基本容錯
        if response.status_code != 200:
            return {"status": "processing"}
            
        res_data = response.json()
        
        if res_data.get("code") == 200:
            data_block = res_data.get("data", {})
            status = str(data_block.get("status", "")).lower()
            
            # 判斷是否完成
            if status in ["completed", "success", "done", "200"]:
                # 暴力抓取影片網址
                video_url = data_block.get("video_url") or data_block.get("video")
                if not video_url and isinstance(data_block.get("result"), list) and len(data_block["result"]) > 0:
                    video_url = data_block["result"][0].get("video") or data_block["result"][0].get("image")
                    
                if video_url:
                    return {"status": "completed", "video_url": video_url}
                else:
                    return {"status": "failed", "detail": "已完成但找不到影片網址"}
            elif status in ["failed", "error"]:
                return {"status": "failed", "detail": "AI 生成失敗"}
            else:
                return {"status": "processing"}
        else:
            return {"status": "processing"}

    except Exception as e:
        return {"status": "processing", "detail": str(e)}

# ==========================================
# 🌐 網頁與靜態檔案路由 (Render 部署必備)
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